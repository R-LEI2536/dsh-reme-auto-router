/**
 * reme-auto-router — plugin Config schema (volatile fields).
 *
 * Owns the user-editable configuration for the multi-workspace reme
 * orchestrator. As of DSH 0.1.7 the settings page is auto-generated
 * from the plugin entry's `Config` schema: every field marked
 * `.volatile()` is editable live and its value persists to the active
 * profile's `cordis.patch.yml` under the entry id
 * (`dsh-reme-auto-router`). `apply` reads the resolved configuration
 * from its `config` argument — volatile fields expose a `.get()`
 * reference that tracks profile edits without a restart.
 *
 * @module reme-auto-router/settings-schema
 */

import z from '@deepseek-ai/schemastery'

/** Marker we put on the reme command line so we can recognise processes we forked. */
export const REME_MANAGED_MARKER = '--reme-managed-by=reme-auto-router'

/**
 * User-editable configuration for reme-auto-router. Each field is
 * documented in the package README; default values here are the
 * recommended starting points. Schema defaults are resolved through
 * schemastery before apply, so `apply` receives a fully-populated
 * value even when no profile override exists.
 *
 * All fields are `.volatile()`: the settings service renders them as
 * a live-editable form (DSH 0.1.7 model) and the runtime exposes each
 * one as a `Volatile` reference whose `.get()` returns the effective
 * value including profile-patch edits.
 */
export const SettingsConfig = z.object({
  /** Whether the plugin kills unpinned reme processes when DSH exits. */
  killOnExit: z.boolean().default(true).volatile(),
  /** SIGTERM → SIGKILL grace period in milliseconds. */
  shutdownGraceMs: z.natural().min(100).max(60_000).default(3_000).volatile(),
  /** When true, poll reme /status for in-flight tasks before signalling. */
  waitForIdleBeforeShutdown: z.boolean().default(false).volatile(),
  /** Total wait budget for `waitForIdleBeforeShutdown`, in milliseconds. */
  maxShutdownWaitMs: z.natural().min(1_000).max(60_000).default(8_000).volatile(),
  /** Inactivity window after which an unpinned reme is stopped. */
  idleTimeoutMs: z.natural().min(1_000).max(86_400_000).default(900_000).volatile(),
  /** Whether to detect and adopt user-launched reme processes. */
  adoptManual: z.boolean().default(true).volatile(),
  /** Port range to allocate from (inclusive base, inclusive end = base + range - 1). */
  ports: z
    .object({
      base: z.natural().min(1_024).max(65_535).default(2_333),
      range: z.natural().min(1).max(1_024).default(67),
    })
    .default({ base: 2_333, range: 67 })
    .volatile(),
  /** Workspace cwd paths (realpath canonical) whose reme is never idle-stopped. */
  pinnedDirs: z.array(z.string()).default([]).volatile(),
})

/**
 * Inferred plugin-config value type — the plain snapshot shape `apply`
 * assembles from the volatile references (see `src/index.ts`).
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

/** Default settings; documented fallback snapshot (schema defaults mirror it). */
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