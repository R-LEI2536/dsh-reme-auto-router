/**
 * reme-auto-router — plugin entry point.
 *
 * Function plugin form (per packages/AGENTS.md): the loader consumes
 * the named exports `name`, `inject`, `Config`, and the async
 * `apply` function. Activation order is fixed by `inject` so the
 * required services are ready before `apply` runs.
 *
 * Runtime responsibilities wired here:
 *   1. Load the durable state record (`StateStore.load`)
 *   2. Resolve the live plugin configuration from the volatile
 *      `Config` fields (DSH 0.1.7 model — no settings namespace)
 *   3. Build the live subsystems (manager, detector, coordinator,
 *      adopter)
 *   4. Register `/reme` slash command and wire the PushNotifier
 *      so the chat flow gets a user-visible card on every reme
 *      state change
 *   5. On plugin dispose: stop the detector and adopter, drain the
 *      coordinator, run the shutdown sequence, then dispose
 *      everything
 *
 * The returned disposer is `async` so the Cordis runtime awaits
 * the shutdown sequence before tearing down its own services.
 *
 * @module reme-auto-router
 */
import { DEFAULT_SETTINGS, SettingsConfig as SettingsConfigSchema } from "./settings-schema.js";
import { StateStore } from "./state-store.js";
import { ProcessManager } from "./process-manager.js";
import { WorkspaceDetector } from "./workspace-detector.js";
import { EndpointCoordinator } from "./endpoint-coordinator.js";
import { ManualAdopter } from "./manual-adopter.js";
import { runShutdown } from "./shutdown.js";
import { registerRemeCommand } from "./slash-command.js";
import { PushNotifier, basename } from "./push-notifier.js";
export const name = 'reme-auto-router';
export const inject = ['subprocess', 'sessions', 'systemPrompt', 'timer', 'commands'];
/** Plugin Config — deployment-time overrides for the same schema users edit in the settings page. */
export const Config = SettingsConfigSchema;
export async function apply(ctx, config) {
    const logger = ctx.logger;
    // 1. Restore prior managed/adopted records before any subscription
    //    can allocate a port; ensures port collisions with last-run
    //    state are impossible on startup.
    const store = new StateStore();
    await store.load(logger);
    // 2. Live configuration thunk: volatile references are updated by the
    //    runtime as the profile user layer changes, so every call
    //    assembles a fresh plain snapshot — settings edits propagate
    //    without restart (same guarantee the old ctx.settings.get path
    //    gave, under the DSH 0.1.7 volatile-Config model).
    const getSettings = () => ({
        killOnExit: config.killOnExit.get(),
        shutdownGraceMs: config.shutdownGraceMs.get(),
        waitForIdleBeforeShutdown: config.waitForIdleBeforeShutdown.get(),
        maxShutdownWaitMs: config.maxShutdownWaitMs.get(),
        idleTimeoutMs: config.idleTimeoutMs.get(),
        adoptManual: config.adoptManual.get(),
        ports: { ...config.ports.get() },
        pinnedDirs: [...config.pinnedDirs.get()],
    });
    // 3. ProcessManager is the source of truth for live reme instances.
    const manager = new ProcessManager({ ctx, settings: getSettings, store, logger });
    // 4. Detector and coordinator: detector owns the
    //    preparing→active state machine (v0.2 #0 fix); coordinator
    //    routes the ready instance's port to the official reme-memory
    //    plugin via its `remeMemory` service.
    const detector = new WorkspaceDetector({ ctx, manager, logger });
    const coordinator = new EndpointCoordinator({
        ctx,
        manager,
        activeCwd: () => detector.activeCwd(),
        logger,
    });
    // 5. PushNotifier: chat-flow user-visible card on every state
    //    change. resolveAgent looks up the Agent by sessionId.
    const agents = ctx.get('agents');
    const pushNotifier = new PushNotifier({
        ctx,
        resolveAgent: (sessionId) => agents?.get(sessionId),
        logger,
    });
    // 6. Wire the trigger sources. Two detector events:
    //    - onPreparingCwdChanged: a new session entered the
    //      `preparing` state — spawn its reme and push a "starting…"
    //      card so the user sees the switch is in progress.
    //    - onActiveCwdChanged: a preparing session promoted to
    //      `active` (manager reported `ready`) — write the new
    //      endpoint and push a "ready" card.
    //    The manager.onStateChange subscription is kept for fallback
    //    coverage: any state change (e.g., `unavailable` after a
    //    crash) re-routes and re-pushes a card for the active cwd.
    detector.onPreparingCwdChanged(({ cwd, sessionId }) => {
        if (cwd === undefined)
            return;
        void (async () => {
            try {
                const inst = await manager.ensure(cwd);
                if (sessionId !== undefined) {
                    void pushNotifier.push(sessionId, inst, basename(cwd));
                }
            }
            catch (error) {
                const reason = error instanceof Error ? error.message : String(error);
                ctx.logger.warn(`reme-auto-router: ensure('${cwd}') during preparing rejected: ${reason}`);
            }
        })();
    });
    detector.onActiveCwdChanged(({ cwd, sessionId }) => {
        if (cwd === undefined)
            return;
        void coordinator.route(cwd);
        if (sessionId !== undefined) {
            const inst = manager.get(cwd);
            if (inst !== undefined)
                void pushNotifier.push(sessionId, inst, basename(cwd));
        }
    });
    manager.onStateChange((cwd, instance) => {
        void coordinator.route(detector.activeCwd());
        if (cwd === detector.activeCwd()) {
            const sessionId = detector.activeSessionId();
            if (sessionId !== undefined)
                void pushNotifier.push(sessionId, instance, basename(cwd));
        }
    });
    // 7. Manual adopter periodically scans the port range for
    //    user-launched reme processes and adds them to the manager.
    const adopter = new ManualAdopter({ ctx, manager, store, settings: getSettings, logger });
    // 8. Register the slash command so the user can query state.
    const disposeSlashCommand = registerRemeCommand({
        ctx,
        manager,
        activeCwd: () => detector.activeCwd(),
    });
    // 9. Start the live subsystems.
    detector.start();
    coordinator.start();
    adopter.start();
    // 10. Dispose chain: stop subscriptions, drain the coordinator,
    //     run shutdown, then dispose the slash command and notifier.
    return async () => {
        detector.stop();
        coordinator.stop();
        adopter.stop();
        await coordinator.drain();
        await runShutdown(manager, getSettings(), logger);
        disposeSlashCommand();
        pushNotifier.dispose();
    };
}
// Re-export the schema and defaults for downstream tests and tools.
export { DEFAULT_SETTINGS, SettingsConfigSchema as SettingsConfig };
