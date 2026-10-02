/**
 * reme-auto-router — browser-half contract test.
 *
 * Locks the Plugins-page settings page added in 0.4.1:
 *   1. `LlmScope` projects the entry's nested `llm` section as flat fields and
 *      nests every staged path operation back under `llm`, which is what lets
 *      the official staged form model edit a nested section.
 *   2. `rowSeatOptions` claims the bundle's own `plugins.row.config` seat under
 *      the page's `<package name>#<row id>` key, with the dictionary binding
 *      and injected form face.
 *   3. The built `lib/client.js` hands off under the package name, carries the
 *      seat registration, and requires platform modules only (skipped until the
 *      artifact is built: run `pnpm run build` first to include it).
 *
 * Coverage boundary: the card's presentational wiring (`RemeCard`) and the
 * controller's use of `SettingsFormModel` are not exercised here. The published
 * UI primitives ship a bundle that imports packages it does not declare, so
 * loading it under plain Node would drag unrelated front-end dependencies into
 * this plugin's devDependencies. Both are typechecked against the official
 * prop/face types, and the live Plugins page is the end-to-end check.
 *
 * Exits 0 on success, 1 on first failed assertion.
 */

import { readFileSync } from 'node:fs'
import { DEFAULT_SETTINGS, type RemeAutoRouterSettings } from '../src/settings-schema.ts'
import { LlmScope } from '../src/client/llm-form-scope.ts'
import {
  CLIENT_INJECT, ENTRY_ID, NS, PACKAGE_NAME, ROW_KEY, rowSeatOptions,
  type RowSeatOptions,
} from '../src/client/row-seat.ts'

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    console.error('FAIL', message)
    process.exit(1)
  }
}

/** One recorded write: the ops handed to the entry form and its fence. */
interface RecordedWrite {
  ops: readonly { op: string; path: readonly string[]; value?: unknown }[]
  revision: number | undefined
}

/** Controllable stand-in for the entry's shared configuration form. */
function fakeForm(init: {
  llm?: Partial<RemeAutoRouterSettings['llm']>
  user?: unknown
  base?: unknown
  status?: 'loading' | 'ready' | 'unavailable'
  writable?: boolean
  revision?: number
} = {}) {
  const snapshot = {
    status: init.status ?? 'ready' as const,
    value: {
      ...DEFAULT_SETTINGS,
      llm: { ...DEFAULT_SETTINGS.llm, ...init.llm },
    } satisfies RemeAutoRouterSettings,
    base: init.base,
    user: init.user,
    revision: init.revision ?? 7,
    writable: init.writable ?? true,
    mode: 'host' as const,
  }
  const writes: RecordedWrite[] = []
  let accepted = true
  return {
    form: {
      getSnapshot: () => snapshot,
      subscribe: () => () => {},
      mutate: async (ops: RecordedWrite['ops'], revision?: number) => {
        writes.push({ ops, revision })
        return accepted
      },
      set: async () => accepted,
      unset: async () => accepted,
    },
    writes,
    refuse: () => { accepted = false },
  }
}

/**
 * Read the built browser bundle, if it has been built.
 * @returns the artifact source, or undefined before the first build.
 */
function clientArtifact(): string | undefined {
  try {
    return readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  } catch {
    return undefined
  }
}

/** The module specifiers the shell's frozen module table always answers. */
const PLATFORM_MODULES = new Set([
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store', '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives', '@deepseek-ai/dsh-client-ui-dockkit',
])

