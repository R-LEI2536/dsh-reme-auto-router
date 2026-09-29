/**
 * reme-auto-router — EndpointCoordinator: publish the active cwd's
 * reme port to the official `reme-memory` plugin.
 *
 * The coordinator owns one write path: when the active workspace
 * cwd has a ready reme instance, it calls the live endpoint setter on
 * the `remeMemory` service provided by the official reme-memory
 * plugin (dsh-reme-support). That routes the plugin's HTTP client to
 * the active workspace's reme process without persisting anything —
 * the same live, non-durable semantics the old
 * `ctx.settings['reme-memory'].endpoint` write had under DSH 0.1.5.
 *
 * Trigger sources (subscribed once at construction):
 *   - `manager.onStateChange(...)` — fires when any instance reaches
 *     `ready`; we route only if the changed cwd is the active cwd
 *   - `detector.onActiveCwdChanged(...)` — fires when the active
 *     cwd changes; we route the new cwd regardless of which event
 *     made it ready
 *
 * Failures (remeMemory service missing, the call itself rejecting)
 * are surfaced as one warn log per cause and the function returns.
 * We never throw into the host event loop.
 *
 * @module reme-auto-router/endpoint-coordinator
 */
import type { Context } from '@deepseek-ai/cordis';
import type { ProcessManager } from './process-manager.ts';
/**
 * Live endpoint sink the official reme-memory plugin exposes on its
 * `remeMemory` service. `setEndpoint` repoints the HTTP client at the
 * given URL at runtime; it must not touch persisted configuration.
 */
export interface RemeMemoryEndpointSink {
    setEndpoint(url: string): void;
}
/** Cwd value the detector exposes; undefined when no session runs. */
export type ActiveCwdProvider = () => string | undefined;
/** Logger surface this module depends on. */
export interface CoordinatorLogger {
    warn(message: string): void;
    info?(message: string): void;
}
/** Construction inputs. */
export interface EndpointCoordinatorDeps {
    ctx: Context;
    manager: Pick<ProcessManager, 'get' | 'onStateChange'>;
    activeCwd: ActiveCwdProvider;
    logger: CoordinatorLogger;
    /** Optional override; defaults to `http://127.0.0.1:<port>`. */
    formatEndpoint?: (port: number) => string;
}
/**
 * Reconcile the active-cwd reme endpoint with `ctx.settings['reme-memory']`.
 *
 * The instance is inert until `start()` is called. Re-calling `start()`
 * is a no-op; `stop()` releases both subscriptions and is idempotent.
 */
export declare class EndpointCoordinator {
    private readonly ctx;
    private readonly manager;
    private readonly activeCwd;
    private readonly logger;
    private readonly formatEndpoint;
    /** Per-cause one-shot warn flag so the log never spams. */
    private warnedNoSink;
    /** Disposer for the manager state-change subscription. */
    private stateChangeDispose;
    /** Currently scheduled route call; subsequent ones chain onto the tail. */
    private routeTail;
    constructor(deps: EndpointCoordinatorDeps);
    /** Subscribe to the two trigger sources. Idempotent. */
    start(): void;
    /** Release the manager subscription. Idempotent. */
    stop(): void;
    /**
     * Write the endpoint for `cwd` if a ready instance exists. Chained
     * so concurrent triggers serialize in arrival order; rejections
     * from one call do not poison the queue.
     */
    route(cwd: string | undefined): Promise<void>;
    /** Wait for any in-flight route writes to settle. */
    drain(): Promise<void>;
    private runRoute;
    private readyInstance;
}
//# sourceMappingURL=endpoint-coordinator.d.ts.map