/**
 * reme-auto-router — ProcessManager spawn-race regression test.
 *
 * Before the reservation fix, `ensure(cwd)` consulted the instance map and then
 * `spawn()` awaited `resolveRemeLlmEnv` *before* installing anything. In that
 * window a second `ensure(cwd)` — two workspace events, two sessions — saw no
 * instance and started a SECOND reme for the same cwd, while a spawn for another
 * cwd was handed the same port, because `allocatePort` only knows the ports
 * state.json already holds records for. Both children then raced for the port:
 * the loser died, the winner served on untracked, and the Plugins page showed
 * ready → unavailable flapping (two `Initializing ReMe Application` sequences in
 * one seconds-resolution reme log file are the fingerprint).
 *
 * Asserts:
 *   1. Two concurrent `ensure(cwd)` calls share one instance and start one child.
 *   2. Two concurrent spawns for different cwds get different ports.
 *   3. An exit after reaching ready marks the instance unavailable, keeps the
 *      exit facts in `lastError`, and logs the child's output tail with the
 *      injected key redacted (the key must never reach a log sink).
 *
 * Coverage boundary: the real subprocess service and reme itself are out of
 * scope — the fake child below is the contract this plugin has to hold up.
 *
 * Run via: pnpm exec tsx tests/process-manager-spawn.mts
 * Exits 0 on success, 1 on first failed assertion.
 */

import { mkdtempSync } from 'node:fs'
import * as net from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { SubprocessHandle, SubprocessOutcome, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { ProcessManager, type RemeInstance } from '../src/process-manager.ts'
import { DEFAULT_SETTINGS, type RemeAutoRouterSettings } from '../src/settings-schema.ts'
import { StateStore } from '../src/state-store.ts'

process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'reme-spawn-race-'))

const KEY_REF = 'REME_TEST_KEY'
const KEY_VALUE = 'AK-SECRET-123'
/** Child output the fixture reports; contains the key to prove redaction. */
const CHILD_OUTPUT = `boot failure tail ${KEY_VALUE}`

let failed = 0
function check(label: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    console.log(`ok   ${label}`)
    return
  }
  failed++
  console.error(`FAIL ${label}`, detail ?? '')
}

/** One controlled fake child: its `done` settles only when the test says so. */
interface FakeChild {
  readonly handle: SubprocessHandle
  settle(outcome: SubprocessOutcome): void
}

function fakeChild(): FakeChild {
  let settle: (outcome: SubprocessOutcome) => void = () => undefined
  const done = new Promise<SubprocessOutcome>((resolve) => { settle = resolve })
  const handle = {
    stdin: undefined,
    stdout: undefined,
    stderr: undefined,
    control: undefined,
    collected: {
      stderr: { readFrom: () => ({ text: CHILD_OUTPUT, nextOffset: CHILD_OUTPUT.length, lossy: false }) },
    },
    done,
    terminate: () => undefined,
    waitForExit: async () => true,
  } as unknown as SubprocessHandle
  return { handle, settle }
}

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return true
    await new Promise((resolve) => { setTimeout(resolve, 20) })
  }
  return predicate()
}

/** Bind a throwaway listener so the readiness probe sees an open port. */
async function listen(port: number): Promise<net.Server> {
  const server = net.createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', resolve)
  })
  return server
}

async function main(): Promise<void> {
  const store = new StateStore()
  await store.load()

  const spawns: SubprocessSpawnSpec[] = []
  const warnings: string[] = []
  const children: FakeChild[] = []
  const servers: net.Server[] = []

  const settings: RemeAutoRouterSettings = {
    ...DEFAULT_SETTINGS,
    ports: { base: 45_000 + Math.floor(Math.random() * 1_000), range: 20 },
    llm: { ...DEFAULT_SETTINGS.llm, apiKeyRef: KEY_REF },
  }

  const ctx = {
    subprocess: {
      spawn: (spec: SubprocessSpawnSpec) => {
        spawns.push(spec)
        const child = fakeChild()
        children.push(child)
        return child.handle
      },
    },
    timer: { setTimeout: () => () => undefined },
    get: (name: string) => name === 'credentials'
      ? { resolve: async (ref: string) => ref === KEY_REF ? { value: KEY_VALUE, source: 'file' } : undefined }
      : undefined,
  } as unknown as Context

  const manager = new ProcessManager({
    ctx,
    settings: () => settings,
    store,
    logger: { warn: (message: string) => { warnings.push(message) }, info: () => undefined },
  })

  try {
    // 1. Concurrent ensure() for one cwd: one instance, one child.
    const [first, second] = await Promise.all([manager.ensure('/w/one'), manager.ensure('/w/one')])
    check('concurrent ensure(cwd) calls share one instance', first === second, { first, second })
    check('concurrent ensure(cwd) calls start exactly one child', spawns.length === 1, spawns.length)
    check(
      'the child carries the resolved key in its env',
      spawns[0]?.env?.LLM_API_KEY === KEY_VALUE,
      spawns[0]?.env,
    )

    // 2. Concurrent spawns for two cwds: distinct ports (the store only learns
    //    a port once a record is written, so the reservation must precede the
    //    first await).
    const [two, three] = await Promise.all([manager.ensure('/w/two'), manager.ensure('/w/three')])
    check('concurrent spawns for different cwds get different ports', two.port !== three.port, {
      two: two.port,
      three: three.port,
    })
    check('each cwd started its own child', spawns.length === 3, spawns.length)

    // 3. Exit after ready: unavailable + exit facts + redacted output tail.
    const exitCwd = '/w/exit'
    const instance = await manager.ensure(exitCwd)
    servers.push(await listen(instance.port))
    check(
      'instance reaches ready once the port accepts',
      await waitFor(() => manager.get(exitCwd)?.status === 'ready', 2_000),
      manager.get(exitCwd)?.status,
    )

    const child = children[children.length - 1]
    child?.settle({ exitCode: 3, signal: null })
    await waitFor(() => manager.get(exitCwd)?.status === 'unavailable', 1_000)

    const after: RemeInstance | undefined = manager.get(exitCwd)
    check('an exit after ready marks the instance unavailable', after?.status === 'unavailable', after?.status)
    check('lastError keeps the exit facts', after?.lastError?.includes('code=3') === true, after?.lastError)
    check(
      'the child output tail is logged',
      warnings.some(warning => warning.includes('boot failure tail')),
      warnings,
    )
    check(
      'the injected key is redacted out of that log line',
      warnings.some(warning => warning.includes('<redacted>')) && !warnings.some(warning => warning.includes(KEY_VALUE)),
      warnings,
    )
  } finally {
    for (const server of servers) server.close()
  }

  if (failed > 0) {
    console.error(`\nprocess-manager-spawn: ${String(failed)} check(s) failed`)
    process.exit(1)
  }
  console.log('\nprocess-manager-spawn: all checks passed')
}

await main()