async function main(): Promise<void> {
  // 1. Scope projection: the nested `llm` view, its composition layer, and the
  //    raw user layer (presence is what marks a field overridden).
  {
    const fake = fakeForm({
      llm: { provider: 'opencode-chat', model: 'deepseek-v4-flash' },
      base: { llm: { apiKeyRef: 'OPENCODE_CHAT_API_KEY' } },
      user: { llm: { provider: 'opencode-chat' } },
      revision: 12,
    })
    const snapshot = new LlmScope(fake.form).getSnapshot()
    assert(snapshot.status === 'ready', 'scope passes the namespace status through')
    assert(snapshot.writable === true, 'scope passes writability through')
    assert(snapshot.revision === 12, 'scope passes the write fence through')
    assert(snapshot.value?.provider === 'opencode-chat', 'value projects the nested llm section')
    assert(snapshot.value?.baseUrl === null, 'an unset nested key still projects its schema default')
    assert(
      (snapshot.base as { apiKeyRef?: string }).apiKeyRef === 'OPENCODE_CHAT_API_KEY',
      'base projects the nested composition layer',
    )
    assert(
      Object.hasOwn(snapshot.user as object, 'provider') === true,
      'user projects the nested user layer so presence stays visible',
    )
    console.log('ok   LlmScope projects the nested llm section as flat fields')
  }

  // 2. Scope writes: every staged field operation nests under `llm` and keeps
  //    the fence the drafts were staged against.
  {
    const fake = fakeForm()
    const scope = new LlmScope(fake.form)
    const accepted = await scope.mutate(
      [
        { op: 'set', path: ['provider'], value: 'opencode-chat' },
        { op: 'unset', path: ['model'] },
      ],
      3,
    )
    assert(accepted === true, 'scope reports the entry form acceptance')
    const write = fake.writes[0]
    assert(write !== undefined, 'scope must write through the entry form')
    assert(write.revision === 3, 'scope passes the staged revision through')
    assert(write.ops.length === 2, 'scope forwards every staged operation')
    assert(
      write.ops[0]?.op === 'set' && write.ops[0].path.join('.') === 'llm.provider',
      'a staged set nests under llm',
    )
    assert(write.ops[0]?.value === 'opencode-chat', 'a staged set keeps its value')
    assert(
      write.ops[1]?.op === 'unset' && write.ops[1].path.join('.') === 'llm.model',
      'a staged clear nests under llm',
    )

    fake.refuse()
    const refused = await scope.mutate([{ op: 'set', path: ['model'], value: 'x' }])
    assert(refused === false, 'scope surfaces a refused write to the form model')
    console.log('ok   LlmScope nests set/unset operations under llm')
  }

  // 3. The seat contract: the bundle's own row page on the Plugins page, bound
  //    to this plugin's entry dictionary and staged-form face.
  {
    const face = { hooks: { remeCard: {} }, edit: () => {}, resetField: () => {}, save: () => {}, discard: () => {} }
    const options: RowSeatOptions = rowSeatOptions(() => face as never)
    assert(options.name === 'plugins.row.config', 'the bundle claims the row configuration seat')
    assert(ROW_KEY === `${PACKAGE_NAME}#${ENTRY_ID}`, `the seat answers the page row key, got ${ROW_KEY}`)
    assert(options.key === ROW_KEY, 'the seat registration carries the row key')
    assert(options.locale === NS && NS === ENTRY_ID, 'one namespace names the dictionary and the edited entry')
    assert(options.inject() === (face as never), 'the seat injects the controller-built face')
    assert(
      CLIENT_INJECT.join(',') === 'slots,locale,configForms',
      `the browser half requires the slot, locale, and form services, got ${CLIENT_INJECT.join(',')}`,
    )
    console.log('ok   rowSeatOptions claims the bundle row seat')
  }

  // 4. The built artifact: the handoff id, the seat, and platform-only requires.
  {
    const artifact = clientArtifact()
    if (artifact === undefined) {
      console.log('skip lib/client.js not built — run `pnpm run build` to include the artifact checks')
    } else {
      assert(
        artifact.startsWith(`window.__ModuleLoader__.load({ id: "dsh-reme-auto-router", factory: (require) => {`),
        'the bundle hands off under the package name the loader keys its row by',
      )
      assert(artifact.includes('return module.exports; } });'), 'the factory returns the module exports')
      assert(artifact.includes('"plugins.row.config"'), 'the artifact registers the row configuration seat')
      assert(artifact.includes(`"${ROW_KEY}"`), 'the artifact carries the row key the page looks up')
      assert(artifact.includes(`"${ENTRY_ID}"`), 'the artifact binds the plugin entry id')
      const required = [...artifact.matchAll(/require\("([^"]+)"\)/g)].map(match => match[1]!)
      assert(required.length > 0, 'the artifact requires its platform modules')
      for (const specifier of required) {
        assert(PLATFORM_MODULES.has(specifier), `the artifact requires a platform module, got ${specifier}`)
      }
      assert(!artifact.includes('schemastery'), 'no Host-only schema dependency leaks into the browser bundle')
      // The card exposes provider/model only; the credential reference and the
      // endpoint are derived from the provider's DSH profile server-side.
      assert(!artifact.includes('apiKeyRef'), 'the card must not render the deployer-only credential-ref field')
      assert(!artifact.includes('baseUrl'), 'the card must not render the deployer-only endpoint field')
      console.log(`ok   lib/client.js hands off under its package name (requires: ${[...new Set(required)].join(', ')})`)
    }
  }

  console.log('\nclient-card: all checks passed')
}

await main()
