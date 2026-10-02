/**
 * reme-auto-router — llm-source contract test.
 *
 * Locks the spawn-time LLM env resolution documented in `src/llm-source.ts`:
 * the reme LLM trio (key, base URL, model) is sourced from DSH at runtime —
 * never from a file the plugin reads or writes — with dsh-user-approval-style
 * `provider`/`model` inheritance (null = host default-model selection) and a
 * coherence gate (nothing injected unless a key resolves).
 *
 * Run via:
 *   pnpm exec tsx --tsconfig tsconfig.base.json \
 *     tests/llm-source.mts
 *
 * Exits 0 on success, 1 on first failed assertion.
 */

import {
  resolveRemeLlmEnv,
  type RemeCredentialsService, type RemeDefaultModelService, type RemeLlmRegistry,
  type RemeSettingsService,
} from '../src/llm-source.ts'

/** Minimal cordis Context stub: only the `get` surface llm-source uses. */
class ContextStub {
  private readonly services = new Map<string, unknown>()
  constructor(services: Record<string, unknown> = {}) {
    for (const [name, value] of Object.entries(services)) this.services.set(name, value)
  }
  get<T = unknown>(name: string): T | undefined {
    return this.services.get(name) as T | undefined
  }
}

/** In-memory credentials seam: non-empty records resolve as `source: 'file'`. */
function memoryCredentials(records: Record<string, string | undefined>): RemeCredentialsService {
  return {
    resolve: async (ref: string) => {
      const value = records[ref]
      return value !== undefined && value.length > 0 ? { value, source: 'file' } : undefined
    },
  }
}

/** Host default-model seam stub. */
function defaultModel(selection: { provider: string; model: string }): RemeDefaultModelService {
  return { currentSelection: () => selection }
}

/** LLM registry stub: one configurable route per entry, profiles at `providers.<route>`. */
function llmRegistry(routes: readonly string[], settingsNs = 'llm-pi-ai'): RemeLlmRegistry {
  return {
    listConfigurableProviders: () => routes.map(provider => ({
      provider, settingsNs, settingsPath: ['providers', provider],
    })),
  }
}

/** Settings service stub: one namespace value per entry id. */
function settingsService(namespaces: Record<string, unknown>): RemeSettingsService {
  return { describe: () => Object.entries(namespaces).map(([ns, value]) => ({ ns, value })) }
}

/** One provider profile namespace shaped like the llm-pi-ai settings entry. */
function providersNamespace(profiles: Record<string, object>): Record<string, unknown> {
  return { 'llm-pi-ai': { providers: profiles } }
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    console.error('FAIL', message)
    process.exit(1)
  }
}

const noLlm = { provider: null, model: null, apiKeyRef: null, baseUrl: null }

