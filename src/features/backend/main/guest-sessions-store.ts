/**
 * Guest sessions registry (main process).
 *
 * Persists the daemons this app joined as a GUEST — a credential minted by
 * `invite.redeem` for the user's own principal — to `guest-sessions.json`
 * under `app.getPath('userData')`, deliberately separate from the paired
 * (owner) registry in `backend-connections.json`: a guest credential must
 * never be listed, forgotten, or keychain-synced as an owner backend, and
 * the two files evolve independently.
 *
 * Each record carries the daemon's dial envelope (hosts, port, pinned cert
 * fingerprint, optional tc address), a display label, and the principal
 * identity the credential belongs to. The bearer token is encrypted at rest
 * with Electron's `safeStorage` when available; otherwise it is stored in
 * plaintext with an explicit `encrypted: false` marker that the token-free
 * record exposes as `tokenEncrypted: false` so callers can surface it. A
 * record that already holds ciphertext is never downgraded: a re-join or a
 * remote sync arriving while encryption is unavailable fails closed
 * ({@link GuestEncryptionUnavailableError}) and leaves the record as is.
 *
 * Identity: one session per daemon, the cert fingerprint being canonical
 * (a re-join after an address change upserts in place) with normalized
 * `host:port` as the fingerprint-less fallback. A second invite redeemed on
 * the same daemon replaces the credential — the daemon upserts the principal
 * and mints a fresh token, so the newest one is the valid one — and
 * {@link onGuestCredentialReplaced} tells the connection pool to drop the
 * client built on the superseded credential.
 *
 * Keychain sync: {@link listSyncRecords} / {@link applyRemoteSyncRecord}
 * back a `LocalSyncAdapter` reconciled against the
 * `com.cloudlands.intent.guest-sessions` service (keychain-sync.ts), with
 * the same tombstone model as the owner registry — per service, so guest
 * tombstones never touch owner records.
 *
 * Durability: writes are serialized behind a promise chain and each one
 * lands as a temp file renamed over the registry, so a concurrent reader
 * sees either the old or the new file, never a truncated or torn one. A
 * registry that fails to parse, or that is not exactly the persisted shape
 * (any row failing validation), is treated as corrupt: reads report only the
 * rows that validate (none for an unparseable file), but every mutation fails
 * closed ({@link GuestStoreCorruptError}) instead of overwriting the file the
 * user may still recover.
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { app, safeStorage } from 'electron';
import { Logger } from '../../../shared/logger';
import { isLoopbackHost } from '../../../shared/loopback-host';
import type { GuestSessionRecord, GuestWorkspaceRef } from '../../../shared/types/guest-sessions';
import { normalizeFingerprint } from './backend-connection';
import { TOMBSTONE_TTL_MS, accountKeyFor, type KeychainSyncRecord } from './keychain-sync';

const logger = new Logger('GuestSessionsStore');

/** File name inside `app.getPath('userData')`. */
const FILE_NAME = 'guest-sessions.json';

interface EncryptedToken {
  encrypted: boolean;
  value: string;
}

/** A guest session as persisted on disk (token included). */
interface StoredGuestSession {
  id: string;
  label: string;
  host: string;
  /** Additional candidate hosts (never contains `host`). */
  hosts?: string[];
  port: number;
  fingerprint: string;
  tcAddress?: string | null;
  hostname?: string | null;
  principalId: string;
  login: string;
  encToken: EncryptedToken;
  /**
   * Workspaces joined on this daemon (join order). Local only — the keychain
   * sync record does not carry it. Absent on rows written before it existed.
   */
  workspaces?: GuestWorkspaceRef[];
  updatedAt: number;
}

/** A forgotten guest session kept so keychain sync propagates the delete. */
interface StoredGuestTombstone {
  label: string;
  host: string;
  hosts?: string[];
  port: number;
  fingerprint: string;
  hostname?: string | null;
  principalId?: string;
  login?: string;
  updatedAt: number;
  deletedAt: number;
}

/** Fields required to register (or refresh) a guest session. */
export interface NewGuestSession {
  label: string;
  host: string;
  /** Extra candidate hosts from the invite envelope; the primary is implied. */
  hosts?: string[];
  port: number;
  fingerprint: string;
  tcAddress?: string | null;
  principalId: string;
  login: string;
  token: string;
  /** The workspace the invite admitted to; merged into the record's list by id. */
  workspace?: GuestWorkspaceRef;
}

