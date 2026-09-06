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
/** Run the shutdown sequence against every stoppable instance. */
export async function runShutdown(manager, cfg, logger) {
    if (!cfg.killOnExit)
        return;
    const tasks = [];
    const pinnedSet = new Set(cfg.pinnedDirs);
    for (const [cwd, instance] of manager.entries()) {
        if (instance.ownership !== 'managed')
            continue;
        if (pinnedSet.has(cwd))
            continue;
        tasks.push(() => stopOne(manager, cwd, instance, cfg, logger));
    }
    if (tasks.length === 0)
        return;
    const overallBudgetMs = cfg.maxShutdownWaitMs + cfg.shutdownGraceMs;
    await raceWithBudget(Promise.allSettled(tasks.map((task) => task())), overallBudgetMs);
}
async function stopOne(manager, cwd, instance, cfg, logger) {
    if (cfg.waitForIdleBeforeShutdown && instance.status === 'ready' && instance.handle !== undefined) {
        await waitForIdle(instance, cfg.maxShutdownWaitMs).catch((error) => {
            const reason = error instanceof Error ? error.message : String(error);
            logger.warn(`reme-auto-router: waitForIdle for ${cwd} failed (${reason}); proceeding with terminate`);
        });
    }
    await manager.stop(cwd, 'killOnExit');
}
/**
 * Poll `http://127.0.0.1:<port>/status` until it reports zero in-flight
 * tasks or the budget elapses. Failures are silent so a sick reme
 * never blocks shutdown.
 */
async function waitForIdle(instance, budgetMs) {
    const deadline = Date.now() + budgetMs;
    const url = `http://127.0.0.1:${String(instance.port)}/status`;
    while (Date.now() < deadline) {
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 500);
            try {
                const response = await fetch(url, { signal: controller.signal });
                if (response.ok) {
                    const body = await response.text();
                    if (looksIdle(body))
                        return;
                }
            }
            finally {
                clearTimeout(timeout);
            }
        }
        catch {
            // ignore: probe failures are silent
        }
        await sleep(500);
    }
}
function looksIdle(body) {
    const lower = body.toLowerCase();
    const match = lower.match(/(?:inflight|in_flight|busy|tasks?)\s*["':= ]+([a-z0-9._-]+)/);
    if (match === null)
        return false;
    const value = match[1];
    if (value === undefined)
        return false;
    return value === '0' || value === 'false' || value === 'none' || value === 'idle';
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
async function raceWithBudget(allSettled, budgetMs) {
    if (budgetMs <= 0)
        return;
    let timer;
    try {
        await Promise.race([
            allSettled,
            new Promise((resolve) => {
                timer = setTimeout(resolve, budgetMs);
            }),
        ]);
    }
    finally {
        if (timer !== undefined)
            clearTimeout(timer);
    }
}
