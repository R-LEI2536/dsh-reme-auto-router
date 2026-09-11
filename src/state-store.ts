/**
 * reme-auto-router — durable state store for managed and adopted reme
 * instances.
 *
 * Persists `cwd → port/pid/ownership/lastUsedAt` mappings to
 * `${DSH_HOME:-$HOME/.dsh}/plugin-data/reme-auto-router/state.json`.
 * Writes are atomic: serialize to a sibling `.tmp` file, fsync, then
 * rename.
 *
 * The store owns three responsibilities beyond raw persistence:
 *   - `allocatePort(base, range)` — hand out the next free port in the
 *     range, skipping already-allocated ones (so two restarts do not
 *     double-bind).
 *   - `replaceRecord(rec)` / `removeRecord(cwd)` — write-through mutations.
 *
 * @module reme-auto-router/state-store
 */

import { promises as fs } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

/** Ownership of one cwd's reme instance. */
export type Ownership = 'managed' | 'adopted'

/**
 * One persisted record.
 *
 * `pid` is optional: as of DSH 0.1.5, the plain `SubprocessHandle` no longer
 * exposes `pid`, so managed instances persist without it. Adopted instances
 * keep the OS pid because the ManualAdopter resolved it from `lsof` and the
 * user may want to grep `ps` for the process they launched themselves.
 *
 * v1 on-disk records that always wrote `pid` are still readable: the type
 * guard below treats the field as optional, so legacy state.json keeps
 * working and only newly-spawned managed records omit it.
 */
export interface InstanceRecord {
  /** Canonical cwd path (realpath-normalised) this reme instance owns. */
  cwd: string
  /** Port the reme HTTP service is listening on. */
  port: number
  /** Last observed OS pid of the reme process (omitted for managed spawns). */
  pid?: number
  /** Whether we own the lifecycle or just observed a user-launched process. */
  ownership: Ownership
  /** ISO timestamp when the record was first persisted. */
  startedAt: string
  /** ISO timestamp when the cwd was last touched by the user/agent. */
  lastUsedAt: string
}

/** Full state document. Versioned for forward-compatibility reads. */
export interface StateDocument {
  schemaVersion: 1
  instances: InstanceRecord[]
  /** ISO timestamp of the last successful manual-instance scan. */
  lastScanAt: string
}

const EMPTY_DOC: StateDocument = {
  schemaVersion: 1,
  instances: [],
  lastScanAt: new Date(0).toISOString(),
}

/** Get the directory holding plugin-managed state for reme-auto-router. */
export function stateDirectory(): string {
  const home = process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh')
  return path.join(home, 'plugin-data', 'reme-auto-router')
}

/** Get the absolute path of the state JSON file. */
export function stateFilePath(): string {
  return path.join(stateDirectory(), 'state.json')
}

/**
 * Logger shape we depend on. `ctx.logger` is structurally compatible.
 * Provided as a type-only interface so tests can substitute mocks
 * without pulling in `@deepseek-ai/cordis`.
 */
export interface StoreLogger {
  warn(message: string): void
}

/**
 * In-memory cache of the persisted document plus write-through methods.
 * One instance per ProcessManager lifetime; mutations call `persist()`.
 */
export class StateStore {
  private doc: StateDocument = { ...EMPTY_DOC }
  private logger?: StoreLogger
  /** Serialised persist queue; see {@link persist} for the rationale. */
  private persistChain: Promise<void> = Promise.resolve()

