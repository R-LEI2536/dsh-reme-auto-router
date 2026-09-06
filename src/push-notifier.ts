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

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { RemeInstance } from './process-manager.ts'

/** Shape the slash-command handler and the notifier both render from. */
export interface StatusSnapshot {
  readonly cwd: string
  readonly port: number
  readonly pid: number
  readonly ownership: 'managed' | 'adopted'
  readonly status: 'starting' | 'ready' | 'unavailable'
  readonly title: string
  readonly lastError?: string
}

/** Logger surface the notifier depends on. */
export interface PushNotifierLogger {
  warn(message: string): void
}

/** Lookup the Agent for a session id — may return undefined when detached. */
export type AgentResolver = (sessionId: SessionId) => Agent | undefined

/** Construction inputs. */
export interface PushNotifierDeps {
  ctx: Context
  resolveAgent: AgentResolver
  logger: PushNotifierLogger
}

/**
 * Auto-push a user-visible chat card on reme state changes. Inert
 * until `push()` is called.
 */
export class PushNotifier {
  private readonly ctx: Context
  private readonly resolveAgent: AgentResolver
  private readonly logger: PushNotifierLogger
  private readonly lastPushed = new Map<string, string>()

  constructor(deps: PushNotifierDeps) {
    this.ctx = deps.ctx
    this.resolveAgent = deps.resolveAgent
    this.logger = deps.logger
  }

  /**
   * Push the current state for `instance` to the chat flow of
   * `sessionId` if the rendered text differs from the last push
   * for that cwd. Errors are absorbed into a single warn log so a
   * transient failure cannot tear down the host.
   */
  async push(sessionId: SessionId, instance: RemeInstance, title: string): Promise<void> {
    const snapshot: StatusSnapshot = {
      cwd: instance.cwd,
      port: instance.port,
      pid: instance.pid,
      ownership: instance.ownership,
      status: instance.status,
      title,
      ...instance.lastError === undefined ? {} : { lastError: instance.lastError },
    }
    const text = renderStatusLine(snapshot)
    if (this.lastPushed.get(snapshot.cwd) === text) return
    const agent = this.resolveAgent(sessionId)
    if (agent === undefined) {
      this.logger.warn(`push-notifier: no agent for session '${String(sessionId)}'; skipping push`)
      return
    }
    const commands = this.ctx.get('commands') as
      | { execute(a: Agent, line: string, images: readonly never[], signal: AbortSignal): Promise<unknown> }
      | undefined
    if (commands === undefined) {
      this.logger.warn('push-notifier: ctx.commands is unavailable; skipping push')
      return
    }
    try {
      await commands.execute(agent, '/reme', [], new AbortController().signal)
      this.lastPushed.set(snapshot.cwd, text)
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      this.logger.warn(`push-notifier: commands.execute for '${snapshot.cwd}' rejected: ${reason}`)
    }
  }

  /** Reset dedup memory. Useful on plugin teardown. */
  dispose(): void {
    this.lastPushed.clear()
  }
}

/**
 * Render one status line. Pure; shared by the slash command
 * handler and the PushNotifier so user-typed `/reme` and auto-push
 * produce identical text.
 */
export function renderStatusLine(snapshot: StatusSnapshot): string {
  const head = formatHead(snapshot)
  const tail = formatTail(snapshot)
  return tail === undefined ? head : `${head}\n${tail}`
}

function formatHead(snapshot: StatusSnapshot): string {
  const tag = snapshot.ownership === 'adopted' ? '👀 adopted reme' : '🔄 reme'
  switch (snapshot.status) {
    case 'ready':
      return `${tag} ready (${snapshot.title})`
    case 'starting':
      return `${tag} starting… (${snapshot.title})`
    case 'unavailable':
      return `⚠ reme unavailable (${snapshot.title})`
  }
}

function formatTail(snapshot: StatusSnapshot): string | undefined {
  if (snapshot.status === 'starting') return undefined
  const portPid = `port ${String(snapshot.port)} · pid ${String(snapshot.pid)}`
  if (snapshot.status === 'unavailable') {
    return `${portPid} — ${snapshot.lastError ?? 'unknown failure'}`
  }
  return portPid
}

/** POSIX basename for display; tolerates both `/` and `\` separators. */
export function basename(p: string): string {
  const trimmed = p.replace(/[\\/]+$/, '')
  const idx = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  return idx >= 0 ? trimmed.slice(idx + 1) : trimmed
}