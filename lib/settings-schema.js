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
import z from '@deepseek-ai/schemastery';
/** Marker we put on the reme command line so we can recognise processes we forked. */
export const REME_MANAGED_MARKER = '--reme-managed-by=reme-auto-router';
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
    /**
     * LLM configuration handed to spawned reme processes, sourced from
     * DSH at spawn time (see README "配置" section). Field shape mirrors
     * dsh-user-approval's `smartProvider`/`smartModel`: `null` inherits
     * the host default-model selection (`agentDefaultModel.currentSelection()`),
     * a non-null value pins the exact provider route / model id the user
     * configured in DSH. `apiKeyRef` selects the credential reference the
     * key is resolved from; `baseUrl` overrides the OpenAI-compatible
     * endpoint (deepseek providers default to `https://api.deepseek.com`).
     */
    llm: z
        .object({
        provider: z.union([z.string().min(1), z.const(null)]).default(null),
        model: z.union([z.string().min(1), z.const(null)]).default(null),
        apiKeyRef: z.union([z.string().min(1), z.const(null)]).default(null),
        baseUrl: z.union([z.string().min(1), z.const(null)]).default(null),
    })
        .default({ provider: null, model: null, apiKeyRef: null, baseUrl: null })
        .volatile(),
});
/** Default settings; documented fallback snapshot (schema defaults mirror it). */
export const DEFAULT_SETTINGS = {
    killOnExit: true,
    shutdownGraceMs: 3_000,
    waitForIdleBeforeShutdown: false,
    maxShutdownWaitMs: 8_000,
    idleTimeoutMs: 900_000,
    adoptManual: true,
    ports: { base: 2_333, range: 67 },
    pinnedDirs: [],
    llm: { provider: null, model: null, apiKeyRef: null, baseUrl: null },
};
