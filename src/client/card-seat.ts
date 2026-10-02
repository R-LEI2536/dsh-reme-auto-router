/**
 * reme-auto-router — the Plugins-page seat this plugin's browser half claims.
 *
 * Kept free of runtime UI imports (types only) so the seat contract — the id,
 * order, dictionary binding, and injected form face — is testable in plain
 * Node, and so the browser entry stays a thin composition of this descriptor
 * with the card component.
 *
 * @module reme-auto-router/card-seat
 */

import type { RemeCardFace } from './reme-card-controller.ts'

/** Dictionary namespace owned by this plugin, and the Settings namespace it edits. */
export const NS = 'dsh-reme-auto-router'

/** Profile entry id whose volatile Config the card edits (`cordis.patch.yml` `id:`). */
export const ENTRY_ID = 'dsh-reme-auto-router'

/** Plugins-page seat id (the page's own seat key for this card). */
export const CARD_ID = 'reme-auto-router'

/** Seat order after the official settings pages (shell 10, loop 20, subagent 30, web-search 40). */
export const CARD_ORDER = 50

/** The client services the browser half requires. */
export const CLIENT_INJECT = ['slots', 'locale', 'configForms'] as const

/** The `plugins.item` registration this plugin claims. */
export interface CardSeatOptions {
  /** The Plugins page's official-plugin seat. */
  name: 'plugins.item'
  /** Seat id, unique among the page's cards. */
  id: string
  /** Place in the Official group. */
  order: number
  /** Card title in the active locale. */
  label: () => string
  /** Dictionary the seat's `t` binding reads. */
  locale: typeof NS
  /** Builds the seat's form face when the page asks for it. */
  inject: () => RemeCardFace
}

/**
 * Build the Plugins-page seat registration.
 * @param t - the card's dictionary reader.
 * @param inject - builds the seat's staged-form face.
 * @returns the slot registration options the browser entry registers with.
 */
export function cardSeatOptions(
  t: (key: 'title') => string,
  inject: () => RemeCardFace,
): CardSeatOptions {
  return {
    name: 'plugins.item',
    id: CARD_ID,
    order: CARD_ORDER,
    label: () => t('title'),
    locale: NS,
    inject,
  }
}
