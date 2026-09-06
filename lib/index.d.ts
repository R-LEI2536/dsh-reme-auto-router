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
 *   2. Register the `reme-auto-router` settings section
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
import type { Context } from '@deepseek-ai/cordis';
import type { RemeAutoRouterSettings } from './settings-schema.ts';
import { DEFAULT_SETTINGS, REME_AUTO_ROUTER_NAMESPACE, SettingsConfig as SettingsConfigSchema } from './settings-schema.ts';
export declare const name = "reme-auto-router";
export declare const inject: string[];
/** Plugin Config — deployment-time overrides for the same schema users edit in settings.yaml. */
export declare const Config: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<{
    killOnExit: import("@deepseek-ai/schemastery").default<boolean, boolean>;
    shutdownGraceMs: import("@deepseek-ai/schemastery").default<number, number>;
    waitForIdleBeforeShutdown: import("@deepseek-ai/schemastery").default<boolean, boolean>;
    maxShutdownWaitMs: import("@deepseek-ai/schemastery").default<number, number>;
    idleTimeoutMs: import("@deepseek-ai/schemastery").default<number, number>;
    adoptManual: import("@deepseek-ai/schemastery").default<boolean, boolean>;
    ports: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<{
        base: import("@deepseek-ai/schemastery").default<number, number>;
        range: import("@deepseek-ai/schemastery").default<number, number>;
    }>, Schemastery.ObjectT<{
        base: import("@deepseek-ai/schemastery").default<number, number>;
        range: import("@deepseek-ai/schemastery").default<number, number>;
    }>>;
    pinnedDirs: import("@deepseek-ai/schemastery").default<string[], string[]>;
}>, Schemastery.ObjectT<{
    killOnExit: import("@deepseek-ai/schemastery").default<boolean, boolean>;
    shutdownGraceMs: import("@deepseek-ai/schemastery").default<number, number>;
    waitForIdleBeforeShutdown: import("@deepseek-ai/schemastery").default<boolean, boolean>;
    maxShutdownWaitMs: import("@deepseek-ai/schemastery").default<number, number>;
    idleTimeoutMs: import("@deepseek-ai/schemastery").default<number, number>;
    adoptManual: import("@deepseek-ai/schemastery").default<boolean, boolean>;
    ports: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<{
        base: import("@deepseek-ai/schemastery").default<number, number>;
        range: import("@deepseek-ai/schemastery").default<number, number>;
    }>, Schemastery.ObjectT<{
        base: import("@deepseek-ai/schemastery").default<number, number>;
        range: import("@deepseek-ai/schemastery").default<number, number>;
    }>>;
    pinnedDirs: import("@deepseek-ai/schemastery").default<string[], string[]>;
}>>;
/** Deployment-time Config value type. Identical to {@link RemeAutoRouterSettings}. */
export type RemeAutoRouterConfig = RemeAutoRouterSettings;
export declare function apply(ctx: Context, config: RemeAutoRouterConfig): Promise<() => Promise<void>>;
export { DEFAULT_SETTINGS, REME_AUTO_ROUTER_NAMESPACE, SettingsConfigSchema as SettingsConfig };
export type { RemeAutoRouterSettings };
//# sourceMappingURL=index.d.ts.map