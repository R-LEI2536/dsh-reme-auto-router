/**
 * reme-auto-router — PushNotifier dedup-seam test.
 *
 * A single `ready` state transition reaches the notifier through two
 * independent paths in `src/index.ts`: the detector's promote path
 * (`onActiveCwdChanged`) and the manager state-change fallback. Both
 * call `push()` synchronously in the same emit tick, so the
 * `lastPushed` memo — which is only written *after*
 * `await commands.execute(...)` — is not yet populated when the second
 * call checks it. Without the in-flight guard that produced two
 * identical `🔄 reme ready` cards in the WebUI.
 *
 * Locks:
 *
 *   1. concurrent pushes with the same text    → exactly one execute
 *   2. sequential pushes with different text   → one execute each
 *      (the `starting…` → `ready` pair must survive)
 *   3. a rejected execute                      → no memo, guard released,
 *                                                the next push retries
 *   4. a successful push                       → the memo suppresses a
 *                                                later identical push
 *   5. no resolvable agent                     → warn, no execute, and
 *                                                the guard is released so a
 *                                                later push still works
 *   6. dispose()                               → clears both maps
 *
 * Run via:
 *   pnpm exec tsx tests/push-notifier.mts
 *
 * Exits 0 on success, 1 on first failed assertion.
 */

import { PushNotifier } from '../src/push-notifier.ts'
import type { RemeInstance } from '../src/process-manager.ts'

/** Minimal cordis Context stub: only the `get('commands')` surface used. */
function ctxWith(commands: unknown): never {
  return {
    get: (name: string): unknown => (name === 'commands' ? commands : undefined),
  } as never
}

/** Records every `/reme` invocation; optionally rejects like a bad host. */
class CommandsStub {
  readonly lines: string[] = []
  fail: Error | undefined
  async execute(_agent: unknown, line: string): Promise<unknown> {
    await Promise.resolve() // model the real async command round-trip
    if (this.fail !== undefined) throw this.fail
    this.lines.push(line)
    return undefined
  }
}

class LoggerStub {
  readonly warns: string[] = []
  warn(message: string): void {
    this.warns.push(message)
  }
}

function instance(cwd: string, status: RemeInstance['status']): RemeInstance {
  const now = new Date().toISOString()
  return {
    cwd,
    port: 2337,
    ownership: 'managed',
    status,
    startedAt: now,
    lastUsedAt: now,
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}

const SID = 'session-a' as never

async function main(): Promise<void> {
  // 1. The regression: two pushes for one transition, same rendered
  //    text, both started before either has recorded its memo entry.
  {
    const commands = new CommandsStub()
    const logger = new LoggerStub()
    const notifier = new PushNotifier({
      ctx: ctxWith(commands),
      resolveAgent: () => ({}) as never,
      logger,
    })
    const inst = instance('/workspace/one', 'ready')
    await Promise.all([
      notifier.push(SID, inst, 'one'),
      notifier.push(SID, inst, 'one'),
    ])
    assert(commands.lines.length === 1, `expected 1 execute for duplicate pushes, got ${String(commands.lines.length)}`)
    assert(logger.warns.length === 0, `no warn expected, got ${JSON.stringify(logger.warns)}`)
    console.log('ok   concurrent identical pushes collapse to one card')
  }

  // 2. Distinct texts (starting… then ready) must both be delivered —
  //    the guard is per rendered text, not per cwd.
  {
    const commands = new CommandsStub()
    const notifier = new PushNotifier({
      ctx: ctxWith(commands),
      resolveAgent: () => ({}) as never,
      logger: new LoggerStub(),
    })
    await Promise.all([
      notifier.push(SID, instance('/workspace/two', 'starting'), 'two'),
      notifier.push(SID, instance('/workspace/two', 'ready'), 'two'),
    ])
    assert(commands.lines.length === 2, `expected 2 executes for distinct texts, got ${String(commands.lines.length)}`)
    console.log('ok   starting… and ready both deliver for one cwd')
  }

  // 3. A rejected execute must not consume the memo: the guard is
  //    released and the next push retries.
  {
    const commands = new CommandsStub()
    const logger = new LoggerStub()
    const notifier = new PushNotifier({
      ctx: ctxWith(commands),
      resolveAgent: () => ({}) as never,
      logger,
    })
    const inst = instance('/workspace/three', 'ready')
    commands.fail = new Error('host rejected')
    await notifier.push(SID, inst, 'three')
    assert(commands.lines.length === 0, 'failed execute must not record a card')
    assert(logger.warns.length === 1, `expected 1 warn, got ${String(logger.warns.length)}`)
    commands.fail = undefined
    await notifier.push(SID, inst, 'three')
    assert(commands.lines.length === 1, `retry after failure must deliver, got ${String(commands.lines.length)}`)
    console.log('ok   rejected execute stays retryable')
  }

  // 4. After a successful delivery the memo suppresses a repeat.
  {
    const commands = new CommandsStub()
    const notifier = new PushNotifier({
      ctx: ctxWith(commands),
      resolveAgent: () => ({}) as never,
      logger: new LoggerStub(),
    })
    const inst = instance('/workspace/four', 'ready')
    await notifier.push(SID, inst, 'four')
    await notifier.push(SID, inst, 'four')
    assert(commands.lines.length === 1, `memo must suppress the repeat, got ${String(commands.lines.length)}`)
    console.log('ok   delivered text is memoised')
  }

  // 5. An unresolvable agent warns and must release the guard, so the
  //    same push still lands once the agent exists.
  {
    const commands = new CommandsStub()
    const logger = new LoggerStub()
    let agent: unknown
    const notifier = new PushNotifier({
      ctx: ctxWith(commands),
      resolveAgent: () => agent as never,
      logger,
    })
    const inst = instance('/workspace/five', 'ready')
    await notifier.push(SID, inst, 'five')
    assert(commands.lines.length === 0, 'no agent means no execute')
    assert(logger.warns.length === 1, `expected 1 warn, got ${String(logger.warns.length)}`)
    agent = {}
    await notifier.push(SID, inst, 'five')
    assert(commands.lines.length === 1, `push must succeed once the agent resolves, got ${String(commands.lines.length)}`)
    console.log('ok   missing agent warns and releases the guard')
  }

  // 6. dispose() resets both maps.
  {
    const commands = new CommandsStub()
    const notifier = new PushNotifier({
      ctx: ctxWith(commands),
      resolveAgent: () => ({}) as never,
      logger: new LoggerStub(),
    })
    const inst = instance('/workspace/six', 'ready')
    await notifier.push(SID, inst, 'six')
    notifier.dispose()
    await notifier.push(SID, inst, 'six')
    assert(commands.lines.length === 2, `dispose must clear the memo, got ${String(commands.lines.length)}`)
    console.log('ok   dispose clears both dedup maps')
  }

  console.log('\npush-notifier: all checks passed')
}

main().catch((error: unknown) => {
  const reason = error instanceof Error ? (error.stack ?? error.message) : String(error)
  console.error('FAIL', reason)
  process.exit(1)
})
