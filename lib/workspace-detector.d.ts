/**
 * reme-auto-router — WorkspaceDetector: infer the active workspace cwd
 * from the `api-session/status` event stream.
 *
 * The detector owns no decisions about process lifecycle. It maps
 * the current set of running sessions to one canonical cwd
 * ("active cwd"), resolving ties between multiple simultaneously-
 * running tabs by insertion order: the most recently activated
 * session wins. Callers subscribe via `onActiveCwdChanged` and read
 * the current value through `activeCwd()`.
 *
 * Source events:
 *   - `api-session/status(sessionId, running)` — adds or removes a
 *     session from the running set
 *   - `api-session/removed(sessionId)` — defensive cleanup
 *
 * The detector does not emit `api-session/status` itself and does
 * not touch settings, processes, or the system prompt.
 *
 * @module reme-auto-router/workspace-detector
 */
import type { Context } from '@deepseek-ai/cordis';
import type { SessionId } from '@deepseek-ai/dsh-session';
/** Listener invoked with the new active cwd, or undefined when no session runs. */
export type ActiveCwdListener = (cwd: string | undefined) => void;
/** Construction inputs. */
export interface WorkspaceDetectorDeps {
    ctx: Context;
    logger?: {
        warn(message: string): void;
    };
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
    /** Insertion order = most-recently-activated last; `values().at(-1)` is the active cwd. */
    private readonly runningCwds;
    private readonly listeners;
    private activeCwdValue;
    private disposers;
    constructor(deps: WorkspaceDetectorDeps);
    /**
     * The current active cwd, or `undefined` when no session is running.
     */
    activeCwd(): string | undefined;
    /**
     * The sessionId of the most-recently activated session, or
     * `undefined` when no session is running. Pairs with `activeCwd()`
     * for callers that need to resolve the owning Agent.
     */
    activeSessionId(): SessionId | undefined;
    /**
     * Subscribe to active-cwd changes. Fires immediately if a callback
     * is registered after a transition has already happened.
     */
    onActiveCwdChanged(listener: ActiveCwdListener): () => void;
    /** Register `api-session/*` listeners. Idempotent: re-calling is a no-op. */
    start(): void;
    /** Dispose all listeners. Idempotent. */
    stop(): void;
    private onStatus;
    private publish;
    private lastValue;
    private onRemoved;
    /**
     * Read and canonicalise the cwd of a session. Returns undefined
     * when the session is unknown, has no cwd, or its cwd does not
     * resolve to a real directory; the skip is silent because the
     * failure modes are normal during a session lifecycle.
     */
    private readSessionCwd;
}
//# sourceMappingURL=workspace-detector.d.ts.map