async function main(): Promise<void> {
  // 1. No credentials seam → nothing resolved (falls back to today's env/.env).
  {
    const env = await resolveRemeLlmEnv(new ContextStub(), noLlm)
    assert(env === undefined, 'no credentials seam must resolve undefined')
    console.log('ok   no credentials seam → no injection')
  }

  // 2. No seam even with provider/model configured → still nothing (key gate).
  {
    const env = await resolveRemeLlmEnv(
      new ContextStub(),
      { provider: 'deepseek-official', model: 'gpt-6-luna', apiKeyRef: null, baseUrl: null },
    )
    assert(env === undefined, 'settings without a credentials seam must resolve undefined')
    console.log('ok   key gate: settings alone never inject without a resolvable key')
  }

  // 3. DEEPSEEK_API_KEY hit through the default probe chain.
  {
    const ctx = new ContextStub({ credentials: memoryCredentials({ DEEPSEEK_API_KEY: 'sk-first' }) })
    const env = await resolveRemeLlmEnv(ctx, noLlm)
    assert(env !== undefined, 'DEEPSEEK_API_KEY hit must resolve')
    assert(env.apiKey === 'sk-first', 'apiKey must be the resolved value')
    assert(env.keySource === 'DEEPSEEK_API_KEY@file', `keySource must be '<ref>@<source>', got ${env.keySource}`)
    console.log('ok   default probe chain: DEEPSEEK_API_KEY resolves with provenance')
  }

  // 4. Chain fallback: first refs miss, LLM_API_KEY hits.
  {
    const ctx = new ContextStub({ credentials: memoryCredentials({ LLM_API_KEY: 'sk-fallback' }) })
    const env = await resolveRemeLlmEnv(ctx, noLlm)
    assert(env !== undefined, 'chain fallback must resolve')
    assert(env.apiKey === 'sk-fallback', 'apiKey must come from the fallen-back ref')
    assert(env.keySource === 'LLM_API_KEY@file', `keySource must name the hit ref, got ${env.keySource}`)
    console.log('ok   probe chain falls back to LLM_API_KEY')
  }

  // 5. Explicit apiKeyRef takes precedence over the chain.
  {
    const records: Record<string, string | undefined> = { DEEPSEEK_API_KEY: 'sk-chain', CUSTOM_REF: 'sk-custom' }
    const ctx = new ContextStub({ credentials: memoryCredentials(records) })
    const env = await resolveRemeLlmEnv(ctx, { provider: null, model: null, apiKeyRef: 'CUSTOM_REF', baseUrl: null })
    assert(env !== undefined, 'explicit apiKeyRef must resolve')
    assert(env.apiKey === 'sk-custom', 'apiKey must come from the configured ref')
    assert(env.keySource === 'CUSTOM_REF@file', `keySource must name the configured ref, got ${env.keySource}`)
    console.log('ok   explicit apiKeyRef beats the probe chain')
  }

  // 6. Empty stored value is skipped; the next ref resolves.
  {
    const records: Record<string, string | undefined> = { DEEPSEEK_API_KEY: '', OPENAI_API_KEY: 'sk-openai' }
    const ctx = new ContextStub({ credentials: memoryCredentials(records) })
    const env = await resolveRemeLlmEnv(ctx, noLlm)
    assert(env !== undefined, 'empty value must be skipped, next ref resolves')
    assert(env.apiKey === 'sk-openai', 'apiKey must come from the next ref')
    console.log('ok   empty stored value skipped → next ref wins')
  }

  // 7. Model inheritance: host default-model model used when setting is null.
  {
    const ctx = new ContextStub({
      credentials: memoryCredentials({ DEEPSEEK_API_KEY: 'sk-1' }),
      agentDefaultModel: defaultModel({ provider: 'deepseek-official', model: 'deepseek-chat' }),
    })
    const env = await resolveRemeLlmEnv(ctx, noLlm)
    assert(env !== undefined, 'inherited model must resolve')
    assert(env.model === 'deepseek-chat', `model must inherit the host default, got ${String(env.model)}`)
    assert(env.provider === 'deepseek-official', `provider must inherit the host default, got ${String(env.provider)}`)
    console.log('ok   provider/model inherit the host default-model selection')
  }

  // 8. Explicit model override wins over inheritance; provider still inherits.
  {
    const ctx = new ContextStub({
      credentials: memoryCredentials({ DEEPSEEK_API_KEY: 'sk-1' }),
      agentDefaultModel: defaultModel({ provider: 'deepseek-official', model: 'deepseek-chat' }),
    })
    const env = await resolveRemeLlmEnv(ctx, { provider: null, model: 'gpt-6-luna', apiKeyRef: null, baseUrl: null })
    assert(env !== undefined, 'explicit model must resolve')
    assert(env.model === 'gpt-6-luna', `explicit model must win, got ${String(env.model)}`)
    assert(env.provider === 'deepseek-official', 'provider must still inherit independently')
    console.log('ok   explicit model override wins; provider inherits independently')
  }

  // 9. baseUrl: deepseek provider gets the official endpoint by default.
  {
    const ctx = new ContextStub({
      credentials: memoryCredentials({ DEEPSEEK_API_KEY: 'sk-1' }),
      agentDefaultModel: defaultModel({ provider: 'deepseek-official', model: 'deepseek-chat' }),
    })
    const env = await resolveRemeLlmEnv(ctx, noLlm)
    assert(env !== undefined, 'deepseek baseUrl must resolve')
    assert(env.baseUrl === 'https://api.deepseek.com', `deepseek default baseUrl, got ${String(env.baseUrl)}`)
    console.log('ok   deepseek provider → official base URL default')
  }

  // 10. baseUrl: custom provider → no default, explicit setting wins.
  {
    const provider: Record<string, string | undefined> = { DEEPSEEK_API_KEY: 'sk-1' }
    const ctx = new ContextStub({
      credentials: memoryCredentials(provider),
      agentDefaultModel: defaultModel({ provider: 'daseinai-proxy', model: 'gpt-6-luna' }),
    })
    const env = await resolveRemeLlmEnv(ctx, { provider: 'daseinai-proxy', model: null, apiKeyRef: null, baseUrl: 'https://api.daseinai.xyz/v1' })
    assert(env !== undefined, 'custom provider with explicit baseUrl must resolve')
    assert(env.baseUrl === 'https://api.daseinai.xyz/v1', `explicit baseUrl must win, got ${String(env.baseUrl)}`)
    const noUrl = await resolveRemeLlmEnv(ctx, { provider: 'daseinai-proxy', model: null, apiKeyRef: null, baseUrl: null })
    assert(noUrl !== undefined && noUrl.baseUrl === undefined, 'custom provider without baseUrl must not inject one')
    console.log('ok   custom provider: explicit baseUrl wins, no default when unset')
  }

  // 11. Key gate: no key → nothing injected even when model/baseUrl are set.
  {
    const ctx = new ContextStub({
      credentials: memoryCredentials({}),
      agentDefaultModel: defaultModel({ provider: 'deepseek-official', model: 'deepseek-chat' }),
    })
    const env = await resolveRemeLlmEnv(ctx, { provider: 'deepseek-official', model: 'deepseek-chat', apiKeyRef: null, baseUrl: 'https://example.test/v1' })
    assert(env === undefined, 'no key must suppress the whole trio regardless of explicit settings')
    console.log('ok   key gate: unresolved key suppresses model/baseUrl too')
  }

  // 12. The headline case: with no LLM fields set, the credential and the
  //     endpoint come from the INHERITED provider's own DSH profile.
  {
    const ctx = new ContextStub({
      credentials: memoryCredentials({ OPENCODE_CHAT_API_KEY: 'sk-oc', DEEPSEEK_API_KEY: 'sk-chain' }),
      agentDefaultModel: defaultModel({ provider: 'opencode-chat', model: 'deepseek-v4-flash' }),
      llm: llmRegistry(['opencode-chat']),
      settings: settingsService(providersNamespace({
        'opencode-chat': { apiKeyEnv: 'OPENCODE_CHAT_API_KEY', baseURL: 'https://opencode.ai/zen/go/v1' },
      })),
    })
    const env = await resolveRemeLlmEnv(ctx, noLlm)
    assert(env !== undefined, 'a provider profile must supply the credential')
    assert(env.keySource === 'OPENCODE_CHAT_API_KEY@file', `profile apiKeyEnv must be used, got ${env.keySource}`)
    assert(env.baseUrl === 'https://opencode.ai/zen/go/v1', `profile baseURL must be used, got ${String(env.baseUrl)}`)
    assert(env.provider === 'opencode-chat', 'the inherited provider is reported')
    assert(env.model === 'deepseek-v4-flash', 'the inherited model is reported')
    console.log('ok   provider profile supplies credential + endpoint (two-field card)')
  }

  // 13. A profile that NAMES a credential owns the choice: a miss must not fall
  //     back to the probe chain (an unrelated ambient key would bill another
  //     tenant), and the miss is logged.
  {
    const warnings: string[] = []
    const ctx = new ContextStub({
      credentials: memoryCredentials({ DEEPSEEK_API_KEY: 'sk-chain' }),
      agentDefaultModel: defaultModel({ provider: 'opencode-chat', model: 'deepseek-v4-flash' }),
      llm: llmRegistry(['opencode-chat']),
      settings: settingsService(providersNamespace({
        'opencode-chat': { apiKeyEnv: 'OPENCODE_CHAT_API_KEY', baseURL: 'https://opencode.ai/zen/go/v1' },
      })),
      logger: { warn: (message: string) => { warnings.push(message) } },
    })
    const env = await resolveRemeLlmEnv(ctx, noLlm)
    assert(env === undefined, 'a named-but-missing credential must suppress injection, not use the chain')
    assert(warnings.length === 1, `the miss must be logged once, got ${warnings.length}`)
    assert(
      warnings[0]?.includes('OPENCODE_CHAT_API_KEY') === true,
      `the log must name the unresolved credential, got ${String(warnings[0])}`,
    )
    assert(warnings[0]?.includes('sk-chain') !== true, 'the log must never carry a key value')
    console.log('ok   named credential miss fails loud (no ambient-key fallback)')
  }

  // 14. The deployer override for the credential ref beats the profile.
  {
    const ctx = new ContextStub({
      credentials: memoryCredentials({ PROFILE_KEY: 'sk-profile', CUSTOM_REF: 'sk-custom' }),
      agentDefaultModel: defaultModel({ provider: 'opencode-chat', model: 'm' }),
      llm: llmRegistry(['opencode-chat']),
      settings: settingsService(providersNamespace({ 'opencode-chat': { apiKeyEnv: 'PROFILE_KEY' } })),
    })
    const env = await resolveRemeLlmEnv(ctx, { provider: null, model: null, apiKeyRef: 'CUSTOM_REF', baseUrl: null })
    assert(env !== undefined, 'an explicit ref must resolve')
    assert(env.keySource === 'CUSTOM_REF@file', `explicit apiKeyRef must beat the profile, got ${env.keySource}`)
    console.log('ok   deployer apiKeyRef override beats the provider profile')
  }

  // 15. The deployer override for the endpoint beats the profile.
  {
    const ctx = new ContextStub({
      credentials: memoryCredentials({ PROFILE_KEY: 'sk-1' }),
      agentDefaultModel: defaultModel({ provider: 'opencode-chat', model: 'm' }),
      llm: llmRegistry(['opencode-chat']),
      settings: settingsService(providersNamespace({
        'opencode-chat': { apiKeyEnv: 'PROFILE_KEY', baseURL: 'https://profile.test/v1' },
      })),
    })
    const env = await resolveRemeLlmEnv(ctx, { provider: null, model: null, apiKeyRef: null, baseUrl: 'https://override.test/v1' })
    assert(env?.baseUrl === 'https://override.test/v1', `explicit baseUrl must win, got ${String(env?.baseUrl)}`)
    console.log('ok   deployer baseUrl override beats the provider profile')
  }

  // 16. A profile that names no credential (account-style login) falls back to
  //     the probe chain while still contributing its endpoint.
  {
    const ctx = new ContextStub({
      credentials: memoryCredentials({ LLM_API_KEY: 'sk-chain' }),
      agentDefaultModel: defaultModel({ provider: 'minimax-cn', model: 'm' }),
      llm: llmRegistry(['minimax-cn']),
      settings: settingsService(providersNamespace({ 'minimax-cn': { baseURL: 'https://api.minimax.test/v1' } })),
    })
    const env = await resolveRemeLlmEnv(ctx, noLlm)
    assert(env !== undefined, 'the probe chain must still resolve when no credential is named')
    assert(env.keySource === 'LLM_API_KEY@file', `probe chain must supply the key, got ${env.keySource}`)
    assert(env.baseUrl === 'https://api.minimax.test/v1', 'the profile still contributes its endpoint')
    console.log('ok   profile without apiKeyEnv → probe chain, endpoint still derived')
  }

  // 17. An unknown route (or a missing registry) leaves the legacy behaviour
  //     untouched: probe chain, and no endpoint for a non-deepseek provider.
  {
    const ctx = new ContextStub({
      credentials: memoryCredentials({ DEEPSEEK_API_KEY: 'sk-chain' }),
      agentDefaultModel: defaultModel({ provider: 'ghost-route', model: 'm' }),
      llm: llmRegistry(['opencode-chat']),
      settings: settingsService(providersNamespace({ 'opencode-chat': { apiKeyEnv: 'NOPE' } })),
    })
    const env = await resolveRemeLlmEnv(ctx, noLlm)
    assert(env !== undefined && env.keySource === 'DEEPSEEK_API_KEY@file', 'an unknown route falls back to the chain')
    assert(env.baseUrl === undefined, 'an unknown non-deepseek route injects no endpoint')

    const noServices = new ContextStub({
      credentials: memoryCredentials({ DEEPSEEK_API_KEY: 'sk-chain' }),
      agentDefaultModel: defaultModel({ provider: 'deepseek-official', model: 'deepseek-chat' }),
    })
    const legacy = await resolveRemeLlmEnv(noServices, noLlm)
    assert(legacy?.baseUrl === 'https://api.deepseek.com', 'without the registry the deepseek default still applies')
    console.log('ok   unknown route / missing registry → legacy behaviour')
  }

  console.log('\nllm-source: all checks passed')
}

main().catch((reason) => {
  console.error('FAIL', reason)
  process.exit(1)
})