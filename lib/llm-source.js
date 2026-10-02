/**
 * reme-auto-router — LLM configuration sourced from DSH at spawn time.
 *
 * Mirrors dsh-user-approval's settings shape and service access: the
 * plugin NEVER reads or writes a key file. `provider` / `model` follow
 * the `smartProvider` / `smartModel` convention — `null` inherits the
 * host default-model selection (`agentDefaultModel.currentSelection()`),
 * a non-null value pins the exact provider route / model id the user
 * configured in DSH. The API key is resolved once per spawn through the
 * credentials seam (`ctx.get('credentials')`), whose layering is
 * `inherited env → $DSH_HOME/.credentials.yaml → DSH's own .env` — the
 * same source DSH's own LLM provider resolves at request time, so the
 * key is never read from the workspace or from any plaintext file this
 * plugin controls.
 *
 * Coherence gate: the trio (key, base URL, model) is only injected when
 * a key resolves. Without a key the function returns `undefined` and the
 * spawned reme keeps today's behaviour (its own env / `.env`).
 *
 * @module reme-auto-router/llm-source
 */
/** Credential references probed in order when `apiKeyRef` is not configured. */
export const DEFAULT_API_KEY_REF_CHAIN = ['DEEPSEEK_API_KEY', 'LLM_API_KEY', 'OPENAI_API_KEY'];
/** OpenAI-compatible endpoint for the official DeepSeek route. */
export const DEEPSEEK_BASE_URL = 'https://api.deepseek.com';
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
    const refs = llm.apiKeyRef !== null && llm.apiKeyRef.length > 0
        ? [llm.apiKeyRef]
        : [...DEFAULT_API_KEY_REF_CHAIN];
    for (const ref of refs) {
        const hit = await credentials.resolve(ref);
        if (hit === undefined || hit.value.length === 0)
            continue;
        // Host-default inheritance is resolved lazily per spawn, exactly like
        // dsh-user-approval's `resolveModelSelection`; each field overrides
        // independently (pin provider without pinning model, and vice versa).
        const defaultModel = ctx.get('agentDefaultModel');
        const selection = defaultModel?.currentSelection();
        const provider = llm.provider ?? selection?.provider;
        const model = llm.model ?? selection?.model;
        const baseUrl = llm.baseUrl
            ?? (provider !== undefined && provider.startsWith('deepseek') ? DEEPSEEK_BASE_URL : undefined);
        return {
            apiKey: hit.value,
            keySource: `${ref}@${hit.source}`,
            ...(provider !== undefined && provider.length > 0 ? { provider } : {}),
            ...(model !== undefined && model.length > 0 ? { model } : {}),
            ...(baseUrl !== undefined && baseUrl.length > 0 ? { baseUrl } : {}),
        };
    }
    return undefined;
}
