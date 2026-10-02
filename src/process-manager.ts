/**
 * reme-auto-router — ProcessManager: spawn, idle-time, and stop reme per
 * cwd.
 *
 * Holds the live `Map<cwd, RemeInstance>` for the plugin. Spawns on
 * demand via `ctx.subprocess.spawn`, tracks port readiness through a
 * bounded TCP probe, and enforces the idle timeout. Pinned cwds
 * never idle-stop.
 *
 * The Manager never decides which cwd is active — that's
 * `WorkspaceDetector`'s job. It only answers `ensure(cwd)` /
 * `touch(cwd)` / `release(cwd)` / `shutdownAll()` and emits state
 * changes via the optional listener.
 *
 * @module reme-auto-router/process-manager
 */

import * as net from 'node:net'
import { Context } from '@deepseek-ai/cordis'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import type { RemeAutoRouterSettings } from './settings-schema.ts'
import { REME_MANAGED_MARKER } from './settings-schema.ts'
import type { StateStore, InstanceRecord } from './state-store.ts'
import { resolveRemeLlmEnv, type RemeLlmEnv } from './llm-source.ts'

/** Lifecycle state of one managed reme instance. */
export type RemeStatus = 'starting' | 'ready' | 'unavailable'

/**
 * Live record kept in ProcessManager's map (extends persisted record).
 *
 * `pid` is optional: 0.1.5's plain `SubprocessHandle` no longer exposes `pid`,
 * so managed instances have `pid` undefined. Adopted instances still carry the
 * OS pid (resolved by `ManualAdopter` via `lsof`), since the user-launched
 * process is independent of our handle.
 */
export interface RemeInstance {
  cwd: string
  port: number
  pid?: number
  ownership: 'managed' | 'adopted'
  status: RemeStatus
  /** Last error message when status transitions to `unavailable`. */
  lastError?: string
  /** Process handle (managed only — undefined for adopted). */
  handle?: SubprocessHandle
  /** ISO timestamps. */
  startedAt: string
  lastUsedAt: string
}

/** Listener invoked when a cwd's state changes. */
export type StateChangeListener = (cwd: string, instance: RemeInstance) => void

/** Constructor inputs. */
export interface ProcessManagerDeps {
  ctx: Context
  /** Settings accessor — resolved at the call site, not captured at construction. */
  settings: () => RemeAutoRouterSettings
  /** Durable state store (writes go through here on spawn/stop/touch). */
  store: StateStore
  /** Logger surface (ctx.logger shape). */
  logger: { warn(message: string): void; info?(message: string): void }
}

/** Time budget for the initial port-bind probe loop. */
const PROBE_TOTAL_MS = 5_000
/** Per-attempt probe timeout. */
const PROBE_TIMEOUT_MS = 500
/** Delay between failed probes. */
const PROBE_BACKOFF_MS = 200

export class ProcessManager {
  private readonly instances = new Map<string, RemeInstance>()
  /** In-flight spawn per cwd, so concurrent `ensure(cwd)` collapses onto one child. */
  private readonly pending = new Map<string, Promise<RemeInstance>>()
  private readonly idleTimers = new Map<string, () => void>()
  private readonly listeners = new Set<StateChangeListener>()
  private readonly dep: ProcessManagerDeps

  constructor(deps: ProcessManagerDeps) {
    this.dep = deps
  }

