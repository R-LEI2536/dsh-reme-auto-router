/**
 * reme-auto-router — Shutdown: stop managed reme processes on plugin
 * teardown.
 *
 * Walks every entry in the ProcessManager and stops the ones this
 * plugin owns (`ownership === 'managed'`) and that are not pinned.
 * Pinned cwds and adopted (user-launched) instances are intentionally
 * skipped — those survive across DSH restarts.
 *
 * Stop sequence (per instance):
 *   1. If `cfg.waitForIdleBeforeShutdown` is true, poll the reme
 *      `/status` endpoint until in-flight tasks drop to zero,
 *      bounded by `cfg.maxShutdownWaitMs`. Failures or timeouts fall
 *      through to step 2 so shutdown never blocks on a sick reme.
 *   2. `inst.handle.terminate()` — the SubprocessHandle escalates
 *      SIGTERM → graceMs → SIGKILL on its own.
 *   3. `await inst.handle.waitForExit(undefined)` — confirm whole-tree exit.
 *
 * All stops run in parallel via `Promise.allSettled`. The whole
 * shutdown is also bound by `cfg.maxShutdownWaitMs + cfg.shutdownGraceMs`
 * via a race against a timer; if the bound elapses, we return and
 * let the background waitForExit settle on its own.
 *
 * @module reme-auto-router/shutdown
 */
import type { RemeAutoRouterSettings } from './settings-schema.ts';
import type { ProcessManager } from './process-manager.ts';
/** Logger surface this module depends on. */
export interface ShutdownLogger {
    info?(message: string): void;
    warn(message: string): void;
}
/** Run the shutdown sequence against every stoppable instance. */
export declare function runShutdown(manager: Pick<ProcessManager, 'entries' | 'stop'>, cfg: RemeAutoRouterSettings, logger: ShutdownLogger): Promise<void>;
//# sourceMappingURL=shutdown.d.ts.map