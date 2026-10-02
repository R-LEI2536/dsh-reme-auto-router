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

/**
 * Structural slice of the DSH credentials seam. Deliberately not an
 * import of `@deepseek-ai/dsh-credentials`: adding a peer/development
 * dependency for one method would ripple install requirements across
 * every host. The seam's `resolve(ref: CredentialRef)` receives the ref
 * as a plain string at runtime (the brand is compile-time only), so a
 * minimal structural type is type-safe and self-describing here.
 */
export interface RemeCredentialsService {
  resolve(ref: string): Promise<{ value: string; source: string } | undefined>
}

/** Structural slice of the host's default-model seam (core service). */
export interface RemeDefaultModelService {
  currentSelection(): { provider: string; model: string }
}

/**
 * Structural slice of the host settings service: the plain values of every
 * live plugin entry, keyed by namespace (the profile entry id).
 */
export interface RemeSettingsService {
  /** Read active plugin schemas and their live values, redacted for wire use. */
  describe(options: { redactSecrets: boolean }): readonly { ns: string; value?: unknown }[]
}

/** One provider route the host LLM registry can activate through settings. */
export interface RemeConfigurableProvider {
  /** Provider route key this entry activates when configured. */
  provider: string
  /** Settings namespace whose section configures this provider. */
  settingsNs: string
  /** Path from that namespace's section root to this provider's profile object. */
  settingsPath: readonly string[]
}

/** Structural slice of the host LLM registry (core service `llm`). */
export interface RemeLlmRegistry {
  /** Provider routes configuration can activate, whether or not they are live. */
  listConfigurableProviders(): readonly RemeConfigurableProvider[]
}

/** Minimal logger surface; logging must never block a spawn. */
export interface RemeLogger {
  warn(message: string): void
}

/** Settings slice consumed by {@link resolveRemeLlmEnv}. */
export interface RemeLlmSettings {
  /** DSH provider route name; `null` inherits the host default-model selection. */
  provider: string | null
  /** Model id; `null` inherits the host default-model selection. */
  model: string | null
  /** Deployer override for the credential ref; `null` derives it from the provider profile. */
  apiKeyRef: string | null
  /** Deployer override for the OpenAI-compatible base URL; `null` derives it from the provider profile. */
  baseUrl: string | null
}

/**
 * Minimal cordis `Context` surface consumed: `get`. Structural on
 * purpose — the seam lookups (`credentials`, `agentDefaultModel`, `llm`,
 * `settings`, `logger`) are optional at runtime, and a stub with just
 * `get` is enough for tests.
 */
export interface RemeCtxGet {
  get<T = unknown>(name: string): T | undefined
}

/** The injected env trio plus provenance, returned only when a key resolved. */
export interface RemeLlmEnv {
  /** The resolved API key (never logged, never persisted by this plugin). */
  apiKey: string
  /** Machine-readable provenance: `<ref>@<source>` (e.g. `DEEPSEEK_API_KEY@file`). */
  keySource: string
  /** Effective provider route name (setting or host default), when known. */
  provider?: string
  /** Effective model id (setting or host default), when known. */
  model?: string
  /** Effective OpenAI-compatible base URL, when known. */
  baseUrl?: string
}

/** Credential references probed in order when no profile and no setting name one. */
export const DEFAULT_API_KEY_REF_CHAIN = ['DEEPSEEK_API_KEY', 'LLM_API_KEY', 'OPENAI_API_KEY'] as const

/** OpenAI-compatible endpoint for the official DeepSeek route. */
export const DEEPSEEK_BASE_URL = 'https://api.deepseek.com'

/** What a provider's DSH profile contributes to the spawn environment. */
export interface RemeProviderProfile {
  /** Credential reference the profile names, when it names one. */
  apiKeyEnv?: string
  /** OpenAI-compatible endpoint the profile declares, when it declares one. */
  baseURL?: string
}

/**
 * Read a non-empty string field off an unknown object.
 * @param source - the object to read.
 * @param key - the field name.
 * @returns the trimmed value, or undefined when absent, empty, or not a string.
 */
