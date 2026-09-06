/**
 * Local copy of the in-memory settings provider fixture used by
 * `@deepseek-ai/dsh-settings` tests. We vendor a minimal version here
 * because the test suite imports it as a sibling helper, but our
 * reme-auto-router workspace does not depend on that test package.
 */

import { SettingsProvider, type SettingsNamespace } from '@deepseek-ai/dsh-settings'

export class MemorySettings extends SettingsProvider {
  doc: Record<string, unknown>
  persisted: Array<{ ns: SettingsNamespace; section: Record<string, unknown> }> = []
  writableFlag: boolean
  persistDelayMs: number

  constructor(ctx: ConstructorParameters<typeof SettingsProvider>[0], options?: {
    doc?: Record<string, unknown>
    writable?: boolean
    persistDelayMs?: number
  }) {
    super(ctx)
    this.doc = structuredClone(options?.doc ?? {})
    this.writableFlag = options?.writable ?? true
    this.persistDelayMs = options?.persistDelayMs ?? 0
  }

  get writable(): boolean {
    return this.writableFlag
  }

  protected load(): Promise<Record<string, unknown>> {
    return Promise.resolve(structuredClone(this.doc))
  }

  protected async persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    if (this.persistDelayMs > 0) {
      await new Promise(resolve => setTimeout(resolve, this.persistDelayMs))
    }
    this.persisted.push({ ns, section: structuredClone(section) })
    this.doc[ns] = structuredClone(section)
  }

  pushExternal(doc: Record<string, unknown>): void {
    this.doc = structuredClone(doc)
    this.publish(structuredClone(doc))
  }
}
