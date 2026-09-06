/**
 * reme-auto-router — Shutdown: stop managed reme processes on plugin
 * teardown.
 *
 * Walks every entry in the ProcessManager and stops the ones this
 * plugin owns (`ownership === 'managed'`) and that are not pinned.
 * Pinned cwds and adopted (user-launched) instances are intentionally
 * skipped — those survive across DSH restarts.
 *
 * Stop sequence (per instance):
 *   1. If `cfg.waitForIdleBeforeShutdown` is true, poll the reme
 *      `/status` endpoint until in-flight tasks drop to zero,
 *      bounded by `cfg.maxShutdownWaitMs`. Failures or timeouts fall
 *      through to step 2 so shutdown never blocks on a sick reme.
 *   2. `inst.handle.terminate()` — the SubprocessHandle escalates
 *      SIGTERM → graceMs → SIGKILL on its own.
 *   3. `await inst.handle.waitForExit(undefined)` — confirm whole-tree exit.
 *
 * All stops run in parallel via `Promise.allSettled`. The whole
 * shutdown is also bound by `cfg.maxShutdownWaitMs + cfg.shutdownGraceMs`
 * via a race against a timer; if the bound elapses, we return and
 * let the background waitForExit settle on its own.
 *
 * @module reme-auto-router/shutdown
 */

import type { RemeAutoRouterSettings } from './settings-schema.ts'
import type { ProcessManager, RemeInstance } from './process-manager.ts'

/** Logger surface this module depends on. */
export interface ShutdownLogger {
  info?(message: string): void
  warn(message: string): void
}

/** Run the shutdown sequence against every stoppable instance. */
export async function runShutdown(
  manager: Pick<ProcessManager, 'entries' | 'stop'>,
  cfg: RemeAutoRouterSettings,
  logger: ShutdownLogger,
): Promise<void> {
  if (!cfg.killOnExit) return
  const tasks: Array<() => Promise<void>> = []
  const pinnedSet = new Set(cfg.pinnedDirs)
  for (const [cwd, instance] of manager.entries()) {
    if (instance.ownership !== 'managed') continue
    if (pinnedSet.has(cwd)) continue
    tasks.push(() => stopOne(manager, cwd, instance, cfg, logger))
  }
  if (tasks.length === 0) return
  const overallBudgetMs = cfg.maxShutdownWaitMs + cfg.shutdownGraceMs
  await raceWithBudget(Promise.allSettled(tasks.map((task) => task())), overallBudgetMs)
}

async function stopOne(
  manager: Pick<ProcessManager, 'stop'>,
  cwd: string,
  instance: RemeInstance,
  cfg: RemeAutoRouterSettings,
  logger: ShutdownLogger,
): Promise<void> {
  if (cfg.waitForIdleBeforeShutdown && instance.status === 'ready' && instance.handle !== undefined) {
    await waitForIdle(instance, cfg.maxShutdownWaitMs).catch((error: unknown) => {
      const reason = error instanceof Error ? error.message : String(error)
      logger.warn(`reme-auto-router: waitForIdle for ${cwd} failed (${reason}); proceeding with terminate`)
    })
  }
  await manager.stop(cwd, 'killOnExit')
}

/**
 * Poll `http://127.0.0.1:<port>/status` until it reports zero in-flight
 * tasks or the budget elapses. Failures are silent so a sick reme
 * never blocks shutdown.
 */
async function waitForIdle(instance: RemeInstance, budgetMs: number): Promise<void> {
  const deadline = Date.now() + budgetMs
  const url = `http://127.0.0.1:${String(instance.port)}/status`
  while (Date.now() < deadline) {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 500)
      try {
        const response = await fetch(url, { signal: controller.signal })
        if (response.ok) {
          const body = await response.text()
          if (looksIdle(body)) return
        }
      } finally {
        clearTimeout(timeout)
      }
    } catch {
      // ignore: probe failures are silent
    }
    await sleep(500)
  }
}

function looksIdle(body: string): boolean {
  const lower = body.toLowerCase()
  const match = lower.match(/(?:inflight|in_flight|busy|tasks?)\s*["':= ]+([a-z0-9._-]+)/)
  if (match === null) return false
  const value = match[1]
  if (value === undefined) return false
  return value === '0' || value === 'false' || value === 'none' || value === 'idle'
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function raceWithBudget(allSettled: Promise<unknown>, budgetMs: number): Promise<void> {
  if (budgetMs <= 0) return
  let timer: NodeJS.Timeout | undefined
  try {
    await Promise.race([
      allSettled,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, budgetMs)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}