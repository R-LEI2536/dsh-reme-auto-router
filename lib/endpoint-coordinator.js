/**
 * reme-auto-router — EndpointCoordinator: publish the active cwd's
 * reme port to the official `reme-memory` settings namespace.
 *
 * The coordinator owns one write path: when the active workspace
 * cwd has a ready reme instance, write its endpoint URL to
 * `ctx.settings['reme-memory']`. The official reme-memory plugin
 * (when mounted) reads that endpoint and routes its HTTP client to
 * the active workspace's reme process.
 *
 * Trigger sources (subscribed once at construction):
 *   - `manager.onStateChange(...)` — fires when any instance reaches
 *     `ready`; we route only if the changed cwd is the active cwd
 *   - `detector.onActiveCwdChanged(...)` — fires when the active
 *     cwd changes; we route the new cwd regardless of which event
 *     made it ready
 *
 * Failures (settings service missing, `reme-memory` namespace not
 * registered, the write itself rejecting) are surfaced as one warn
 * log per cause and the function returns. We never throw into the
 * host event loop.
 *
 * @module reme-auto-router/endpoint-coordinator
 */
/** External namespace whose `endpoint` field this plugin writes. */
const REME_MEMORY_NAMESPACE = 'reme-memory';
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
    warnedNoSettings = false;
    warnedNoNamespace = false;
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
        const settings = this.ctx.get('settings');
        if (settings === undefined) {
            if (!this.warnedNoSettings) {
                this.warnedNoSettings = true;
                this.logger.warn('reme-auto-router: ctx.settings is unavailable; skipping endpoint writes');
            }
            return;
        }
        const endpoint = this.formatEndpoint(instance.port);
        try {
            await settings
                .update(REME_MEMORY_NAMESPACE, { endpoint });
            this.logger.info?.(`reme-auto-router: routed ${cwd} → ${endpoint}`);
        }
        catch (error) {
            if (!this.warnedNoNamespace) {
                this.warnedNoNamespace = true;
                const reason = error instanceof Error ? error.message : String(error);
                this.logger.warn(`reme-auto-router: cannot write '${REME_MEMORY_NAMESPACE}.endpoint' (${reason}); the official reme-memory plugin may not be mounted`);
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
