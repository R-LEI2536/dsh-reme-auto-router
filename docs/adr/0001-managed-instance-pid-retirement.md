# ADR-0001: Retire `pid` from managed instance records

- **Status**: Accepted
- **Date**: 2026-09-11
- **Driver**: DSH 0.1.5-rc.1 removed `pid` from the plain
  `SubprocessHandle` (only `SubprocessTerminalHandle` keeps it).

## Context

In DSH 0.1.2 the plugin wrote the OS pid of every spawned reme
process into `state.json`, surfaced it in the `/reme` status card
("port N · pid M"), and used `pid === -1` as a spawn-failure sentinel
in `terminateTree`. The audit
(`/home/hive/projects/dsh-plugin_dev/deepseek-harness/DSH-0.1.5-UPGRADE-AUDIT.md`,
§3.2) flagged that 0.1.5's plain `SubprocessHandle` only carries
`done` / `terminate()` / `waitForExit()`; reading `handle.pid` at
runtime now throws.

## Decision

`pid` becomes optional on `RemeInstance` and `InstanceRecord`. Managed
spawns no longer record a pid; the `/reme` status card degrades to
`port N` for managed instances and keeps `port N · pid M` for
adopted ones (adopters still resolve the pid through `lsof`).

`terminateTree` drops the `pid === -1` sentinel and relies on
`handle.done` rejecting as the spawn-failure signal.

## Consequences

- **Backward compatibility**: v1 `state.json` records that always wrote
  `pid` are still readable. `isInstanceRecord` treats the field as
  optional; old records keep their pid, new managed records omit it.
- **Asymmetric user perception**: Adopted cards show pid, managed
  cards don't. Acceptable because the pid was always informational —
  the port is the routing key, and the user can `lsof -i:PORT` to find
  the managed process if needed.
- **No new runtime cost**: We explicitly chose **not** to spawn-time
  `lsof` the managed process just to recover the pid. The adopter's
  `lsof`+`/proc/<pid>/cmdline` chain is reused as-is for adopted
  instances and already proves that path works on Linux/macOS.
- **Termination path unchanged in semantics**: `handle.terminate()`
  with `graceMs: 5_000` is the documented escalation; the missing pid
  does not affect the SIGTERM→SIGKILL window.

## Alternatives considered

- **A.** Always recover the pid at spawn time via `lsof`. Rejected:
  adds a 0..500 ms race window between spawn and `lsof` resolving a
  pid that we never use for control flow; also complicates Windows
  support which we already do not provide.
- **B.** Delete the `pid` field outright (schema bump). Rejected: the
  adopter path still needs it for the user-facing card and
  `process.kill(pid, 0)` is the planned v0.2 P4 liveness probe (see
  `docs/design.md §16.7`).
- **C.** Keep `pid` required and store `-1` for managed. Rejected:
  sentinel values are exactly the kind of thing the new shape wants to
  avoid; the optional field is cleaner and more honest about the
  data's true availability.

## References

- Audit: `DSH-0.1.5-UPGRADE-AUDIT.md` §3.2 (lines 91-105)
- DSH source: `node_modules/@deepseek-ai/dsh-subprocess/lib/types/types.d.ts:154-179`
- Code: `src/process-manager.ts`, `src/state-store.ts`,
  `src/push-notifier.ts`, `tests/state-store-race.mts` R.6
