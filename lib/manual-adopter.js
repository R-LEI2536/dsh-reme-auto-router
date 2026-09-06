/**
 * reme-auto-router — ManualAdopter: periodically scan the configured
 * port range and adopt user-launched reme processes into the
 * ProcessManager.
 *
 * A user-launched reme carries `workspace_dir=<cwd> service.port=<port>`
 * on its command line but does NOT carry the
 * `--reme-managed-by=reme-auto-router` marker. For every listening
 * port in `[cfg.ports.base, cfg.ports.base + cfg.ports.range)`:
 *
 *   1. TCP probe — is anyone listening?
 *   2. Identify the owning pid via `lsof`
 *   3. Read the cmdline via `/proc/<pid>/cmdline` (Linux) or
 *      `ps -p <pid> -o args=` (macOS). Windows is not supported in v1.
 *   4. Parse `workspace_dir=` and `service.port=`; reject if marker
 *      is present (our own instance)
 *   5. Realpath the cwd; skip when the manager already tracks it
 *   6. `manager.adopt(realCwd, port, pid)`
 *
 * The scan re-arms itself on completion with a fixed interval.
 * Respects `cfg.adoptManual: false` by skipping the scan entirely.
 * Updates `state.json` `lastScanAt` after each successful sweep.
 *
 * @module reme-auto-router/manual-adopter
 */
import { execFile } from 'node:child_process';
import { readFile, realpath } from 'node:fs/promises';
import { platform } from 'node:os';
import * as net from 'node:net';
import { sep } from 'node:path';
import { promisify } from 'node:util';
import { REME_MANAGED_MARKER } from "./settings-schema.js";
const execFileAsync = promisify(execFile);
/** Time between scans in milliseconds. */
const SCAN_INTERVAL_MS = 30_000;
/** Per-port probe timeout. */
const PROBE_TIMEOUT_MS = 200;
/** Per-port `lsof` execution timeout. */
const LSOF_TIMEOUT_MS = 1_000;
/** Per-pid `ps` execution timeout (macOS path). */
const PS_TIMEOUT_MS = 1_000;
/**
 * Periodic scanner that adopts user-launched reme processes into the
 * ProcessManager. Inert until `start()` is called.
 */
export class ManualAdopter {
    ctx;
    manager;
    store;
    settings;
    logger;
    scanDispose;
    scanning = false;
    constructor(deps) {
        this.ctx = deps.ctx;
        this.manager = deps.manager;
        this.store = deps.store;
        this.settings = deps.settings;
        this.logger = deps.logger;
    }
    /** Schedule the first scan; subsequent scans re-arm themselves. */
    start() {
        if (this.scanDispose !== undefined)
            return;
        this.scheduleNext(0);
    }
    /** Cancel the next scheduled scan. Idempotent. */
    stop() {
        this.scanDispose?.();
        this.scanDispose = undefined;
    }
    scheduleNext(delayMs) {
        this.scanDispose?.();
        this.scanDispose = this.ctx.timer.setTimeout(() => {
            this.scanDispose = undefined;
            void this.runOnce().finally(() => {
                if (this.scanDispose === undefined)
                    this.scheduleNext(SCAN_INTERVAL_MS);
            });
        }, delayMs);
    }
    /** One full scan pass. */
    async runOnce() {
        if (this.scanning)
            return;
        this.scanning = true;
        try {
            const cfg = this.settings();
            if (!cfg.adoptManual)
                return;
            const { base, range } = cfg.ports;
            const host = '127.0.0.1';
            const known = this.collectKnown();
            for (let offset = 0; offset < range; offset++) {
                const port = base + offset;
                if (known.has(port))
                    continue;
                try {
                    const listening = await tryConnect(host, port, PROBE_TIMEOUT_MS);
                    if (!listening)
                        continue;
                    await this.adoptListening(port);
                }
                catch (error) {
                    const reason = error instanceof Error ? error.message : String(error);
                    this.logger.warn(`reme-auto-router: scan of port ${String(port)} failed (${reason})`);
                }
            }
            await this.store.touchScan();
        }
        finally {
            this.scanning = false;
        }
    }
    collectKnown() {
        const ports = new Set();
        for (const [, instance] of this.manager.entries()) {
            ports.add(instance.port);
        }
        return ports;
    }
    async adoptListening(port) {
        const pid = await this.pidForPort(port);
        if (pid === undefined)
            return;
        const cmdline = await this.cmdlineForPid(pid);
        if (cmdline === undefined)
            return;
        if (!cmdline.includes('workspace_dir='))
            return;
        if (cmdline.includes(REME_MANAGED_MARKER))
            return;
        const parsed = parseRemeInvocation(cmdline, port);
        if (parsed === undefined)
            return;
        let realCwd;
        try {
            const canonical = await realpath(parsed.cwd);
            realCwd = canonical.endsWith(sep) ? canonical.slice(0, -1) : canonical;
        }
        catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            this.logger.warn(`reme-auto-router: skip adopt port=${String(port)}: cwd '${parsed.cwd}' does not resolve (${reason})`);
            return;
        }
        if (this.manager.get(realCwd) !== undefined)
            return;
        this.manager.adopt(realCwd, port, pid);
        this.logger.info?.(`reme-auto-router: adopted user reme pid=${String(pid)} port=${String(port)} cwd=${realCwd}`);
    }
    async pidForPort(port) {
        try {
            const { stdout } = await execFileAsync('lsof', ['-nP', `-iTCP:${String(port)}`, '-sTCP:LISTEN', '-F', 'p'], { encoding: 'utf8', timeout: LSOF_TIMEOUT_MS });
            for (const line of stdout.split('\n')) {
                if (!line.startsWith('p'))
                    continue;
                const value = Number.parseInt(line.slice(1), 10);
                if (Number.isFinite(value) && value > 0)
                    return value;
            }
            return undefined;
        }
        catch {
            return undefined;
        }
    }
    async cmdlineForPid(pid) {
        if (platform() === 'linux') {
            try {
                const raw = await readFile(`/proc/${String(pid)}/cmdline`, 'utf8');
                return raw.split('\0').filter((segment) => segment.length > 0).join(' ');
            }
            catch {
                return undefined;
            }
        }
        if (platform() === 'darwin') {
            try {
                const { stdout } = await execFileAsync('ps', ['-p', String(pid), '-o', 'args='], {
                    encoding: 'utf8',
                    timeout: PS_TIMEOUT_MS,
                });
                return stdout.trim();
            }
            catch {
                return undefined;
            }
        }
        return undefined;
    }
}
/** Parse `workspace_dir=<cwd>` and confirm `service.port=<port>` matches. */
function parseRemeInvocation(cmdline, expectedPort) {
    const args = cmdline.split(/\s+/).filter((arg) => arg.length > 0);
    let cwd;
    let port;
    for (const arg of args) {
        if (arg.startsWith('workspace_dir=')) {
            cwd = arg.slice('workspace_dir='.length);
            continue;
        }
        if (arg.startsWith('service.port=')) {
            port = Number.parseInt(arg.slice('service.port='.length), 10);
        }
    }
    if (cwd === undefined || cwd.length === 0)
        return undefined;
    if (port !== undefined && port !== expectedPort)
        return undefined;
    return { cwd };
}
/** Single TCP-connect probe with a hard timeout. */
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
