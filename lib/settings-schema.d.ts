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
export declare const REME_MANAGED_MARKER = "--reme-managed-by=reme-auto-router";
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
export declare const SettingsConfig: z<Schemastery.ObjectS<NoInfer<{
    /** Whether the plugin kills unpinned reme processes when DSH exits. */
    killOnExit: z<boolean, boolean, "volatile-defined">;
    /** SIGTERM → SIGKILL grace period in milliseconds. */
    shutdownGraceMs: z<number, number, "volatile-defined">;
    /** When true, poll reme /status for in-flight tasks before signalling. */
    waitForIdleBeforeShutdown: z<boolean, boolean, "volatile-defined">;
    /** Total wait budget for `waitForIdleBeforeShutdown`, in milliseconds. */
    maxShutdownWaitMs: z<number, number, "volatile-defined">;
    /** Inactivity window after which an unpinned reme is stopped. */
    idleTimeoutMs: z<number, number, "volatile-defined">;
    /** Whether to detect and adopt user-launched reme processes. */
    adoptManual: z<boolean, boolean, "volatile-defined">;
    /** Port range to allocate from (inclusive base, inclusive end = base + range - 1). */
    ports: z<NoInfer<Schemastery.ObjectS<NoInfer<{
        base: z<number, number, "defined">;
        range: z<number, number, "defined">;
    }>>>, NoInfer<Schemastery.ObjectT<NoInfer<{
        base: z<number, number, "defined">;
        range: z<number, number, "defined">;
    }>>>, "volatile-defined">;
    /** Workspace cwd paths (realpath canonical) whose reme is never idle-stopped. */
    pinnedDirs: z<NoInfer<string[]>, NoInfer<string[]>, "volatile-defined">;
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
    llm: z<NoInfer<Schemastery.ObjectS<NoInfer<{
        provider: z<string | null, string | null, "defined">;
        model: z<string | null, string | null, "defined">;
        apiKeyRef: z<string | null, string | null, "defined">;
        baseUrl: z<string | null, string | null, "defined">;
    }>>>, NoInfer<Schemastery.ObjectT<NoInfer<{
        provider: z<string | null, string | null, "defined">;
        model: z<string | null, string | null, "defined">;
        apiKeyRef: z<string | null, string | null, "defined">;
        baseUrl: z<string | null, string | null, "defined">;
    }>>>, "volatile-defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    /** Whether the plugin kills unpinned reme processes when DSH exits. */
    killOnExit: z<boolean, boolean, "volatile-defined">;
    /** SIGTERM → SIGKILL grace period in milliseconds. */
    shutdownGraceMs: z<number, number, "volatile-defined">;
    /** When true, poll reme /status for in-flight tasks before signalling. */
    waitForIdleBeforeShutdown: z<boolean, boolean, "volatile-defined">;
    /** Total wait budget for `waitForIdleBeforeShutdown`, in milliseconds. */
    maxShutdownWaitMs: z<number, number, "volatile-defined">;
    /** Inactivity window after which an unpinned reme is stopped. */
    idleTimeoutMs: z<number, number, "volatile-defined">;
    /** Whether to detect and adopt user-launched reme processes. */
    adoptManual: z<boolean, boolean, "volatile-defined">;
    /** Port range to allocate from (inclusive base, inclusive end = base + range - 1). */
    ports: z<NoInfer<Schemastery.ObjectS<NoInfer<{
        base: z<number, number, "defined">;
        range: z<number, number, "defined">;
    }>>>, NoInfer<Schemastery.ObjectT<NoInfer<{
        base: z<number, number, "defined">;
        range: z<number, number, "defined">;
    }>>>, "volatile-defined">;
    /** Workspace cwd paths (realpath canonical) whose reme is never idle-stopped. */
    pinnedDirs: z<NoInfer<string[]>, NoInfer<string[]>, "volatile-defined">;
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
    llm: z<NoInfer<Schemastery.ObjectS<NoInfer<{
        provider: z<string | null, string | null, "defined">;
        model: z<string | null, string | null, "defined">;
        apiKeyRef: z<string | null, string | null, "defined">;
        baseUrl: z<string | null, string | null, "defined">;
    }>>>, NoInfer<Schemastery.ObjectT<NoInfer<{
        provider: z<string | null, string | null, "defined">;
        model: z<string | null, string | null, "defined">;
        apiKeyRef: z<string | null, string | null, "defined">;
        baseUrl: z<string | null, string | null, "defined">;
    }>>>, "volatile-defined">;
}>>, "plain">;
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
    killOnExit: boolean;
    /** SIGTERM → SIGKILL grace period in milliseconds. */
    shutdownGraceMs: number;
    /** When true, poll reme /status for in-flight tasks before signalling. */
    waitForIdleBeforeShutdown: boolean;
    /** Total wait budget for `waitForIdleBeforeShutdown`, in milliseconds. */
    maxShutdownWaitMs: number;
    /** Inactivity window after which an unpinned reme is stopped. */
    idleTimeoutMs: number;
    /** Whether to detect and adopt user-launched reme processes. */
    adoptManual: boolean;
    /** Port range to allocate from (inclusive base, inclusive end = base + range - 1). */
    ports: {
        base: number;
        range: number;
    };
    /** Workspace cwd paths (realpath canonical) whose reme is never idle-stopped. */
    pinnedDirs: string[];
    /**
     * LLM configuration handed to spawned reme processes at spawn time.
     * `provider`/`model` are `null` to inherit the DSH default-model
     * selection; `apiKeyRef` (`null` = probe chain) selects the credential
     * reference; `baseUrl` (`null` = no injection) overrides the endpoint.
     */
    llm: {
        /** DSH provider route name; `null` inherits the host default-model selection. */
        provider: string | null;
        /** Model id; `null` inherits the host default-model selection. */
        model: string | null;
        /** Credential ref for the API key; `null` probes DEEPSEEK_API_KEY → LLM_API_KEY → OPENAI_API_KEY. */
        apiKeyRef: string | null;
        /** OpenAI-compatible base URL; `null` disables injection (deepseek providers default to `https://api.deepseek.com`). */
        baseUrl: string | null;
    };
}
/** Default settings; documented fallback snapshot (schema defaults mirror it). */
export declare const DEFAULT_SETTINGS: RemeAutoRouterSettings;
//# sourceMappingURL=settings-schema.d.ts.map