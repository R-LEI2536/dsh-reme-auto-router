/**
 * reme-auto-router — bridge from the entry's nested `llm` section to the flat
 * field model the official settings card machinery edits.
 *
 * The plugin's Config keeps its LLM knobs in one volatile `llm` object, while
 * `SettingsFormModel` addresses **top-level** section fields only (`path:
 * [field]`, `Object.hasOwn(user, field)`). This scope projects `llm.provider`,
 * `llm.model`, `llm.apiKeyRef`, and `llm.baseUrl` as four flat fields and
 * prefixes every staged path operation back with `llm`, so the card renders
 * through the shared form model without the Host schema changing shape.
 *
 * The Host accepts those nested paths: the settings service treats every path
 * beneath a declared volatile node as live-editable (`isVolatilePath`).
 *
 * @module reme-auto-router/llm-form-scope
 */

import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import type {
  SettingsFormPathOp, SettingsFormScope, SettingsFormScopeSnapshot,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { RemeAutoRouterSettings } from '../settings-schema.ts'

/** The nested `llm` section as the flat fields the card edits. */
export interface RemeLlmFields {
  /** DSH provider route name; `null` inherits the host default-model selection. */
  provider: string | null
  /** Model id; `null` inherits the host default-model selection. */
  model: string | null
  /** Credential reference the key is resolved from; `null` probes the default chain. */
  apiKeyRef: string | null
  /** OpenAI-compatible base URL; `null` disables endpoint injection. */
  baseUrl: string | null
}

/** The section key every staged operation is nested under. */
const SECTION = 'llm'

/**
 * One entry form's `llm` section, presented as a flat four-field scope.
 *
 * `user` is projected to the nested user layer itself so the form model's
 * presence check (`Object.hasOwn`) still reports a field as overridden exactly
 * when the profile's user layer carries it.
 */
export class LlmScope implements SettingsFormScope<RemeLlmFields> {
  /** @param form - the shared configuration form of the plugin's own entry. */
  constructor(private readonly form: ConfigForm<RemeAutoRouterSettings>) {}

  /**
   * Project the entry snapshot onto the flat `llm` view.
   * @returns the section values, the composition layer, and the raw user layer.
   */
  getSnapshot(): SettingsFormScopeSnapshot<RemeLlmFields> {
    const snapshot = this.form.getSnapshot()
    return {
      status: snapshot.status,
      value: snapshot.value?.llm,
      base: (snapshot.base as { llm?: RemeLlmFields } | undefined)?.llm,
      user: (snapshot.user as { llm?: Partial<RemeLlmFields> } | undefined)?.llm,
      writable: snapshot.writable,
      revision: snapshot.revision,
    }
  }

  /**
   * Observe snapshot replacements.
   * @param listener - invoked after each snapshot change.
   * @returns the disposer removing this listener.
   */
  subscribe(listener: () => void): () => void {
    return this.form.subscribe(listener)
  }

  /**
   * Nest every staged field operation under `llm` and write it in one fence.
   * @param ops - the card's flat field edits, in staging order.
   * @param expectedRevision - the revision the drafts were staged against.
   * @returns whether the Host accepted the write, after any recovery read.
   */
  mutate(ops: readonly SettingsFormPathOp[], expectedRevision?: number): Promise<boolean> {
    const nested = ops.map(op => op.op === 'set'
      ? { op: 'set' as const, path: [SECTION, ...op.path], value: op.value }
      : { op: 'unset' as const, path: [SECTION, ...op.path] })
    // The nested shape is the entry form's own mutation contract; the shared
    // model types its values as `unknown`, so the parameter type is the
    // authority on the wire shape rather than a duplicated JsonValue import.
    return this.form.mutate(nested as Parameters<ConfigForm<RemeAutoRouterSettings>['mutate']>[0], expectedRevision)
  }
}
