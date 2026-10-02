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

import { resolveRemeLlmEnv, type RemeCredentialsService, type RemeDefaultModelService } from '../src/llm-source.ts'

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

  console.log('\nllm-source: all checks passed')
}

main().catch((reason) => {
  console.error('FAIL', reason)
  process.exit(1)
})