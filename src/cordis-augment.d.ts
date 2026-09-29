/**
 * reme-auto-router — ambient augmentation of the cordis `Context` and
 * `Events` types for the services and event names this plugin reads from.
 *
 * In the monorepo these signatures live in their respective service
 * packages (dsh-subprocess, dsh-session, cordis-plugin-timer,
 * dsh-api-session-controller/types, …) and are loaded implicitly when
 * source files import anything from those packages. The standalone
 * checkout imports only the types it uses, so those augmentations never
 * trigger; we vendor the slice we need here to keep the plugin
 * self-describing.
 *
 * Each `interface Context { ... }` line below must match the runtime
 * shape of the corresponding service — the cordis proxy resolves names
 * dynamically, so a typo here would fail silently at runtime.
 *
 * No `settings` declaration: as of DSH 0.1.7 this plugin no longer
 * consumes `ctx.settings` (configuration lives in the volatile `Config`
 * schema; settings-page forms are generated host-side), so the type is
 * intentionally absent.
 */
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'

/** Timer service methods used by ProcessManager + ManualAdopter. */
interface RemeTimer {
  setTimeout(callback: () => void, delay: number): () => void
}

/** Commands service shape consumed via `ctx.get('commands')` — type-only reference. */
interface RemeCommands {
  execute(agent: unknown, line: string, ...rest: unknown[]): Promise<unknown>
  register(definition: unknown): () => void
}

/** Agent lookup consumed via `ctx.get('agents')` — type-only reference. */
interface RemeAgents {
  get(id: SessionId): { id: string } | undefined
}

/** SystemPrompt service shape — no methods consumed, presence is enough. */
// eslint-disable-next-line @typescript-eslint/no-empty-interface
interface RemeSystemPrompt {}

declare module '@deepseek-ai/cordis' {
  interface Context {
    subprocess: SubprocessRuntime
    timer: RemeTimer
    commands: RemeCommands
    agents: RemeAgents
    systemPrompt: RemeSystemPrompt
  }
  interface Events {
    /** A Session left the live Host registry. */
    'api-session/removed'(sessionId: SessionId): void
    /** One Agent changed running state. */
    'api-session/status'(sessionId: SessionId, running: boolean): void
  }
}

export {}
