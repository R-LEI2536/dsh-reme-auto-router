/**
 * reme-auto-router — PushNotifier: publish reme state to the
 * user-visible chat flow without involving the model.
 *
 * When the active cwd changes, or when the active cwd's reme
 * instance transitions between `starting` / `ready` / `unavailable`,
 * the notifier calls `ctx.commands.execute(agent, '/reme', [], signal)`
 * itself. That appends `command/run` + `command/done` to the session
 * log; the DSH chat assembler renders `command/done` as a
 * user-visible command card. Both events are log-only per
 * `SessionEventMap` JSDoc, so the model never sees the rendered text.
 *
 * Dedup keeps the chat clean: the notifier tracks the last text it
 * pushed per cwd; a notify with the same rendered text is a no-op.
 *
 * @module reme-auto-router/push-notifier
 */
import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent/types';
import type { SessionId } from '@deepseek-ai/dsh-session/types';
import type { RemeInstance } from './process-manager.ts';
/**
 * Shape the slash-command handler and the notifier both render from.
 *
 * `pid` is optional: managed instances never have one (0.1.5's plain
 * SubprocessHandle no longer exposes `pid`), so the rendered status line
 * degrades to "port N" when it is missing.
 */
export interface StatusSnapshot {
    readonly cwd: string;
    readonly port: number;
    readonly pid?: number;
    readonly ownership: 'managed' | 'adopted';
    readonly status: 'starting' | 'ready' | 'unavailable';
    readonly title: string;
    readonly lastError?: string;
}
/** Logger surface the notifier depends on. */
export interface PushNotifierLogger {
    warn(message: string): void;
}
/** Lookup the Agent for a session id — may return undefined when detached. */
export type AgentResolver = (sessionId: SessionId) => Agent | undefined;
/** Construction inputs. */
export interface PushNotifierDeps {
    ctx: Context;
    resolveAgent: AgentResolver;
    logger: PushNotifierLogger;
}
/**
 * Auto-push a user-visible chat card on reme state changes. Inert
 * until `push()` is called.
 */
export declare class PushNotifier {
    private readonly ctx;
    private readonly resolveAgent;
    private readonly logger;
    private readonly lastPushed;
    constructor(deps: PushNotifierDeps);
    /**
     * Push the current state for `instance` to the chat flow of
     * `sessionId` if the rendered text differs from the last push
     * for that cwd. Errors are absorbed into a single warn log so a
     * transient failure cannot tear down the host.
     */
    push(sessionId: SessionId, instance: RemeInstance, title: string): Promise<void>;
    /** Reset dedup memory. Useful on plugin teardown. */
    dispose(): void;
}
/**
 * Render one status line. Pure; shared by the slash command
 * handler and the PushNotifier so user-typed `/reme` and auto-push
 * produce identical text.
 */
export declare function renderStatusLine(snapshot: StatusSnapshot): string;
/** POSIX basename for display; tolerates both `/` and `\` separators. */
export declare function basename(p: string): string;
//# sourceMappingURL=push-notifier.d.ts.map