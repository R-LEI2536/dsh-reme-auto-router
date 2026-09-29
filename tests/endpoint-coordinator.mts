/**
 * reme-auto-router — EndpointCoordinator routing-seam contract test.
 *
 * Unit-tests the DSH 0.1.7 routing channel: the coordinator must call
 * `setEndpoint(url)` on the `remeMemory` service provided by the official
 * reme-memory plugin (dsh-reme-support ≥ 0.2.2), and must degrade safely
 * (one-shot warn, never throw) when the service is absent or malformed.
 *
 * This locks OUR side of the contract documented in
 * `docs/reme-memory-setEndpoint-contract.md`:
 *
 *   1. ready instance + service present  → setEndpoint(http://127.0.0.1:<port>)
 *   2. no ready instance                 → no call, no warn
 *   3. service missing                   → warn exactly once, further routes silent
 *   4. service present but no setEndpoint→ warn exactly once, no throw
 *   5. setEndpoint throws                → warn once, rejection not propagated
 *
 * Run via:
 *   pnpm exec tsx --tsconfig tsconfig.base.json \
 *     tests/endpoint-coordinator.mts
 *
 * Exits 0 on success, 1 on first failed assertion.
 */

import { EndpointCoordinator, type RemeMemoryEndpointSink } from '../src/endpoint-coordinator.ts'
import type { RemeInstance, StateChangeListener } from '../src/process-manager.ts'

/** Minimal cordis Context stub: only the `get` surface the coordinator uses. */
class ContextStub {
  private readonly services = new Map<string, unknown>()
  constructor(services: Record<string, unknown> = {}) {
    for (const [name, value] of Object.entries(services)) this.services.set(name, value)
  }
  get<T = unknown>(name: string): T | undefined {
    return this.services.get(name) as T | undefined
  }
}

