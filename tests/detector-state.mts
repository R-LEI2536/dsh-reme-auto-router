/**
 * reme-auto-router — WorkspaceDetector state-machine unit test.
 *
 * Pure detector test with a mocked ProcessManager and a minimal
 * ctx/sessions stub. Validates the preparing→active gate that fixes
 * the workspace-switch endpoint-stale bug (v0.2 #0).
 *
 * Run via:
 *   pnpm exec tsx tests/detector-state.mts
 *
 * Exits 0 on success, 1 on first failed assertion.
 */

import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { realpath } from 'node:fs/promises'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { RemeInstance, StateChangeListener } from '../src/process-manager.ts'
import { WorkspaceDetector } from '../src/workspace-detector.ts'

/** Real on-disk cwds so readSessionCwd's realpath() succeeds. */
const sandboxRoot = mkdtempSync(join(tmpdir(), 'reme-detector-'))
const cwdA = join(sandboxRoot, 'a')
const cwdB = join(sandboxRoot, 'b')
mkdirSync(cwdA)
mkdirSync(cwdB)

/** Pre-canonicalised paths (realpath resolves symlinks like /tmp → /private/tmp). */
const canonicalA = await realpath(cwdA)
const canonicalB = await realpath(cwdB)

/** Branded SessionId aliases so the test reads as identifiers, not strings. */
const A = 'A' as SessionId
const B = 'B' as SessionId

interface ListenerTrace {
  preparing: Array<{ cwd: string | undefined; sessionId: SessionId | undefined }>
  active: Array<{ cwd: string | undefined; sessionId: SessionId | undefined }>
}

function newTrace(): ListenerTrace {
  return { preparing: [], active: [] }
}

/** Tiny in-memory session store. */
class SessionsStub {
  private readonly byId = new Map<SessionId, { header: { cwd?: string } }>()
  put(id: SessionId, cwd: string | undefined): void {
    if (cwd === undefined) this.byId.delete(id)
    else this.byId.set(id, { header: { cwd } })
  }
  get(id: SessionId): { header: { cwd?: string } } | undefined {
    return this.byId.get(id)
  }
}

/** Minimal cordis Context stub: only the `on` and `get` surface. */
class ContextStub {
  private readonly handlers = new Map<string, Set<(...args: unknown[]) => void>>()
  private readonly services = new Map<string, unknown>()
  on(event: string, handler: (...args: unknown[]) => void): () => void {
    let bucket = this.handlers.get(event)
    if (bucket === undefined) {
      bucket = new Set()
      this.handlers.set(event, bucket)
    }
    bucket.add(handler)
    return () => {
      bucket?.delete(handler)
    }
  }
  emit(event: string, ...args: unknown[]): void {
    const bucket = this.handlers.get(event)
    if (bucket === undefined) return
    for (const h of bucket) void h(...args)
  }
  provide(name: string, value: unknown): void {
    this.services.set(name, value)
  }
  get<T = unknown>(name: string): T | undefined {
    return this.services.get(name) as T | undefined
  }
}

/**
 * Mock ProcessManager. `ensure(cwd)` returns a fresh starting instance
 * synchronously; `markReady(cwd)` is the test hook to fire the
 * `ready` state-change that the detector subscribes to.
 */
class ManagerStub {
  private readonly instances = new Map<string, RemeInstance>()
  private readonly listeners = new Set<StateChangeListener>()
  private nextPort = 23_33

  async ensure(cwd: string): Promise<RemeInstance> {
    let inst = this.instances.get(cwd)
    if (inst === undefined) {
      inst = {
        cwd,
        port: this.nextPort++,
        pid: 10_000 + this.instances.size,
        ownership: 'managed',
        status: 'starting',
        startedAt: '2026-09-07T00:00:00.000Z',
        lastUsedAt: '2026-09-07T00:00:00.000Z',
      }
      this.instances.set(cwd, inst)
    }
    return inst
  }
  get(cwd: string): RemeInstance | undefined {
    return this.instances.get(cwd)
  }
  onStateChange(listener: StateChangeListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  /** Test hook: mark an instance ready and fire all listeners. */
  markReady(cwd: string): void {
    const inst = this.instances.get(cwd)
    if (inst === undefined) return
    inst.status = 'ready'
    for (const l of this.listeners) l(cwd, inst)
  }
}

function tick(ms = 20): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

let failed = 0
function check(label: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    console.log(`ok   ${label}`)
    return
  }
  failed++
  console.error(`FAIL ${label}`, detail ?? '')
}

