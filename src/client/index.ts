/**
 * reme-auto-router — browser half.
 *
 * Registers the plugin's page on the Plugins page (`plugins.item`), where the
 * Host-served `llm` settings section is edited through the shared settings
 * form. The card is registered unconditionally: a namespace the Host does not
 * serve still shows the card with the form's own "unavailable" line, which
 * turns a profile entry that never composed into something visible instead of
 * a page that silently has no trace of the plugin.
 *
 * The Settings page itself carries no section for this plugin — the settings
 * are few, and the Plugins page is where the official settings pages already
 * live.
 *
 * @module reme-auto-router/client
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the Plugins page's SlotMap merge (the 'plugins.item' entry).
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
// Type-only: the ui-renderer Context merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: the ctx.configForms Context merge.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: the locale namespace map this file augments, and the slot props.
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { RemeCard } from './RemeCard.tsx'
import { CLIENT_INJECT, ENTRY_ID, NS, cardSeatOptions } from './card-seat.ts'
import { LlmScope } from './llm-form-scope.ts'
import { RemeCardController } from './reme-card-controller.ts'
import { en, zh, type RemeSettingsLocaleKey } from './locales.ts'
import type { RemeAutoRouterSettings } from '../settings-schema.ts'

export type { RemeCardProps } from './RemeCard.tsx'
export type { CardSeatOptions } from './card-seat.ts'
export type { RemeCardFace, RemeCardFields, RemeCardState } from './reme-card-controller.ts'
export type { RemeLlmFields } from './llm-form-scope.ts'
export type { RemeSettingsLocaleKey } from './locales.ts'
export { ENTRY_ID, NS } from './card-seat.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** reme-auto-router's Plugins-page card copy. */
    'dsh-reme-auto-router': RemeSettingsLocaleKey
  }
}

/** Required services: slot registry, locale registry, configuration forms. */
export const inject = [...CLIENT_INJECT]

/**
 * Mount the plugin's Plugins-page card.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'reme-auto-router: card dictionaries')
  const controller = new RemeCardController(new LlmScope(ctx.configForms.get<RemeAutoRouterSettings>(ENTRY_ID)))
  ctx.effect(() => () => { controller.dispose() }, 'reme-auto-router: form subscription')
  ctx.effect(
    () => ctx.slots.inject('plugins.item', () => ctx.slots.register(cardSeatOptions(t, () => controller.inject()), RemeCard)),
    'reme-auto-router: plugins page card',
  )
}
