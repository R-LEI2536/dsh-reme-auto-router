/**
 * reme-auto-router — the Plugins-page row seat this plugin's browser half claims.
 *
 * A bundle's configuration belongs in the row (or bundle) seat, not in
 * `plugins.item`: that one is reserved for the official host-plane settings
 * pages. Registering `plugins.row.config` under this bundle's row key turns the
 * row on the package page into a clickable control whose detail page renders
 * the settings form — the "open the plugin, open its component" flow.
 *
 * Kept free of runtime UI imports (types only) so the seat contract — the key,
 * dictionary binding, and injected form face — is testable in plain Node, and
 * so the browser entry stays a thin composition of this descriptor with the
 * card component.
 *
 * @module reme-auto-router/row-seat
 */

import type { RemeCardFace } from './reme-card-controller.ts'

/** Dictionary namespace owned by this plugin, and the Settings namespace it edits. */
export const NS = 'dsh-reme-auto-router'

/** Profile entry id whose volatile Config the card edits (`cordis.patch.yml` `id:`). */
export const ENTRY_ID = 'dsh-reme-auto-router'

/** Bundle package name the Plugins page lists. */
export const PACKAGE_NAME = 'dsh-reme-auto-router'

/**
 * The Plugins page's row-config key: `<package name>#<row id>` — the same
 * spelling as the page's own `rowConfigKey` (`ui-plugin-manager`'s
 * config-ledger), inlined as a literal because a cross-package value import is
 * a require the browser module table cannot answer. The row id is this bundle's
 * patch `id`, so the key reads `<package name>#<entry id>`. Spelled out rather
 * than interpolated so the built bundle carries the exact key; the test asserts
 * it still equals `PACKAGE_NAME + '#' + ENTRY_ID`.
 */
export const ROW_KEY = 'dsh-reme-auto-router#dsh-reme-auto-router'

/** The client services the browser half requires. */
export const CLIENT_INJECT = ['slots', 'locale', 'configForms'] as const

/** The `plugins.row.config` registration this plugin claims. */
export interface RowSeatOptions {
  /** The Plugins page's row-level configuration seat. */
  name: 'plugins.row.config'
  /** Row key (`<package name>#<row id>`) the seat answers for. */
  key: string
  /** Dictionary the seat's `t` binding reads. */
  locale: typeof NS
  /** Builds the seat's form face when the page asks for it. */
  inject: () => RemeCardFace
}

/**
 * Build the Plugins-page row seat registration.
 * @param inject - builds the seat's staged-form face.
 * @returns the slot registration options the browser entry registers with.
 */
export function rowSeatOptions(inject: () => RemeCardFace): RowSeatOptions {
  return { name: 'plugins.row.config', key: ROW_KEY, locale: NS, inject }
}
