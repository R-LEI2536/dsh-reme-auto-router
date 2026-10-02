/**
 * reme-auto-router — Plugins-page card locale bundles (zh/en).
 *
 * The card copy follows the official settings pages: a title, a one-line
 * summary the Plugins page shows while the card is closed, one label and hint
 * per editable field, and the chrome strings the shared `SettingsForm` frame
 * renders. Only the provider route and the model are user-facing; the
 * credential reference and the endpoint are derived from the provider's DSH
 * profile at spawn time.
 *
 * @module reme-auto-router/locales
 */

import type { SettingsFormLabels } from '@deepseek-ai/dsh-client-ui-primitives'

/** Locale keys the card renders. */
export type RemeSettingsLocaleKey =
  | 'title' | 'description'
  | 'provider' | 'providerHint'
  | 'model' | 'modelHint'
  | 'overridden' | 'reset' | 'readOnly' | 'unavailable'
  | 'save' | 'saving' | 'saveFailed' | 'invalidText'

/** English copy. */
export const en: Record<RemeSettingsLocaleKey, string> = {
  title: 'ReMe Auto Router',
  description: 'Choose the DSH provider route and model handed to workspace-bound reme instances.',
  provider: 'Provider',
  providerHint: 'DSH provider route reme calls its LLM through. Leave blank to inherit the host default-model selection. The credential and endpoint are read from this provider\u2019s DSH configuration.',
  model: 'Model',
  modelHint: 'Model id reme calls. Leave blank to inherit the host default-model selection.',
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
  description: '选择交给工作区 reme 实例的 DSH provider 路由与模型。',
  provider: 'Provider',
  providerHint: 'reme 调用 LLM 用的 DSH provider 路由。留空则继承宿主默认模型选择;凭据与端点自动取自该 provider 在 DSH 里的配置。',
  model: 'Model',
  modelHint: 'reme 调用 LLM 用的模型 id。留空则继承宿主默认模型选择。',
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