  /** Subscribe to state transitions. Returns the disposer. */
  onStateChange(listener: StateChangeListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** Read-only snapshot of all live instances (including adopted). */
  entries(): IterableIterator<[string, RemeInstance]> {
    return this.instances.entries()
  }

  /** Lookup one cwd; returns undefined when the cwd is not tracked. */
  get(cwd: string): RemeInstance | undefined {
    return this.instances.get(cwd)
  }

  /**
   * Make sure the cwd has a ready reme instance. Returns the instance
   * after status reaches `ready` (or `unavailable` if spawn failed).
   *
   * Idempotent: re-calling for the same cwd resets the idle timer.
   */
  async ensure(cwd: string): Promise<RemeInstance> {
    const existing = this.instances.get(cwd)
    if (existing !== undefined) {
      this.touch(cwd)
      if (existing.status === 'ready' || existing.status === 'starting') return existing
      // existing.status === 'unavailable' — fall through to retry spawn below
    }
    // Collapse concurrent ensure(cwd) calls — two workspace events, two
    // sessions — onto one spawn: `spawn` reserves its port before its first
    // await, but the instance only exists once a child does, so without this
    // guard the second caller would start a second reme for the same cwd.
    const inflight = this.pending.get(cwd)
    if (inflight !== undefined) {
      this.touch(cwd)
      return await inflight
    }
    const started = this.spawn(cwd)
    this.pending.set(cwd, started)
    try {
      return await started
    } finally {
      this.pending.delete(cwd)
    }
  }

  /** Reset the idle timer for one cwd. */
  touch(cwd: string): void {
    const inst = this.instances.get(cwd)
    if (inst === undefined) return
    inst.lastUsedAt = new Date().toISOString()
    void this.dep.store.replaceRecord({ ...toRecord(inst) })
    this.scheduleIdle(cwd)
  }

  /**
   * Spawn a reme instance for cwd if not present. Always returns the
   * instance (possibly in `starting` status). Throws only if the cwd
   * cannot be canonicalised or port allocation fails.
   */
  private async spawn(cwd: string): Promise<RemeInstance> {
    const cfg = this.dep.settings()
    const port = this.dep.store.allocatePort(cfg.ports.base, cfg.ports.range)
    // We deliberately omit `workspace_dir=<cwd>` from the argv. ReMe's
    // `workspace_dir` defaults to the literal string `.reme` and resolves
    // relative to the reme process's CWD. Combined with `cwd` below, the
    // data lands at `<workspace>/.reme/{daily,digest,metadata,session,
    // mem_session,resource,logs}/` — keeping the workspace clean instead of
    // littering its root with seven visible directories. Hard-coding an
    // absolute path here would defeat the relative-path convention reme
    // ships with.
    const argv = [
      'reme',
      'start',
      `service.port=${String(port)}`,
      REME_MANAGED_MARKER,
    ]
    const now = new Date().toISOString()
    // Reserve the PORT synchronously, before the first await below: resolving
    // the LLM env talks to the credentials and settings services, and
    // `allocatePort` only knows the ports state.json already holds records for,
    // so a spawn for a second cwd inside that window would otherwise be handed
    // the same port as this one. Both children would then race for the port,
    // the loser would die, and the winner would serve untracked — the ready →
    // unavailable flapping this reservation exists to prevent. (Concurrent
    // calls for the SAME cwd are collapsed by `ensure`'s in-flight guard.)
    const instance: RemeInstance = {
      cwd,
      port,
      ownership: 'managed',
      status: 'starting',
      startedAt: now,
      lastUsedAt: now,
    }
    void this.dep.store.replaceRecord(toRecord(instance))
    // Release the reservation when no child was started, so a later
    // ensure(cwd) retries instead of leaving the port booked forever.
    const release = (): void => { void this.dep.store.removeRecord(cwd) }

    // Source the LLM key/base-url/model from DSH at spawn time (credentials
    // seam + host default-model selection, mirroring dsh-user-approval). The
    // value is injected as plain env entries — explicit `env` entries always
    // win over the scrubbed parent base — and is never logged or persisted.
    // Returns undefined when no key resolves: in that case reme keeps today's
    // behaviour (its own env / `.env`), so we inject nothing.
    const remeLlm = await resolveRemeLlmEnv(this.dep.ctx, cfg.llm).catch((error: unknown) => {
      release()
      throw error
    })
    const spec: SubprocessSpawnSpec = {
      argv,
      cwd,
      stdio: {
        stdin: 'ignore',
        stdout: { maxBytes: 64 * 1024 },
        stderr: { maxBytes: 64 * 1024 },
      },
      graceMs: 5_000,
      // Pin NO_PROXY to IPv4 loopback. Parent shell may export `NO_PROXY=::1`
      // (containers, npm config, shell rc) which reaches the reme child via
      // `scrubbedParentEnv` — httpx2 inside reme then trips on the IPv6 form
      // and rejects every `auto_memory` / `auto_dream` LLM call with
      // `InvalidURL: Invalid port: ':1]'`. IPv4 loopback is semantically
      // equivalent for our use case (reme listens on 127.0.0.1 only).
      env: {
        NO_PROXY: '127.0.0.1,localhost',
        no_proxy: '127.0.0.1,localhost',
        ...(remeLlm === undefined ? {} : {
          LLM_API_KEY: remeLlm.apiKey,
          ...(remeLlm.baseUrl === undefined ? {} : { LLM_BASE_URL: remeLlm.baseUrl }),
          ...(remeLlm.model === undefined ? {} : { LLM_MODEL_NAME: remeLlm.model }),
        }),
      },
    }
    let handle: SubprocessHandle
    try {
      handle = this.dep.ctx.subprocess.spawn(spec)
    } catch (error) {
      // A synchronous provider failure must not leave the port reserved.
      release()
      throw error
    }
    // 0.1.5 `SubprocessHandle` removed the `pid` getter; we intentionally
    // leave `pid` undefined for managed instances. The `terminateTree`
    // path uses the handle's own escalation, not the OS pid.
    instance.handle = handle
    // Install only now: readers (`manager.get`) must never observe a spawn that
    // produced no process, so a failed start cannot push a status card.
    this.instances.set(cwd, instance)
    if (remeLlm !== undefined) {
      // Provenance only — the key value itself is never logged.
      this.dep.logger.info?.(
        `reme-auto-router: ${cwd} reme LLM sourced from DSH (key=${remeLlm.keySource}, `
        + `provider=${remeLlm.provider ?? 'n/a'}, model=${remeLlm.model ?? 'n/a'}, `
        + `baseUrl=${remeLlm.baseUrl ?? 'n/a'})`,
      )
    }

    // Probe for port readiness in the background; resolve immediately with `starting`.
    void this.probeReady(instance).then((status) => {
      if (this.instances.get(cwd) !== instance) return // superseded
      instance.status = status
      if (status === 'unavailable') {
        instance.lastError = 'port did not bind within probe window'
        this.dep.logger.warn(`reme-auto-router: ${cwd} failed to bind port ${String(port)}`)
      }
      this.emit(cwd, instance)
      void this.dep.store.replaceRecord(toRecord(instance))
    })

    handle.done
      .then((outcome) => {
        if (this.instances.get(cwd) !== instance) return // superseded / stopped
        // Process exited unexpectedly before/after reaching ready. Its own
        // output is the only evidence of why: reme logs to stderr, and the
        // collected tail stays readable after exit, so report it — redacting
        // the key, which the child only ever sees in its environment.
        if (instance.status !== 'unavailable') {
          instance.status = 'unavailable'
          instance.lastError = `process exited code=${String(outcome.exitCode)} signal=${outcome.signal ?? 'none'}`
          this.emit(cwd, instance)
          void this.dep.store.replaceRecord(toRecord(instance))
        }
        const tail = childOutputTail(handle)
        this.dep.logger.warn(
          `reme-auto-router: ${cwd} ${instance.lastError ?? 'process exited'}`
          + (tail === undefined ? '' : `\n${redactSecret(tail, remeLlm?.apiKey)}`),
        )
      })
      .catch((error: unknown) => {
        // Spawn-level failure: `handle.done` rejects when the provider could not
        // start the process. Release the slot (the reservation above is already
        // installed) so a later ensure(cwd) can retry instead of wedging on a
        // `starting` instance that will never get a process.
        if (this.instances.get(cwd) !== instance) return
        this.instances.delete(cwd)
        void this.dep.store.removeRecord(cwd)
        this.dep.logger.warn(`reme-auto-router: ${cwd} could not start reme: ${String(error)}`)
      })

    this.emit(cwd, instance)
    return instance
  }

  /**
   * Probe `127.0.0.1:port` until it accepts a TCP connection or the total
   * budget elapses. Returns `ready` on success, `unavailable` on timeout.
   */
  private async probeReady(instance: RemeInstance): Promise<RemeStatus> {
    const deadline = Date.now() + PROBE_TOTAL_MS
    while (Date.now() < deadline) {
      const ok = await tryConnect('127.0.0.1', instance.port, PROBE_TIMEOUT_MS)
      if (ok) return 'ready'
      await sleep(PROBE_BACKOFF_MS)
    }
    return 'unavailable'
  }

  /**
   * Schedule idle stop for the cwd. Disposed and re-armed on every touch.
   * Pinned cwds never get an idle timer; the existing one (if any) is cleared.
   */
  private scheduleIdle(cwd: string): void {
    const dispose = this.idleTimers.get(cwd)
    if (dispose !== undefined) {
      dispose()
      this.idleTimers.delete(cwd)
    }
    const inst = this.instances.get(cwd)
    if (inst === undefined || inst.ownership !== 'managed') return
    const cfg = this.dep.settings()
    if (cfg.pinnedDirs.includes(cwd)) return // pin protects the instance
    const timerDispose = this.dep.ctx.timer.setTimeout(() => {
      void this.stop(cwd, 'idle timeout')
    }, cfg.idleTimeoutMs)
    this.idleTimers.set(cwd, timerDispose)
  }

  /**
   * Stop one managed reme instance. Adopted instances are never stopped
   * by us — that's the whole point of the adoption flag.
   */
  async stop(cwd: string, reason: string): Promise<void> {
    const inst = this.instances.get(cwd)
    if (inst === undefined) return
    if (inst.ownership !== 'managed') return
    const dispose = this.idleTimers.get(cwd)
    if (dispose !== undefined) {
      dispose()
      this.idleTimers.delete(cwd)
    }
    await terminateTree(inst)
    this.instances.delete(cwd)
    void this.dep.store.removeRecord(cwd)
    this.dep.logger.info?.(`reme-auto-router: stopped ${cwd} (${reason})`)
  }

  /** Adopt a manually-launched reme instance into the map. */
  adopt(cwd: string, port: number, pid: number): RemeInstance {
    const now = new Date().toISOString()
    const instance: RemeInstance = {
      cwd,
      port,
      pid,
      ownership: 'adopted',
      status: 'ready',
      startedAt: now,
      lastUsedAt: now,
    }
    this.instances.set(cwd, instance)
    void this.dep.store.replaceRecord(toRecord(instance))
    this.emit(cwd, instance)
    return instance
  }

  private emit(cwd: string, instance: RemeInstance): void {
    for (const listener of this.listeners) listener(cwd, instance)
  }
}

/** Translate instance → persisted record. Omit `pid` when undefined so the
 *  on-disk shape matches the optional field's intent (rather than writing
 *  `null` / `-1` and forcing the schema to special-case them). */
function toRecord(inst: RemeInstance): InstanceRecord {
  return {
    cwd: inst.cwd,
    port: inst.port,
    ownership: inst.ownership,
    startedAt: inst.startedAt,
    lastUsedAt: inst.lastUsedAt,
    ...(inst.pid === undefined ? {} : { pid: inst.pid }),
  }
}

/**
 * SIGTERM → graceMs → SIGKILL on the SubprocessHandle. The handle's
 * spec already encodes the escalation (its `graceMs` is the SIGTERM→
 * SIGKILL window), so this just fires the verb and awaits full tree exit.
 *
 * No `pid` sentinel: 0.1.5's plain SubprocessHandle no longer exposes `pid`,
 * and `terminate()` is a no-op when the handle is already settled. We rely
 * on the `done` promise chain in `spawn()` to surface spawn-level failures.
 */
async function terminateTree(inst: RemeInstance): Promise<void> {
  const handle = inst.handle
  if (handle === undefined) return
  handle.terminate()
  await handle.waitForExit(undefined)
}

/**
 * Read the retained tail of the child's collected output, for exit diagnostics.
 * Prefers stderr (where reme's tracebacks land), falls back to stdout, and
 * returns undefined when the child said nothing. Collected streams stay
 * readable after exit, so this is safe to call from the `done` handler.
 */
function childOutputTail(handle: SubprocessHandle, maxChars = 4_000): string | undefined {
  for (const reader of [handle.collected.stderr, handle.collected.stdout]) {
    const text = reader?.readFrom(0).text.trim()
    if (text !== undefined && text !== '') {
      return text.length > maxChars ? `…${text.slice(-maxChars)}` : text
    }
  }
  return undefined
}

/** Replace a known secret with a marker before it can reach a log sink. */
function redactSecret(text: string, secret: string | undefined): string {
  return secret === undefined || secret === '' ? text : text.split(secret).join('<redacted>')
}

/** One TCP-connect probe with a hard timeout. */
function tryConnect(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const socket = new net.Socket()
    let settled = false
    const finish = (value: boolean): void => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(value)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
    socket.once('timeout', () => finish(false))
    socket.connect(port, host)
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}