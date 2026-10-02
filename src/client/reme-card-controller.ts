/**
 * reme-auto-router — the Plugins-page card's staged form over the entry's
 * `llm` section.
 *
 * Mirrors the official settings cards (`ui-settings-shell`'s shell card): one
 * `SettingsFormModel` stages every edit and writes them together on save, and
 * the card component renders that projection. Only a save writes; an emptied
 * field stages a clear, so the entry re-inherits the composition layer.
 *
 * The card edits the same two knobs dsh-user-approval exposes
 * (`smartProvider` / `smartModel`): the provider route and the model. The
 * credential reference and the endpoint are derived from the provider's DSH
 * profile at spawn time (see `src/llm-source.ts`) and their Config fields stay
 * deployer-only, so the user never types them.
 *
 * @module reme-auto-router/reme-card-controller
 */

import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import {
  SettingsFormModel, settingsTextField,
  type SettingsFieldState, type SettingsFormActions, type SettingsFormScope, type SettingsFormShell,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { RemeLlmFields } from './llm-form-scope.ts'

/** The LLM fields this card edits — a subset of the served schema by design. */
export type RemeCardFields = Pick<RemeLlmFields, 'provider' | 'model'>

/** What the Plugins-page card renders. */
export interface RemeCardState extends SettingsFormShell {
  /** DSH provider route handed to spawned reme instances. */
  provider: SettingsFieldState
  /** Model id handed to spawned reme instances. */
  model: SettingsFieldState
}

/** The registration-side face the card's slot entry injects. */
export interface RemeCardFace extends SettingsFormActions {
  hooks: {
    /** Card snapshot bound by the renderer as `useRemeCard`. */
    remeCard: SnapshotStore<RemeCardState>
  }
}

/** Bridges the entry's `llm` scope onto the card's staged form. */
export class RemeCardController {
  private readonly form: SettingsFormModel<RemeCardFields>
  private readonly store: SnapshotStore<RemeCardState>

  /** @param scope - the shared configuration form of the plugin's own entry, projected onto `llm`. */
  constructor(scope: SettingsFormScope<RemeCardFields>) {
    this.form = new SettingsFormModel(scope, [
      settingsTextField('provider'),
      settingsTextField('model'),
    ])
    this.store = this.form.bind(() => this.projection())
  }

  private projection(): RemeCardState {
    return {
      ...this.form.shell(),
      provider: this.form.field('provider'),
      model: this.form.field('model'),
    }
  }

  /**
   * Build the face the card's slot registration injects.
   * @returns the card's snapshot and its form actions.
   */
  inject(): RemeCardFace {
    return { hooks: { remeCard: this.store }, ...this.form.actions() }
  }

  /** Release the form subscription. */
  dispose(): void {
    this.form.dispose()
  }
}
