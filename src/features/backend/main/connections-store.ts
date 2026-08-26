/**
 * Multi-backend connections registry (main process).
 *
 * Persists the set of remote intentd connections the user has paired with,
 * plus which backend is currently active, to a dedicated JSON file under
 * `app.getPath('userData')` — `backend-connections.json`, separate from
 * `local-prefs.json` so the two stores evolve independently.
 *
 * The bearer token for each remote is encrypted at rest with Electron's
 * cross-platform `safeStorage` when `isEncryptionAvailable()` is true; when
 * it is not (e.g. a headless Linux box with no keyring), the token is stored
 * in plaintext with an explicit `encrypted: false` marker so callers/audits
 * can tell the difference. See spec "Decisions" (token storage).
 *
 * The local sidecar is not a persisted record: a synthetic, non-forgettable
 * "This machine (local)" entry (id `local`) is always synthesized as the
 * first item of `list()`, and `activeId` defaults to `local`.
 *
 * Writes are serialized behind a promise chain (mirroring `local-prefs.ts`)
 * so a mid-write reader sees either the old or new file, never a torn one.
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { app, safeStorage } from 'electron';
import { Logger } from '../../../shared/logger';
import { LOCAL_CONNECTION_ID, type ConnectionRecord } from '../../../shared/types/connections';
import { TOMBSTONE_TTL_MS, accountKeyFor, type KeychainSyncRecord } from './keychain-sync';

// Re-export the shared contract types so existing store importers keep a single
// import site while the canonical definitions live in `shared/types/connections`
// (one source of truth consumed by T3's IPC and T5's renderer slice alike).
export { LOCAL_CONNECTION_ID };
export type { ConnectionRecord };

const logger = new Logger('ConnectionsStore');

/** File name inside `app.getPath('userData')`. */
const FILE_NAME = 'backend-connections.json';

/** Display label for the synthesized local sidecar entry. */
// i18n-ignore (main-process fallback label; the renderer renders local via m.layout_daemonStatus_localConnection_label())
export const LOCAL_CONNECTION_LABEL = 'This machine (local)';

/**
 * Token ciphertext (or plaintext fallback) as persisted on disk.
 * `value` is base64 of the `safeStorage` ciphertext when `encrypted`, else
 * the raw token string.
 */
interface EncryptedToken {
  encrypted: boolean;
  value: string;
}

/** A remote connection as persisted on disk (token included). */
interface StoredConnection {
  id: string;
  label: string;
  host: string;
  port: number;
  fingerprint: string;
  /**
   * Remote machine hostname (from `host.status`), captured on first connect so
   * the menu can show `hostname (host:port)`. Absent on records written before
   * this field existed and until the first successful capture — treated as
   * "unavailable" (the UI falls back to `host:port`).
   */
  hostname?: string | null;
  /**
   * Candidate hosts (#1746): the primary `host` first, then any additional IPs
   * the backend reported via `server.pairingInfo`. Absent on records written
   * before this field existed — treated as `[host]` (single-host behavior).
   */
  hosts?: string[];
  /**
   * "Detect all backend IPs" option (#1746). Absent on older records — treated
   * as enabled so existing connections gain the resilience benefit. When
   * `false`, the host list is never refreshed from the backend.
   */
  detectHosts?: boolean;
  encToken: EncryptedToken;
  /**
   * Last-writer-wins conflict clock for keychain sync (ms since epoch),
   * stamped on every syncable mutation. Absent on records written before sync
   * existed — treated as 0 (epoch-old) so any synced copy wins over them.
   */
  updatedAt?: number;
}

/**
 * A forgotten remote connection, kept so keychain sync can propagate the
 * deletion to other machines (see keychain-sync.ts "tombstones"). Carries the
 * full identity shape a sync record needs but NEVER a token. Purged from disk
 * once the corresponding keychain tombstone expires (the reconcile stops
 * listing it) or when the same host:port is re-added.
 */
