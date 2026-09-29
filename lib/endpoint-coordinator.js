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
/**
 * Reconcile the active-cwd reme endpoint with `ctx.settings['reme-memory']`.
 *
 * The instance is inert until `start()` is called. Re-calling `start()`
 * is a no-op; `stop()` releases both subscriptions and is idempotent.
 */
export class EndpointCoordinator {
    ctx;
    manager;
    activeCwd;
    logger;
    formatEndpoint;
    /** Per-cause one-shot warn flag so the log never spams. */
    warnedNoSink = false;
    /** Disposer for the manager state-change subscription. */
    stateChangeDispose;
    /** Currently scheduled route call; subsequent ones chain onto the tail. */
    routeTail = Promise.resolve();
    constructor(deps) {
        this.ctx = deps.ctx;
        this.manager = deps.manager;
        this.activeCwd = deps.activeCwd;
        this.logger = deps.logger;
        this.formatEndpoint = deps.formatEndpoint ?? defaultEndpoint;
    }
    /** Subscribe to the two trigger sources. Idempotent. */
    start() {
        if (this.stateChangeDispose !== undefined)
            return;
        const onState = () => {
            void this.route(this.activeCwd());
        };
        this.stateChangeDispose = this.manager.onStateChange(onState);
    }
    /** Release the manager subscription. Idempotent. */
    stop() {
        this.stateChangeDispose?.();
        this.stateChangeDispose = undefined;
    }
    /**
     * Write the endpoint for `cwd` if a ready instance exists. Chained
     * so concurrent triggers serialize in arrival order; rejections
     * from one call do not poison the queue.
     */
    route(cwd) {
        const next = this.routeTail.then(() => this.runRoute(cwd)).catch(() => undefined);
        this.routeTail = next;
        return next;
    }
    /** Wait for any in-flight route writes to settle. */
    async drain() {
        await this.routeTail;
    }
    async runRoute(cwd) {
        if (cwd === undefined)
            return; // keep the last successful write
        const instance = this.readyInstance(cwd);
        if (instance === undefined)
            return;
        const remeMemory = this.ctx.get('remeMemory');
        if (remeMemory === undefined || typeof remeMemory.setEndpoint !== 'function') {
            if (!this.warnedNoSink) {
                this.warnedNoSink = true;
                this.logger.warn('reme-auto-router: remeMemory service is unavailable; the official reme-memory plugin may not be mounted');
            }
            return;
        }
        const endpoint = this.formatEndpoint(instance.port);
        try {
            remeMemory.setEndpoint(endpoint);
            this.logger.info?.(`reme-auto-router: routed ${cwd} → ${endpoint}`);
        }
        catch (error) {
            if (!this.warnedNoSink) {
                this.warnedNoSink = true;
                const reason = error instanceof Error ? error.message : String(error);
                this.logger.warn(`reme-auto-router: remeMemory.setEndpoint('${endpoint}') failed (${reason})`);
            }
        }
    }
    readyInstance(cwd) {
        const instance = this.manager.get(cwd);
        if (instance === undefined)
            return undefined;
        return instance.status === 'ready' ? instance : undefined;
    }
}
/** Default loopback URL formatter. */
function defaultEndpoint(port) {
    return `http://127.0.0.1:${String(port)}`;
}
