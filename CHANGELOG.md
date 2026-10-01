# Changelog

All notable changes to `dsh-reme-auto-router` are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions adhere to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed

- **Duplicate `routed` log lines**: a single `ready` transition reaches
  `EndpointCoordinator` through three independent triggers (the detector's
  promote path re-firing `onActiveCwdChanged`, the coordinator's own manager
  subscription, and the `index.ts` manager subscription), so the same target
  was written and logged three times. The coordinator now memoises the last
  successfully delivered `(sink, cwd, endpoint)` and short-circuits repeats,
  so one transition logs `routed <cwd> → http://127.0.0.1:<port>` once. A port
  change (instance respawn) or a re-mounted `remeMemory` service still routes.
- **Duplicate `🔄 reme ready` cards**: `PushNotifier`'s memo is written only
  after `await commands.execute(...)`, so the two pushes fired by one `ready`
  emit (`onActiveCwdChanged` and the manager state-change fallback) both passed
  the check before either recorded its text, appending two identical
  `command/done` cards. A per-cwd in-flight guard now collapses them; distinct
  texts still both deliver, and a failed delivery stays retryable.
- **Tests**: `tests/endpoint-coordinator.mts` gained a case covering repeated
  triggers, port change, and sink re-mount; new `tests/push-notifier.mts`
  locks the notifier's dedup seam. Wired into `pnpm run verify` as
  `test:notifier`.

## [0.3.1] — route seam verified against dsh-reme-support 0.2.2

### Changed

- **Routing seam closed with the official side**: `remeMemory.setEndpoint(url)`
  is now implemented by dsh-reme-support 0.2.2 (`8beca4b` + `43fbdf2`), so the
  v0.3.0 contract is live. Routing in this release requires
  `dsh-reme-support ≥ 0.2.2` mounted; when the service is absent or predates
  `setEndpoint`, the coordinator still degrades to a one-shot warn and skips.
- **Contract test**: new `tests/endpoint-coordinator.mts` locks our side of the
  seam — ready instance routes via `setEndpoint(http://127.0.0.1:<port>)`;
  non-ready/unknown cwd is silent; missing or malformed service warns exactly
  once; a throwing `setEndpoint` is caught and warned without propagating.
  Wired into `pnpm run verify` (`test:coordinator`).
- **Docs**: `docs/reme-memory-setEndpoint-contract.md` marked implemented with a
  contract-vs-implementation checklist (§4.1); README routing bullet and known
  limitations updated (dsh-reme-support ≥ 0.2.2).

### Known limitation (unchanged behaviour, documented)

- Stale endpoint during downtime (P2): when an instance is idle-stopped,
  crashes, or DSH restarts before respawn, the last endpoint stays published
  until the next `ready` route or restart. `auto_memory`/`auto_dream`
  `fetch failed` in that window (data is requeued). Revocation needs a
  contract extension (`setEndpoint(undefined)` or a separate clear) and is
  tracked as follow-up.

## [0.3.0] — DSH 0.1.7-rc.1+

> **Host requirement**: this release targets DSH `0.1.7-rc.1` or later
> (`@deepseek-ai/dsh* @ ^0.1.7-rc.1`). It does not run on 0.1.5 hosts.

### Changed

- **Settings → volatile plugin Config (DSH 0.1.7 model)**:
  - Removed the `reme-auto-router` settings namespace
    (`ctx.settings.installSection` / `ctx.settings.get` deleted upstream).
  - All eight editable fields (`killOnExit`, `shutdownGraceMs`,
    `waitForIdleBeforeShutdown`, `maxShutdownWaitMs`, `idleTimeoutMs`,
    `adoptManual`, `ports`, `pinnedDirs`) are now declared `.volatile()` on
    the plugin `Config` schema. The WebUI settings page is auto-generated
    from them; edits persist live to the active profile's
    `cordis.patch.yml` under the entry id `dsh-reme-auto-router`
    (this also closes the old `docs/design.md §16.2` settings-page backlog
    without a client plugin).
  - `apply` reads configuration through volatile references
    (`config.<field>.get()`), preserving the old "settings edits apply
    without restart" guarantee.
  - Dropped `'settings'` from `inject` and removed the vendored
    `SettingsProvider` augmentation; `@deepseek-ai/dsh-settings` is no
    longer a dependency.
  - Removed the now-meaningless `REME_AUTO_ROUTER_NAMESPACE` export
    (forms are keyed by profile entry id).
- **Cross-plugin routing seam**:
  - `EndpointCoordinator` no longer writes `ctx.settings['reme-memory']
    .endpoint` (the `setSource` seam is gone upstream; `SettingsForms`
    writes would persist durably and clobber user config).
  - It now calls `remeMemory.setEndpoint(url)` on the `remeMemory` service
    provided by the official reme-memory plugin — live, non-persistent,
    with a one-shot warn when the service is absent.
- **Peer compatibility (J1-01)**: added `peerDependencies` for every
  consumed `@deepseek-ai/*` package with floors admitting `0.1.7-rc.1+`
  (`^0.1.7-rc.1`, `@deepseek-ai/cordis >=4.0.4`,
  `@deepseek-ai/schemastery >=3.18.4`); devDependencies updated to match.
- Tests: removed the vendored 0.1.5 `SettingsProvider` fixture
  (`tests/memory-settings.ts`); `smoke-apply` now asserts schema-default
  parity against `DEFAULT_SETTINGS`; `import-check` asserts `inject` no
  longer requires `settings`.

### Notes

- `process-manager` / `workspace-detector` / `manual-adopter` /
  `shutdown` / `slash-command` / `push-notifier` / `state-store` were
  verified against the 0.1.7-rc.2 API surfaces (`SubprocessHandle`,
  `api-session/*` events, `commands.register/execute`, `timer.setTimeout`)
  and required no changes.
- Routing to reme-memory requires the official plugin to expose
  `remeMemory.setEndpoint(url)` (dsh-reme-support 0.1.7-companion
  release).

## [0.2.1] — 2026-09-11

- Pin `NO_PROXY`/`no_proxy` to IPv4 loopback for managed reme children
  (fixes httpx2 `InvalidURL: Invalid port: ':1]'` inside reme when the
  parent shell exports `NO_PROXY=::1`).

## [0.2.0]

- Fix endpoint-stale-on-switch bug (prepare-window routing, v0.2 #0).
- Retire managed-instance `pid` (DSH 0.1.5 `SubprocessHandle` removed
  it); `RemeInstance.pid` / `InstanceRecord.pid` / `StatusSnapshot.pid`
  are optional; adopted instances keep the OS pid.
- Dependencies floored to `^0.1.5-rc.1`.
- `private: false` for GitHub release-tarball distribution.