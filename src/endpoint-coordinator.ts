/**
 * reme-auto-router — EndpointCoordinator: publish the active cwd's
 * reme port to the official `reme-memory` plugin.
 *
 * The coordinator owns one write path: when the active workspace
 * cwd has a ready reme instance, it calls the live endpoint setter on
 * the `remeMemory` service provided by the official reme-memory
 * plugin (dsh-reme-support). That routes the plugin's HTTP client to
 * the active workspace's reme process without persisting anything —
 * the same live, non-durable semantics the old
 * `ctx.settings['reme-memory'].endpoint` write had under DSH 0.1.5.
 *
 * Trigger sources (subscribed once at construction):
 *   - `manager.onStateChange(...)` — fires when any instance reaches
 *     `ready`; we route only if the changed cwd is the active cwd
 *   - `detector.onActiveCwdChanged(...)` — fires when the active
 *     cwd changes; we route the new cwd regardless of which event
 *     made it ready
 *
 * Failures (remeMemory service missing, the call itself rejecting)
 * are surfaced as one warn log per cause and the function returns.
 * We never throw into the host event loop.
 *
 * @module reme-auto-router/endpoint-coordinator
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ProcessManager, RemeInstance } from './process-manager.ts'

/**
 * Live endpoint sink the official reme-memory plugin exposes on its
 * `remeMemory` service. `setEndpoint` repoints the HTTP client at the
 * given URL at runtime; it must not touch persisted configuration.
 */
export interface RemeMemoryEndpointSink {
  setEndpoint(url: string): void
}

/** Cwd value the detector exposes; undefined when no session runs. */
export type ActiveCwdProvider = () => string | undefined

/** Logger surface this module depends on. */
export interface CoordinatorLogger {
  warn(message: string): void
  info?(message: string): void
}

/** Construction inputs. */
export interface EndpointCoordinatorDeps {
  ctx: Context
  manager: Pick<ProcessManager, 'get' | 'onStateChange'>
  activeCwd: ActiveCwdProvider
  logger: CoordinatorLogger
  /** Optional override; defaults to `http://127.0.0.1:<port>`. */
  formatEndpoint?: (port: number) => string
}

/**
 * Reconcile the active-cwd reme endpoint with `ctx.settings['reme-memory']`.
 *
 * The instance is inert until `start()` is called. Re-calling `start()`
 * is a no-op; `stop()` releases both subscriptions and is idempotent.
 */
export class EndpointCoordinator {
  private readonly ctx: Context
  private readonly manager: Pick<ProcessManager, 'get' | 'onStateChange'>
  private readonly activeCwd: ActiveCwdProvider
  private readonly logger: CoordinatorLogger
  private readonly formatEndpoint: (port: number) => string

  /** Per-cause one-shot warn flag so the log never spams. */
  private warnedNoSink = false

  /**
   * Last endpoint actually delivered, as `(sink identity, cwd, url)`.
   *
   * A single `ready` transition reaches us through three independent
   * triggers (the detector's promote path re-firing
   * `onActiveCwdChanged`, our own manager subscription, and the
   * `index.ts` manager subscription), so the same target would be
   * written — and logged — three times. Routing is idempotent on the
   * peer side (dsh-reme-support's `setEndpoint` re-runs
   * `runtime.reconfigure()`, whose effects drain on the first call),
   * so re-asserting an identical target is pure noise. Comparing the
   * sink identity too means a re-mounted `remeMemory` service is never
   * skipped by a stale memo.
   */
  private lastSink: RemeMemoryEndpointSink | undefined
  private lastRouted: { cwd: string; endpoint: string } | undefined

  /** Disposer for the manager state-change subscription. */
  private stateChangeDispose: (() => void) | undefined
  /** Currently scheduled route call; subsequent ones chain onto the tail. */
  private routeTail: Promise<void> = Promise.resolve()

  constructor(deps: EndpointCoordinatorDeps) {
    this.ctx = deps.ctx
    this.manager = deps.manager
    this.activeCwd = deps.activeCwd
    this.logger = deps.logger
    this.formatEndpoint = deps.formatEndpoint ?? defaultEndpoint
  }

  /** Subscribe to the two trigger sources. Idempotent. */
  start(): void {
    if (this.stateChangeDispose !== undefined) return
    const onState = (): void => {
      void this.route(this.activeCwd())
    }
    this.stateChangeDispose = this.manager.onStateChange(onState)
  }

  /** Release the manager subscription. Idempotent. */
  stop(): void {
    this.stateChangeDispose?.()
    this.stateChangeDispose = undefined
  }

  /**
   * Write the endpoint for `cwd` if a ready instance exists. Chained
   * so concurrent triggers serialize in arrival order; rejections
   * from one call do not poison the queue.
   */
  route(cwd: string | undefined): Promise<void> {
    const next = this.routeTail.then(() => this.runRoute(cwd)).catch(() => undefined)
    this.routeTail = next
    return next
  }

  /** Wait for any in-flight route writes to settle. */
  async drain(): Promise<void> {
    await this.routeTail
  }

  private async runRoute(cwd: string | undefined): Promise<void> {
    if (cwd === undefined) return // keep the last successful write
    const instance = this.readyInstance(cwd)
    if (instance === undefined) return
    const remeMemory = this.ctx.get('remeMemory') as RemeMemoryEndpointSink | undefined
    if (remeMemory === undefined || typeof remeMemory.setEndpoint !== 'function') {
      if (!this.warnedNoSink) {
        this.warnedNoSink = true
        this.logger.warn('reme-auto-router: remeMemory service is unavailable; the official reme-memory plugin may not be mounted')
      }
      return
    }
    const endpoint = this.formatEndpoint(instance.port)
    // Duplicate triggers for a target we already delivered are no-ops.
    // Recorded only after a successful write, so a throwing
    // setEndpoint stays retryable on the next trigger.
    const alreadyRouted =
      this.lastSink === remeMemory &&
      this.lastRouted?.cwd === cwd &&
      this.lastRouted.endpoint === endpoint
    if (alreadyRouted) return
    try {
      remeMemory.setEndpoint(endpoint)
      this.lastSink = remeMemory
      this.lastRouted = { cwd, endpoint }
      this.logger.info?.(`reme-auto-router: routed ${cwd} → ${endpoint}`)
    } catch (error) {
      if (!this.warnedNoSink) {
        this.warnedNoSink = true
        const reason = error instanceof Error ? error.message : String(error)
        this.logger.warn(`reme-auto-router: remeMemory.setEndpoint('${endpoint}') failed (${reason})`)
      }
    }
  }

  private readyInstance(cwd: string): RemeInstance | undefined {
    const instance = this.manager.get(cwd)
    if (instance === undefined) return undefined
    return instance.status === 'ready' ? instance : undefined
  }
}

/** Default loopback URL formatter. */
function defaultEndpoint(port: number): string {
  return `http://127.0.0.1:${String(port)}`
}