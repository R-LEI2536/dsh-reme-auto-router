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
import { Context } from '@deepseek-ai/cordis';
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess';
import type { RemeAutoRouterSettings } from './settings-schema.ts';
import type { StateStore } from './state-store.ts';
/** Lifecycle state of one managed reme instance. */
export type RemeStatus = 'starting' | 'ready' | 'unavailable';
/**
 * Live record kept in ProcessManager's map (extends persisted record).
 *
 * `pid` is optional: 0.1.5's plain `SubprocessHandle` no longer exposes `pid`,
 * so managed instances have `pid` undefined. Adopted instances still carry the
 * OS pid (resolved by `ManualAdopter` via `lsof`), since the user-launched
 * process is independent of our handle.
 */
export interface RemeInstance {
    cwd: string;
    port: number;
    pid?: number;
    ownership: 'managed' | 'adopted';
    status: RemeStatus;
    /** Last error message when status transitions to `unavailable`. */
    lastError?: string;
    /** Process handle (managed only — undefined for adopted). */
    handle?: SubprocessHandle;
    /** ISO timestamps. */
    startedAt: string;
    lastUsedAt: string;
}
/** Listener invoked when a cwd's state changes. */
export type StateChangeListener = (cwd: string, instance: RemeInstance) => void;
/** Constructor inputs. */
export interface ProcessManagerDeps {
    ctx: Context;
    /** Settings accessor — resolved at the call site, not captured at construction. */
    settings: () => RemeAutoRouterSettings;
    /** Durable state store (writes go through here on spawn/stop/touch). */
    store: StateStore;
    /** Logger surface (ctx.logger shape). */
    logger: {
        warn(message: string): void;
        info?(message: string): void;
    };
}
export declare class ProcessManager {
    private readonly instances;
    private readonly idleTimers;
    private readonly listeners;
    private readonly dep;
    constructor(deps: ProcessManagerDeps);
    /** Subscribe to state transitions. Returns the disposer. */
    onStateChange(listener: StateChangeListener): () => void;
    /** Read-only snapshot of all live instances (including adopted). */
    entries(): IterableIterator<[string, RemeInstance]>;
    /** Lookup one cwd; returns undefined when the cwd is not tracked. */
    get(cwd: string): RemeInstance | undefined;
    /**
     * Make sure the cwd has a ready reme instance. Returns the instance
     * after status reaches `ready` (or `unavailable` if spawn failed).
     *
     * Idempotent: re-calling for the same cwd resets the idle timer.
     */
    ensure(cwd: string): Promise<RemeInstance>;
    /** Reset the idle timer for one cwd. */
    touch(cwd: string): void;
    /**
     * Spawn a reme instance for cwd if not present. Always returns the
     * instance (possibly in `starting` status). Throws only if the cwd
     * cannot be canonicalised or port allocation fails.
     */
    private spawn;
    /**
     * Probe `127.0.0.1:port` until it accepts a TCP connection or the total
     * budget elapses. Returns `ready` on success, `unavailable` on timeout.
     */
    private probeReady;
    /**
     * Schedule idle stop for the cwd. Disposed and re-armed on every touch.
     * Pinned cwds never get an idle timer; the existing one (if any) is cleared.
     */
    private scheduleIdle;
    /**
     * Stop one managed reme instance. Adopted instances are never stopped
     * by us — that's the whole point of the adoption flag.
     */
    stop(cwd: string, reason: string): Promise<void>;
    /** Adopt a manually-launched reme instance into the map. */
    adopt(cwd: string, port: number, pid: number): RemeInstance;
    private emit;
}
//# sourceMappingURL=process-manager.d.ts.map