  /** Load from disk; replaces any in-memory state. Idempotent. */
  async load(logger?: StoreLogger): Promise<void> {
    if (logger !== undefined) this.logger = logger
    try {
      const raw = await fs.readFile(stateFilePath(), 'utf8')
      const parsed = JSON.parse(raw) as unknown
      if (isStateDocument(parsed)) {
        this.doc = parsed
      } else {
        this.warn('state.json shape mismatch, ignoring existing file')
        this.doc = { ...EMPTY_DOC, lastScanAt: new Date().toISOString() }
      }
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        this.doc = { ...EMPTY_DOC }
        return
      }
      this.warn(`failed to read state.json (${(error as Error).message})`)
      this.doc = { ...EMPTY_DOC, lastScanAt: new Date().toISOString() }
    }
  }

  /** Replace or insert one record, then persist. */
  async replaceRecord(record: InstanceRecord): Promise<void> {
    const idx = this.doc.instances.findIndex((r) => r.cwd === record.cwd)
    if (idx >= 0) this.doc.instances[idx] = record
    else this.doc.instances.push(record)
    await this.persist()
  }

  /** Remove the record for cwd; idempotent when cwd is not present. */
  async removeRecord(cwd: string): Promise<void> {
    const before = this.doc.instances.length
    this.doc.instances = this.doc.instances.filter((r) => r.cwd !== cwd)
    if (this.doc.instances.length !== before) await this.persist()
  }

  /** Update the lastScanAt timestamp (called by manual-adopter after a scan). */
  async touchScan(): Promise<void> {
    this.doc.lastScanAt = new Date().toISOString()
    await this.persist()
  }

  /** Return all current records. */
  records(): readonly InstanceRecord[] {
    return this.doc.instances
  }

  /**
   * Hand out the next free port in `[base, base + range)`. Skips
   * ports already allocated (from this in-memory cache); on overflow,
   * falls back to a random high port and lets the OS reject duplicates.
   */
  allocatePort(base: number, range: number): number {
    const used = new Set(this.doc.instances.map((r) => r.port))
    for (let i = 0; i < range; i++) {
      const candidate = base + i
      if (!used.has(candidate)) return candidate
    }
    // Exhausted the configured range: pick a random port in 30000..65000.
    const fallback = 30_000 + Math.floor(Math.random() * 35_000)
    this.warn(`port range ${String(base)}..${String(base + range - 1)} exhausted, falling back to ${String(fallback)}`)
    return fallback
  }

  private async persist(): Promise<void> {
    // Serialise persist calls on a per-instance promise chain. Without
    // this, two concurrent replaceRecord/removeRecord calls race on
    // the shared `state.json.tmp` file: each call's `open(..., 'w')`
    // truncates the other's tmp, and the loser's eventual `rename`
    // sees ENOENT because the winner already renamed. The chain
    // matches the pattern EndpointCoordinator.route uses; rejections
    // are caught so a single failed write does not poison the queue.
    const next = this.persistChain.then(() => this.doPersist()).catch(() => undefined)
    this.persistChain = next
    return next
  }

  private async doPersist(): Promise<void> {
    const dir = stateDirectory()
    await fs.mkdir(dir, { recursive: true })
    const finalPath = stateFilePath()
    const tmpPath = `${finalPath}.tmp`
    const handle = await fs.open(tmpPath, 'w')
    try {
      await handle.writeFile(JSON.stringify(this.doc, null, 2), 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    await fs.rename(tmpPath, finalPath)
  }

  private warn(message: string): void {
    this.logger?.warn(`reme-auto-router: ${message}`)
  }
}

/** Type guard for StateDocument (defence-in-depth against manual edits). */
function isStateDocument(value: unknown): value is StateDocument {
  if (!value || typeof value !== 'object') return false
  const v = value as Partial<StateDocument>
  if (v.schemaVersion !== 1) return false
  if (!Array.isArray(v.instances)) return false
  if (typeof v.lastScanAt !== 'string') return false
  return v.instances.every(isInstanceRecord)
}

function isInstanceRecord(value: unknown): value is InstanceRecord {
  if (!value || typeof value !== 'object') return false
  const r = value as Partial<InstanceRecord>
  return (
    typeof r.cwd === 'string' &&
    typeof r.port === 'number' &&
    // `pid` is optional as of DSH 0.1.5 (managed spawns no longer expose
    // the OS pid through SubprocessHandle). Accept missing or numeric;
    // reject the empty string or null variants.
    (r.pid === undefined || typeof r.pid === 'number') &&
    (r.ownership === 'managed' || r.ownership === 'adopted') &&
    typeof r.startedAt === 'string' &&
    typeof r.lastUsedAt === 'string'
  )
}

function isNodeError(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error && 'code' in value
}