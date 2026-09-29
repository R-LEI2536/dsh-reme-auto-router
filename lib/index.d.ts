/**
 * reme-auto-router — plugin entry point.
 *
 * Function plugin form (per packages/AGENTS.md): the loader consumes
 * the named exports `name`, `inject`, `Config`, and the async
 * `apply` function. Activation order is fixed by `inject` so the
 * required services are ready before `apply` runs.
 *
 * Runtime responsibilities wired here:
 *   1. Load the durable state record (`StateStore.load`)
 *   2. Resolve the live plugin configuration from the volatile
 *      `Config` fields (DSH 0.1.7 model — no settings namespace)
 *   3. Build the live subsystems (manager, detector, coordinator,
 *      adopter)
 *   4. Register `/reme` slash command and wire the PushNotifier
 *      so the chat flow gets a user-visible card on every reme
 *      state change
 *   5. On plugin dispose: stop the detector and adopter, drain the
 *      coordinator, run the shutdown sequence, then dispose
 *      everything
 *
 * The returned disposer is `async` so the Cordis runtime awaits
 * the shutdown sequence before tearing down its own services.
 *
 * @module reme-auto-router
 */
import type { Context, Volatile } from '@deepseek-ai/cordis';
import type { RemeAutoRouterSettings } from './settings-schema.ts';
import { DEFAULT_SETTINGS, SettingsConfig as SettingsConfigSchema } from './settings-schema.ts';
export declare const name = "reme-auto-router";
export declare const inject: string[];
/** Plugin Config — deployment-time overrides for the same schema users edit in the settings page. */
export declare const Config: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<NoInfer<{
    killOnExit: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
    shutdownGraceMs: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
    waitForIdleBeforeShutdown: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
    maxShutdownWaitMs: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
    idleTimeoutMs: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
    adoptManual: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
    ports: import("@deepseek-ai/schemastery").default<NoInfer<Schemastery.ObjectS<NoInfer<{
        base: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        range: import("@deepseek-ai/schemastery").default<number, number, "defined">;
    }>>>, NoInfer<Schemastery.ObjectT<NoInfer<{
        base: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        range: import("@deepseek-ai/schemastery").default<number, number, "defined">;
    }>>>, "volatile-defined">;
    pinnedDirs: import("@deepseek-ai/schemastery").default<NoInfer<string[]>, NoInfer<string[]>, "volatile-defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    killOnExit: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
    shutdownGraceMs: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
    waitForIdleBeforeShutdown: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
    maxShutdownWaitMs: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
    idleTimeoutMs: import("@deepseek-ai/schemastery").default<number, number, "volatile-defined">;
    adoptManual: import("@deepseek-ai/schemastery").default<boolean, boolean, "volatile-defined">;
    ports: import("@deepseek-ai/schemastery").default<NoInfer<Schemastery.ObjectS<NoInfer<{
        base: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        range: import("@deepseek-ai/schemastery").default<number, number, "defined">;
    }>>>, NoInfer<Schemastery.ObjectT<NoInfer<{
        base: import("@deepseek-ai/schemastery").default<number, number, "defined">;
        range: import("@deepseek-ai/schemastery").default<number, number, "defined">;
    }>>>, "volatile-defined">;
    pinnedDirs: import("@deepseek-ai/schemastery").default<NoInfer<string[]>, NoInfer<string[]>, "volatile-defined">;
}>>, "plain">;
/**
 * Deployment-time Config value type: the `apply(config)` argument.
 *
 * Volatile fields arrive as `Volatile<T>` references — `.get()` returns
 * the effective value including live profile-patch edits, so per-call
 * reads (see {@link getSettings}) pick up settings-page changes without
 * a restart. Mirrors {@link RemeAutoRouterSettings} field-for-field.
 */
export interface RemeAutoRouterConfig {
    killOnExit: Volatile<boolean>;
    shutdownGraceMs: Volatile<number>;
    waitForIdleBeforeShutdown: Volatile<boolean>;
    maxShutdownWaitMs: Volatile<number>;
    idleTimeoutMs: Volatile<number>;
    adoptManual: Volatile<boolean>;
    ports: Volatile<{
        base: number;
        range: number;
    }>;
    pinnedDirs: Volatile<string[]>;
}
export declare function apply(ctx: Context, config: RemeAutoRouterConfig): Promise<() => Promise<void>>;
export { DEFAULT_SETTINGS, SettingsConfigSchema as SettingsConfig };
export type { RemeAutoRouterSettings };
//# sourceMappingURL=index.d.ts.map