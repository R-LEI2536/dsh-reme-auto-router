/**
 * reme-auto-router — WorkspaceDetector: infer the active workspace cwd
 * from the `api-session/status` event stream.
 *
 * The detector owns no decisions about process lifecycle. It maps
 * the current set of running sessions to one canonical cwd
 * ("active cwd"), resolving ties between multiple simultaneously-
 * running tabs by insertion order: the most recently activated
 * session wins. Callers subscribe via `onPreparingCwdChanged` and
 * `onActiveCwdChanged`, and read the current values through
 * `activeCwd()` / `preparingCwd()`.
 *
 * Each session moves through two modes:
 *   - `preparing` — first seen via `api-session/status(running=true)`.
 *     The detector triggers a reme spawn (via the optional manager
 *     dep) and holds the session out of the "active" view until the
 *     manager reports `status='ready'` for the cwd. This delay is the
 *     fix for the endpoint-stale-on-switch bug: until the new reme
 *     binds, the previously-active cwd remains the routing target so
 *     the data is consistent (no silent writes to the wrong workspace).
 *   - `active` — promoted when the manager emits `ready` for the cwd.
 *     The session's cwd becomes the candidate for `activeCwd()`.
 *
 * Source events:
 *   - `api-session/status(sessionId, running)` — adds or removes a
 *     session from the running set
 *   - `api-session/removed(sessionId)` — defensive cleanup
 *   - `manager.onStateChange(cwd, instance)` — promotes preparing
 *     sessions to active when `instance.status === 'ready'`
 *
 * The detector does not emit `api-session/status` itself and does
 * not touch settings, processes, or the system prompt.
 *
 * @module reme-auto-router/workspace-detector
 */
import { realpath } from 'node:fs/promises';
import { sep } from 'node:path';
/**
 * Resolves the active workspace cwd from the running-session event stream.
 *
 * The instance is inert until `start()` is called; `stop()` is idempotent
 * and safe to call before `start()`.
 */
