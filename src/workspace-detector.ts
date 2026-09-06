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

import { realpath } from 'node:fs/promises'
import { sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session'

/** Listener invoked with the new active cwd, or undefined when no session runs. */
export type ActiveCwdListener = (cwd: string | undefined) => void

/** Construction inputs. */
export interface WorkspaceDetectorDeps {
  ctx: Context
  logger?: { warn(message: string): void }
}

/**
 * Resolves the active workspace cwd from the running-session event stream.
 *
 * The instance is inert until `start()` is called; `stop()` is idempotent
 * and safe to call before `start()`.
 */
export class WorkspaceDetector {
  private readonly ctx: Context
  private readonly logger: WorkspaceDetectorDeps['logger']
  /** Insertion order = most-recently-activated last; `values().at(-1)` is the active cwd. */
  private readonly runningCwds = new Map<SessionId, string>()
  private readonly listeners = new Set<ActiveCwdListener>()
  private activeCwdValue: string | undefined
  private disposers: Array<() => void> = []

  constructor(deps: WorkspaceDetectorDeps) {
    this.ctx = deps.ctx
    this.logger = deps.logger
  }

  /**
   * The current active cwd, or `undefined` when no session is running.
   */
  activeCwd(): string | undefined {
    return this.activeCwdValue
  }

  /**
   * The sessionId of the most-recently activated session, or
   * `undefined` when no session is running. Pairs with `activeCwd()`
   * for callers that need to resolve the owning Agent.
   */
  activeSessionId(): SessionId | undefined {
    if (this.runningCwds.size === 0) return undefined
    const lastKey = [...this.runningCwds.keys()].at(-1)
    return lastKey
  }

  /**
   * Subscribe to active-cwd changes. Fires immediately if a callback
   * is registered after a transition has already happened.
   */
  onActiveCwdChanged(listener: ActiveCwdListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** Register `api-session/*` listeners. Idempotent: re-calling is a no-op. */
  start(): void {
    if (this.disposers.length > 0) return
    this.disposers.push(
      this.ctx.on('api-session/status', (sessionId, running) => {
        void this.onStatus(sessionId, running)
      }),
      this.ctx.on('api-session/removed', (sessionId) => {
        void this.onRemoved(sessionId)
      }),
    )
  }

  /** Dispose all listeners. Idempotent. */
  stop(): void {
    for (const dispose of this.disposers) dispose()
    this.disposers = []
  }

  private async onStatus(sessionId: SessionId, running: boolean): Promise<void> {
    if (running) {
      const cwd = await this.readSessionCwd(sessionId)
      if (cwd === undefined) return
      // Move-to-end: delete + insert re-positions this session at the
      // tail so it becomes the new active cwd when multiple sessions
      // run concurrently.
      if (this.runningCwds.has(sessionId)) this.runningCwds.delete(sessionId)
      this.runningCwds.set(sessionId, cwd)
      this.publish(this.lastValue())
      return
    }
    if (this.runningCwds.delete(sessionId)) this.publish(this.lastValue())
  }

  private publish(next: string | undefined): void {
    if (next === this.activeCwdValue) return
    this.activeCwdValue = next
    for (const listener of this.listeners) listener(next)
  }

  private lastValue(): string | undefined {
    const last = [...this.runningCwds.values()].at(-1)
    return last
  }

  private async onRemoved(sessionId: SessionId): Promise<void> {
    if (this.runningCwds.delete(sessionId)) this.publish(this.lastValue())
  }

  /**
   * Read and canonicalise the cwd of a session. Returns undefined
   * when the session is unknown, has no cwd, or its cwd does not
   * resolve to a real directory; the skip is silent because the
   * failure modes are normal during a session lifecycle.
   */
  private async readSessionCwd(sessionId: SessionId): Promise<string | undefined> {
    const sessions = this.ctx.get('sessions')
    if (sessions === undefined) return undefined
    const session = sessions.get(sessionId)
    if (session === undefined) return undefined
    const raw = session.header.cwd
    if (typeof raw !== 'string' || raw.length === 0) return undefined
    try {
      const canonical = await realpath(raw)
      return canonical.endsWith(sep) ? canonical.slice(0, -1) : canonical
    } catch {
      return undefined
    }
  }
}