async function test1_preparingFiresOnNewSession(): Promise<void> {
  const ctx = new ContextStub()
  const sessions = new SessionsStub()
  ctx.provide('sessions', sessions)
  const mgr = new ManagerStub()
  const detector = new WorkspaceDetector({ ctx: ctx as never, manager: mgr })
  const trace = newTrace()
  detector.onPreparingCwdChanged((e) => trace.preparing.push(e))
  detector.onActiveCwdChanged((e) => trace.active.push(e))
  detector.start()

  sessions.put(A, canonicalA)
  ctx.emit('api-session/status', A, true)
  await tick()

  check('1.1 preparing fired exactly once', trace.preparing.length === 1, trace.preparing)
  check('1.2 preparing cwd === canonicalA', trace.preparing[0]?.cwd === canonicalA)
  check('1.3 preparing sessionId === A', trace.preparing[0]?.sessionId === A)
  check('1.4 active NOT fired (still preparing)', trace.active.length === 0, trace.active)
  check('1.5 activeCwd() undefined', detector.activeCwd() === undefined)
  check('1.6 preparingCwd() === canonicalA', detector.preparingCwd() === canonicalA)
  check('1.7 mgr.ensure(canonicalA) was called', mgr.get(canonicalA) !== undefined)

  detector.stop()
}

async function test2_promoteOnReady(): Promise<void> {
  const ctx = new ContextStub()
  const sessions = new SessionsStub()
  ctx.provide('sessions', sessions)
  const mgr = new ManagerStub()
  const detector = new WorkspaceDetector({ ctx: ctx as never, manager: mgr })
  const trace = newTrace()
  detector.onPreparingCwdChanged((e) => trace.preparing.push(e))
  detector.onActiveCwdChanged((e) => trace.active.push(e))
  detector.start()

  sessions.put(A, canonicalA)
  ctx.emit('api-session/status', A, true)
  await tick()
  mgr.markReady(canonicalA)
  await tick()

  check('2.1 active fired exactly once', trace.active.length === 1, trace.active)
  check('2.2 active cwd === canonicalA', trace.active[0]?.cwd === canonicalA)
  check('2.3 active sessionId === A', trace.active[0]?.sessionId === A)
  check('2.4 activeCwd() === canonicalA', detector.activeCwd() === canonicalA)
  check('2.5 preparingCwd() undefined (A promoted away)', detector.preparingCwd() === undefined)
  // The promote also fires preparing with cwd=undefined (the set is now empty).
  check('2.6 preparing fired twice total (new + empty)', trace.preparing.length === 2)
  check('2.7 second preparing has cwd=undefined', trace.preparing[1]?.cwd === undefined)

  detector.stop()
}

async function test3_concurrentPreparingKeepsOldActive(): Promise<void> {
  const ctx = new ContextStub()
  const sessions = new SessionsStub()
  ctx.provide('sessions', sessions)
  const mgr = new ManagerStub()
  const detector = new WorkspaceDetector({ ctx: ctx as never, manager: mgr })
  const trace = newTrace()
  detector.onPreparingCwdChanged((e) => trace.preparing.push(e))
  detector.onActiveCwdChanged((e) => trace.active.push(e))
  detector.start()

  sessions.put(A, canonicalA)
  ctx.emit('api-session/status', A, true)
  await tick()
  mgr.markReady(canonicalA)
  await tick()
  // Now user switches to B while A is still active.
  sessions.put(B, canonicalB)
  ctx.emit('api-session/status', B, true)
  await tick()

  check('3.1 activeCwd() still === canonicalA (B is preparing, not promoted)', detector.activeCwd() === canonicalA)
  check('3.2 preparingCwd() === canonicalB', detector.preparingCwd() === canonicalB)
  check('3.3 active did NOT fire again for B preparing', trace.active.length === 1)

  detector.stop()
}

