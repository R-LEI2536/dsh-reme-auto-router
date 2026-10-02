/**
 * reme-auto-router — LLM configuration sourced from DSH at spawn time.
 *
 * Mirrors dsh-user-approval's settings shape and service access: the
 * plugin NEVER reads or writes a key file, and the user only names a
 * provider route and a model — `null` inherits the host default-model
 * selection (`agentDefaultModel.currentSelection()`), exactly like
 * dsh-user-approval's `smartProvider` / `smartModel`. Everything reme's
 * child process needs beyond that is derived from the provider's own DSH
 * profile:
 *
 *   - the credential reference is the profile's `apiKeyEnv`, resolved
 *     through the credentials seam (`ctx.get('credentials')`), whose
 *     layering is `inherited env → $DSH_HOME/.credentials.yaml → DSH's own
 *     .env` — the same source DSH's own LLM provider resolves at request
 *     time;
 *   - the endpoint is the profile's `baseURL` (deepseek routes fall back
 *     to the official endpoint when their profile names none).
 *
 * The provider profile is read the way the harness itself reads it
 * (`hasProviderApiKey` in the session controller): the LLM registry's
 * configurable-provider directory names the settings namespace and the path
 * to the profile, and `settings.describe({ redactSecrets: true })` carries
 * its plain values. A named credential that does not resolve is NOT
 * replaced by the probe chain — picking up an unrelated ambient key would
 * bill another tenant, and failing loud is what llm-pi-ai itself does; the
 * chain only applies when no profile names a credential at all.
 *
 * Both overrides stay available to deployers through the Config schema
 * (`llm.apiKeyRef`, `llm.baseUrl`); the plugin's UI card does not render
 * them.
 *
 * Coherence gate: the trio (key, base URL, model) is only injected when a
 * key resolves. Without a key the function returns `undefined` and the
 * spawned reme keeps today's behaviour (its own env / `.env`).
 *
 * @module reme-auto-router/llm-source
 */
/** Credential references probed in order when no profile and no setting name one. */
export const DEFAULT_API_KEY_REF_CHAIN = ['DEEPSEEK_API_KEY', 'LLM_API_KEY', 'OPENAI_API_KEY'];
/** OpenAI-compatible endpoint for the official DeepSeek route. */
export const DEEPSEEK_BASE_URL = 'https://api.deepseek.com';
/**
 * Read a non-empty string field off an unknown object.
 * @param source - the object to read.
 * @param key - the field name.
 * @returns the trimmed value, or undefined when absent, empty, or not a string.
 */
function stringField(source, key) {
    const value = Reflect.get(source, key);
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}
/**
 * Look a provider route up in the host's LLM registry and settings document.
 * @param ctx - host context carrying the `llm` and `settings` services.
 * @param route - provider route name (as `agentDefaultModel` or the setting spells it).
 * @returns the profile's credential reference and endpoint, when it declares either.
 */
export function resolveProviderProfile(ctx, route) {
    const llm = ctx.get('llm');
    const settings = ctx.get('settings');
    if (llm === undefined || settings === undefined)
        return undefined;
    const declared = llm.listConfigurableProviders().find(entry => entry.provider === route);
    if (declared === undefined)
        return undefined;
    const namespace = settings.describe({ redactSecrets: true })
        .find(candidate => candidate.ns === declared.settingsNs);
    let profile = namespace?.value;
    for (const key of declared.settingsPath) {
        profile = profile !== null && typeof profile === 'object' ? Reflect.get(profile, key) : undefined;
    }
    if (profile === null || typeof profile !== 'object')
        return undefined;
    const apiKeyEnv = stringField(profile, 'apiKeyEnv');
    const baseURL = stringField(profile, 'baseURL');
    if (apiKeyEnv === undefined && baseURL === undefined)
        return undefined;
    return {
        ...apiKeyEnv === undefined ? {} : { apiKeyEnv },
        ...baseURL === undefined ? {} : { baseURL },
    };
}
/**
 * Resolve a provider profile without ever failing a spawn: a missing service,
 * a registry without the directory, or an unexpected shape all fall back to
 * the legacy behaviour (probe chain, deepseek default endpoint).
 * @param ctx - host context.
 * @param route - provider route name.
 * @returns the profile contribution, or undefined when it cannot be read.
 */
function providerProfileOrUndefined(ctx, route) {
    try {
        return resolveProviderProfile(ctx, route);
    }
    catch {
        return undefined;
    }
}
/**
 * Resolve the LLM environment for one spawned reme process.
 *
 * Resolution is per call (mirrors the credentials seam's documented
 * "resolve per operation" rule — a changed credential reaches the next
 * spawn without a restart). Returns `undefined` when no key resolves, so
 * the spawner can fall back to today's behaviour untouched.
 */
export async function resolveRemeLlmEnv(ctx, llm) {
    const credentials = ctx.get('credentials');
    if (credentials === undefined)
        return undefined;
    // Host-default inheritance is resolved lazily per spawn, exactly like
    // dsh-user-approval's `resolveModelSelection`; each field overrides
    // independently (pin provider without pinning model, and vice versa). The
    // derived profile follows the EFFECTIVE provider, so an inherited default
    // route contributes its credential reference and endpoint too.
    const selection = ctx.get('agentDefaultModel')?.currentSelection();
    const provider = llm.provider ?? selection?.provider;
    const model = llm.model ?? selection?.model;
    const profile = provider === undefined ? undefined : providerProfileOrUndefined(ctx, provider);
    const explicitRef = llm.apiKeyRef !== null && llm.apiKeyRef.length > 0 ? llm.apiKeyRef : undefined;
    // A profile that names a credential owns the choice: a miss must fail loud
    // rather than let an unrelated ambient key authenticate the request.
    const refs = explicitRef !== undefined
        ? [explicitRef]
        : profile?.apiKeyEnv !== undefined
            ? [profile.apiKeyEnv]
            : [...DEFAULT_API_KEY_REF_CHAIN];
    for (const ref of refs) {
        const hit = await credentials.resolve(ref);
        if (hit === undefined || hit.value.length === 0)
            continue;
        const baseUrl = llm.baseUrl
            ?? profile?.baseURL
            ?? (provider !== undefined && provider.startsWith('deepseek') ? DEEPSEEK_BASE_URL : undefined);
        return {
            apiKey: hit.value,
            keySource: `${ref}@${hit.source}`,
            ...(provider !== undefined && provider.length > 0 ? { provider } : {}),
            ...(model !== undefined && model.length > 0 ? { model } : {}),
            ...(baseUrl !== undefined && baseUrl.length > 0 ? { baseUrl } : {}),
        };
    }
    if (explicitRef === undefined && profile?.apiKeyEnv !== undefined) {
        ctx.get('logger')?.warn?.(`reme-auto-router: provider route "${provider}" names credential ${profile.apiKeyEnv},`
            + ' which did not resolve; reme keeps its own LLM environment');
    }
    return undefined;
}
