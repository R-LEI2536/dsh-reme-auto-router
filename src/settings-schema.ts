/**
 * reme-auto-router — settings namespace schema (`reme-auto-router`).
 *
 * Owns the user-editable configuration for the multi-workspace reme
 * orchestrator. Lives at `~/.dsh/settings.yaml` under the
 * `reme-auto-router:` top-level key. Distinct from the official
 * `reme-memory` namespace owned by the upstream reme plugin, which
 * this plugin only writes the `endpoint` field of (not owned here).
 *
 * @module reme-auto-router/settings-schema
 */

import z from '@deepseek-ai/schemastery'

/** Settings namespace string. Must be a lowercase hyphenated identifier. */
export const REME_AUTO_ROUTER_NAMESPACE = 'reme-auto-router'

/** Marker we put on the reme command line so we can recognise processes we forked. */
export const REME_MANAGED_MARKER = '--reme-managed-by=reme-auto-router'

/**
 * User-editable configuration for reme-auto-router. Each field is
 * documented in the package README; default values here are the
 * recommended starting points. Schema defaults are resolved through
 * schemastery before apply, so `installSection` receives a
 * fully-populated value even when the user section is absent.
 */
export const SettingsConfig = z.object({
  /** Whether the plugin kills unpinned reme processes when DSH exits. */
  killOnExit: z.boolean().default(true),
  /** SIGTERM → SIGKILL grace period in milliseconds. */
  shutdownGraceMs: z.natural().min(100).max(60_000).default(3_000),
  /** When true, poll reme /status for in-flight tasks before signalling. */
  waitForIdleBeforeShutdown: z.boolean().default(false),
  /** Total wait budget for `waitForIdleBeforeShutdown`, in milliseconds. */
  maxShutdownWaitMs: z.natural().min(1_000).max(60_000).default(8_000),
  /** Inactivity window after which an unpinned reme is stopped. */
  idleTimeoutMs: z.natural().min(1_000).max(86_400_000).default(900_000),
  /** Whether to detect and adopt user-launched reme processes. */
  adoptManual: z.boolean().default(true),
  /** Port range to allocate from (inclusive base, inclusive end = base + range - 1). */
  ports: z
    .object({
      base: z.natural().min(1_024).max(65_535).default(2_333),
      range: z.natural().min(1).max(1_024).default(67),
    })
    .default({ base: 2_333, range: 67 }),
  /** Workspace cwd paths (realpath canonical) whose reme is never idle-stopped. */
  pinnedDirs: z.array(z.string()).default([]),
})

/**
 * Inferred user-settings type — `installSection` generic T parameter.
 *
 * Hand-written rather than `z.infer<typeof SettingsConfig>` because
 * `@deepseek-ai/schemastery` has no `infer` member (the d.ts is missing
 * the global `TypeT<…>` export). Schema and type stay co-located so a
 * future schema edit must keep the interface in lockstep.
 */
export interface RemeAutoRouterSettings {
  /** Whether the plugin kills unpinned reme processes when DSH exits. */
  killOnExit: boolean
  /** SIGTERM → SIGKILL grace period in milliseconds. */
  shutdownGraceMs: number
  /** When true, poll reme /status for in-flight tasks before signalling. */
  waitForIdleBeforeShutdown: boolean
  /** Total wait budget for `waitForIdleBeforeShutdown`, in milliseconds. */
  maxShutdownWaitMs: number
  /** Inactivity window after which an unpinned reme is stopped. */
  idleTimeoutMs: number
  /** Whether to detect and adopt user-launched reme processes. */
  adoptManual: boolean
  /** Port range to allocate from (inclusive base, inclusive end = base + range - 1). */
  ports: { base: number; range: number }
  /** Workspace cwd paths (realpath canonical) whose reme is never idle-stopped. */
  pinnedDirs: string[]
}

/** Default settings; passed as the `entry` argument of `installSection`. */
export const DEFAULT_SETTINGS: RemeAutoRouterSettings = {
  killOnExit: true,
  shutdownGraceMs: 3_000,
  waitForIdleBeforeShutdown: false,
  maxShutdownWaitMs: 8_000,
  idleTimeoutMs: 900_000,
  adoptManual: true,
  ports: { base: 2_333, range: 67 },
  pinnedDirs: [],
}