async function test4_promoteLaterCwdsWins(): Promise<void> {
  const ctx = new ContextStub()
  const sessions = new SessionsStub()
  ctx.provide('sessions', sessions)
  const mgr = new ManagerStub()
  const detector = new WorkspaceDetector({ ctx: ctx as never, manager: mgr })
  detector.start()

  sessions.put(A, canonicalA)
  ctx.emit('api-session/status', A, true)
  void tick().then(() => mgr.markReady(canonicalA))
  sessions.put(B, canonicalB)
  ctx.emit('api-session/status', B, true)
  void tick().then(() => mgr.markReady(canonicalB))
  await tick(50)

  check('4.1 activeCwd() === canonicalB (most-recent active wins)', detector.activeCwd() === canonicalB)
  check('4.2 preparingCwd() undefined', detector.preparingCwd() === undefined)
  detector.stop()
}

async function test5_sessionRemovalFiresActive(): Promise<void> {
  const ctx = new ContextStub()
  const sessions = new SessionsStub()
  ctx.provide('sessions', sessions)
  const mgr = new ManagerStub()
  const detector = new WorkspaceDetector({ ctx: ctx as never, manager: mgr })
  const trace = newTrace()
  detector.onActiveCwdChanged((e) => trace.active.push(e))
  detector.start()

  sessions.put(A, canonicalA)
  ctx.emit('api-session/status', A, true)
  await tick()
  mgr.markReady(canonicalA)
  await tick()
  const beforeRemoval = trace.active.length

  sessions.put(A, undefined)
  ctx.emit('api-session/status', A, false)
  await tick()

  check('5.1 active fired on removal', trace.active.length === beforeRemoval + 1, trace.active)
  check('5.2 last active cwd === undefined', trace.active.at(-1)?.cwd === undefined)
  check('5.3 activeCwd() === undefined', detector.activeCwd() === undefined)

  detector.stop()
}

async function test6_alreadyActiveSameCwdIsNoop(): Promise<void> {
  const ctx = new ContextStub()
  const sessions = new SessionsStub()
  ctx.provide('sessions', sessions)
  const mgr = new ManagerStub()
  const detector = new WorkspaceDetector({ ctx: ctx as never, manager: mgr })
  const trace = newTrace()
  detector.onPreparingCwdChanged((e) => trace.preparing.push(e))
  detector.onActiveCwdChanged((e) => trace.active.push(e))
  detector.start()

  sessions.put(A, canonicalA)
  ctx.emit('api-session/status', A, true)
  await tick()
  mgr.markReady(canonicalA)
  await tick()
  const activeBefore = trace.active.length
  const preparingBefore = trace.preparing.length

  // Same session, same cwd, status=true again (idempotent re-emit).
  ctx.emit('api-session/status', A, true)
  await tick()

  check('6.1 active NOT re-fired', trace.active.length === activeBefore)
  check('6.2 preparing NOT re-fired', trace.preparing.length === preparingBefore)

  detector.stop()
}

async function main(): Promise<void> {
  await test1_preparingFiresOnNewSession()
  await test2_promoteOnReady()
  await test3_concurrentPreparingKeepsOldActive()
  await test4_promoteLaterCwdsWins()
  await test5_sessionRemovalFiresActive()
  await test6_alreadyActiveSameCwdIsNoop()
  if (failed > 0) {
    console.error(`\n${failed} check(s) failed`)
    process.exit(1)
  }
  console.log('\ndetector-state: all checks passed')
}

main().catch((error: unknown) => {
  const reason = error instanceof Error ? (error.stack ?? error.message) : String(error)
  console.error('FAIL', reason)
  process.exit(1)
})