export class WorkspaceDetector {
    ctx;
    logger;
    manager;
    /** Insertion order = most-recently-activated last. */
    sessions = new Map();
    preparingListeners = new Set();
    activeListeners = new Set();
    /** Last value published to the preparing-listener set; used for dedup. */
    preparingLastFired;
    /** Last value published to the active-listener set; used for dedup. */
    activeLastFired;
    disposers = [];
    managerDispose;
    constructor(deps) {
        this.ctx = deps.ctx;
        this.logger = deps.logger;
        this.manager = deps.manager;
        if (this.manager !== undefined) {
            this.managerDispose = this.manager.onStateChange((cwd, instance) => {
                if (instance.status === 'ready')
                    this.tryPromote(cwd);
            });
        }
    }
    /**
     * The current active cwd, or `undefined` when no session is active.
     * During a workspace switch, the value remains the OLD cwd until the
     * new workspace's reme instance reaches `ready`; this is the gate
     * that prevents endpoint-stale data writes.
     */
    activeCwd() {
        return this.lastActiveEntry()?.cwd;
    }
    /**
     * The sessionId of the most-recent active session, or `undefined`
     * when no session is active. Pairs with `activeCwd()` for callers
     * that need to resolve the owning Agent.
     */
    activeSessionId() {
        return this.lastActiveEntry()?.sessionId;
    }
    /**
     * The current preparing cwd (the most-recently-seen session whose
     * reme is still starting), or `undefined` when no session is in
     * preparing state. Useful for status display during a switch.
     */
    preparingCwd() {
        return this.lastPreparingEntry()?.cwd;
    }
    /**
     * The sessionId of the most-recent preparing session, or
     * `undefined`. Pairs with `preparingCwd()` for callers that need
     * to resolve the owning Agent.
     */
    preparingSessionId() {
        return this.lastPreparingEntry()?.sessionId;
    }
    /**
     * Subscribe to preparing-cwd changes. Fires on every transition of
     * the most-recent preparing cwd (including the "no preparing
     * session" empty case). The returned function unsubscribes.
     */
    onPreparingCwdChanged(listener) {
        this.preparingListeners.add(listener);
        return () => {
            this.preparingListeners.delete(listener);
        };
    }
    /**
     * Subscribe to active-cwd changes. Fires when the most-recent
     * active cwd changes (including the "no active session" empty
     * case). Does NOT fire during the prepare window — active-cwd
     * only updates on `manager.onStateChange(_, ready)` (the promote
     * path) and on session removal.
     */
    onActiveCwdChanged(listener) {
        this.activeListeners.add(listener);
        return () => {
            this.activeListeners.delete(listener);
        };
    }
    /** Register `api-session/*` listeners. Idempotent. */
    start() {
        if (this.disposers.length > 0)
            return;
        this.disposers.push(this.ctx.on('api-session/status', (sessionId, running) => {
            void this.onStatus(sessionId, running);
        }), this.ctx.on('api-session/removed', (sessionId) => {
            void this.onRemoved(sessionId);
        }));
    }
    /** Dispose all listeners. Idempotent. */
    stop() {
        for (const dispose of this.disposers)
            dispose();
        this.disposers = [];
        this.managerDispose?.();
        this.managerDispose = undefined;
    }
    async onStatus(sessionId, running) {
        if (running) {
            const cwd = await this.readSessionCwd(sessionId);
            if (cwd === undefined)
                return;
            const previous = this.sessions.get(sessionId);
            // Already active with the same cwd — nothing to do.
            if (previous?.cwd === cwd && previous.mode === 'active')
                return;
            // Optimisation (v0.2.0.1): a brand-new session whose cwd is
            // already covered by another active session (e.g. the user
            // opened a new tab in the currently-active workspace) joins
            // the active set directly. The reme instance for that cwd is
            // already up, so we skip the preparing path: no manager.ensure
            // (which would otherwise call touch() and trigger a
            // state-store write per call), no onPreparingCwdChanged
            // listener fire, no push card. The activeCwdValue is
            // unchanged, so fireActive's own dedup swallows the no-op.
            if (previous === undefined && this.hasActiveSessionForCwd(cwd)) {
                this.sessions.set(sessionId, { cwd, mode: 'active' });
                this.fireActive();
                return;
            }
            // New session, cwd change, or re-entering a still-preparing session.
            // In all three cases, ensure() and stay/become preparing.
            this.sessions.set(sessionId, { cwd, mode: 'preparing' });
            if (this.manager !== undefined) {
                void this.manager.ensure(cwd).catch((error) => {
                    const reason = error instanceof Error ? error.message : String(error);
                    this.logger?.warn(`workspace-detector: ensure('${cwd}') rejected: ${reason}`);
                });
            }
            this.firePreparing();
            return;
        }
        if (this.sessions.delete(sessionId)) {
            this.fireActive();
            this.firePreparing();
        }
    }
    async onRemoved(sessionId) {
        if (this.sessions.delete(sessionId)) {
            this.fireActive();
            this.firePreparing();
        }
    }
    /**
     * Read and canonicalise the cwd of a session. Returns undefined
     * when the session is unknown, has no cwd, or its cwd does not
     * resolve to a real directory; the skip is silent because the
     * failure modes are normal during a session lifecycle.
     */
    async readSessionCwd(sessionId) {
        const sessions = this.ctx.get('sessions');
        if (sessions === undefined)
            return undefined;
        const session = sessions.get(sessionId);
        if (session === undefined)
            return undefined;
        const raw = session.header.cwd;
        if (typeof raw !== 'string' || raw.length === 0)
            return undefined;
        try {
            const canonical = await realpath(raw);
            return canonical.endsWith(sep) ? canonical.slice(0, -1) : canonical;
        }
        catch {
            return undefined;
        }
    }
    /**
     * Promote all sessions in preparing state whose cwd matches `cwd`
     * to active. Called by the manager.onStateChange subscription when
     * an instance reaches `ready`. Fires the active-listener set (and
     * re-checks the preparing-listener set in case this was the only
     * preparing session).
     */
    tryPromote(cwd) {
        let promoted = false;
        for (const [sid, sess] of this.sessions) {
            if (sess.cwd === cwd && sess.mode === 'preparing') {
                this.sessions.set(sid, { cwd, mode: 'active' });
                promoted = true;
            }
        }
        if (!promoted)
            return;
        this.fireActive();
        this.firePreparing();
    }
    firePreparing() {
        const last = this.lastPreparingEntry();
        const cwd = last?.cwd;
        if (cwd === this.preparingLastFired)
            return;
        this.preparingLastFired = cwd;
        for (const listener of this.preparingListeners) {
            listener({ cwd, sessionId: last?.sessionId });
        }
    }
    fireActive() {
        const last = this.lastActiveEntry();
        const cwd = last?.cwd;
        if (cwd === this.activeLastFired)
            return;
        this.activeLastFired = cwd;
        for (const listener of this.activeListeners) {
            listener({ cwd, sessionId: last?.sessionId });
        }
    }
    lastActiveEntry() {
        let result;
        for (const [sessionId, sess] of this.sessions) {
            if (sess.mode === 'active')
                result = { sessionId, cwd: sess.cwd };
        }
        return result;
    }
    lastPreparingEntry() {
        let result;
        for (const [sessionId, sess] of this.sessions) {
            if (sess.mode === 'preparing')
                result = { sessionId, cwd: sess.cwd };
        }
        return result;
    }
    /**
     * True when at least one session in the map is already active for
     * `cwd`. Used by `onStatus` to short-circuit the preparing path
     * when the user opens a new tab in an already-active workspace.
     */
    hasActiveSessionForCwd(cwd) {
        for (const sess of this.sessions.values()) {
            if (sess.cwd === cwd && sess.mode === 'active')
                return true;
        }
        return false;
    }
}