interface StoredTombstone {
  label: string;
  host: string;
  port: number;
  fingerprint: string;
  hostname?: string | null;
  hosts?: string[];
  detectHosts?: boolean;
  /** LWW clock at forget time (ms since epoch). */
  updatedAt: number;
  /** When the backend was forgotten (ms since epoch); sync TTL anchor. */
  deletedAt: number;
}

/** Fields required to register a new remote connection. */
export interface NewConnection {
  label: string;
  host: string;
  port: number;
  fingerprint: string;
  token: string;
  /** "Detect all backend IPs" option (#1746); absent = enabled. */
  detectHosts?: boolean;
}

interface PersistedState {
  connections: StoredConnection[];
  activeId: string;
  tombstones: StoredTombstone[];
}

/** In-flight write chain so concurrent writers serialize. */
let writeChain: Promise<void> = Promise.resolve();

function filePath(): string {
  return path.join(app.getPath('userData'), FILE_NAME);
}

function localRecord(): ConnectionRecord {
  return {
    id: LOCAL_CONNECTION_ID,
    label: LOCAL_CONNECTION_LABEL,
    host: null,
    hosts: null,
    port: null,
    fingerprint: null,
    isLocal: true,
  };
}

/**
 * Candidate-host list for a stored record: the primary `host` first, then the
 * stored extras (deduplicated). Records written before `hosts` existed migrate
 * to the one-element `[host]` list.
 */
function candidateHosts(stored: Pick<StoredConnection, 'host' | 'hosts'>): string[] {
  return dedupeHosts([stored.host, ...(stored.hosts ?? [])]);
}

/** Trim, drop empties, and deduplicate while preserving order. */
function dedupeHosts(hosts: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of hosts) {
    const host = raw.trim();
    if (!host || seen.has(host)) continue;
    seen.add(host);
    out.push(host);
  }
  return out;
}

function toRecord(stored: StoredConnection): ConnectionRecord {
  return {
    id: stored.id,
    label: stored.label,
    host: stored.host,
    hosts: candidateHosts(stored),
    port: stored.port,
    fingerprint: stored.fingerprint,
    hostname: stored.hostname ?? null,
    isLocal: false,
  };
}

function isStoredConnection(value: unknown): value is StoredConnection {
  if (!value || typeof value !== 'object') return false;
  const c = value as Record<string, unknown>;
  const tok = c.encToken as Record<string, unknown> | undefined;
  return (
    typeof c.id === 'string' &&
    typeof c.label === 'string' &&
    typeof c.host === 'string' &&
    typeof c.port === 'number' &&
    typeof c.fingerprint === 'string' &&
    // `hostname` is an optional late addition: absent on older records, a string
    // once captured. Accept missing/null/string; reject any other type.
    (c.hostname === undefined || c.hostname === null || typeof c.hostname === 'string') &&
    // `hosts` / `detectHosts` are optional late additions (#1746): absent on
    // older records. Accept missing or well-typed; reject any other type.
    (c.hosts === undefined ||
      (Array.isArray(c.hosts) && c.hosts.every((h) => typeof h === 'string'))) &&
    (c.detectHosts === undefined || typeof c.detectHosts === 'boolean') &&
    // `updatedAt` is an optional late addition (keychain sync): absent on
    // records written before sync existed — treated as epoch-old.
    (c.updatedAt === undefined || typeof c.updatedAt === 'number') &&
    !!tok &&
    typeof tok === 'object' &&
    typeof tok.encrypted === 'boolean' &&
    typeof tok.value === 'string'
  );
}

function isStoredTombstone(value: unknown): value is StoredTombstone {
  if (!value || typeof value !== 'object') return false;
  const t = value as Record<string, unknown>;
  return (
    typeof t.label === 'string' &&
    typeof t.host === 'string' &&
    typeof t.port === 'number' &&
    typeof t.fingerprint === 'string' &&
    (t.hostname === undefined || t.hostname === null || typeof t.hostname === 'string') &&
    (t.hosts === undefined ||
      (Array.isArray(t.hosts) && t.hosts.every((h) => typeof h === 'string'))) &&
    (t.detectHosts === undefined || typeof t.detectHosts === 'boolean') &&
    typeof t.updatedAt === 'number' &&
    typeof t.deletedAt === 'number'
  );
}

