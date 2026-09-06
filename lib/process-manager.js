/**
 * reme-auto-router — ProcessManager: spawn, idle-time, and stop reme per
 * cwd.
 *
 * Holds the live `Map<cwd, RemeInstance>` for the plugin. Spawns on
 * demand via `ctx.subprocess.spawn`, tracks port readiness through a
 * bounded TCP probe, and enforces the idle timeout. Pinned cwds
 * never idle-stop.
 *
 * The Manager never decides which cwd is active — that's
 * `WorkspaceDetector`'s job. It only answers `ensure(cwd)` /
 * `touch(cwd)` / `release(cwd)` / `shutdownAll()` and emits state
 * changes via the optional listener.
 *
 * @module reme-auto-router/process-manager
 */
import * as net from 'node:net';
import { REME_MANAGED_MARKER } from "./settings-schema.js";
/** Time budget for the initial port-bind probe loop. */
const PROBE_TOTAL_MS = 5_000;
/** Per-attempt probe timeout. */
const PROBE_TIMEOUT_MS = 500;
/** Delay between failed probes. */
const PROBE_BACKOFF_MS = 200;
export class ProcessManager {
    instances = new Map();
    idleTimers = new Map();
    listeners = new Set();
    dep;
    constructor(deps) {
        this.dep = deps;
    }
    /** Subscribe to state transitions. Returns the disposer. */
    onStateChange(listener) {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }
    /** Read-only snapshot of all live instances (including adopted). */
    entries() {
        return this.instances.entries();
    }
    /** Lookup one cwd; returns undefined when the cwd is not tracked. */
    get(cwd) {
        return this.instances.get(cwd);
    }
    /**
     * Make sure the cwd has a ready reme instance. Returns the instance
     * after status reaches `ready` (or `unavailable` if spawn failed).
     *
     * Idempotent: re-calling for the same cwd resets the idle timer.
     */
    async ensure(cwd) {
        const existing = this.instances.get(cwd);
        if (existing !== undefined) {
            this.touch(cwd);
            if (existing.status === 'ready' || existing.status === 'starting')
                return existing;
            // existing.status === 'unavailable' — fall through to retry spawn below
        }
        return await this.spawn(cwd);
    }
    /** Reset the idle timer for one cwd. */
    touch(cwd) {
        const inst = this.instances.get(cwd);
        if (inst === undefined)
            return;
        inst.lastUsedAt = new Date().toISOString();
        void this.dep.store.replaceRecord({ ...toRecord(inst) });
        this.scheduleIdle(cwd);
    }
    /**
     * Spawn a reme instance for cwd if not present. Always returns the
     * instance (possibly in `starting` status). Throws only if the cwd
     * cannot be canonicalised or port allocation fails.
     */
    async spawn(cwd) {
        const cfg = this.dep.settings();
        const port = this.dep.store.allocatePort(cfg.ports.base, cfg.ports.range);
        // We deliberately omit `workspace_dir=<cwd>` from the argv. ReMe's
        // `workspace_dir` defaults to the literal string `.reme` and resolves
        // relative to the reme process's CWD. Combined with `cwd` below, the
        // data lands at `<workspace>/.reme/{daily,digest,metadata,session,
        // mem_session,resource,logs}/` — keeping the workspace clean instead of
        // littering its root with seven visible directories. Hard-coding an
        // absolute path here would defeat the relative-path convention reme
        // ships with.
        const argv = [
            'reme',
            'start',
            `service.port=${String(port)}`,
            REME_MANAGED_MARKER,
        ];
        const handle = this.dep.ctx.subprocess.spawn({
            argv,
            cwd,
            stdio: {
                stdin: 'ignore',
                stdout: { maxBytes: 64 * 1024 },
                stderr: { maxBytes: 64 * 1024 },
            },
            graceMs: 5_000,
        });
        const now = new Date().toISOString();
        const instance = {
            cwd,
            port,
            pid: handle.pid,
            ownership: 'managed',
            status: 'starting',
            handle,
            startedAt: now,
            lastUsedAt: now,
        };
        this.instances.set(cwd, instance);
        void this.dep.store.replaceRecord(toRecord(instance));
        // Probe for port readiness in the background; resolve immediately with `starting`.
        void this.probeReady(instance).then((status) => {
            if (this.instances.get(cwd) !== instance)
                return; // superseded
            instance.status = status;
            if (status === 'unavailable') {
                instance.lastError = 'port did not bind within probe window';
                this.dep.logger.warn(`reme-auto-router: ${cwd} failed to bind port ${String(port)}`);
            }
            this.emit(cwd, instance);
            void this.dep.store.replaceRecord(toRecord(instance));
        });
        handle.done
            .then((outcome) => {
            if (this.instances.get(cwd) !== instance)
                return; // superseded
            // Process exited unexpectedly before/after reaching ready.
            if (instance.status !== 'unavailable') {
                instance.status = 'unavailable';
                instance.lastError = `process exited code=${String(outcome.exitCode)} signal=${outcome.signal ?? 'none'}`;
                this.emit(cwd, instance);
                void this.dep.store.replaceRecord(toRecord(instance));
            }
        })
            .catch(() => {
            /* spawn-level failures: handle.pid === -1; treat as unavailable */
        });
        this.emit(cwd, instance);
        return instance;
    }
    /**
     * Probe `127.0.0.1:port` until it accepts a TCP connection or the total
     * budget elapses. Returns `ready` on success, `unavailable` on timeout.
     */
    async probeReady(instance) {
        const deadline = Date.now() + PROBE_TOTAL_MS;
        while (Date.now() < deadline) {
            const ok = await tryConnect('127.0.0.1', instance.port, PROBE_TIMEOUT_MS);
            if (ok)
                return 'ready';
            await sleep(PROBE_BACKOFF_MS);
        }
        return 'unavailable';
    }
    /**
     * Schedule idle stop for the cwd. Disposed and re-armed on every touch.
     * Pinned cwds never get an idle timer; the existing one (if any) is cleared.
     */
    scheduleIdle(cwd) {
        const dispose = this.idleTimers.get(cwd);
        if (dispose !== undefined) {
            dispose();
            this.idleTimers.delete(cwd);
        }
        const inst = this.instances.get(cwd);
        if (inst === undefined || inst.ownership !== 'managed')
            return;
        const cfg = this.dep.settings();
        if (cfg.pinnedDirs.includes(cwd))
            return; // pin protects the instance
        const timerDispose = this.dep.ctx.timer.setTimeout(() => {
            void this.stop(cwd, 'idle timeout');
        }, cfg.idleTimeoutMs);
        this.idleTimers.set(cwd, timerDispose);
    }
    /**
     * Stop one managed reme instance. Adopted instances are never stopped
     * by us — that's the whole point of the adoption flag.
     */
    async stop(cwd, reason) {
        const inst = this.instances.get(cwd);
        if (inst === undefined)
            return;
        if (inst.ownership !== 'managed')
            return;
        const dispose = this.idleTimers.get(cwd);
        if (dispose !== undefined) {
            dispose();
            this.idleTimers.delete(cwd);
        }
        await terminateTree(inst);
        this.instances.delete(cwd);
        void this.dep.store.removeRecord(cwd);
        this.dep.logger.info?.(`reme-auto-router: stopped ${cwd} (${reason})`);
    }
    /** Adopt a manually-launched reme instance into the map. */
    adopt(cwd, port, pid) {
        const now = new Date().toISOString();
        const instance = {
            cwd,
            port,
            pid,
            ownership: 'adopted',
            status: 'ready',
            startedAt: now,
            lastUsedAt: now,
        };
        this.instances.set(cwd, instance);
        void this.dep.store.replaceRecord(toRecord(instance));
        this.emit(cwd, instance);
        return instance;
    }
    emit(cwd, instance) {
        for (const listener of this.listeners)
            listener(cwd, instance);
    }
}
/** Translate instance → persisted record. */
function toRecord(inst) {
    return {
        cwd: inst.cwd,
        port: inst.port,
        pid: inst.pid,
        ownership: inst.ownership,
        startedAt: inst.startedAt,
        lastUsedAt: inst.lastUsedAt,
    };
}
/**
 * SIGTERM → graceMs → SIGKILL on the SubprocessHandle. The handle's
 * spec already encodes the escalation (its `graceMs` is the SIGTERM→
 * SIGKILL window), so this just fires the verb and awaits full tree exit.
 */
async function terminateTree(inst) {
    const handle = inst.handle;
    if (handle === undefined)
        return;
    if (handle.pid === -1)
        return;
    handle.terminate();
    await handle.waitForExit(undefined);
}
/** One TCP-connect probe with a hard timeout. */
function tryConnect(host, port, timeoutMs) {
    return new Promise((resolve) => {
        const socket = new net.Socket();
        let settled = false;
        const finish = (value) => {
            if (settled)
                return;
            settled = true;
            socket.destroy();
            resolve(value);
        };
        socket.setTimeout(timeoutMs);
        socket.once('connect', () => finish(true));
        socket.once('error', () => finish(false));
        socket.once('timeout', () => finish(false));
        socket.connect(port, host);
    });
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
