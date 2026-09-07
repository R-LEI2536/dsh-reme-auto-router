/**
 * reme-auto-router — StateStore concurrent-persist regression test.
 *
 * Asserts that many concurrent replaceRecord/removeRecord calls do
 * not race on the shared `state.json.tmp` file. Before the v0.2
 * follow-up fix, two overlapping persists could both `open(..., 'w')`
 * the same tmp, the loser's `rename` then hit ENOENT and surface as
 * a fatal `dsh plugin` error. With the promise-chain serialisation
 * in StateStore.persist, this regression test must pass for any
 * reasonable concurrency level.
 *
 * Run via:
 *   pnpm exec tsx tests/state-store-race.mts
 *
 * Exits 0 on success, 1 on first failed assertion.
 */

import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { StateStore, stateFilePath } from '../src/state-store.ts'

const sandboxHome = mkdtempSync(join(tmpdir(), 'reme-state-store-race-'))
process.env.DSH_HOME = sandboxHome

let failed = 0
function check(label: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    console.log(`ok   ${label}`)
    return
  }
  failed++
  console.error(`FAIL ${label}`, detail ?? '')
}

async function main(): Promise<void> {
  const store = new StateStore()
  await store.load()

  // 50 concurrent replaceRecord calls. Each one writes the
  // current `doc` (which is the same single record at this point).
  // Before the fix, the open-truncate race on the shared .tmp would
  // throw ENOENT for some subset of these calls.
  const N = 50
  const tasks: Array<Promise<void>> = []
  for (let i = 0; i < N; i++) {
    tasks.push(
      store.replaceRecord({
        cwd: '/race/cwd',
        port: 2333,
        pid: 1000 + i,
        ownership: 'managed',
        startedAt: '2026-09-07T00:00:00.000Z',
        lastUsedAt: '2026-09-07T00:00:00.000Z',
      }),
    )
  }
  // Also interleave removes + a touchScan.
  tasks.push(store.removeRecord('/race/cwd'))
  tasks.push(store.touchScan())
  await Promise.all(tasks)

  // After all settles, state.json must exist and be valid JSON.
  const { promises: fs } = await import('node:fs')
  const raw = await fs.readFile(stateFilePath(), 'utf8')
  const parsed: unknown = JSON.parse(raw)

  check('R.1 no ENOENT thrown during concurrent persists (verified by reaching here)', true)
  check('R.2 state.json exists and is valid JSON', parsed !== null && typeof parsed === 'object')
  check('R.3 schemaVersion === 1', (parsed as { schemaVersion?: number }).schemaVersion === 1)
  check('R.4 lastScanAt > epoch (touchScan wrote)', typeof (parsed as { lastScanAt?: string }).lastScanAt === 'string')

  // Second round: make sure a second wave also settles cleanly.
  const wave2: Array<Promise<void>> = []
  for (let i = 0; i < 20; i++) {
    wave2.push(
      store.replaceRecord({
        cwd: `/race/cwd-${String(i)}`,
        port: 2333 + i,
        pid: 2000 + i,
        ownership: 'managed',
        startedAt: '2026-09-07T00:00:00.000Z',
        lastUsedAt: '2026-09-07T00:00:00.000Z',
      }),
    )
  }
  await Promise.all(wave2)
  const raw2 = await fs.readFile(stateFilePath(), 'utf8')
  const parsed2: unknown = JSON.parse(raw2)
  const instances = (parsed2 as { instances?: unknown[] }).instances ?? []
  check('R.5 second wave wrote 20 distinct cwds', instances.length === 20, `got ${String(instances.length)}`)

  if (failed > 0) {
    console.error(`\n${failed} check(s) failed`)
    process.exit(1)
  }
  console.log('\nstate-store-race: all checks passed')
}

main().catch((error: unknown) => {
  const reason = error instanceof Error ? (error.stack ?? error.message) : String(error)
  console.error('FAIL', reason)
  process.exit(1)
})
