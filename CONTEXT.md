# CONTEXT

Glossary for `dsh-reme-auto-router`. This file defines domain terms used
across `docs/` and `src/`. It deliberately contains no implementation
details — see the ADR series under `docs/adr/` for trade-offs and the
source under `src/` for how each concept is realised.

## Actors

- **workspace** — A canonical cwd (realpath-normalised) the user has
  an active session in. One workspace maps to at most one managed or
  adopted reme instance.
- **active workspace** — The workspace the most recently running
  session belongs to. Drives `reme_search` routing.
- **preparing workspace** — A workspace whose reme instance has been
  spawned but has not yet reached `ready`. Distinct from *active* so
  the router keeps using the previous active instance's endpoint
  during the spawn window.
- **managed instance** — A reme process spawned and supervised by the
  plugin (`process-manager.spawn`). Its lifecycle is owned: idle stop,
  shutdown, SIGTERM grace.
- **adopted instance** — A reme process the user started outside the
  plugin. The plugin observes it but never stops it (`manual-adopter`).

## Lifecycle states

- **starting** — Spawned; TCP probe to the configured port has not yet
  succeeded.
- **ready** — Port accepts TCP connections; safe to route `reme_search`
  to this instance.
- **unavailable** — Either spawn failed (port did not bind within the
  probe window) or the process exited unexpectedly. Recorded with a
  `lastError` for diagnosis.

## Persistence

- **state.json** — Durable document at
  `${DSH_HOME:-$HOME/.dsh}/plugin-data/reme-auto-router/state.json` that
  maps `cwd → InstanceRecord`. Persisted via atomic tmp + rename.
- **schemaVersion** — Currently `1`. Bumped only when the on-disk shape
  changes incompatibly.
- **InstanceRecord** — The persisted shape of one entry: cwd, port,
  ownership, startedAt, lastUsedAt, and optionally pid (see ADR-0001).

## Routing

- **endpoint** — The HTTP base URL the upstream `reme-memory` client
  uses to talk to a reme process. Delivered by `endpoint-coordinator`
  through the `remeMemory` service's `setEndpoint(url)` (DSH 0.1.7;
  replaced the removed `ctx.settings['reme-memory'].endpoint` write).
  Live-only — never persisted, so the user's own endpoint
  configuration is never clobbered.
- **prepare window** — The interval between `preparing` and `ready`
  for a freshly-spawned workspace. During this window the
  `endpoint-coordinator` keeps the previous ready instance's endpoint
  so cross-workspace memory writes do not leak.

## User-facing channel

- **status card** — The `command/done` payload rendered by the chat
  assembler when `/reme` runs. Log-only event; the model never reads
  the card text.
- **/reme command** — The slash command the user types (or the plugin
  simulates on state change) to render the current instance's status.
- **dedup** — Per-cwd memo of the last rendered text, plus the text
  currently in flight; a push matching either is a no-op. The memo is
  written only after `commands.execute` resolves, so the in-flight
  guard is what collapses the two push sources that fire on a single
  `ready` emit.
- **plugins-page card** — The configuration entry point: a `plugins.item`
  seat registered by the browser half (`src/client/`), listed in the
  Plugins page's Official group. Renders the Host-served `llm` section
  through the official `SettingsForm` / `SettingsValueField`, with
  `LlmScope` nesting the card's flat field paths back under `llm`. No
  `settings.section` exists by design (few settings; avoid polluting the
  Settings page). Registered unconditionally so an unserved namespace
  shows the form's `unavailable` line instead of no card at all.

## Tooling

- **subprocess handle** — The DSH 0.1.5 plain `SubprocessHandle`
  exposes `done`, `terminate()`, `waitForExit()`, stdio streams, and
  collected outputs; **no `pid`**. Only `SubprocessTerminalHandle`
  retains `pid`. See ADR-0001.
- **terminal handle** — DSH 0.1.5 `SubprocessTerminalHandle`. Not used
  by this plugin (we have no interactive terminal need).