interface PersistedState {
  sessions: StoredGuestSession[];
  tombstones: StoredGuestTombstone[];
}

/** The registry file exists but cannot be read as a guest-sessions registry. */
export class GuestStoreCorruptError extends Error {
  readonly code = 'guest-store-corrupt';

  constructor() {
    // i18n-ignore (internal error)
    super('Guest sessions registry is unreadable');
    this.name = 'GuestStoreCorruptError';
  }
}

/** Encryption is unavailable and the write would downgrade stored ciphertext to plaintext. */
export class GuestEncryptionUnavailableError extends Error {
  readonly code = 'guest-encryption-unavailable';

  constructor() {
    // i18n-ignore (internal error)
    super('Guest session encryption unavailable');
    this.name = 'GuestEncryptionUnavailableError';
  }
}

let writeChain: Promise<void> = Promise.resolve();

function filePath(): string {
  return path.join(app.getPath('userData'), FILE_NAME);
}

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

/** Primary host first, then extras; loopback entries dropped unless nothing else remains. */
function candidateHosts(stored: Pick<StoredGuestSession, 'host' | 'hosts'>): string[] {
  const routable = dedupeHosts(
    [stored.host, ...(stored.hosts ?? [])].filter((h) => !isLoopbackHost(h)),
  );
  return routable.length > 0 ? routable : dedupeHosts([stored.host]);
}

function toRecord(stored: StoredGuestSession): GuestSessionRecord {
  return {
    id: stored.id,
    label: stored.label,
    host: stored.host,
    hosts: candidateHosts(stored),
    port: stored.port,
    fingerprint: stored.fingerprint,
    tcAddress: stored.tcAddress ?? null,
    hostname: stored.hostname ?? null,
    principalId: stored.principalId,
    login: stored.login,
    tokenEncrypted: stored.encToken.encrypted,
    workspaces: (stored.workspaces ?? []).map((w) => ({ id: w.id, title: w.title })),
    updatedAt: stored.updatedAt,
  };
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((h) => typeof h === 'string');
}

function isWorkspaceRefArray(value: unknown): value is GuestWorkspaceRef[] {
  return (
    Array.isArray(value) &&
    value.every(
      (w) =>
        !!w &&
        typeof w === 'object' &&
        typeof (w as Record<string, unknown>).id === 'string' &&
        typeof (w as Record<string, unknown>).title === 'string',
    )
  );
}

/** Append or retitle one workspace entry (by id), returning the new list. */
function mergeWorkspace(
  current: GuestWorkspaceRef[] | undefined,
  workspace: GuestWorkspaceRef | undefined,
): GuestWorkspaceRef[] {
  const list = [...(current ?? [])];
  if (!workspace) return list;
  const existing = list.find((w) => w.id === workspace.id);
  if (existing) existing.title = workspace.title;
  else list.push({ id: workspace.id, title: workspace.title });
  return list;
}

function isOptionalNullableString(value: unknown): boolean {
  return value === undefined || value === null || typeof value === 'string';
}

function isStoredGuestSession(value: unknown): value is StoredGuestSession {
  if (!value || typeof value !== 'object') return false;
  const c = value as Record<string, unknown>;
  const tok = c.encToken as Record<string, unknown> | undefined;
  return (
    typeof c.id === 'string' &&
    typeof c.label === 'string' &&
    typeof c.host === 'string' &&
    (c.hosts === undefined || isStringArray(c.hosts)) &&
    typeof c.port === 'number' &&
    typeof c.fingerprint === 'string' &&
    isOptionalNullableString(c.tcAddress) &&
    isOptionalNullableString(c.hostname) &&
    typeof c.principalId === 'string' &&
    typeof c.login === 'string' &&
    (c.workspaces === undefined || isWorkspaceRefArray(c.workspaces)) &&
    typeof c.updatedAt === 'number' &&
    !!tok &&
    typeof tok === 'object' &&
    typeof tok.encrypted === 'boolean' &&
    typeof tok.value === 'string'
  );
}

