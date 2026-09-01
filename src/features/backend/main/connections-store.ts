/**
 * Multi-backend connections registry (main process).
 *
 * Persists the set of remote intentd connections the user has paired with to
 * a dedicated JSON file under `app.getPath('userData')` —
 * `backend-connections.json`, separate from `local-prefs.json` so the two
 * stores evolve independently.
 *
 * The bearer token for each remote is encrypted at rest with Electron's
 * cross-platform `safeStorage` when `isEncryptionAvailable()` is true; when
 * it is not (e.g. a headless Linux box with no keyring), the token is stored
 * in plaintext with an explicit `encrypted: false` marker so callers/audits
 * can tell the difference. See spec "Decisions" (token storage).
 *
 * The local sidecar is not a persisted record: a synthetic, non-forgettable
 * "This machine (local)" entry (id `local`) is always synthesized as the
 * first item of `list()`. The file also carries the legacy `activeId` field
 * (defaults to `local`) — Open-only: it no longer drives client routing. It
 * is read primarily as a boot-time default (which session bucket restores
 * first / the fallback backend for a fresh first window), plus a couple of
 * legacy compat reads: the `connections:add` rebuild-if-active check (and its
 * `switched` result field) and the browser-capture state-dir key.
 *
 * Writes are serialized behind a promise chain (mirroring `local-prefs.ts`)
 * so a mid-write reader sees either the old or new file, never a torn one.
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { app, safeStorage } from 'electron';
import { normalizeFingerprint } from './backend-connection';
import { Logger } from '../../../shared/logger';
import {
  DEFAULT_CONNECTION_ACCENT,
  LOCAL_CONNECTION_ID,
  isConnectionAccent,
  type ConnectionAccent,
  type ConnectionRecord,
} from '../../../shared/types/connections';
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
  /** Optional for backward compatibility; missing uses the default, null is explicitly blank. */
  accent?: ConnectionAccent;
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
   * The remote daemon's reported version (`server.version` from its
   * `client.hello`), captured on connect and refreshed on every reconnect.
   * Absent on records written before this field existed and until the first
   * capture. Observational, per-machine state: it is NEVER part of the
   * keychain-sync surface (each machine observes the daemon itself), so
   * writes never bump the LWW clock or notify sync.
   */
  daemonVersion?: string | null;
  /**
   * Whether the remote daemon reports self-update support (`updateSupported`
   * from `system.status`), captured after connect and refreshed on every
   * reconnect. Absent on records written before this field existed and until
   * the first capture (= unknown). Observational, per-machine state like
   * `daemonVersion`: NEVER part of the keychain-sync surface, so writes never
   * bump the LWW clock or notify sync.
   */
  updateSupported?: boolean | null;
  /**
   * Candidate hosts (#1746): the primary `host` first, then any additional IPs
   * the backend reported via `server.pairingInfo`. Absent on records written
   * before this field existed — treated as `[host]` (single-host behavior).
   */
  hosts?: string[];
  /**
   * tc address of the daemon's tailcat tunnel endpoint (PROTOCOL §12.3),
   * captured from the pairing URI's `tc=` at add time and refreshed from
   * `system.status.tcAddress` / `server.pairingInfo` after each successful
   * connect. Absent on records written before this field existed and until
   * the first capture; `null` after a conclusive refresh saying the daemon
   * has no tunnel. Unlike `daemonVersion`, this IS part of the keychain-sync
   * surface: every machine learns the same address from the same daemon, and
   * syncing it lets a device that can only reach the daemon THROUGH the
   * tunnel inherit the address from a device that paired locally — so writes
   * bump the LWW clock and notify sync (see {@link setTcAddress}).
   */
  tcAddress?: string | null;
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
  /**
   * Per-backend keychain-sync exclusion (spec Phase 2): when `true` the
   * record is local-only — never listed to sync (see listSyncRecords). Absent
   * on records written before the flag existed — treated as `false` (synced).
   */
  syncExcluded?: boolean;
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
  accent?: ConnectionAccent;
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
  /**
   * `true` when the forgotten record was sync-excluded: the tombstone is as
   * local-only as the record was — never listed to sync, so a purely local
   * backend's deletion can never propagate to the keychain. Absent = synced.
   */
  excluded?: boolean;
}

