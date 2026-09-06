/**
 * reme-auto-router — SlashCommand: register the `/reme` user-visible
 * chat command and share its rendering with the PushNotifier.
 *
 * The user can type `/reme` in the composer at any time; the
 * handler returns a snapshot of the active workspace's reme
 * instance. The chat assembler renders the result as a
 * user-visible command card. The `command/done` event carrying
 * the text is `log-only` per `SessionEventMap` JSDoc, so the
 * model never sees the rendered text.
 *
 * The same path is used by the auto-push notifier, which calls
 * `ctx.commands.execute(agent, '/reme', [], signal)` from the
 * host side on every state transition.
 *
 * @module reme-auto-router/slash-command
 */
import type { Context } from '@deepseek-ai/cordis';
import type { ProcessManager } from './process-manager.ts';
import { type StatusSnapshot } from './push-notifier.ts';
/** Returns the cwd the user/agent is currently working in, or undefined. */
export type ActiveCwdProvider = () => string | undefined;
/** Construction inputs. */
export interface SlashCommandDeps {
    ctx: Context;
    manager: Pick<ProcessManager, 'get'>;
    activeCwd: ActiveCwdProvider;
}
/** The registered command name — also the literal the auto-push invokes. */
export declare const REME_COMMAND_NAME = "reme";
/** Build the snapshot for `cwd`, or undefined when there is nothing to show. */
export declare function snapshotFor(cwd: string, manager: Pick<ProcessManager, 'get'>): StatusSnapshot | undefined;
/**
 * Register the `/reme` slash command. Caller stores the disposer
 * for teardown. `recordInput: false` because the command accepts
 * no argument.
 */
export declare function registerRemeCommand(deps: SlashCommandDeps): () => void;
//# sourceMappingURL=slash-command.d.ts.map