function isStoredGuestTombstone(value: unknown): value is StoredGuestTombstone {
  if (!value || typeof value !== 'object') return false;
  const t = value as Record<string, unknown>;
  return (
    typeof t.label === 'string' &&
    typeof t.host === 'string' &&
    (t.hosts === undefined || isStringArray(t.hosts)) &&
    typeof t.port === 'number' &&
    typeof t.fingerprint === 'string' &&
    isOptionalNullableString(t.hostname) &&
    (t.principalId === undefined || typeof t.principalId === 'string') &&
    (t.login === undefined || typeof t.login === 'string') &&
    typeof t.updatedAt === 'number' &&
    typeof t.deletedAt === 'number'
  );
}

/**
 * The registry as loaded from disk. `intact` is false when the file is not
 * exactly the persisted shape — wrong top-level fields or any row that fails
 * validation — in which case `state` is the lossy view of the rows that did
 * validate: fine for reading, never a basis for writing the file back.
 */
interface LoadedState {
  state: PersistedState;
  intact: boolean;
}

/**
 * Load the registry. A missing file is the empty registry; a file that
 * exists but cannot be read or parsed as one is `null` (corrupt) — logged
 * with a bounded reason only, never the file contents.
 */
async function loadState(): Promise<LoadedState | null> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath(), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { state: { sessions: [], tombstones: [] }, intact: true };
    }
    logger.warn('Failed to read guest-sessions', {
      reason: 'io',
      code: (error as NodeJS.ErrnoException).code ?? null,
    });
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    logger.warn('Failed to read guest-sessions', { reason: 'parse' });
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    logger.warn('Failed to read guest-sessions', { reason: 'shape' });
    return null;
  }
  const obj = parsed as Record<string, unknown>;
  const rawSessions: unknown[] = Array.isArray(obj.sessions) ? obj.sessions : [];
  const rawTombstones: unknown[] = Array.isArray(obj.tombstones) ? obj.tombstones : [];
  const sessions = rawSessions.filter(isStoredGuestSession);
  const tombstones = rawTombstones.filter(isStoredGuestTombstone);
  const intact =
    Array.isArray(obj.sessions) &&
    Array.isArray(obj.tombstones) &&
    sessions.length === rawSessions.length &&
    tombstones.length === rawTombstones.length;
  if (!intact) {
    logger.warn('Guest-sessions registry has malformed entries; mutations disabled', {
      reason: 'shape',
      droppedSessions: rawSessions.length - sessions.length,
      droppedTombstones: rawTombstones.length - tombstones.length,
    });
  }
  return { state: { sessions, tombstones }, intact };
}

/**
 * Read-only view: a corrupt registry reads as empty and a registry with
 * malformed rows reads as the rows that validate (mutations refuse both,
 * see {@link mutate}).
 */
async function readState(): Promise<PersistedState> {
  return (await loadState())?.state ?? { sessions: [], tombstones: [] };
}

/**
 * Persist atomically: write a sibling temp file, then rename it over the
 * registry, so a reader racing the write never observes a truncated file.
 */