/** Fields required to register a new remote connection. */
export interface NewConnection {
  label: string;
  accent?: ConnectionAccent;
  host: string;
  port: number;
  fingerprint: string;
  token: string;
  /** tc address from the pairing URI's `tc=` (PROTOCOL §12.3); absent = none advertised. */
  tcAddress?: string;
  /** "Detect all backend IPs" option (#1746); absent = enabled. */
  detectHosts?: boolean;
  /**
   * Per-backend keychain-sync exclusion (spec Phase 2): `true` keeps the
   * record local-only (never pushed to the keychain), `false` explicitly
   * marks it synced. Absent = no opinion: a new record defaults to synced,
   * while an upsert into an existing record preserves its current flag (so
   * flag-less freshness paths never flip a user's opt-out — see add()).
   */
  syncExcluded?: boolean;
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
    accent: null,
    host: null,
    hosts: null,
    port: null,
    fingerprint: null,
    tcAddress: null,
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
    accent: stored.accent === undefined ? DEFAULT_CONNECTION_ACCENT : stored.accent,
    host: stored.host,
    hosts: candidateHosts(stored),
    port: stored.port,
    fingerprint: stored.fingerprint,
    tcAddress: stored.tcAddress ?? null,
    hostname: stored.hostname ?? null,
    daemonVersion: stored.daemonVersion ?? null,
    updateSupported: stored.updateSupported ?? null,
    syncExcluded: stored.syncExcluded === true,
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
    (c.accent === undefined || isConnectionAccent(c.accent)) &&
    typeof c.host === 'string' &&
    typeof c.port === 'number' &&
    typeof c.fingerprint === 'string' &&
    // `hostname` is an optional late addition: absent on older records, a string
    // once captured. Accept missing/null/string; reject any other type.
    (c.hostname === undefined || c.hostname === null || typeof c.hostname === 'string') &&
    // `daemonVersion` is an optional late addition: absent on older records,
    // a string once captured. Accept missing/null/string; reject any other type.
    (c.daemonVersion === undefined ||
      c.daemonVersion === null ||
      typeof c.daemonVersion === 'string') &&
    // `updateSupported` is an optional late addition: absent on older records,
    // a boolean once captured. Accept missing/null/boolean; reject other types.
    (c.updateSupported === undefined ||
      c.updateSupported === null ||
      typeof c.updateSupported === 'boolean') &&
    // `hosts` / `detectHosts` are optional late additions (#1746): absent on
    // older records. Accept missing or well-typed; reject any other type.
    (c.hosts === undefined ||
      (Array.isArray(c.hosts) && c.hosts.every((h) => typeof h === 'string'))) &&
    (c.detectHosts === undefined || typeof c.detectHosts === 'boolean') &&
    // `tcAddress` is an optional late addition (tailcat tunnel): absent on
    // older records, string once captured, null after a conclusive "no
    // tunnel" refresh. Accept missing/null/string; reject any other type.
    (c.tcAddress === undefined || c.tcAddress === null || typeof c.tcAddress === 'string') &&
    // `updatedAt` is an optional late addition (keychain sync): absent on
    // records written before sync existed — treated as epoch-old.
    (c.updatedAt === undefined || typeof c.updatedAt === 'number') &&
    // `syncExcluded` is an optional late addition (spec Phase 2): absent on
    // older records — treated as `false` (synced).
    (c.syncExcluded === undefined || typeof c.syncExcluded === 'boolean') &&
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
    (t.accent === undefined || isConnectionAccent(t.accent)) &&
    typeof t.host === 'string' &&
    typeof t.port === 'number' &&
    typeof t.fingerprint === 'string' &&
    (t.hostname === undefined || t.hostname === null || typeof t.hostname === 'string') &&
    (t.hosts === undefined ||
      (Array.isArray(t.hosts) && t.hosts.every((h) => typeof h === 'string'))) &&
    (t.detectHosts === undefined || typeof t.detectHosts === 'boolean') &&
    typeof t.updatedAt === 'number' &&
    typeof t.deletedAt === 'number' &&
    (t.excluded === undefined || typeof t.excluded === 'boolean')
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

class ConnectionSecretUnavailableError extends Error {
  readonly code = 'connection-secret-unavailable';

