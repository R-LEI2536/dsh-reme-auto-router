/**
 * reme-auto-router — the plugin's page on the Plugins page: the LLM
 * configuration handed to spawned reme instances.
 *
 * Registered through `plugins.row.config` (this bundle's own row), so the row
 * on the package page opens this form; the page itself draws the title,
 * description, and breadcrumb, and this component draws only the body. Settings
 * live on the Host with the profile entry, so the card needs no separate
 * sidebar section and adds nothing to the Settings page.
 *
 * Two fields only, mirroring dsh-user-approval's `smartProvider` /
 * `smartModel`: the credential reference and the endpoint come from the chosen
 * provider's DSH profile at spawn time.
 *
 * @module reme-auto-router/RemeCard
 */

import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import { SettingsForm, SettingsValueField } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { formLabels } from './locales.ts'
import type { RemeCardFace } from './reme-card-controller.ts'

/** Props the renderer binds for the plugin's row page. */
export type RemeCardProps =
  PropsRuntime<'plugins.row.config'>
  & PropsLocale<'dsh-reme-auto-router'>
  & InjectFace<RemeCardFace>

/**
 * Render the plugin's configuration form, as the Plugins page asks.
 * @param props - the view asked for, locale copy, the form snapshot, and its actions.
 * @returns the row's one-liner fallback, or the form.
 */
export function RemeCard(props: RemeCardProps) {
  const { t } = props
  const state = props.useRemeCard(snapshot => snapshot)
  if (props.view === 'summary') return t('description')
  const disabled = !state.writable
  return (
    <SettingsForm labels={formLabels(t)} state={state} onSave={props.save} onDiscard={props.discard}>
      <SettingsValueField
        id="plugin-config-reme-auto-router-provider"
        label={t('provider')}
        hint={t('providerHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidText')}
        disabled={disabled}
        {...state.provider}
        onEdit={(text) => { props.edit('provider', text) }}
        onReset={() => { props.resetField('provider') }}
      />
      <SettingsValueField
        id="plugin-config-reme-auto-router-model"
        label={t('model')}
        hint={t('modelHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidText')}
        disabled={disabled}
        {...state.model}
        onEdit={(text) => { props.edit('model', text) }}
        onReset={() => { props.resetField('model') }}
      />
    </SettingsForm>
  )
}
