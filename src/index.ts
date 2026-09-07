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
 *   2. Register the `reme-auto-router` settings section
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

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { RemeAutoRouterSettings } from './settings-schema.ts'
import { DEFAULT_SETTINGS, REME_AUTO_ROUTER_NAMESPACE, SettingsConfig as SettingsConfigSchema } from './settings-schema.ts'
import { StateStore } from './state-store.ts'
import { ProcessManager } from './process-manager.ts'
import { WorkspaceDetector } from './workspace-detector.ts'
import { EndpointCoordinator } from './endpoint-coordinator.ts'
import { ManualAdopter } from './manual-adopter.ts'
import { runShutdown } from './shutdown.ts'
import { registerRemeCommand } from './slash-command.ts'
import { PushNotifier, basename } from './push-notifier.ts'

export const name = 'reme-auto-router'

export const inject = ['settings', 'subprocess', 'sessions', 'systemPrompt', 'timer', 'commands']

/** Plugin Config — deployment-time overrides for the same schema users edit in settings.yaml. */
export const Config = SettingsConfigSchema

/** Deployment-time Config value type. Identical to {@link RemeAutoRouterSettings}. */
export type RemeAutoRouterConfig = RemeAutoRouterSettings

export async function apply(
  ctx: Context,
  config: RemeAutoRouterConfig,
): Promise<() => Promise<void>> {
  const logger = ctx.logger as { warn(message: string): void; info?(message: string): void }

  // 1. Restore prior managed/adopted records before any subscription
  //    can allocate a port; ensures port collisions with last-run
  //    state are impossible on startup.
  const store = new StateStore()
  await store.load(logger)

  // 2. installSection drives both the user layer (settings.yaml) and
  //    the composition `base` (the plugin Config).
  installSettingsSection(ctx, config)

  // 3. Resolver used by every downstream subsystem on every call so
  //    settings edits propagate without restart.
  const getSettings = (): RemeAutoRouterSettings => {
    const raw = ctx.settings.get(REME_AUTO_ROUTER_NAMESPACE)
    return isCompleteSettings(raw) ? raw : mergeSettings(config)
  }

  // 4. ProcessManager is the source of truth for live reme instances.
  const manager = new ProcessManager({ ctx, settings: getSettings, store, logger })

  // 5. Detector and coordinator: detector owns the
  //    preparing→active state machine (v0.2 #0 fix); coordinator
  //    routes the ready instance's port to
  //    ctx.settings['reme-memory'].
  const detector = new WorkspaceDetector({ ctx, manager, logger })
  const coordinator = new EndpointCoordinator({
    ctx,
    manager,
    activeCwd: () => detector.activeCwd(),
    logger,
  })

  // 6. PushNotifier: chat-flow user-visible card on every state
  //    change. resolveAgent looks up the Agent by sessionId.
  const agents = ctx.get('agents') as
    | { get(id: SessionId): Agent | undefined }
    | undefined
  const pushNotifier = new PushNotifier({
    ctx,
    resolveAgent: (sessionId) => agents?.get(sessionId),
    logger,
  })

  // 7. Wire the trigger sources. Two detector events:
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
    if (cwd === undefined) return
    void (async () => {
      try {
        const inst = await manager.ensure(cwd)
        if (sessionId !== undefined) {
          void pushNotifier.push(sessionId, inst, basename(cwd))
        }
      } catch (error: unknown) {
        const reason = error instanceof Error ? error.message : String(error)
        ctx.logger.warn(`reme-auto-router: ensure('${cwd}') during preparing rejected: ${reason}`)
      }
    })()
  })
  detector.onActiveCwdChanged(({ cwd, sessionId }) => {
    if (cwd === undefined) return
    void coordinator.route(cwd)
    if (sessionId !== undefined) {
      const inst = manager.get(cwd)
      if (inst !== undefined) void pushNotifier.push(sessionId, inst, basename(cwd))
    }
  })
  manager.onStateChange((cwd, instance) => {
    void coordinator.route(detector.activeCwd())
    if (cwd === detector.activeCwd()) {
      const sessionId = detector.activeSessionId()
      if (sessionId !== undefined) void pushNotifier.push(sessionId, instance, basename(cwd))
    }
  })

  // 8. Manual adopter periodically scans the port range for
  //    user-launched reme processes and adds them to the manager.
  const adopter = new ManualAdopter({ ctx, manager, store, settings: getSettings, logger })

  // 9. Register the slash command so the user can query state.
  const disposeSlashCommand = registerRemeCommand({
    ctx,
    manager,
    activeCwd: () => detector.activeCwd(),
  })

  // 10. Start the live subsystems.
  detector.start()
  coordinator.start()
  adopter.start()

  // 11. Dispose chain: stop subscriptions, drain the coordinator,
  //     run shutdown, then dispose the slash command and notifier.
  return async () => {
    detector.stop()
    coordinator.stop()
    adopter.stop()
    await coordinator.drain()
    await runShutdown(manager, getSettings(), logger)
    disposeSlashCommand()
    pushNotifier.dispose()
  }
}

/**
 * Register the `reme-auto-router` settings namespace. The plugin
 * Config becomes the composition `base`.
 */
function installSettingsSection(ctx: Context, config: RemeAutoRouterConfig): void {
  const entry: RemeAutoRouterSettings = mergeSettings(config)
  ctx.settings.installSection(
    ctx,
    REME_AUTO_ROUTER_NAMESPACE,
    SettingsConfigSchema,
    entry,
    {
      setSource: () => undefined,
      onChange: () => undefined,
    },
  )
}

/** Combine the plugin Config with schema defaults into a full Settings object. */
function mergeSettings(config: Partial<RemeAutoRouterSettings>): RemeAutoRouterSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...config,
    ports: { ...DEFAULT_SETTINGS.ports, ...config.ports },
    pinnedDirs: config.pinnedDirs ?? DEFAULT_SETTINGS.pinnedDirs,
  }
}

function isCompleteSettings(value: unknown): value is RemeAutoRouterSettings {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<RemeAutoRouterSettings>
  return (
    typeof candidate.killOnExit === 'boolean' &&
    typeof candidate.idleTimeoutMs === 'number' &&
    candidate.ports !== undefined &&
    typeof candidate.ports.base === 'number' &&
    typeof candidate.ports.range === 'number'
  )
}

// Re-export the schema and namespace for downstream tests and tools.
export { DEFAULT_SETTINGS, REME_AUTO_ROUTER_NAMESPACE, SettingsConfigSchema as SettingsConfig }
export type { RemeAutoRouterSettings }