async function readState(): Promise<PersistedState> {
  try {
    const raw = await fs.readFile(filePath(), 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const obj = parsed as Record<string, unknown>;
      const connections = Array.isArray(obj.connections)
        ? obj.connections.filter(isStoredConnection)
        : [];
      const activeId = typeof obj.activeId === 'string' ? obj.activeId : LOCAL_CONNECTION_ID;
      const tombstones = Array.isArray(obj.tombstones)
        ? obj.tombstones.filter(isStoredTombstone)
        : [];
      return { connections, activeId, tombstones };
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') {
      logger.warn('Failed to read backend-connections', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { connections: [], activeId: LOCAL_CONNECTION_ID, tombstones: [] };
}

async function writeState(next: PersistedState): Promise<void> {
  const target = filePath();
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, JSON.stringify(next, null, 2), 'utf8');
}

/** Serialize a read-modify-write against the store behind the write chain. */
function mutate<T>(fn: (state: PersistedState) => T | Promise<T>): Promise<T> {
  const run = writeChain.then(async () => {
    const state = await readState();
    return fn(state);
  });
  // Keep the chain alive (and swallow errors on the chain) but let callers
  // observe the real result/rejection of their own mutation.
  writeChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function encryptToken(token: string): EncryptedToken {
  if (safeStorage.isEncryptionAvailable()) {
    return {
      encrypted: true,
      value: safeStorage.encryptString(token).toString('base64'),
    };
  }
  return { encrypted: false, value: token };
}

function decryptToken(encToken: EncryptedToken): string {
  if (encToken.encrypted) {
    return safeStorage.decryptString(Buffer.from(encToken.value, 'base64'));
  }
  return encToken.value;
}

/**
 * Listeners notified after every LOCAL syncable mutation (add / forget /
 * setHostname / setHosts) that actually persisted a change. The keychain-sync
 * lifecycle (T3) uses this to schedule an async push. Remote applications via
 * {@link applyRemoteSyncRecord} intentionally do NOT notify — that would loop
 * a pull straight back into a push.
 */
const mutationListeners = new Set<() => void>();

/** Subscribe to local syncable mutations; returns an unsubscribe function. */
export function onConnectionsMutated(listener: () => void): () => void {
  mutationListeners.add(listener);
  return () => mutationListeners.delete(listener);
}

function notifyMutated(): void {
  for (const listener of mutationListeners) {
    try {
      listener();
    } catch (error) {
      logger.warn('connections mutation listener failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/**
 * Whether two host:port identities refer to the same backend. Hosts compare
 * trimmed + case-insensitively, mirroring keychain-sync's `accountKeyFor`, so
 * a case-differing re-add can never split one backend into two records.
 */
function sameTarget(
  a: Pick<StoredConnection, 'host' | 'port'>,
  b: Pick<StoredConnection, 'host' | 'port'>,
): boolean {
  return accountKeyFor(a.host, a.port) === accountKeyFor(b.host, b.port);
}

/** Drop tombstones matching `host:port` (the backend came back). */
function clearTombstone(state: PersistedState, host: string, port: number): void {
  state.tombstones = state.tombstones.filter((t) => !sameTarget(t, { host, port }));
}

/**
 * List all connections: the synthesized local entry first, then persisted
 * remotes in insertion order. Tokens are never included.
 */
export async function list(): Promise<ConnectionRecord[]> {
  const state = await readState();
  return [localRecord(), ...state.connections.map(toRecord)];
}

/**
 * Register a remote connection, deduplicating by `host:port` (upsert). If any
 * stored connections with the same host+port already exist — earlier app
 * versions allowed repeated `host:port` entries — they are collapsed into ONE
 * surviving record: the ACTIVE duplicate when one is active (so the caller's
 * active-reconnect path keys off the right id), else the first. The survivor's
 * `fingerprint`, `encToken`, and `label` are replaced in place (it keeps its
 * `id` and captured `hostname`, inheriting a hostname from a dropped duplicate
 * if it has none), the other duplicates are dropped, and the survivor is
 * returned; otherwise a new record is appended. The plaintext token is
 * encrypted (or marked plaintext) before it hits disk. Returns the token-free
 * record.
 */
export async function add(conn: NewConnection): Promise<ConnectionRecord> {
  const encToken = encryptToken(conn.token);
  const stored = await mutate(async (state) => {
    // Host comparison is normalized (trim + lowercase, see sameTarget) so a
    // case-differing re-add upserts the existing record instead of splitting
    // one backend into two — keychain-sync keys accounts the same way.
    const duplicates = state.connections.filter((c) => sameTarget(c, conn));
    clearTombstone(state, conn.host, conn.port);
    if (duplicates.length > 0) {
      const survivor = duplicates.find((c) => c.id === state.activeId) ?? duplicates[0];
      survivor.label = conn.label;
      survivor.fingerprint = conn.fingerprint;
      survivor.encToken = encToken;
      survivor.detectHosts = conn.detectHosts ?? true;
      survivor.hostname ??= duplicates.find((c) => c.hostname != null)?.hostname ?? null;
      survivor.updatedAt = Date.now();
      state.connections = state.connections.filter(
        (c) => c === survivor || !duplicates.includes(c),
      );
      await writeState(state);
      return survivor;
    }
    const record: StoredConnection = {
      id: randomUUID(),
      label: conn.label,
      host: conn.host,
      port: conn.port,
      fingerprint: conn.fingerprint,
      detectHosts: conn.detectHosts ?? true,
      encToken,
      updatedAt: Date.now(),
    };
    state.connections.push(record);
    await writeState(state);
    return record;
  });
  notifyMutated();
  return toRecord(stored);
}

/**
 * Replace the candidate-host list for a remote connection (#1746), e.g. from a
 * post-connect `server.pairingInfo` refresh. The primary `host` always stays
 * first; `hosts` persists only the deduplicated extras. A no-op for unknown
 * ids and for records whose `detectHosts` is `false` (the user opted out of
 * IP detection at add time). Fail-soft by design: candidate hosts are a
 * resilience nicety, never a hard requirement.
 */
export async function setHosts(id: string, hosts: string[]): Promise<void> {
  const changed = await mutate(async (state) => {
    const conn = state.connections.find((c) => c.id === id);
    if (!conn) return false; // unknown id: nothing to update
    if (conn.detectHosts === false) return false; // user opted out of IP detection
    const extras = dedupeHosts([conn.host, ...hosts]).filter((h) => h !== conn.host.trim());
    // Unchanged list: skip the write so the LWW clock is not artificially
    // bumped (a re-stamp would let this stale record win over a newer remote
    // edit in keychain sync).
    if (JSON.stringify(extras) === JSON.stringify(conn.hosts ?? [])) return false;
    conn.hosts = extras;
    conn.updatedAt = Date.now();
    await writeState(state);
    return true;
  });
  if (changed) notifyMutated();
}

/**
 * Whether the "detect all backend IPs" option is enabled for a remote
 * connection (#1746). Records written before the option existed default to
 * enabled. Returns `false` for the local entry and unknown ids (nothing to
 * refresh).
 */
export async function getDetectHosts(id: string): Promise<boolean> {
  if (id === LOCAL_CONNECTION_ID) return false;
  const state = await readState();
  const conn = state.connections.find((c) => c.id === id);
  if (!conn) return false;
  return conn.detectHosts !== false;
}

/**
 * Persist the captured hostname for a remote connection (from `host.status`).
 * A no-op for an unknown id (fail-soft: hostname is a display nicety, never a
 * hard requirement). Empty/whitespace hostnames are ignored so the UI keeps its
 * `host:port` fallback rather than showing a blank label.
 */
export async function setHostname(id: string, hostname: string): Promise<void> {
  const trimmed = hostname.trim();
  if (!trimmed) return;
  const changed = await mutate(async (state) => {
    const conn = state.connections.find((c) => c.id === id);
    if (!conn) return false; // unknown id: nothing to label
    // Unchanged hostname (the common every-connect case): skip the write so
    // the LWW clock is not artificially bumped, which would let this stale
    // record win over a newer remote edit in keychain sync.
    if (conn.hostname === trimmed) return false;
    conn.hostname = trimmed;
    conn.updatedAt = Date.now();
    await writeState(state);
    return true;
  });
  if (changed) notifyMutated();
}

/**
 * Forget a remote connection. Rejects the reserved `local` id. If the
 * forgotten connection was active, the active selection falls back to `local`.
 * Writes a tombstone for the removed backend so keychain sync propagates the
 * deletion to other machines (replacing any older tombstone for the same
 * host:port).
 */
export async function forget(id: string): Promise<void> {
  if (id === LOCAL_CONNECTION_ID) {
    throw new Error('Cannot forget the local connection');
  }
  const changed = await mutate(async (state) => {
    const removed = state.connections.find((c) => c.id === id);
    state.connections = state.connections.filter((c) => c.id !== id);
    if (state.activeId === id) {
      state.activeId = LOCAL_CONNECTION_ID;
    }
    if (removed) {
      const now = Date.now();
      clearTombstone(state, removed.host, removed.port);
      state.tombstones.push({
        label: removed.label,
        host: removed.host,
        port: removed.port,
        fingerprint: removed.fingerprint,
        hostname: removed.hostname ?? null,
        hosts: removed.hosts,
        detectHosts: removed.detectHosts,
        updatedAt: now,
        deletedAt: now,
      });
    }
    await writeState(state);
    return removed !== undefined;
  });
  if (changed) notifyMutated();
}

/** The currently active backend id; defaults to `local`. */
export async function getActiveId(): Promise<string> {
  const state = await readState();
  return state.activeId;
}

/**
 * Set the active backend. `local` is always valid; any other id must match a
 * persisted connection, else this rejects.
 */
export async function setActiveId(id: string): Promise<void> {
  await mutate((state) => {
    if (id !== LOCAL_CONNECTION_ID && !state.connections.some((c) => c.id === id)) {
      throw new Error(`Unknown connection id: ${id}`);
    }
    state.activeId = id;
    return writeState(state);
  });
}

/**
 * Decrypt and return the bearer token for a remote connection. Returns null
 * for the local entry (no token) and for unknown ids.
 */
export async function getDecryptedToken(id: string): Promise<string | null> {
  if (id === LOCAL_CONNECTION_ID) return null;
  const state = await readState();
  const conn = state.connections.find((c) => c.id === id);
  if (!conn) return null;
  return decryptToken(conn.encToken);
}

// ============================================================================
// Keychain-sync adapter surface (LocalSyncAdapter backing, see keychain-sync.ts)
// ============================================================================

/**
 * Every locally known sync record: live remotes (token decrypted, needed for
 * pushes) followed by tombstones. Records written before sync existed carry
 * `updatedAt: 0` (epoch-old) so any synced copy wins over them. A live record
 * whose token cannot be decrypted is skipped (fail-soft — one corrupt entry
 * must not abort the whole reconcile). Expired tombstones are pruned from
 * disk as a side effect (the reconcile never pushes them anyway).
 *
 * The local sidecar is never listed: it is synthesized, not persisted, so it
 * can never leak into the keychain. `activeId` is per-machine state and is
 * likewise never part of the sync payload.
 */
export async function listSyncRecords(): Promise<KeychainSyncRecord[]> {
  const now = Date.now();
  const state = await readState();
  if (state.tombstones.some((t) => t.deletedAt + TOMBSTONE_TTL_MS <= now)) {
    await mutate((s) => {
      s.tombstones = s.tombstones.filter((t) => t.deletedAt + TOMBSTONE_TTL_MS > now);
      return writeState(s);
    });
  }
  const records: KeychainSyncRecord[] = [];
  for (const conn of state.connections) {
    let token: string;
    try {
      token = decryptToken(conn.encToken);
    } catch (error) {
      logger.warn('skipping undecryptable connection in sync listing', {
        id: conn.id,
        error: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
    records.push({
      label: conn.label,
      host: conn.host,
      hosts: candidateHosts(conn),
      port: conn.port,
      fingerprint: conn.fingerprint,
      hostname: conn.hostname ?? null,
      detectHosts: conn.detectHosts !== false,
      token,
      updatedAt: conn.updatedAt ?? 0,
    });
  }
  for (const t of state.tombstones) {
    if (t.deletedAt + TOMBSTONE_TTL_MS <= now) continue;
    records.push({
      label: t.label,
      host: t.host,
      hosts: candidateHosts(t),
      port: t.port,
      fingerprint: t.fingerprint,
      hostname: t.hostname ?? null,
      detectHosts: t.detectHosts !== false,
      token: '',
      updatedAt: t.updatedAt,
      deleted: true,
      deletedAt: t.deletedAt,
    });
  }
  return records;
}

/**
 * Apply a remote-won sync record to the local store (LWW loser side of a
 * reconcile). A live record upserts by normalized host:port — the existing
 * record keeps its `id` (so open windows/pool entries stay attached) while
 * label/fingerprint/token/hosts/hostname/detectHosts and the remote's
 * `updatedAt` clock are taken verbatim (NOT re-stamped: the clock must
 * converge across machines). A tombstone removes the backend and remembers
 * the tombstone; if the removed backend was active, the selection falls back
 * to `local` (never touching any other machine-local selection state).
 *
 * Deliberately does NOT fire {@link onConnectionsMutated} — pulls must not
 * loop back into pushes. Returns whether anything actually changed so the
 * lifecycle can refresh the renderer only when needed.
 */
export async function applyRemoteSyncRecord(record: KeychainSyncRecord): Promise<boolean> {
  return mutate(async (state) => {
    if (record.deleted === true) {
      const existing = state.connections.filter((c) => sameTarget(c, record));
      state.connections = state.connections.filter((c) => !existing.includes(c));
      if (existing.some((c) => c.id === state.activeId)) {
        state.activeId = LOCAL_CONNECTION_ID;
      }
      clearTombstone(state, record.host, record.port);
      state.tombstones.push({
        label: record.label,
        host: record.host,
        port: record.port,
        fingerprint: record.fingerprint,
        hostname: record.hostname,
        hosts: record.hosts.filter((h) => h.trim() !== record.host.trim()),
        detectHosts: record.detectHosts,
        updatedAt: record.updatedAt,
        deletedAt: record.deletedAt ?? record.updatedAt,
      });
      await writeState(state);
      return existing.length > 0;
    }

    clearTombstone(state, record.host, record.port);
    const encToken = encryptToken(record.token);
    const extras = record.hosts.filter((h) => h.trim() !== record.host.trim());
    const duplicates = state.connections.filter((c) => sameTarget(c, record));
    if (duplicates.length > 0) {
      const survivor = duplicates.find((c) => c.id === state.activeId) ?? duplicates[0];
      survivor.label = record.label;
      survivor.host = record.host;
      survivor.port = record.port;
      survivor.fingerprint = record.fingerprint;
      survivor.encToken = encToken;
      survivor.hostname = record.hostname;
      survivor.hosts = extras;
      survivor.detectHosts = record.detectHosts;
      survivor.updatedAt = record.updatedAt;
      state.connections = state.connections.filter(
        (c) => c === survivor || !duplicates.includes(c),
      );
    } else {
      state.connections.push({
        id: randomUUID(),
        label: record.label,
        host: record.host,
        port: record.port,
        fingerprint: record.fingerprint,
        hostname: record.hostname,
        hosts: extras,
        detectHosts: record.detectHosts,
        encToken,
        updatedAt: record.updatedAt,
      });
    }
    await writeState(state);
    return true;
  });
}

/**
 * Test-only: await any in-flight writes, then reset the chain.
 * Call in afterEach before deleting temp directories so all file operations
 * complete before cleanup.
 * @internal
 */
export async function __drainWriteChainForTesting(): Promise<void> {
  await writeChain;
  writeChain = Promise.resolve();
}
