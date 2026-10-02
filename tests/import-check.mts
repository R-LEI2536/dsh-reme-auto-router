/**
 * reme-auto-router — import smoke test.
 *
 * Asserts every module in the plugin compiles and loads under tsx.
 * Pure side-effect-free check; no Cordis context is booted. Run via:
 *
 *   pnpm exec tsx --tsconfig tsconfig.base.json \
 *     tests/import-check.mts
 *
 * Exits 0 on success, 1 with the failing module name on failure.
 */

import { StateStore } from '../src/state-store.ts'
import { ProcessManager } from '../src/process-manager.ts'
import { SettingsConfig, REME_MANAGED_MARKER, DEFAULT_SETTINGS } from '../src/settings-schema.ts'
import { renderStatusLine, basename } from '../src/push-notifier.ts'
import { registerRemeCommand, REME_COMMAND_NAME } from '../src/slash-command.ts'
import { WorkspaceDetector } from '../src/workspace-detector.ts'
import { EndpointCoordinator } from '../src/endpoint-coordinator.ts'
import { ManualAdopter } from '../src/manual-adopter.ts'
import { runShutdown } from '../src/shutdown.ts'
import { PushNotifier } from '../src/push-notifier.ts'
import * as entry from '../src/index.ts'

const expected = [
  ['StateStore', typeof StateStore],
  ['ProcessManager', typeof ProcessManager],
  ['SettingsConfig', typeof SettingsConfig],
  ['REME_MANAGED_MARKER', typeof REME_MANAGED_MARKER],
  ['DEFAULT_SETTINGS', typeof DEFAULT_SETTINGS],
  ['renderStatusLine', typeof renderStatusLine],
  ['basename', typeof basename],
  ['WorkspaceDetector', typeof WorkspaceDetector],
  ['EndpointCoordinator', typeof EndpointCoordinator],
  ['ManualAdopter', typeof ManualAdopter],
  ['runShutdown', typeof runShutdown],
  ['registerRemeCommand', typeof registerRemeCommand],
  ['REME_COMMAND_NAME', typeof REME_COMMAND_NAME],
  ['PushNotifier', typeof PushNotifier],
  ['entry.name', typeof entry.name],
  ['entry.apply', typeof entry.apply],
  ['entry.Config', typeof entry.Config],
  ['entry.inject', Array.isArray(entry.inject) ? 'array' : typeof entry.inject],
] as const

let failed = 0
for (const [name, actual] of expected) {
  if (actual === 'undefined') {
    console.error(`FAIL ${name} is undefined`)
    failed++
    continue
  }
  console.log(`ok   ${name}: ${actual}`)
}

if (entry.name !== 'reme-auto-router') {
  console.error(`FAIL entry.name: got ${JSON.stringify(entry.name)}`)
  failed++
}

const inject = entry.inject as readonly string[]
if (!inject.includes('subprocess') || !inject.includes('sessions')) {
  console.error(`FAIL entry.inject missing required services: ${inject.join(',')}`)
  failed++
}
if (inject.includes('settings')) {
  console.error(`FAIL entry.inject still requires 'settings' (DSH 0.1.7+ removed the namespace API; 0.2.0-rc.1+ identical): ${inject.join(',')}`)
  failed++
}

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`)
  process.exit(1)
}
console.log('\nall import checks passed')