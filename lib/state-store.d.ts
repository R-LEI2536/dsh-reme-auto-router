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
/** Ownership of one cwd's reme instance. */
export type Ownership = 'managed' | 'adopted';
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
    cwd: string;
    /** Port the reme HTTP service is listening on. */
    port: number;
    /** Last observed OS pid of the reme process (omitted for managed spawns). */
    pid?: number;
    /** Whether we own the lifecycle or just observed a user-launched process. */
    ownership: Ownership;
    /** ISO timestamp when the record was first persisted. */
    startedAt: string;
    /** ISO timestamp when the cwd was last touched by the user/agent. */
    lastUsedAt: string;
}
/** Full state document. Versioned for forward-compatibility reads. */
export interface StateDocument {
    schemaVersion: 1;
    instances: InstanceRecord[];
    /** ISO timestamp of the last successful manual-instance scan. */
    lastScanAt: string;
}
/** Get the directory holding plugin-managed state for reme-auto-router. */
export declare function stateDirectory(): string;
/** Get the absolute path of the state JSON file. */
export declare function stateFilePath(): string;
/**
 * Logger shape we depend on. `ctx.logger` is structurally compatible.
 * Provided as a type-only interface so tests can substitute mocks
 * without pulling in `@deepseek-ai/cordis`.
 */
export interface StoreLogger {
    warn(message: string): void;
}
/**
 * In-memory cache of the persisted document plus write-through methods.
 * One instance per ProcessManager lifetime; mutations call `persist()`.
 */
export declare class StateStore {
    private doc;
    private logger?;
    /** Serialised persist queue; see {@link persist} for the rationale. */
    private persistChain;
    /** Load from disk; replaces any in-memory state. Idempotent. */
    load(logger?: StoreLogger): Promise<void>;
    /** Replace or insert one record, then persist. */
    replaceRecord(record: InstanceRecord): Promise<void>;
    /** Remove the record for cwd; idempotent when cwd is not present. */
    removeRecord(cwd: string): Promise<void>;
    /** Update the lastScanAt timestamp (called by manual-adopter after a scan). */
    touchScan(): Promise<void>;
    /** Return all current records. */
    records(): readonly InstanceRecord[];
    /**
     * Hand out the next free port in `[base, base + range)`. Skips
     * ports already allocated (from this in-memory cache); on overflow,
     * falls back to a random high port and lets the OS reject duplicates.
     */
    allocatePort(base: number, range: number): number;
    private persist;
    private doPersist;
    private warn;
}
//# sourceMappingURL=state-store.d.ts.map