/** Manager stub exposing just `get` and `onStateChange`. */
class ManagerStub {
  private readonly byCwd = new Map<string, RemeInstance>()
  private readonly listeners = new Set<StateChangeListener>()
  put(instance: RemeInstance): void {
    this.byCwd.set(instance.cwd, instance)
  }
  get(cwd: string): RemeInstance | undefined {
    return this.byCwd.get(cwd)
  }
  onStateChange(listener: StateChangeListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
}

/** Recording sink: asserts the coordinator delivers the expected URL. */
class RecordingSink implements RemeMemoryEndpointSink {
  readonly urls: string[] = []
  fail: Error | undefined
  setEndpoint(url: string): void {
    if (this.fail !== undefined) throw this.fail
    this.urls.push(url)
  }
}

/** Logging surface: collects warn/info lines. */
class LoggerStub {
  readonly warns: string[] = []
  readonly infos: string[] = []
  warn(message: string): void {
    this.warns.push(message)
  }
  info(message: string): void {
    this.infos.push(message)
  }
}

function instance(cwd: string, port: number, status: RemeInstance['status']): RemeInstance {
  return {
    cwd,
    port,
    ownership: 'managed',
    status,
    startedAt: new Date().toISOString(),
    lastUsedAt: new Date().toISOString(),
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}

const CWD = '/workspace/a'
const PORT = 2340

async function main(): Promise<void> {
  // 1. ready instance + service present → setEndpoint called with the
  //    formatted URL, and an info log records the route.
  {
    const sink = new RecordingSink()
    const ctx = new ContextStub({ remeMemory: sink })
    const manager = new ManagerStub()
    manager.put(instance(CWD, PORT, 'ready'))
    const logger = new LoggerStub()
    const coordinator = new EndpointCoordinator({
      ctx: ctx as never,
      manager: manager as never,
      activeCwd: () => CWD,
      logger,
    })
    await coordinator.route(CWD)
    assert(sink.urls.length === 1, `expected 1 setEndpoint call, got ${sink.urls.length}`)
    assert(sink.urls[0] === `http://127.0.0.1:${PORT}`, `unexpected endpoint ${sink.urls[0]}`)
    assert(logger.infos.some((l) => l.includes(`routed ${CWD} → http://127.0.0.1:${PORT}`)), 'missing routed info log')
    console.log(`ok   ready instance routed via setEndpoint → http://127.0.0.1:${PORT}`)
  }

  // 2. no ready instance → no call, no warn.
  {
    const sink = new RecordingSink()
    const ctx = new ContextStub({ remeMemory: sink })
    const manager = new ManagerStub()
    manager.put(instance(CWD, PORT, 'starting'))
    const logger = new LoggerStub()
    const coordinator = new EndpointCoordinator({
      ctx: ctx as never,
      manager: manager as never,
      activeCwd: () => CWD,
      logger,
    })
    await coordinator.route(CWD)
    assert(sink.urls.length === 0, `no setEndpoint call expected, got ${sink.urls.length}`)
    assert(logger.warns.length === 0, 'no warn expected for non-ready instance')
    // Missing instance entirely: also silent.
    await coordinator.route('/workspace/ghost')
    assert(sink.urls.length === 0, 'no setEndpoint call expected for unknown cwd')
    assert(logger.warns.length === 0, 'no warn expected for unknown cwd')
    console.log('ok   non-ready / unknown cwd: no call, no warn')
  }

  // 3. service missing → warn exactly once; subsequent routes stay silent
  //    (one-shot guard), still no throw.
  {
    const ctx = new ContextStub({}) // no remeMemory service
    const manager = new ManagerStub()
    manager.put(instance(CWD, PORT, 'ready'))
    const logger = new LoggerStub()
    const coordinator = new EndpointCoordinator({
      ctx: ctx as never,
      manager: manager as never,
      activeCwd: () => CWD,
      logger,
    })
    await coordinator.route(CWD)
    await coordinator.route(CWD)
    await coordinator.route(CWD)
    assert(logger.warns.length === 1, `expected exactly 1 warn, got ${logger.warns.length}`)
    assert(logger.warns[0]?.includes('remeMemory service is unavailable') ?? false, `unexpected warn text: ${logger.warns[0] ?? '(none)'}`)
    console.log('ok   missing service: one-shot warn, repeated routes silent')
  }

  // 4. service present but setEndpoint is not a function → warn once, skip.
  {
    const ctx = new ContextStub({ remeMemory: {} }) // sink without setEndpoint
    const manager = new ManagerStub()
    manager.put(instance(CWD, PORT, 'ready'))
    const logger = new LoggerStub()
    const coordinator = new EndpointCoordinator({
      ctx: ctx as never,
      manager: manager as never,
      activeCwd: () => CWD,
      logger,
    })
    await coordinator.route(CWD)
    await coordinator.route(CWD)
    assert(logger.warns.length === 1, `expected exactly 1 warn, got ${logger.warns.length}`)
    console.log('ok   malformed service (no setEndpoint): one-shot warn, no throw')
  }

  // 5. setEndpoint throws → warn once, rejection not propagated.
  {
    const sink = new RecordingSink()
    sink.fail = new Error('setEndpoint exploded')
    const ctx = new ContextStub({ remeMemory: sink })
    const manager = new ManagerStub()
    manager.put(instance(CWD, PORT, 'ready'))
    const logger = new LoggerStub()
    const coordinator = new EndpointCoordinator({
      ctx: ctx as never,
      manager: manager as never,
      activeCwd: () => CWD,
      logger,
    })
    await coordinator.route(CWD) // must resolve, not reject
    await coordinator.route(CWD)
    assert(logger.warns.length === 1, `expected exactly 1 warn, got ${logger.warns.length}`)
    assert(logger.warns[0]?.includes("setEndpoint('http://127.0.0.1:2340') failed") ?? false, `unexpected warn text: ${logger.warns[0] ?? '(none)'}`)
    console.log('ok   setEndpoint throw: warn once, route resolves')
  }

  console.log('\nendpoint-coordinator: all checks passed')
}

main().catch((error: unknown) => {
  const reason = error instanceof Error ? (error.stack ?? error.message) : String(error)
  console.error('FAIL', reason)
  process.exit(1)
})