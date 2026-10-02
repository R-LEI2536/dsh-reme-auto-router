/**
 * reme-auto-router — Plugins-page card locale bundles (zh/en).
 *
 * The card copy follows the official settings pages: a title, a one-line
 * summary the Plugins page shows while the card is closed, one label and hint
 * per editable field, and the chrome strings the shared `SettingsForm` frame
 * renders.
 *
 * @module reme-auto-router/locales
 */

import type { SettingsFormLabels } from '@deepseek-ai/dsh-client-ui-primitives'

/** Locale keys the card renders. */
export type RemeSettingsLocaleKey =
  | 'title' | 'description'
  | 'provider' | 'providerHint'
  | 'model' | 'modelHint'
  | 'apiKeyRef' | 'apiKeyRefHint'
  | 'baseUrl' | 'baseUrlHint'
  | 'overridden' | 'reset' | 'readOnly' | 'unavailable'
  | 'save' | 'saving' | 'saveFailed' | 'invalidText'

/** English copy. */
export const en: Record<RemeSettingsLocaleKey, string> = {
  title: 'ReMe Auto Router',
  description: 'Choose the LLM provider, model, credential reference, and endpoint handed to workspace-bound reme instances.',
  provider: 'Provider',
  providerHint: 'DSH provider route for reme\u2019s LLM calls. Leave blank to inherit the host default-model selection.',
  model: 'Model',
  modelHint: 'Model id for reme\u2019s LLM calls. Leave blank to inherit the host default-model selection.',
  apiKeyRef: 'API key reference',
  apiKeyRefHint: 'Credential reference the key is resolved from (inherited env, credentials store, DSH .env). Leave blank to probe DEEPSEEK_API_KEY \u2192 LLM_API_KEY \u2192 OPENAI_API_KEY.',
  baseUrl: 'Base URL',
  baseUrlHint: 'OpenAI-compatible endpoint for reme\u2019s LLM calls. Leave blank for no injection; a provider route starting with \u201cdeepseek\u201d defaults to https://api.deepseek.com.',
  overridden: 'Overridden',
  reset: 'Reset to default',
  readOnly: 'This deployment stores settings read-only.',
  unavailable: 'This plugin\u2019s settings are not being served by the Host right now; check that the plugin is enabled in this profile.',
  save: 'Save',
  saving: 'Saving\u2026',
  saveFailed: 'The deployment did not accept these values; they were left for you to correct.',
  invalidText: 'Enter a value, or leave blank to inherit the default.',
}

/** Simplified Chinese copy. */
export const zh: Record<RemeSettingsLocaleKey, string> = {
  title: 'ReMe 自动路由',
  description: '配置交给工作区 reme 实例的 LLM:provider、模型、凭据引用与端点。',
  provider: 'Provider',
  providerHint: 'reme 调用 LLM 用的 DSH provider 路由。留空则继承宿主默认模型选择。',
  model: 'Model',
  modelHint: 'reme 调用 LLM 用的模型 id。留空则继承宿主默认模型选择。',
  apiKeyRef: 'API key 引用',
  apiKeyRefHint: '解析 key 的凭据引用(继承环境变量、凭据库、DSH .env)。留空则依次探测 DEEPSEEK_API_KEY → LLM_API_KEY → OPENAI_API_KEY。',
  baseUrl: 'Base URL',
  baseUrlHint: 'reme 调用 LLM 用的 OpenAI 兼容端点。留空则不注入;provider 以 “deepseek” 开头时默认 https://api.deepseek.com。',
  overridden: '已覆盖',
  reset: '恢复默认',
  readOnly: '本部署的设置为只读。',
  unavailable: '宿主当前没有提供本插件的设置命名空间;请确认该插件已在当前 profile 启用。',
  save: '保存',
  saving: '保存中…',
  saveFailed: '本部署没有接受这些值,已保留供你修改。',
  invalidText: '填写值;留空表示继承默认。',
}

/**
 * The form frame's copy, read from this card's dictionary.
 * @param t - the card's locale reader.
 * @returns the labels the shared settings form renders.
 */
export function formLabels(t: (key: RemeSettingsLocaleKey) => string): SettingsFormLabels {
  return {
    unavailable: t('unavailable'),
    readOnly: t('readOnly'),
    saveFailed: t('saveFailed'),
    save: t('save'),
    saving: t('saving'),
  }
}