  constructor() {
    // i18n-ignore (internal error)
    super('Connection secret unavailable');
    this.name = 'ConnectionSecretUnavailableError';
  }
}

function decryptToken(encToken: EncryptedToken): string {
  if (encToken.encrypted) {
    try {
      return safeStorage.decryptString(Buffer.from(encToken.value, 'base64'));
    } catch {
      throw new ConnectionSecretUnavailableError();
    }
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

/**
 * Normalized cert-fingerprint comparison key (trimmed, case-insensitive), or
 * null when the record carries no usable fingerprint (legacy/blank).
 */
function fingerprintKey(fingerprint: string | undefined | null): string | null {
  const key = normalizeFingerprint(fingerprint ?? '');
  return key === '' ? null : key;
}

/**
 * Whether two records identify the same backend MACHINE for LIVE dedupe
 * (add/upsert). The certificate fingerprint is the canonical identity: when
 * both sides carry one, a match means the same machine even under a different
 * host:port (DHCP/IP change). Records without a usable fingerprint fall back
 * to host:port identity — and so does an explicit re-pair at the same address
 * with a rotated cert, which must upsert in place rather than duplicate.
 */
function sameBackend(
  a: Pick<StoredConnection, 'host' | 'port' | 'fingerprint'>,
  b: Pick<StoredConnection, 'host' | 'port' | 'fingerprint'>,
): boolean {
  const fa = fingerprintKey(a.fingerprint);
  const fb = fingerprintKey(b.fingerprint);
  if (fa !== null && fb !== null && fa === fb) return true;
  return sameTarget(a, b);
}

/**
 * Strict identity for TOMBSTONE matching (fingerprint-keyed forget contract):
 * when both sides carry a fingerprint, only fingerprint equality matches —
 * different fingerprints are different machines even at the same host:port,
 * so a tombstone for an old certificate at a reused address must never
 * delete (or be cleared by) the new backend living there. The host:port
 * fallback applies only when either side lacks a usable fingerprint.
 */
function tombstoneMatches(
  a: Pick<StoredConnection, 'host' | 'port' | 'fingerprint'>,
  b: Pick<StoredConnection, 'host' | 'port' | 'fingerprint'>,
): boolean {
  const fa = fingerprintKey(a.fingerprint);
  const fb = fingerprintKey(b.fingerprint);
  if (fa !== null && fb !== null) return fa === fb;
  return sameTarget(a, b);
}

/** Drop tombstones for the same backend — matching the cert fingerprint, or
 * `host:port` for fingerprint-less records — so a machine that came back
 * (possibly under a new address) is never re-suppressed by its own stale
 * tombstone. */
function clearTombstone(
  state: PersistedState,
  target: Pick<StoredConnection, 'host' | 'port' | 'fingerprint'>,
): void {
  state.tombstones = state.tombstones.filter((t) => !tombstoneMatches(t, target));
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
 * Register a remote connection, deduplicating by backend identity (upsert):
 * the cert fingerprint is canonical (a matching fingerprint is the same
 * machine even under a different host:port), with normalized `host:port` as
 * the fallback for fingerprint-less records. If any stored connections match
 * — earlier app versions allowed repeated `host:port` entries — they are
 * collapsed into ONE surviving record: the ACTIVE duplicate when one is
 * active (so the caller's active-reconnect path keys off the right id), else
 * the first. The survivor's `host`/`port`/`hosts`, `fingerprint`, `encToken`,
 * and `label` are replaced in place (it keeps its `id` and captured
 * `hostname`, inheriting a hostname from a dropped duplicate if it has none),
 * the other duplicates are dropped, and the survivor is returned; otherwise a
 * new record is appended. The survivor's `syncExcluded` flag follows the
 * incoming add only when the flag is EXPLICIT — a re-add with a boolean is the
 * sanctioned way to flip a backend's exclusion (`false` = clear it, `true` =
 * set it), while an `undefined` flag preserves the survivor's current state so
 * flag-less upsert paths (e.g. the self-entry refresh) can never silently
 * revert a user's per-backend opt-out. The plaintext token is encrypted (or
 * marked plaintext) before it hits disk. Returns the token-free record.
 */
export async function add(conn: NewConnection): Promise<ConnectionRecord> {
  const accent = conn.accent === undefined ? DEFAULT_CONNECTION_ACCENT : conn.accent;
  if (!isConnectionAccent(accent)) throw new Error('Invalid connection accent');
  const encToken = encryptToken(conn.token);
  const stored = await mutate(async (state) => {
    // Identity matching: fingerprint first (canonical machine identity, so a
    // re-pair after an IP/port change upserts instead of duplicating), then
    // normalized host:port (trim + lowercase, see sameTarget) — keychain-sync
    // keys accounts the same way.
    const duplicates = state.connections.filter((c) => sameBackend(c, conn));
    // An explicit (re-)add must outrank the tombstone it supersedes even
    // under clock skew: a tombstone written by a machine whose clock is ahead
    // would otherwise re-delete this record on the next reconcile (its
    // keychain copy keeps the future clock; newer/tie favors the delete).
    // Read the matching tombstone's clock before dropping it and stamp the
    // upsert strictly past it.
    const supersededTombstone = state.tombstones.find((t) => tombstoneMatches(t, conn));
    const stamp = Math.max(Date.now(), (supersededTombstone?.updatedAt ?? 0) + 1);
    clearTombstone(state, conn);
    if (duplicates.length > 0) {
      const survivor = duplicates.find((c) => c.id === state.activeId) ?? duplicates[0];
      survivor.label = conn.label;
      survivor.accent = accent;
      survivor.host = conn.host;
      survivor.port = conn.port;
      // Extras keyed to the old primary may be stale after a host change;
      // keep them minus the new primary — detectHosts refreshes them later.
      survivor.hosts = (survivor.hosts ?? []).filter((h) => h.trim() !== conn.host.trim());
      survivor.fingerprint = conn.fingerprint;
      survivor.encToken = encToken;
      // Re-pair carries fresh pairing-URI facts: a tc= param overwrites, but
      // an absent one keeps the known address (older daemons/QRs omit it).
      if (conn.tcAddress !== undefined) survivor.tcAddress = conn.tcAddress;
      survivor.detectHosts = conn.detectHosts ?? true;
      survivor.syncExcluded = conn.syncExcluded ?? survivor.syncExcluded ?? false;
      survivor.hostname ??= duplicates.find((c) => c.hostname != null)?.hostname ?? null;
      survivor.updatedAt = stamp;
      state.connections = state.connections.filter(
        (c) => c === survivor || !duplicates.includes(c),
      );
      await writeState(state);
      return survivor;
    }
    const record: StoredConnection = {
      id: randomUUID(),
      label: conn.label,
      accent,
      host: conn.host,
      port: conn.port,
      fingerprint: conn.fingerprint,
      tcAddress: conn.tcAddress,
      detectHosts: conn.detectHosts ?? true,
      syncExcluded: conn.syncExcluded ?? false,
      encToken,
      updatedAt: stamp,
    };
    state.connections.push(record);
    await writeState(state);
    return record;
  });
  notifyMutated();
  return toRecord(stored);
}

/**
 * Update the user-editable metadata for a saved remote. The bearer token and
 * transport identity fields are deliberately untouched. Local and unknown ids
 * reject so callers cannot edit the synthetic sidecar or silently lose work.
 */
export async function updateMetadata(
  id: string,
  metadata: {
    label: string;
    accent: ConnectionAccent;
    host?: string;
    port?: number;
    fingerprint?: string;
  },
): Promise<ConnectionRecord> {
  if (id === LOCAL_CONNECTION_ID) throw new Error('Cannot update the local connection');
  const label = metadata.label.trim();
  if (!label) throw new Error('Connection label is required');
  if (!isConnectionAccent(metadata.accent)) throw new Error('Invalid connection accent');
  const host = metadata.host?.trim();
  if (metadata.host !== undefined && !host) throw new Error('Connection host is required');
  if (
    metadata.port !== undefined &&
    (!Number.isInteger(metadata.port) || metadata.port < 1 || metadata.port > 65_535)
  ) {
    throw new Error('Invalid connection port');
  }
  const fingerprint = metadata.fingerprint?.trim();
  if (metadata.fingerprint !== undefined && !fingerprint) {
    throw new Error('Connection fingerprint is required');
  }

  const result = await mutate(async (state) => {
    const conn = state.connections.find((candidate) => candidate.id === id);
    if (!conn) throw new Error(`Unknown connection id: ${id}`);
    const nextHost = host ?? conn.host;
    const nextPort = metadata.port ?? conn.port;
    const nextFingerprint = fingerprint ?? conn.fingerprint;
    const addressChanged = conn.host !== nextHost || conn.port !== nextPort;
    const fingerprintChanged = fingerprintKey(conn.fingerprint) !== fingerprintKey(nextFingerprint);
    const identityChanged = addressChanged || fingerprintChanged;
    const nextIdentity = { host: nextHost, port: nextPort, fingerprint: nextFingerprint };
    const duplicates = state.connections.filter(
      (candidate) => candidate !== conn && sameBackend(candidate, nextIdentity),
    );
    const matchingTombstone = state.tombstones.find((tombstone) =>
      tombstoneMatches(tombstone, nextIdentity),
    );
    if (
      conn.label === label &&
      conn.accent === metadata.accent &&
      !addressChanged &&
      !fingerprintChanged &&
      duplicates.length === 0 &&
      !matchingTombstone
    ) {
      return { conn, changed: false };
    }
    const previous = { ...conn, hosts: conn.hosts ? [...conn.hosts] : undefined };
    // An identity change clears the captured hostname below. When the
    // submitted label was itself auto-captured (equal to the previous address
    // or the hostname being cleared — see setHostname), reset it to the NEW
    // address default: that keeps it recognizably uncustomized so the next
    // connect's capture migrates it to the (possibly different) machine's
    // pretty name, instead of freezing the stale name as if user-given.
    const labelAutoCaptured =
      label === `${conn.host.trim()}:${conn.port}` ||
      (conn.hostname != null && label === conn.hostname.trim());
    conn.label = identityChanged && labelAutoCaptured ? `${nextHost}:${nextPort}` : label;
    conn.accent = metadata.accent;
    conn.host = nextHost;
    conn.port = nextPort;
    conn.fingerprint = nextFingerprint;
    if (addressChanged) conn.hosts = [];
    if (addressChanged || fingerprintChanged) conn.hostname = null;
    const now = Math.max(
      Date.now(),
      ...duplicates.map((candidate) => (candidate.updatedAt ?? 0) + 1),
      matchingTombstone ? matchingTombstone.updatedAt + 1 : 0,
    );
    conn.updatedAt = now;
    if (identityChanged || matchingTombstone) clearTombstone(state, nextIdentity);
    if (duplicates.some((candidate) => candidate.id === state.activeId)) state.activeId = conn.id;
    state.connections = state.connections.filter(
      (candidate) => candidate === conn || !duplicates.includes(candidate),
    );
    if (addressChanged && fingerprintChanged) {
      clearTombstone(state, previous);
      state.tombstones.push({
        label: previous.label,
        accent: previous.accent === undefined ? DEFAULT_CONNECTION_ACCENT : previous.accent,
        host: previous.host,
        port: previous.port,
        fingerprint: previous.fingerprint,
        hostname: previous.hostname ?? null,
        hosts: previous.hosts,
        detectHosts: previous.detectHosts,
        updatedAt: now,
        deletedAt: now,
        excluded: previous.syncExcluded === true,
      });
    }
    await writeState(state);
    return { conn, changed: true };
  });
  if (result.changed) notifyMutated();
  return toRecord(result.conn);
}

/** Atomically replace a remote's encrypted secret after main-process validation. */
export async function replaceSecret(
  id: string,
  token: string,
  fingerprint: string,
): Promise<ConnectionRecord> {
  if (id === LOCAL_CONNECTION_ID) throw new Error('Cannot update the local connection');
  if (!token) throw new Error('Connection token is required');
  const normalizedFingerprint = fingerprint.trim();
  if (!normalizedFingerprint) throw new Error('Connection fingerprint is required');
  const result = await mutate(async (state) => {
    const conn = state.connections.find((candidate) => candidate.id === id);
    if (!conn) throw new Error(`Unknown connection id: ${id}`);
    conn.encToken = encryptToken(token);
    if (fingerprintKey(conn.fingerprint) !== fingerprintKey(normalizedFingerprint)) {
      conn.fingerprint = normalizedFingerprint;
      // The cert changed, so the captured hostname may describe a different
      // machine. A label auto-captured from it (see setHostname) resets to
      // the address default so it stays recognizably uncustomized and the
      // next connect re-captures the pretty name.
      if (conn.hostname != null && conn.label.trim() === conn.hostname.trim()) {
        conn.label = `${conn.host.trim()}:${conn.port}`;
      }
      conn.hostname = null;
    }
    conn.updatedAt = Date.now();
    await writeState(state);
    return conn;
  });
  notifyMutated();
  return toRecord(result);
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
 *
 * The user-editable `label` follows the capture while it is UNCUSTOMIZED —
 * equal (trimmed) to the record's `host:port` address (the add-form default),
 * equal to the previously captured hostname (a label that only ever followed
 * captures), or blank (a whitespace-only label slips past the add schema's
 * `.min(1)` and would otherwise stay blank forever). That migrates
 * address-named records to the pretty name on the next (re)connect and
 * follows backend machine renames, while a label the user typed themselves
 * is never touched. Corollary: editing the label back to exactly the address
 * (or the current hostname) makes it uncustomized again, so the next capture
 * overwrites it — accepted by design.
 *
 * Unlike the observational {@link setDaemonVersion}, both fields written here
 * are part of the keychain-sync surface, and a label change in particular is
 * a real user-visible edit — so any change bumps the LWW clock (`updatedAt`)
 * and notifies sync, exactly as before. The unchanged common every-connect
 * case still skips the write so a stale record cannot win over a newer
 * remote edit. The stamp is forced strictly past the record's current clock
 * (the store's usual `Math.max(now, previous + 1)` guard): the first capture
 * routinely lands in the same millisecond as `add`, and reconciliation treats
 * equal live clocks as in-sync — an un-bumped stamp would keep the migrated
 * label from propagating to a device still holding the address label.
 * Trade-off: because the migration is an AUTOMATIC write that bumps the
 * clock, it can out-clock a manual rename made on another machine shortly
 * before but not yet synced — that rename then loses the LWW reconcile. A
 * one-shot-per-rename window, accepted by the spec decision that label
 * migrations are real syncable edits.
 */
export async function setHostname(id: string, hostname: string): Promise<void> {
  const trimmed = hostname.trim();
  if (!trimmed) return;
  const changed = await mutate(async (state) => {
    const conn = state.connections.find((c) => c.id === id);
    if (!conn) return false; // unknown id: nothing to label
    const label = conn.label.trim();
    const uncustomized =
      label === '' ||
      label === `${conn.host.trim()}:${conn.port}` ||
      (conn.hostname != null && label === conn.hostname.trim());
    const nextLabel = uncustomized ? trimmed : conn.label;
    // Unchanged hostname AND label (the common every-connect case): skip the
    // write so the LWW clock is not artificially bumped, which would let this
    // stale record win over a newer remote edit in keychain sync.
    if (conn.hostname === trimmed && nextLabel === conn.label) return false;
    conn.hostname = trimmed;
    conn.label = nextLabel;
    conn.updatedAt = Math.max(Date.now(), (conn.updatedAt ?? 0) + 1);
    await writeState(state);
    return true;
  });
  if (changed) notifyMutated();
}

/**
 * Persist the remote daemon's reported version for a connection (from its
 * `client.hello` `server.version`). Returns `true` when the stored value
 * actually changed so the caller can broadcast the refreshed list. A no-op
 * for an unknown id and for empty/whitespace versions (fail-soft: the version
 * is an observational display nicety, never a hard requirement). Unlike
 * {@link setHostname}, this is per-machine observational state: it never
 * bumps the LWW clock (`updatedAt`) and never notifies keychain sync — each
 * machine captures the version from its own connection, and a re-stamp would
 * let a stale record win over a newer remote edit.
 */
export async function setDaemonVersion(id: string, version: string): Promise<boolean> {
  const trimmed = version.trim();
  if (!trimmed) return false;
  return mutate(async (state) => {
    const conn = state.connections.find((c) => c.id === id);
    if (!conn) return false; // unknown id: nothing to update
    // Unchanged version (the common every-reconnect case): skip the write.
    if (conn.daemonVersion === trimmed) return false;
    conn.daemonVersion = trimmed;
    await writeState(state);
    return true;
  });
}

/**
 * Persist whether the remote daemon reports self-update support
 * (`updateSupported` from its `system.status`). `null` clears the flag back
 * to "unknown" — used when a successful `system.status` lacks the field (the
 * daemon was replaced/downgraded to one too old to report it), so a stale
 * `true` never survives a conclusive flagless response. Returns `true` when
 * the stored value actually changed so the caller can broadcast the refreshed
 * list. A no-op for an unknown id (fail-soft: the flag only gates a UI
 * affordance, never a hard requirement). Like {@link setDaemonVersion}, this
 * is per-machine observational state: it never bumps the LWW clock
 * (`updatedAt`) and never notifies keychain sync.
 */
export async function setUpdateSupported(id: string, supported: boolean | null): Promise<boolean> {
  return mutate(async (state) => {
    const conn = state.connections.find((c) => c.id === id);
    if (!conn) return false; // unknown id: nothing to update
    // Unchanged flag (the common every-reconnect case): skip the write.
    // Absent and null both mean "unknown" — normalize before comparing.
    if ((conn.updateSupported ?? null) === supported) return false;
    conn.updateSupported = supported;
    await writeState(state);
    return true;
  });
}

/**
 * Persist the remote daemon's tailcat tunnel endpoint (`tcAddress` from its
 * `system.status` or `server.pairingInfo`, PROTOCOL §12.3). `null` clears the
 * address back to "no tunnel" — used when a successful response lacks the
 * field, so a stale address never survives a conclusive tunnel-less response.
 * Returns `true` when the stored value actually changed so the caller can
 * broadcast the refreshed list. A no-op for an unknown id (fail-soft: the
 * tunnel is one extra connect candidate, never a hard requirement).
 *
 * Unlike the observational {@link setDaemonVersion}, the tc address is part
 * of the keychain-sync surface (see the `tcAddress` field doc): a change
 * bumps the LWW clock and notifies sync so tunnel rotation propagates to the
 * user's other devices. Like {@link setHostname}, the unchanged common
 * every-reconnect case skips the write (no artificial clock bump), and the
 * stamp is forced strictly past the record's current clock so a capture
 * landing in the same millisecond as `add` still out-clocks it.
 */
export async function setTcAddress(id: string, tcAddress: string | null): Promise<boolean> {
  const normalized = tcAddress?.trim() || null;
  const changed = await mutate(async (state) => {
    const conn = state.connections.find((c) => c.id === id);
    if (!conn) return false; // unknown id: nothing to update
    // Unchanged address (the common every-reconnect case): skip the write.
    // Absent and null both mean "no tunnel" — normalize before comparing.
    if ((conn.tcAddress ?? null) === normalized) return false;
    conn.tcAddress = normalized;
    conn.updatedAt = Math.max(Date.now(), (conn.updatedAt ?? 0) + 1);
    await writeState(state);
    return true;
  });
  if (changed) notifyMutated();
  return changed;
}

/**
 * Forget a remote connection. Rejects the reserved `local` id. If the
 * forgotten connection was active, the active selection falls back to `local`.
 * Writes a tombstone for the removed backend so keychain sync propagates the
 * deletion to other machines (replacing any older tombstone for the same
 * host:port). A sync-excluded record yields an `excluded` tombstone — kept
 * for local dedupe/re-add bookkeeping but never listed to sync, so forgetting
 * a local-only backend can never touch the keychain.
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
      clearTombstone(state, removed);
      state.tombstones.push({
        label: removed.label,
        accent: removed.accent === undefined ? DEFAULT_CONNECTION_ACCENT : removed.accent,
        host: removed.host,
        port: removed.port,
        fingerprint: removed.fingerprint,
        hostname: removed.hostname ?? null,
        hosts: removed.hosts,
        detectHosts: removed.detectHosts,
        updatedAt: now,
        deletedAt: now,
        excluded: removed.syncExcluded === true,
      });
    }
    await writeState(state);
    return removed !== undefined;
  });
  if (changed) notifyMutated();
}

/**
 * The legacy persisted `activeId`; defaults to `local`. Open-only: not a
 * routing concept — read primarily as a boot-time default, plus a couple of
 * legacy compat reads (see the file header).
 */
export async function getActiveId(): Promise<string> {
  const state = await readState();
  return state.activeId;
}

/**
 * Set the legacy persisted `activeId`. `local` is always valid; any other id
 * must match a persisted connection, else this rejects.
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
 * likewise never part of the sync payload. Sync-excluded records and their
 * `excluded` tombstones (spec Phase 2, per-backend exclusion) are omitted
 * too — a local-only backend is invisible to sync in both directions.
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
    if (conn.syncExcluded === true) continue;
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
      accent: conn.accent === undefined ? DEFAULT_CONNECTION_ACCENT : conn.accent,
      host: conn.host,
      hosts: candidateHosts(conn),
      port: conn.port,
      fingerprint: conn.fingerprint,
      hostname: conn.hostname ?? null,
      tcAddress: conn.tcAddress ?? null,
      detectHosts: conn.detectHosts !== false,
      token,
      updatedAt: conn.updatedAt ?? 0,
    });
  }
  for (const t of state.tombstones) {
    if (t.deletedAt + TOMBSTONE_TTL_MS <= now) continue;
    if (t.excluded === true) continue;
    records.push({
      label: t.label,
      accent: t.accent === undefined ? DEFAULT_CONNECTION_ACCENT : t.accent,
      host: t.host,
      hosts: candidateHosts(t),
      port: t.port,
      fingerprint: t.fingerprint,
      hostname: t.hostname ?? null,
      tcAddress: null,
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
 * reconcile). A live record upserts by backend identity — cert fingerprint
 * canonical, normalized host:port as the fingerprint-less fallback — so a
 * record arriving under a new address collapses into the machine's existing
 * entry instead of duplicating it. The existing record keeps its `id` (so
 * open windows/pool entries stay attached) while host/port/
 * label/fingerprint/token/hosts/hostname/tcAddress/detectHosts and the
 * remote's `updatedAt` clock are taken verbatim (NOT re-stamped: the clock
 * must converge across machines). A tombstone removes the backend (matched by the
 * same identity, so a delete written under an old address still lands) and
 * remembers the tombstone; if the removed backend was active, the selection
 * falls back to `local` (never touching any other machine-local selection
 * state).
 *
 * Sync-excluded records are invisible AND inviolable (spec Phase 2): a remote
 * record or tombstone matching ONLY excluded records — by fingerprint, or
 * host:port for fingerprint-less records — is a pure no-op: it never
 * overwrites or deletes the local-only record and never inserts a synced
 * duplicate of the same backend alongside it. EXCLUDED tombstones shield the
 * same way: forgetting an opted-out backend never reaches the keychain, so
 * its stale synced copy arrives as an unpaired live pull — re-creating the
 * backend from it would silently undo the forget. The shields ignore the
 * remote LWW clock (exclusion is a consent boundary, not a clock race);
 * non-excluded tombstones keep the reconcile layer's normal LWW semantics.
 *
 * Deliberately does NOT fire {@link onConnectionsMutated} — pulls must not
 * loop back into pushes. Returns whether anything actually changed so the
 * lifecycle can refresh the renderer only when needed.
 */
export async function applyRemoteSyncRecord(record: KeychainSyncRecord): Promise<boolean> {
  return mutate(async (state) => {
    if (record.deleted === true) {
      // Match by STRICT backend identity (fingerprint canonical, host:port
      // fallback only for fingerprint-less records) so a tombstone written
      // under an old address still deletes the record now living under a new
      // one — but a tombstone for an old certificate at a reused address
      // never deletes the different machine now living there. A tombstone
      // matching only sync-excluded records is a pure no-op (nothing deleted,
      // no tombstone remembered): the local-only backend outlives its
      // forgotten synced twin.
      const matched = state.connections.filter((c) => tombstoneMatches(c, record));
      const existing = matched.filter((c) => c.syncExcluded !== true);
      if (matched.length > 0 && existing.length === 0) return false;
      state.connections = state.connections.filter((c) => !existing.includes(c));
      if (existing.some((c) => c.id === state.activeId)) {
        state.activeId = LOCAL_CONNECTION_ID;
      }
      clearTombstone(state, record);
      state.tombstones.push({
        label: record.label,
        accent: record.accent === undefined ? DEFAULT_CONNECTION_ACCENT : record.accent,
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

    // A live remote copy of a backend held here as sync-excluded must
    // neither overwrite the local-only record nor insert a duplicate next to
    // it: when every identity match is excluded, drop the pull entirely.
    const matches = state.connections.filter((c) => sameBackend(c, record));
    const duplicates = matches.filter((c) => c.syncExcluded !== true);
    if (matches.length > 0 && duplicates.length === 0) return false;
    // An EXCLUDED tombstone shields the same way: it means the user forgot a
    // backend they had opted out of sync, and (being local-only) that forget
    // never reached the keychain — so the stale synced copy arrives as an
    // unpaired pull. Re-creating the backend from it would silently undo the
    // forget. The shield ignores the remote's LWW clock: exclusion is a
    // consent boundary, not a clock race (same as the live-record shield
    // above). Non-excluded tombstones stay with the reconcile layer's LWW.
    if (
      duplicates.length === 0 &&
      state.tombstones.some((t) => t.excluded === true && tombstoneMatches(t, record))
    ) {
      return false;
    }
    clearTombstone(state, record);
    const encToken = encryptToken(record.token);
    const extras = record.hosts.filter((h) => h.trim() !== record.host.trim());
    if (duplicates.length > 0) {
      const survivor = duplicates.find((c) => c.id === state.activeId) ?? duplicates[0];
      survivor.label = record.label;
      survivor.accent = record.accent === undefined ? DEFAULT_CONNECTION_ACCENT : record.accent;
      survivor.host = record.host;
      survivor.port = record.port;
      survivor.fingerprint = record.fingerprint;
      survivor.encToken = encToken;
      survivor.hostname = record.hostname;
      survivor.hosts = extras;
      survivor.tcAddress = record.tcAddress;
      survivor.detectHosts = record.detectHosts;
      survivor.updatedAt = record.updatedAt;
      state.connections = state.connections.filter(
        (c) => c === survivor || !duplicates.includes(c),
      );
    } else {
      state.connections.push({
        id: randomUUID(),
        label: record.label,
        accent: record.accent === undefined ? DEFAULT_CONNECTION_ACCENT : record.accent,
        host: record.host,
        port: record.port,
        fingerprint: record.fingerprint,
        hostname: record.hostname,
        hosts: extras,
        tcAddress: record.tcAddress,
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
