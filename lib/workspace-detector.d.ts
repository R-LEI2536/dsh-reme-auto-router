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
import type { Context } from '@deepseek-ai/cordis';
import type { SessionId } from '@deepseek-ai/dsh-session';
import type { ProcessManager } from './process-manager.ts';
/** Event payload shared by both preparing and active listeners. */
export interface CwdTransition {
    /** New cwd value, or `undefined` when the corresponding set is empty. */
    cwd: string | undefined;
    /** SessionId that drove the transition, or `undefined` when empty. */
    sessionId: SessionId | undefined;
}
/** Listener invoked with the most-recent preparing cwd (or undefined). */
export type PreparingCwdListener = (event: CwdTransition) => void;
/** Listener invoked with the most-recent active cwd (or undefined). */
export type ActiveCwdListener = (event: CwdTransition) => void;
/** Construction inputs. */
export interface WorkspaceDetectorDeps {
    ctx: Context;
    logger?: {
        warn(message: string): void;
    };
    /**
     * ProcessManager surface used to (a) trigger a spawn when a new
     * session enters preparing, and (b) listen for `ready` state-changes
     * to promote preparing sessions to active. Optional: the detector
     * can run without a manager (degraded mode — sessions stay in
     * preparing forever, useful for tests that exercise detector logic
     * in isolation).
     */
    manager?: Pick<ProcessManager, 'ensure' | 'get' | 'onStateChange'>;
}
/**
 * Resolves the active workspace cwd from the running-session event stream.
 *
 * The instance is inert until `start()` is called; `stop()` is idempotent
 * and safe to call before `start()`.
 */
export declare class WorkspaceDetector {
    private readonly ctx;
    private readonly logger;
    private readonly manager;
    /** Insertion order = most-recently-activated last. */
    private readonly sessions;
    private readonly preparingListeners;
    private readonly activeListeners;
    /** Last value published to the preparing-listener set; used for dedup. */
    private preparingLastFired;
    /** Last value published to the active-listener set; used for dedup. */
    private activeLastFired;
    private disposers;
    private managerDispose;
    constructor(deps: WorkspaceDetectorDeps);
    /**
     * The current active cwd, or `undefined` when no session is active.
     * During a workspace switch, the value remains the OLD cwd until the
     * new workspace's reme instance reaches `ready`; this is the gate
     * that prevents endpoint-stale data writes.
     */
    activeCwd(): string | undefined;
    /**
     * The sessionId of the most-recent active session, or `undefined`
     * when no session is active. Pairs with `activeCwd()` for callers
     * that need to resolve the owning Agent.
     */
    activeSessionId(): SessionId | undefined;
    /**
     * The current preparing cwd (the most-recently-seen session whose
     * reme is still starting), or `undefined` when no session is in
     * preparing state. Useful for status display during a switch.
     */
    preparingCwd(): string | undefined;
    /**
     * The sessionId of the most-recent preparing session, or
     * `undefined`. Pairs with `preparingCwd()` for callers that need
     * to resolve the owning Agent.
     */
    preparingSessionId(): SessionId | undefined;
    /**
     * Subscribe to preparing-cwd changes. Fires on every transition of
     * the most-recent preparing cwd (including the "no preparing
     * session" empty case). The returned function unsubscribes.
     */
    onPreparingCwdChanged(listener: PreparingCwdListener): () => void;
    /**
     * Subscribe to active-cwd changes. Fires when the most-recent
     * active cwd changes (including the "no active session" empty
     * case). Does NOT fire during the prepare window — active-cwd
     * only updates on `manager.onStateChange(_, ready)` (the promote
     * path) and on session removal.
     */
    onActiveCwdChanged(listener: ActiveCwdListener): () => void;
    /** Register `api-session/*` listeners. Idempotent. */
    start(): void;
    /** Dispose all listeners. Idempotent. */
    stop(): void;
    private onStatus;
    private onRemoved;
    /**
     * Read and canonicalise the cwd of a session. Returns undefined
     * when the session is unknown, has no cwd, or its cwd does not
     * resolve to a real directory; the skip is silent because the
     * failure modes are normal during a session lifecycle.
     */
    private readSessionCwd;
    /**
     * Promote all sessions in preparing state whose cwd matches `cwd`
     * to active. Called by the manager.onStateChange subscription when
     * an instance reaches `ready`. Fires the active-listener set (and
     * re-checks the preparing-listener set in case this was the only
     * preparing session).
     */
    private tryPromote;
    private firePreparing;
    private fireActive;
    private lastActiveEntry;
    private lastPreparingEntry;
    /**
     * True when at least one session in the map is already active for
     * `cwd`. Used by `onStatus` to short-circuit the preparing path
     * when the user opens a new tab in an already-active workspace.
     */
    private hasActiveSessionForCwd;
}
//# sourceMappingURL=workspace-detector.d.ts.map