async function writeState(next: PersistedState): Promise<void> {
  const target = filePath();
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temp = `${target}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temp, JSON.stringify(next, null, 2), 'utf8');
    await fs.rename(temp, target);
  } catch (error) {
    await fs.rm(temp, { force: true }).catch(() => {});
    throw error;
  }
}

/**
 * Serialize a read-modify-write against the store behind the write chain.
 * Refuses to run against a corrupt registry: overwriting it would destroy
 * whatever the user could still recover from the file.
 */
function mutate<T>(fn: (state: PersistedState) => T | Promise<T>): Promise<T> {
  const run = writeChain.then(async () => {
    const loaded = await loadState();
    if (loaded === null || !loaded.intact) throw new GuestStoreCorruptError();
    return fn(loaded.state);
  });
  writeChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/**
 * Encrypt a token for storage. When encryption is unavailable the token is
 * stored in plaintext (flagged), unless `previous` holds ciphertext: a
 * downgrade from encrypted to plaintext never happens silently — the write
 * fails closed and the stored record is left untouched.
 */
function encryptToken(token: string, previous?: EncryptedToken): EncryptedToken {
  if (safeStorage.isEncryptionAvailable()) {
    return { encrypted: true, value: safeStorage.encryptString(token).toString('base64') };
  }
  if (previous?.encrypted) throw new GuestEncryptionUnavailableError();
  return { encrypted: false, value: token };
}

class GuestSecretUnavailableError extends Error {
  readonly code = 'guest-secret-unavailable';

  constructor() {
    // i18n-ignore (internal error)
    super('Guest session secret unavailable');
    this.name = 'GuestSecretUnavailableError';
  }
}

function decryptToken(encToken: EncryptedToken): string {
  if (encToken.encrypted) {
    try {
      return safeStorage.decryptString(Buffer.from(encToken.value, 'base64'));
    } catch {
      throw new GuestSecretUnavailableError();
    }
  }
  return encToken.value;
}

/**
 * Listeners notified after every LOCAL mutation that persisted a change
 * (add / forget / setHostname / leaveWorkspace). Remote applications via
 * {@link applyRemoteSyncRecord} do NOT notify — a pull must not loop back
 * into a push.
 */
const mutationListeners = new Set<() => void>();

/** Subscribe to local syncable mutations; returns an unsubscribe function. */
export function onGuestSessionsMutated(listener: () => void): () => void {
  mutationListeners.add(listener);
  return () => mutationListeners.delete(listener);
}

function notifyMutated(): void {
  for (const listener of mutationListeners) {
    try {
      listener();
    } catch (error) {
      logger.warn('guest sessions mutation listener failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/**
 * Listeners notified with the session id when a re-join REPLACED an existing
 * session's credential (and possibly its principal) in place. The connection
 * pool drops the client built on the superseded credential so the next open
 * dials with the fresh one — a pooled client is never left authenticating as
 * the old principal.
 */
const credentialReplacedListeners = new Set<(id: string) => void>();

/** Subscribe to in-place credential replacements; returns an unsubscribe function. */
export function onGuestCredentialReplaced(listener: (id: string) => void): () => void {
  credentialReplacedListeners.add(listener);
  return () => credentialReplacedListeners.delete(listener);
}

function notifyCredentialReplaced(id: string): void {
  for (const listener of credentialReplacedListeners) {
    try {
      listener(id);
    } catch (error) {
      logger.warn('guest credential replacement listener failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/**
 * Listeners notified with the session id when a keychain-sync tombstone
 * ({@link applyRemoteSyncRecord}) DELETED a live session — the guest was
 * forgotten on another device. The connection pool drops the client built on
 * the now-deleted credential so it cannot keep serving a forgotten guest
 * until restart. A local {@link forget} does NOT notify: its caller owns the
 * pool/window teardown for that flow.
 */
const removedBySyncListeners = new Set<(id: string) => void>();

/** Subscribe to sync-driven session deletions; returns an unsubscribe function. */
export function onGuestSessionRemovedBySync(listener: (id: string) => void): () => void {
  removedBySyncListeners.add(listener);
  return () => removedBySyncListeners.delete(listener);
}

function notifyRemovedBySync(id: string): void {
  for (const listener of removedBySyncListeners) {
    try {
      listener(id);
    } catch (error) {
      logger.warn('guest session removal listener failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

type Identity = Pick<StoredGuestSession, 'host' | 'port' | 'fingerprint'>;

function fingerprintKey(fingerprint: string | undefined | null): string | null {
  const key = normalizeFingerprint(fingerprint ?? '');
  return key === '' ? null : key;
}

function sameTarget(a: Identity, b: Identity): boolean {
  return accountKeyFor(a.host, a.port) === accountKeyFor(b.host, b.port);
}

/** Live dedupe identity: fingerprint canonical, host:port fallback (mirrors the owner registry). */
function sameDaemon(a: Identity, b: Identity): boolean {
  const fa = fingerprintKey(a.fingerprint);
  const fb = fingerprintKey(b.fingerprint);
  if (fa !== null && fb !== null && fa === fb) return true;
  return sameTarget(a, b);
}

/** Strict tombstone identity: fingerprints decide when both sides carry one. */
function tombstoneMatches(a: Identity, b: Identity): boolean {
  const fa = fingerprintKey(a.fingerprint);
  const fb = fingerprintKey(b.fingerprint);
  if (fa !== null && fb !== null) return fa === fb;
  return sameTarget(a, b);
}

function clearTombstone(state: PersistedState, target: Identity): void {
  state.tombstones = state.tombstones.filter((t) => !tombstoneMatches(t, target));
}

// ============================================================================
// Public API
// ============================================================================

/** All guest sessions in insertion order. Tokens are never included. */
export async function list(): Promise<GuestSessionRecord[]> {
  const state = await readState();
  return state.sessions.map(toRecord);
}

/** The token-free record for a session id, or null when unknown. */
export async function findById(id: string): Promise<GuestSessionRecord | null> {
  const state = await readState();
  const found = state.sessions.find((s) => s.id === id);
  return found ? toRecord(found) : null;
}

/**
 * Find the session for a daemon identity from an invite envelope: fingerprint
 * canonical, normalized `host:port` fallback, each candidate host tried
 * against the stored primary. Returns the token-free record or null.
 */
export async function findMatching(identity: {
  hosts: string[];
  port: number;
  fingerprint: string | null;
}): Promise<GuestSessionRecord | null> {
  const state = await readState();
  const probe = { port: identity.port, fingerprint: identity.fingerprint ?? '' };
  const match = state.sessions.find((s) =>
    identity.hosts.some((host) => sameDaemon(s, { ...probe, host })),
  );
  return match ? toRecord(match) : null;
}

/**
 * Register a guest session, upserting by daemon identity: a re-join of a
 * known daemon replaces its credential, label, address, and principal
 * identity in place (the record keeps its `id`, so open windows stay
 * attached; {@link onGuestCredentialReplaced} fires so the pooled client is
 * rebuilt on the new credential) and stamps the clock strictly past any
 * superseded tombstone AND past the replaced session's own clock, so neither
 * a forget written elsewhere nor a clock-ahead record pulled from another
 * device can out-clock the fresh join in the next LWW reconcile (which would
 * hand the old remote credential the win over the freshly redeemed one).
 * The token is encrypted before it hits disk; a re-join that
 * would downgrade stored ciphertext to plaintext fails closed
 * ({@link GuestEncryptionUnavailableError}). Returns the token-free record.
 */
export async function add(input: NewGuestSession): Promise<GuestSessionRecord> {
  const extras = dedupeHosts(input.hosts ?? []).filter((h) => h !== input.host.trim());
  const { stored, replaced } = await mutate(async (state) => {
    const duplicates = state.sessions.filter((s) => sameDaemon(s, input));
    const encToken = encryptToken(input.token, duplicates[0]?.encToken);
    const superseded = state.tombstones.find((t) => tombstoneMatches(t, input));
    const stamp = Math.max(
      Date.now(),
      (superseded?.updatedAt ?? 0) + 1,
      ...duplicates.map((s) => s.updatedAt + 1),
    );
    clearTombstone(state, input);
    if (duplicates.length > 0) {
      const survivor = duplicates[0];
      survivor.label = input.label;
      survivor.host = input.host;
      survivor.hosts = extras;
      survivor.port = input.port;
      survivor.fingerprint = input.fingerprint;
      if (input.tcAddress !== undefined) survivor.tcAddress = input.tcAddress;
      survivor.principalId = input.principalId;
      survivor.login = input.login;
      survivor.encToken = encToken;
      survivor.hostname ??= duplicates.find((s) => s.hostname != null)?.hostname ?? null;
      survivor.workspaces = mergeWorkspace(
        duplicates.flatMap((s) => s.workspaces ?? []),
        input.workspace,
      );
      survivor.updatedAt = stamp;
      state.sessions = state.sessions.filter((s) => s === survivor || !duplicates.includes(s));
      await writeState(state);
      return { stored: survivor, replaced: true };
    }
    const record: StoredGuestSession = {
      id: randomUUID(),
      label: input.label,
      host: input.host,
      hosts: extras,
      port: input.port,
      fingerprint: input.fingerprint,
      tcAddress: input.tcAddress ?? null,
      hostname: null,
      principalId: input.principalId,
      login: input.login,
      encToken,
      workspaces: mergeWorkspace([], input.workspace),
      updatedAt: stamp,
    };
    state.sessions.push(record);
    await writeState(state);
    return { stored: record, replaced: false };
  });
  if (replaced) notifyCredentialReplaced(stored.id);
  notifyMutated();
  return toRecord(stored);
}

/**
 * Persist the daemon's hostname for a session (display label upgrade).
 * Returns whether anything changed. No-op for unknown ids.
 */
export async function setHostname(id: string, hostname: string): Promise<boolean> {
  const trimmed = hostname.trim();
  if (trimmed === '') return false;
  const changed = await mutate(async (state) => {
    const session = state.sessions.find((s) => s.id === id);
    if (!session || session.hostname === trimmed) return false;
    session.hostname = trimmed;
    session.updatedAt = Math.max(Date.now(), session.updatedAt + 1);
    await writeState(state);
    return true;
  });
  if (changed) notifyMutated();
  return changed;
}

/**
 * Persist the tunnel address a connected daemon currently advertises
 * (PROTOCOL §12.3) — conclusively, so `null` clears a stale invite-time
 * address the daemon no longer serves. The unchanged every-reconnect case
 * skips the write so the LWW clock stays put; a change stamps strictly past
 * the record's own clock (as `setHostname` does) so the refreshed route wins
 * reconciliation. Returns whether anything changed. No-op for unknown ids.
 */
export async function setTcAddress(id: string, tcAddress: string | null): Promise<boolean> {
  const normalized = tcAddress?.trim() || null;
  const changed = await mutate(async (state) => {
    const session = state.sessions.find((s) => s.id === id);
    if (!session || (session.tcAddress ?? null) === normalized) return false;
    session.tcAddress = normalized;
    session.updatedAt = Math.max(Date.now(), session.updatedAt + 1);
    await writeState(state);
    return true;
  });
  if (changed) notifyMutated();
  return changed;
}

/**
 * Replace the candidate-host list learned from a connected daemon (its
 * current interfaces), so reconnects and keychain sync stop dialing the
 * invite-time list. The primary `host` always stays first; only deduplicated
 * extras are persisted. An unchanged list skips the write (no artificial
 * clock bump); a change stamps strictly past the record's own clock. Returns
 * whether anything changed. No-op for unknown ids.
 */
export async function setHosts(id: string, hosts: string[]): Promise<boolean> {
  const changed = await mutate(async (state) => {
    const session = state.sessions.find((s) => s.id === id);
    if (!session) return false;
    const extras = dedupeHosts([session.host, ...hosts]).filter((h) => h !== session.host.trim());
    if (JSON.stringify(extras) === JSON.stringify(session.hosts ?? [])) return false;
    session.hosts = extras;
    session.updatedAt = Math.max(Date.now(), session.updatedAt + 1);
    await writeState(state);
    return true;
  });
  if (changed) notifyMutated();
  return changed;
}

/**
 * Drop one workspace from a session's local record (per-workspace *Leave*,
 * after the host accepted `workspace.members.leave`). The session stays,
 * even with zero workspaces, until *Leave host*. Returns whether anything
 * changed; no-op for an unknown session or workspace. Like
 * {@link setWorkspaces}, this edits only the local-only workspace cache
 * (omitted from {@link listSyncRecords}), so the record's `updatedAt` — the
 * keychain LWW clock — is left alone: advancing it would republish this
 * device's possibly stale credential as the newer copy and roll back a
 * re-join another device just made. Listeners still fire so the renderer
 * sees the new list.
 */
export async function leaveWorkspace(id: string, workspaceId: string): Promise<boolean> {
  const changed = await mutate(async (state) => {
    const session = state.sessions.find((s) => s.id === id);
    if (!session?.workspaces?.some((w) => w.id === workspaceId)) return false;
    session.workspaces = session.workspaces.filter((w) => w.id !== workspaceId);
    await writeState(state);
    return true;
  });
  if (changed) notifyMutated();
  return changed;
}

/**
 * Reconcile a session's local workspace list against the host's authoritative
 * membership-filtered `workspace.list` (read through the guest connection
 * once it is reachable). The local list is only a last-known cache: rows
 * written before the field existed and rows imported by keychain sync (which
 * never carries it) start with no workspaces at all, and a membership removed
 * on the host must not linger as a phantom row. Reconciled by id — entries
 * the host no longer lists are dropped, kept entries keep their local (join)
 * order and take the host's title, new memberships append in host order.
 * Not a syncable mutation: the record's `updatedAt` is the keychain LWW
 * clock and is left alone (a cache refresh on every reconnect must never
 * outrank another device's genuine edit), and {@link onGuestSessionsMutated}
 * does not fire — the caller broadcasts. Returns whether anything changed;
 * no-op for an unknown session. `stillValid` is consulted at the commit
 * boundary — inside the serialized mutation, after the current state has
 * been loaded — so a snapshot whose premise was invalidated by a mutation
 * queued ahead of it (a record replacement, a *Leave*) is dropped rather
 * than written over that mutation's result.
 */
export async function setWorkspaces(
  id: string,
  workspaces: readonly GuestWorkspaceRef[],
  stillValid: () => boolean = () => true,
): Promise<boolean> {
  return mutate(async (state) => {
    if (!stillValid()) return false;
    const session = state.sessions.find((s) => s.id === id);
    if (!session) return false;
    const byId = new Map(workspaces.map((w) => [w.id, w.title] as const));
    const kept = (session.workspaces ?? [])
      .filter((w) => byId.has(w.id))
      .map((w) => ({ id: w.id, title: byId.get(w.id)! }));
    const seen = new Set(kept.map((w) => w.id));
    const next = [...kept];
    for (const w of workspaces) {
      if (seen.has(w.id)) continue;
      seen.add(w.id);
      next.push({ id: w.id, title: w.title });
    }
    const current = session.workspaces ?? [];
    const unchanged =
      current.length === next.length &&
      current.every((w, i) => w.id === next[i].id && w.title === next[i].title);
    if (unchanged && session.workspaces !== undefined) return false;
    session.workspaces = next;
    await writeState(state);
    return true;
  });
}

/** Forget a guest session, leaving a tombstone so keychain sync propagates the delete. */
export async function forget(id: string): Promise<boolean> {
  const changed = await mutate(async (state) => {
    const removed = state.sessions.find((s) => s.id === id);
    if (!removed) return false;
    state.sessions = state.sessions.filter((s) => s.id !== id);
    const now = Date.now();
    clearTombstone(state, removed);
    state.tombstones.push({
      label: removed.label,
      host: removed.host,
      hosts: removed.hosts,
      port: removed.port,
      fingerprint: removed.fingerprint,
      hostname: removed.hostname ?? null,
      principalId: removed.principalId,
      login: removed.login,
      updatedAt: now,
      deletedAt: now,
    });
    await writeState(state);
    return true;
  });
  if (changed) notifyMutated();
  return changed;
}

/**
 * Decrypt and return the bearer token for a guest session; null for unknown
 * ids. Throws when the ciphertext cannot be decrypted (keyring changed).
 */
export async function getDecryptedToken(id: string): Promise<string | null> {
  const state = await readState();
  const session = state.sessions.find((s) => s.id === id);
  if (!session) return null;
  return decryptToken(session.encToken);
}

// ============================================================================
// Keychain sync adapter (guest-sessions service)
// ============================================================================

/**
 * Snapshot of every syncable guest session plus every live tombstone, as
 * `KeychainSyncRecord`s for the guest-sessions keychain service. Expired
 * tombstones are pruned on the way out. Sessions whose token cannot be
 * decrypted are skipped (never synced as an empty credential).
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
  for (const session of state.sessions) {
    let token: string;
    try {
      token = decryptToken(session.encToken);
    } catch (error) {
      logger.warn('skipping undecryptable guest session in sync listing', {
        id: session.id,
        error: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
    records.push({
      label: session.label,
      host: session.host,
      hosts: candidateHosts(session),
      port: session.port,
      fingerprint: session.fingerprint,
      hostname: session.hostname ?? null,
      tcAddress: session.tcAddress ?? null,
      detectHosts: false,
      token,
      principalId: session.principalId,
      login: session.login,
      updatedAt: session.updatedAt,
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
      tcAddress: null,
      detectHosts: false,
      token: '',
      ...(t.principalId !== undefined ? { principalId: t.principalId } : {}),
      ...(t.login !== undefined ? { login: t.login } : {}),
      updatedAt: t.updatedAt,
      deleted: true,
      deletedAt: t.deletedAt,
    });
  }
  return records;
}

/**
 * Apply a remote-won sync record (LWW loser side of a reconcile). A live
 * record upserts by daemon identity; a tombstone deletes the matching
 * session and is remembered so it keeps propagating. Records without the
 * guest principal identity are rejected — they cannot be guest sessions.
 * A remote win that replaces a live session's credential fires
 * {@link onGuestCredentialReplaced} exactly like a local re-join, so a
 * pooled client never keeps serving the superseded credential; a tombstone
 * that deletes a live session fires {@link onGuestSessionRemovedBySync} per
 * deleted id so the pool drops that client too. Returns whether the local
 * store changed.
 */
export async function applyRemoteSyncRecord(record: KeychainSyncRecord): Promise<boolean> {
  const { changed, replacedId, removedIds } = await mutate(async (state) => {
    const extras = record.hosts.filter((h) => h.trim() !== record.host.trim());
    if (record.deleted === true) {
      const existing = state.sessions.filter((s) => tombstoneMatches(s, record));
      state.sessions = state.sessions.filter((s) => !existing.includes(s));
      clearTombstone(state, record);
      state.tombstones.push({
        label: record.label,
        host: record.host,
        hosts: extras,
        port: record.port,
        fingerprint: record.fingerprint,
        hostname: record.hostname,
        ...(record.principalId !== undefined ? { principalId: record.principalId } : {}),
        ...(record.login !== undefined ? { login: record.login } : {}),
        updatedAt: record.updatedAt,
        deletedAt: record.deletedAt ?? record.updatedAt,
      });
      await writeState(state);
      return {
        changed: existing.length > 0,
        replacedId: null,
        removedIds: existing.map((s) => s.id),
      };
    }

    if (!record.principalId || !record.login) {
      logger.warn('ignoring remote guest record without principal identity', {
        account: accountKeyFor(record.host, record.port),
      });
      return { changed: false, replacedId: null, removedIds: [] };
    }
    clearTombstone(state, record);
    const duplicates = state.sessions.filter((s) => sameDaemon(s, record));
    let encToken: EncryptedToken;
    try {
      encToken = encryptToken(record.token, duplicates[0]?.encToken);
    } catch (error) {
      if (!(error instanceof GuestEncryptionUnavailableError)) throw error;
      // Fail closed: the encrypted local record stays; the remote win is not
      // applied rather than persisted as plaintext.
      logger.warn('ignoring remote guest record: would downgrade an encrypted credential', {
        account: accountKeyFor(record.host, record.port),
      });
      return { changed: false, replacedId: null, removedIds: [] };
    }
    let replacedId: string | null = null;
    if (duplicates.length > 0) {
      const survivor = duplicates[0];
      replacedId = survivor.id;
      survivor.label = record.label;
      survivor.host = record.host;
      survivor.hosts = extras;
      survivor.port = record.port;
      survivor.fingerprint = record.fingerprint;
      survivor.hostname = record.hostname;
      survivor.tcAddress = record.tcAddress;
      survivor.principalId = record.principalId;
      survivor.login = record.login;
      survivor.encToken = encToken;
      survivor.updatedAt = record.updatedAt;
      state.sessions = state.sessions.filter((s) => s === survivor || !duplicates.includes(s));
    } else {
      state.sessions.push({
        id: randomUUID(),
        label: record.label,
        host: record.host,
        hosts: extras,
        port: record.port,
        fingerprint: record.fingerprint,
        hostname: record.hostname,
        tcAddress: record.tcAddress,
        principalId: record.principalId,
        login: record.login,
        encToken,
        updatedAt: record.updatedAt,
      });
    }
    await writeState(state);
    return { changed: true, replacedId, removedIds: [] };
  });
  if (replacedId !== null) notifyCredentialReplaced(replacedId);
  for (const id of removedIds) notifyRemovedBySync(id);
  return changed;
}

/**
 * Test-only: await any in-flight writes, then reset the chain.
 * @internal
 */
export async function __drainWriteChainForTesting(): Promise<void> {
  await writeChain;
  writeChain = Promise.resolve();
}
