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
import type { Context } from '@deepseek-ai/cordis';
import type { RemeAutoRouterSettings } from './settings-schema.ts';
import type { ProcessManager } from './process-manager.ts';
import type { StateStore } from './state-store.ts';
/** Logger surface this module depends on. */
export interface AdopterLogger {
    warn(message: string): void;
    info?(message: string): void;
}
/** Construction inputs. */
export interface ManualAdopterDeps {
    ctx: Context;
    manager: Pick<ProcessManager, 'get' | 'entries' | 'adopt'>;
    store: StateStore;
    settings: () => RemeAutoRouterSettings;
    logger: AdopterLogger;
}
/**
 * Periodic scanner that adopts user-launched reme processes into the
 * ProcessManager. Inert until `start()` is called.
 */
export declare class ManualAdopter {
    private readonly ctx;
    private readonly manager;
    private readonly store;
    private readonly settings;
    private readonly logger;
    private scanDispose;
    private scanning;
    constructor(deps: ManualAdopterDeps);
    /** Schedule the first scan; subsequent scans re-arm themselves. */
    start(): void;
    /** Cancel the next scheduled scan. Idempotent. */
    stop(): void;
    private scheduleNext;
    /** One full scan pass. */
    runOnce(): Promise<void>;
    private collectKnown;
    private adoptListening;
    private pidForPort;
    private cmdlineForPid;
}
//# sourceMappingURL=manual-adopter.d.ts.map