function stringField(source: object, key: string): string | undefined {
  const value: unknown = Reflect.get(source, key)
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

/**
 * Look a provider route up in the host's LLM registry and settings document.
 * @param ctx - host context carrying the `llm` and `settings` services.
 * @param route - provider route name (as `agentDefaultModel` or the setting spells it).
 * @returns the profile's credential reference and endpoint, when it declares either.
 */
export function resolveProviderProfile(ctx: RemeCtxGet, route: string): RemeProviderProfile | undefined {
  const llm = ctx.get<RemeLlmRegistry>('llm')
  const settings = ctx.get<RemeSettingsService>('settings')
  if (llm === undefined || settings === undefined) return undefined
  const declared = llm.listConfigurableProviders().find(entry => entry.provider === route)
  if (declared === undefined) return undefined
  const namespace = settings.describe({ redactSecrets: true })
    .find(candidate => candidate.ns === declared.settingsNs)
  let profile: unknown = namespace?.value
  for (const key of declared.settingsPath) {
    profile = profile !== null && typeof profile === 'object' ? Reflect.get(profile, key) : undefined
  }
  if (profile === null || typeof profile !== 'object') return undefined
  const apiKeyEnv = stringField(profile, 'apiKeyEnv')
  const baseURL = stringField(profile, 'baseURL')
  if (apiKeyEnv === undefined && baseURL === undefined) return undefined
  return {
    ...apiKeyEnv === undefined ? {} : { apiKeyEnv },
    ...baseURL === undefined ? {} : { baseURL },
  }
}

/**
 * Resolve a provider profile without ever failing a spawn: a missing service,
 * a registry without the directory, or an unexpected shape all fall back to
 * the legacy behaviour (probe chain, deepseek default endpoint).
 * @param ctx - host context.
 * @param route - provider route name.
 * @returns the profile contribution, or undefined when it cannot be read.
 */
function providerProfileOrUndefined(ctx: RemeCtxGet, route: string): RemeProviderProfile | undefined {
  try {
    return resolveProviderProfile(ctx, route)
  } catch {
    return undefined
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
export async function resolveRemeLlmEnv(
  ctx: RemeCtxGet,
  llm: RemeLlmSettings,
): Promise<RemeLlmEnv | undefined> {
  const credentials = ctx.get<RemeCredentialsService>('credentials')
  if (credentials === undefined) return undefined

  // Host-default inheritance is resolved lazily per spawn, exactly like
  // dsh-user-approval's `resolveModelSelection`; each field overrides
  // independently (pin provider without pinning model, and vice versa). The
  // derived profile follows the EFFECTIVE provider, so an inherited default
  // route contributes its credential reference and endpoint too.
  const selection = ctx.get<RemeDefaultModelService>('agentDefaultModel')?.currentSelection()
  const provider = llm.provider ?? selection?.provider
  const model = llm.model ?? selection?.model
  const profile = provider === undefined ? undefined : providerProfileOrUndefined(ctx, provider)

  const explicitRef = llm.apiKeyRef !== null && llm.apiKeyRef.length > 0 ? llm.apiKeyRef : undefined
  // A profile that names a credential owns the choice: a miss must fail loud
  // rather than let an unrelated ambient key authenticate the request.
  const refs = explicitRef !== undefined
    ? [explicitRef]
    : profile?.apiKeyEnv !== undefined
      ? [profile.apiKeyEnv]
      : [...DEFAULT_API_KEY_REF_CHAIN]

  for (const ref of refs) {
    const hit = await credentials.resolve(ref)
    if (hit === undefined || hit.value.length === 0) continue
    const baseUrl = llm.baseUrl
      ?? profile?.baseURL
      ?? (provider !== undefined && provider.startsWith('deepseek') ? DEEPSEEK_BASE_URL : undefined)
    return {
      apiKey: hit.value,
      keySource: `${ref}@${hit.source}`,
      ...(provider !== undefined && provider.length > 0 ? { provider } : {}),
      ...(model !== undefined && model.length > 0 ? { model } : {}),
      ...(baseUrl !== undefined && baseUrl.length > 0 ? { baseUrl } : {}),
    }
  }
  if (explicitRef === undefined && profile?.apiKeyEnv !== undefined) {
    ctx.get<RemeLogger>('logger')?.warn?.(
      `reme-auto-router: provider route "${provider}" names credential ${profile.apiKeyEnv},`
      + ' which did not resolve; reme keeps its own LLM environment',
    )
  }
  return undefined
}
