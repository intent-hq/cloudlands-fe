/**
 * Invited principals live in guest-sessions.json, separate from the owner registry.
 * A canonical pinned host certificate plus opaque remote principal identifies each
 * person. Guest-to-member upgrades keep that person's window id and workspaces.
 * Every new bearer or opaque imported payload requires Electron safeStorage;
 * recoverable legacy plaintext remains readable but is never a fallback for writes.
 *
 * The same atomic, serialized file stores encrypted pending imports, deliberate
 * pairing intents, permanent removal observations and the publication outbox.
 * Invited v2 reconciliation never enters the owner service's v1 codec. A malformed
 * registry disables mutations so recovery bytes cannot be silently discarded.
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { app, safeStorage } from 'electron';
import { Logger } from '../../../shared/logger';
import { isLoopbackHost } from '../../../shared/loopback-host';
import type { GuestSessionRecord, GuestWorkspaceRef } from '../../../shared/types/guest-sessions';
import { accountKeyFor, serializeRecord, type KeychainItem } from './keychain-sync';
import {
  canonicalFingerprint,
  invitedPersonKey,
  invitedRemovalKey,
  sortedStrings,
} from './invited-session-key';
import {
  isClock,
  isPersonAccount,
  mergeInvitedPerson,
  parseInvitedPayload,
  type InvitedSession,
  type InvitedRemoval,
} from './invited-session-payload';
import type { InvitedPayload } from './invited-session-payload';
import type { InvitedSyncAdapter } from './invited-session-sync';
import type { AddConnectionParams } from '../../../shared/types/connections';
import type { PrincipalIdentity } from '../../workspace-sharing/types';

const logger = new Logger('GuestSessionsStore');

/** File name inside `app.getPath('userData')`. */
const FILE_NAME = 'guest-sessions.json';

interface EncryptedToken {
  encrypted: boolean;
  value: string;
}

/** A guest session as persisted on disk (token included). */
type InvitedPreferences = Pick<
  AddConnectionParams,
  'accent' | 'detectedDeviceKind' | 'deviceIcon' | 'detectHosts' | 'syncExcluded'
>;
const preferenceKeys = [
  'accent',
  'detectedDeviceKind',
  'deviceIcon',
  'detectHosts',
  'syncExcluded',
] as const;
interface StoredGuestSession extends InvitedPreferences {
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
  login: string | null;
  /** Display hints only; every live connection revalidates remote authority. */
  identity?: PrincipalIdentity;
  hostRole?: 'guest' | 'member';
  pairedAt?: number;
  removedThrough?: number;
  tcUpdatedAt?: number | null;
  legacyAccounts?: string[];
  pendingPairing?: number;
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
  login?: string | null;
  updatedAt: number;
  deletedAt: number;
}

/** Fields required to register (or refresh) a guest session. */
export interface NewGuestSession extends InvitedPreferences {
  label: string;
  host: string;
  /** Extra candidate hosts from the invite envelope; the primary is implied. */
  hosts?: string[];
  port: number;
  fingerprint: string;
  tcAddress?: string | null;
  principalId: string;
  login: string | null;
  identity?: PrincipalIdentity;
  hostRole?: 'guest' | 'member';
  /** Returning invite.accept must retain the original pairing clock and bearer. */
  retainPairing?: boolean;
  token: string;
  /** The workspace the invite admitted to; merged into the record's list by id. */
  workspace?: GuestWorkspaceRef;
}

interface PersistedState {
  [key: string]: unknown;
  sessions: StoredGuestSession[];
  tombstones: StoredGuestTombstone[];
  /** Encrypted pending imports plus durable token-free removals/retirement facts in this same registry. */
  invitedProvenance?: Record<string, { fingerprint: string; principalId: string }[]>;
  excludedInvitedPeople?: string[];
  invitedSync?: { account: string; group?: string; encPayload: EncryptedToken }[];
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
    identity: stored.identity,
    hostRole: stored.hostRole,
    pairedAt: stored.pairedAt ?? stored.updatedAt,
    detectHosts: stored.detectHosts,
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
    (c.login === null || typeof c.login === 'string') &&
    (c.workspaces === undefined || isWorkspaceRefArray(c.workspaces)) &&
    isClock(c.updatedAt) &&
    ['pairedAt', 'removedThrough', 'pendingPairing'].every(
      (key) => c[key] === undefined || isClock(c[key]),
    ) &&
    (c.tcUpdatedAt === undefined || c.tcUpdatedAt === null || isClock(c.tcUpdatedAt)) &&
    (c.legacyAccounts === undefined || isStringArray(c.legacyAccounts)) &&
    (c.hostRole === undefined || c.hostRole === 'member' || c.hostRole === 'guest') &&
    (c.detectHosts === undefined || typeof c.detectHosts === 'boolean') &&
    (c.syncExcluded === undefined || typeof c.syncExcluded === 'boolean') &&
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
    (t.login === undefined || t.login === null || typeof t.login === 'string') &&
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
  const syncIntact =
    obj.invitedSync === undefined ||
    (Array.isArray(obj.invitedSync) &&
      obj.invitedSync.every(
        (row) =>
          row &&
          typeof row.account === 'string' &&
          (row.group === undefined || typeof row.group === 'string') &&
          typeof row.encPayload?.encrypted === 'boolean' &&
          typeof row.encPayload?.value === 'string',
      ));
  const exclusionsIntact =
    obj.excludedInvitedPeople === undefined ||
    (isStringArray(obj.excludedInvitedPeople) && obj.excludedInvitedPeople.every(isPersonAccount));
  const provenanceIntact =
    obj.invitedProvenance === undefined ||
    (!!obj.invitedProvenance &&
      typeof obj.invitedProvenance === 'object' &&
      !Array.isArray(obj.invitedProvenance) &&
      Object.values(obj.invitedProvenance).every(
        (people) =>
          Array.isArray(people) &&
          people.every((person) => {
            try {
              return (
                typeof person?.fingerprint === 'string' &&
                typeof person?.principalId === 'string' &&
                !!invitedPersonKey(person)
              );
            } catch {
              return false;
            }
          }),
      ));
  return {
    state: { ...obj, sessions, tombstones } as PersistedState,
    intact: intact && syncIntact && exclusionsIntact && provenanceIntact,
  };
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

/** New credential writes always require OS encryption; existing bytes survive failures. */
function encryptToken(token: string): EncryptedToken {
  if (safeStorage.isEncryptionAvailable()) {
    return { encrypted: true, value: safeStorage.encryptString(token).toString('base64') };
  }
  throw new GuestEncryptionUnavailableError();
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
 * {@link createInvitedSyncAdapter} do NOT notify — a pull must not loop back
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
 * ({@link createInvitedSyncAdapter}) DELETED a live session — the guest was
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

type Identity = { fingerprint: string; principalId?: string };

function fingerprintKey(fingerprint: string | undefined | null): string | null {
  try {
    return canonicalFingerprint(fingerprint ?? '');
  } catch {
    return null;
  }
}

/** Only the canonical certificate pin identifies an invited host. */
function sameDaemon(a: Identity, b: Identity): boolean {
  const fa = fingerprintKey(a.fingerprint);
  const fb = fingerprintKey(b.fingerprint);
  return fa !== null && fb !== null && fa === fb;
}

function samePerson(a: Identity, b: Identity): boolean {
  return !!a.principalId && a.principalId === b.principalId && sameDaemon(a, b);
}

/** Strict tombstone identity: fingerprints decide when both sides carry one. */
function tombstoneMatches(a: Identity, b: Identity): boolean {
  return samePerson(a, b);
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
 * Return the sole person pinned to the invite's host, or null if selection is ambiguous.
 */
export async function findMatching(identity: {
  hosts: string[];
  port: number;
  fingerprint: string | null;
}): Promise<GuestSessionRecord | null> {
  const state = await readState();
  const probe = { fingerprint: identity.fingerprint ?? '' };
  const matches = state.sessions.filter((s) => sameDaemon(s, probe));
  return matches.length === 1 ? toRecord(matches[0]) : null;
}

/** All people pinned to this host; route matches alone never select an identity. */
export async function findAllMatching(fingerprint: string): Promise<GuestSessionRecord[]> {
  const key = canonicalFingerprint(fingerprint);
  return (await list()).filter((s) => fingerprintKey(s.fingerprint) === key);
}

/**
 * Upsert one verified person at one pinned host, keeping their local record id.
 * Returning credentials retain their pairing clock; deliberate joins wait for
 * a complete sync snapshot before publication. Other people on the same host
 * remain separate. Every new credential write requires encryption.
 */
export async function add(input: NewGuestSession): Promise<GuestSessionRecord> {
  input = { ...input, fingerprint: canonicalFingerprint(input.fingerprint) };
  invitedPersonKey(input);
  const extras = dedupeHosts(input.hosts ?? []).filter((h) => h !== input.host.trim());
  const { stored, replaced } = await mutate(async (state) => {
    const duplicates = state.sessions.filter((s) => samePerson(s, input));
    if (
      input.retainPairing &&
      duplicates.length > 0 &&
      decryptToken(duplicates[0].encToken) !== input.token
    ) {
      throw new Error('Returning invited credential changed');
    }
    const encToken = encryptToken(input.token);
    const superseded = state.tombstones.find((t) => tombstoneMatches(t, input));
    const stamp = Math.max(
      Date.now(),
      (superseded?.updatedAt ?? 0) + 1,
      ...duplicates.map((s) => s.updatedAt + 1),
    );
    clearTombstone(state, input);
    const personKey = invitedPersonKey(input);
    if (input.syncExcluded === true)
      state.excludedInvitedPeople = [
        ...new Set([...(state.excludedInvitedPeople ?? []), personKey]),
      ];
    else if (input.syncExcluded === false)
      state.excludedInvitedPeople = state.excludedInvitedPeople?.filter((key) => key !== personKey);
    const preferences = Object.fromEntries(
      preferenceKeys.filter((key) => input[key] !== undefined).map((key) => [key, input[key]]),
    );
    if (duplicates.length > 0) {
      const survivor = duplicates[0];
      if (survivor.pairedAt === undefined)
        survivor.legacyAccounts = [accountKeyFor(survivor.host, survivor.port)];
      Object.assign(survivor, preferences);
      survivor.label = input.label;
      survivor.host = input.host;
      survivor.hosts = extras;
      survivor.port = input.port;
      survivor.fingerprint = input.fingerprint;
      // A missing tunnel in an invitation is unknown, not an observed clear.
      if (input.tcAddress != null && input.tcAddress !== survivor.tcAddress) {
        survivor.tcAddress = input.tcAddress;
        survivor.tcUpdatedAt = stamp;
      }
      survivor.principalId = input.principalId;
      survivor.login = input.login;
      survivor.identity = input.identity ?? survivor.identity;
      survivor.hostRole = input.hostRole ?? survivor.hostRole;
      if (!input.retainPairing) {
        survivor.pairedAt = stamp;
        survivor.pendingPairing = stamp;
      } else survivor.pairedAt ??= survivor.updatedAt;
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
      ...preferences,
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
      identity: input.identity,
      hostRole: input.hostRole ?? 'guest',
      pairedAt: stamp,
      pendingPairing: stamp,
      removedThrough: 0,
      tcUpdatedAt: input.tcAddress != null ? stamp : null,
      legacyAccounts: [],
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
export interface InvitedCredentialLease {
  principalId: string;
  token: string;
  pairedAt: number;
}
export type InvitedCommitGuard = (() => boolean) & { credential?: InvitedCredentialLease };
function matchesCredential(
  session: StoredGuestSession,
  expected?: InvitedCredentialLease,
): boolean {
  return (
    !expected ||
    (session.principalId === expected.principalId &&
      (session.pairedAt ?? session.updatedAt) === expected.pairedAt &&
      decryptToken(session.encToken) === expected.token)
  );
}
function canCommit(
  session: StoredGuestSession | undefined,
  guard?: InvitedCommitGuard,
): session is StoredGuestSession {
  return !!session && (!guard || (guard() && matchesCredential(session, guard.credential)));
}

/** Safe display hints only; authority is always refreshed by principal.me in the renderer. */
export async function setPrincipal(
  id: string,
  principal: {
    login: string | null;
    identity?: StoredGuestSession['identity'];
    hostRole: 'member' | 'guest';
  },
  guard: InvitedCommitGuard,
): Promise<boolean> {
  return mutate(async (state) => {
    const session = state.sessions.find((s) => s.id === id);
    if (!canCommit(session, guard)) return false;
    if (
      session.login === principal.login &&
      session.hostRole === principal.hostRole &&
      JSON.stringify(session.identity) === JSON.stringify(principal.identity)
    )
      return true;
    session.login = principal.login;
    session.hostRole = principal.hostRole;
    session.identity = principal.identity;
    await writeState(state);
    return true;
  });
}

export async function setHostname(
  id: string,
  hostname: string,
  guard?: InvitedCommitGuard,
): Promise<boolean> {
  const trimmed = hostname.trim();
  if (trimmed === '') return false;
  const changed = await mutate(async (state) => {
    const session = state.sessions.find((s) => s.id === id);
    if (!canCommit(session, guard) || session.hostname === trimmed) return false;
    if (session.pairedAt === undefined)
      session.legacyAccounts = sortedStrings([
        ...(session.legacyAccounts ?? []),
        accountKeyFor(session.host, session.port),
      ]);
    session.pairedAt ??= session.updatedAt;
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
export async function setTcAddress(
  id: string,
  tcAddress: string | null,
  guard?: InvitedCommitGuard,
): Promise<boolean> {
  if (tcAddress === '') return false;
  const normalized = tcAddress;
  const changed = await mutate(async (state) => {
    const session = state.sessions.find((s) => s.id === id);
    if (
      !canCommit(session, guard) ||
      ((session.tcAddress ?? null) === normalized && session.tcUpdatedAt != null)
    )
      return false;
    if (session.pairedAt === undefined)
      session.legacyAccounts = sortedStrings([
        ...(session.legacyAccounts ?? []),
        accountKeyFor(session.host, session.port),
      ]);
    session.pairedAt ??= session.updatedAt;
    session.tcAddress = normalized;
    session.updatedAt = Math.max(Date.now(), session.updatedAt + 1);
    session.tcUpdatedAt = session.updatedAt;
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
export async function setHosts(
  id: string,
  hosts: string[],
  guard?: InvitedCommitGuard,
): Promise<boolean> {
  const changed = await mutate(async (state) => {
    const session = state.sessions.find((s) => s.id === id);
    if (!canCommit(session, guard)) return false;
    const extras = dedupeHosts([session.host, ...hosts]).filter((h) => h !== session.host.trim());
    if (JSON.stringify(extras) === JSON.stringify(session.hosts ?? [])) return false;
    if (session.pairedAt === undefined)
      session.legacyAccounts = sortedStrings([
        ...(session.legacyAccounts ?? []),
        accountKeyFor(session.host, session.port),
      ]);
    session.pairedAt ??= session.updatedAt;
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
 * (omitted from {@link createInvitedSyncAdapter}), so the record's `updatedAt` — the
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
  stillValid: InvitedCommitGuard = () => true,
): Promise<boolean> {
  return mutate(async (state) => {
    if (!stillValid()) return false;
    const session = state.sessions.find((s) => s.id === id);
    if (!canCommit(session, stillValid)) return false;
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
export async function forget(id: string, expected?: InvitedCredentialLease): Promise<boolean> {
  const changed = await mutate(async (state) => {
    const removed = state.sessions.find((s) => s.id === id);
    if (!removed) return false;
    if (!matchesCredential(removed, expected)) return false;
    state.sessions = state.sessions.filter((s) => s.id !== id);
    try {
      invitedPersonKey(removed);
    } catch {
      // Explicit local recovery for old unqualified records. A route cannot
      // supply the trusted person identity needed to publish a removal.
      await writeState(state);
      return true;
    }
    const now = Date.now();
    const facts = syncPayloads(state).filter(
      (r): r is InvitedRemoval => r.kind === 'removal' && samePerson(r, removed),
    );
    const floor = Math.max(
      now,
      removed.updatedAt + 1,
      (removed.pairedAt ?? 0) + 1,
      (removed.removedThrough ?? 0) + 1,
      ...facts.map((r) => r.removedThrough + 1),
    );
    const removal: InvitedRemoval = {
      v: 2,
      kind: 'removal',
      fingerprint: canonicalFingerprint(removed.fingerprint),
      principalId: removed.principalId,
      removalId: randomUUID(),
      removedThrough: floor,
      legacyAccounts: sortedStrings([
        ...(removed.legacyAccounts ?? []),
        ...facts.flatMap((r) => r.legacyAccounts),
      ]),
    };
    saveSyncItem(state, { account: invitedRemovalKey(removal), payload: JSON.stringify(removal) });
    const deleted = {
      ...sessionPayload(removed, {}, true),
      token: '',
      deleted: true,
      deletedAt: now,
      updatedAt: floor,
      removedThrough: floor,
    };
    saveSyncItem(state, { account: invitedPersonKey(removal), payload: JSON.stringify(deleted) });
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
      updatedAt: floor,
      deletedAt: now,
    });
    await writeState(state);
    return true;
  });
  if (changed) notifyMutated();
  return changed;
}

/** A pinned authentication refusal tears down only the exact rejected saved credential. */
export async function rejectStoredCredential(
  id: string,
  expected: InvitedCredentialLease,
): Promise<void> {
  if (await forget(id, expected)) notifyRemovedBySync(id);
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
 * Test-only: await any in-flight writes, then reset the chain.
 * @internal
 */
export async function __drainWriteChainForTesting(): Promise<void> {
  await writeChain;
  writeChain = Promise.resolve();
}

function sessionPayload(
  session: StoredGuestSession,
  extensions: Record<string, unknown> = {},
  omitToken = false,
): InvitedSession {
  return {
    ...extensions,
    v: 2,
    kind: 'session',
    fingerprint: canonicalFingerprint(session.fingerprint),
    principalId: session.principalId,
    label: session.label,
    login: session.login,
    host: session.host,
    hosts: candidateHosts(session),
    port: session.port,
    hostname: session.hostname ?? null,
    detectHosts: session.detectHosts ?? false,
    tcAddress: session.tcAddress ?? null,
    ...Object.fromEntries(
      ['accent', 'detectedDeviceKind', 'deviceIcon']
        .filter((key) => session[key as keyof StoredGuestSession] !== undefined)
        .map((key) => [key, session[key as keyof StoredGuestSession]]),
    ),
    tcUpdatedAt: session.tcUpdatedAt ?? (session.tcAddress ? session.updatedAt : null),
    token: omitToken ? '' : decryptToken(session.encToken),
    updatedAt: session.updatedAt,
    pairedAt: session.pairedAt ?? session.updatedAt,
    removedThrough: session.removedThrough ?? 0,
    deleted: false,
    deletedAt: null,
    legacyAccounts: session.legacyAccounts ?? [],
  };
}

function syncItems(state: PersistedState): KeychainItem[] {
  return (state.invitedSync ?? []).map((r) => ({
    account: r.account,
    group: r.group,
    payload: decryptToken(r.encPayload),
  }));
}

function syncPayloads(state: PersistedState): InvitedPayload[] {
  // Removal facts are always token-free, so forgetting is possible even with a locked keyring.
  return (state.invitedSync ?? [])
    .filter((r) => !r.encPayload.encrypted)
    .flatMap((r) => {
      const parsed = parseInvitedPayload(r.account, r.encPayload.value);
      return parsed ? [parsed] : [];
    });
}

/** All opaque/possibly credential-bearing imported bytes are encrypted, including unknown versions. */
function saveSyncItem(state: PersistedState, item: KeychainItem): void {
  const rows = (state.invitedSync ??= []);
  const existing = rows.find((r) => r.account === item.account && r.group === item.group);
  let previous: string | undefined;
  try {
    previous = existing ? decryptToken(existing.encPayload) : undefined;
  } catch (error) {
    const incoming = parseInvitedPayload(item.account, item.payload);
    // The independent removal remains durable while locked credential bytes stay recoverable.
    if (incoming?.kind === 'removed' || (incoming?.kind === 'session' && incoming.deleted)) return;
    throw error;
  }
  if (previous === item.payload) return;
  let record = parseInvitedPayload(item.account, item.payload);
  const old = previous === undefined ? null : parseInvitedPayload(item.account, previous);
  // Never overwrite future/malformed canonical data with a understood downgrade.
  if (previous !== undefined && item.account.startsWith('invited-v2-') && old === null) return;
  if (old?.kind === 'removal') return; // Immutable forever, including unknown extensions.
  if (old?.kind === 'legacy-alias' && record?.kind !== 'legacy-alias') return;
  if (
    old &&
    (old.kind === 'session' || old.kind === 'removed') &&
    record &&
    (record.kind === 'session' || record.kind === 'removed')
  ) {
    record = mergeInvitedPerson([old, record], [])!;
    item = { ...item, payload: JSON.stringify(record) };
  }
  if (old?.kind === 'legacy-alias' && record?.kind === 'legacy-alias') {
    item = {
      ...item,
      payload: JSON.stringify({
        ...old,
        ...record,
        personKeys: sortedStrings([...old.personKeys, ...record.personKeys]),
      }),
    };
  }
  const safe =
    record?.kind === 'removal' ||
    record?.kind === 'legacy-alias' ||
    record?.kind === 'removed' ||
    (record?.kind === 'session' && record.deleted);
  const encPayload = safe ? { encrypted: false, value: item.payload } : encryptToken(item.payload);
  if (existing) existing.encPayload = encPayload;
  else rows.push({ account: item.account, group: item.group, encPayload });
}

/** The existing registry is the sole durable invited store, including pending imports and the outbox. */
export function createInvitedSyncAdapter(
  authenticate: InvitedSyncAdapter['authenticate'],
): InvitedSyncAdapter {
  return {
    authenticate,
    async rejectCredential(record) {
      let removedId: string | undefined;
      const changed = await mutate(async (state) => {
        const active = state.sessions.find((s) => samePerson(s, record));
        if (active && !matchesCredential(active, record)) return false;
        const account = invitedPersonKey(record);
        const candidates = syncItems(state).flatMap((item) => {
          const r = item.account === account ? parseInvitedPayload(account, item.payload) : null;
          return r?.kind === 'session' || r?.kind === 'removed' ? [r] : [];
        });
        if (active) candidates.push(sessionPayload(active));
        const facts = syncPayloads(state).filter(
          (r): r is InvitedRemoval => r.kind === 'removal' && samePerson(r, record),
        );
        const selected = mergeInvitedPerson(candidates, facts);
        if (
          selected?.kind !== 'session' ||
          selected.deleted ||
          selected.token !== record.token ||
          selected.pairedAt !== record.pairedAt
        )
          return false;
        const floor = Math.max(
          Date.now(),
          selected.updatedAt + 1,
          selected.pairedAt + 1,
          selected.removedThrough + 1,
        );
        if (!Number.isSafeInteger(floor)) throw new GuestStoreCorruptError();
        const removal: InvitedRemoval = {
          v: 2,
          kind: 'removal',
          fingerprint: selected.fingerprint,
          principalId: selected.principalId,
          removalId: randomUUID(),
          removedThrough: floor,
          legacyAccounts: selected.legacyAccounts,
        };
        saveSyncItem(state, {
          account: invitedRemovalKey(removal),
          payload: JSON.stringify(removal),
        });
        saveSyncItem(state, {
          account,
          payload: JSON.stringify({
            ...selected,
            token: '',
            deleted: true,
            deletedAt: Date.now(),
            updatedAt: floor,
            removedThrough: floor,
          }),
        });
        if (active) {
          state.sessions = state.sessions.filter((s) => s !== active);
          removedId = active.id;
        }
        await writeState(state);
        return true;
      });
      if (removedId) notifyRemovedBySync(removedId);
      if (changed) notifyMutated();
    },
    async read() {
      await writeChain;
      const loaded = await loadState();
      if (!loaded?.intact) throw new GuestStoreCorruptError();
      const state = loaded.state;
      const items = syncItems(state);
      const pendingPairings: string[] = [];
      for (const s of state.sessions) {
        let personKey: string;
        try {
          personKey = invitedPersonKey(s);
        } catch {
          continue;
        } // Unpinned legacy rows stay local and recoverable, never guessed from a route.
        if (state.excludedInvitedPeople?.includes(personKey)) continue;
        // Legacy rows keep their provenance and clock; the engine authenticates before migration.
        if (s.pairedAt === undefined) {
          items.push({
            account: accountKeyFor(s.host, s.port),
            payload: serializeRecord({
              label: s.label,
              host: s.host,
              hosts: candidateHosts(s),
              port: s.port,
              fingerprint: s.fingerprint,
              hostname: s.hostname ?? null,
              detectHosts: false,
              tcAddress: s.tcAddress ?? null,
              principalId: s.principalId,
              ...(s.login !== null ? { login: s.login } : {}),
              token: decryptToken(s.encToken),
              updatedAt: s.updatedAt,
            }),
          });
        } else {
          const key = invitedPersonKey(s);
          const known = items
            .flatMap((r) => (r.account === key ? [parseInvitedPayload(key, r.payload)] : []))
            .find((r) => r?.kind === 'session');
          items.push({ account: key, payload: JSON.stringify(sessionPayload(s, known ?? {})) });
          if (s.pendingPairing !== undefined) pendingPairings.push(key);
        }
      }
      for (const t of state.tombstones) {
        try {
          if (
            t.principalId &&
            items.some(
              (r) =>
                r.account ===
                invitedPersonKey({ fingerprint: t.fingerprint, principalId: t.principalId! }),
            )
          )
            continue;
        } catch {
          /* An unpinned legacy deletion remains pending for explicit recovery. */
        }
        // Already-v2 removals fence these v1 caches regardless of clock. Old entries still migrate.
        items.push({
          account: accountKeyFor(t.host, t.port),
          payload: serializeRecord({
            label: t.label,
            host: t.host,
            hosts: candidateHosts(t),
            port: t.port,
            fingerprint: t.fingerprint,
            hostname: t.hostname ?? null,
            detectHosts: false,
            tcAddress: null,
            token: '',
            principalId: t.principalId,
            ...(t.login != null ? { login: t.login } : {}),
            updatedAt: t.updatedAt,
            deleted: true,
            deletedAt: t.deletedAt,
          }),
        });
      }
      return {
        items,
        pendingPairings,
        excludedPeople: state.excludedInvitedPeople,
        provenance: state.invitedProvenance,
      };
    },
    async remember(items) {
      if (!items.length) return;
      const removed: string[] = [];
      await mutate(async (state) => {
        for (const item of items) {
          // Provenance only comes from a locally authenticated active credential. A remote row is not proof.
          const payload = parseInvitedPayload(item.account, item.payload);
          if (
            payload?.kind === 'session' &&
            !payload.deleted &&
            state.sessions.some(
              (s) => samePerson(s, payload) && decryptToken(s.encToken) === payload.token,
            )
          ) {
            const provenance = (state.invitedProvenance ??= {});
            for (const alias of payload.legacyAccounts) {
              const people = (provenance[alias] ??= []);
              if (!people.some((person) => samePerson(person, payload)))
                people.push({ fingerprint: payload.fingerprint, principalId: payload.principalId });
            }
          }
          saveSyncItem(state, item);
          const fact = parseInvitedPayload(item.account, item.payload);
          if (
            fact?.kind !== 'removal' ||
            state.excludedInvitedPeople?.includes(invitedPersonKey(fact))
          )
            continue;
          state.sessions = state.sessions.filter((session) => {
            if (
              !samePerson(session, fact) ||
              session.pendingPairing !== undefined ||
              (session.pairedAt ?? session.updatedAt) > fact.removedThrough
            )
              return true;
            removed.push(session.id);
            return false;
          });
        }
        await writeState(state);
      });
      for (const id of removed) notifyRemovedBySync(id);
    },
    async admitPairing(account, floor, observedClock, expected) {
      let changedId: string | undefined;
      const result = await mutate(async (state) => {
        const session = state.sessions.find((s) => {
          try {
            return invitedPersonKey(s) === account;
          } catch {
            return false;
          }
        });
        if (!session || session.pendingPairing === undefined) return null;
        if (
          decryptToken(session.encToken) !== expected.token ||
          session.pairedAt !== expected.pairedAt
        )
          return null;
        const stamp = Math.max(session.pendingPairing, floor + 1, observedClock + 1);
        if (!Number.isSafeInteger(stamp)) throw new GuestStoreCorruptError();
        if (session.pairedAt !== stamp) changedId = session.id;
        session.pairedAt = stamp;
        session.updatedAt = Math.max(session.updatedAt, stamp);
        session.removedThrough = Math.max(session.removedThrough ?? 0, floor);
        delete session.pendingPairing;
        const record = sessionPayload(session);
        saveSyncItem(state, { account, payload: JSON.stringify(record) });
        await writeState(state);
        return record;
      });
      if (changedId) notifyCredentialReplaced(changedId);
      return result;
    },
    async apply(account, incoming) {
      let replaced: string | null = null;
      const removed: string[] = [];
      await mutate(async (state) => {
        const existing = state.sessions.find((s) => samePerson(s, incoming));
        const facts = syncPayloads(state).filter(
          (r): r is InvitedRemoval => r.kind === 'removal' && samePerson(r, incoming),
        );
        const records = [incoming];
        if (existing) records.unshift(sessionPayload(existing));
        const merged = mergeInvitedPerson(records, facts)!;
        if (merged.kind === 'removed' || merged.deleted) {
          // A new deliberate join racing this pass stays pending until a fresh complete read.
          if (existing?.pendingPairing !== undefined) return;
          if (existing) {
            state.sessions = state.sessions.filter((s) => s !== existing);
            removed.push(existing.id);
          }
          saveSyncItem(state, { account, payload: JSON.stringify(merged) });
        } else {
          const encrypted = encryptToken(merged.token);
          const row: StoredGuestSession = {
            ...existing,
            id: existing?.id ?? randomUUID(),
            label: merged.label,
            host: merged.host,
            hosts: merged.hosts,
            port: merged.port,
            fingerprint: merged.fingerprint,
            tcAddress: merged.tcAddress,
            hostname: merged.hostname,
            principalId: merged.principalId,
            login: merged.login,
            ...Object.fromEntries(
              preferenceKeys
                .filter((key) => merged[key] !== undefined)
                .map((key) => [key, merged[key]]),
            ),
            encToken: encrypted,
            updatedAt: merged.updatedAt,
            pairedAt: merged.pairedAt,
            removedThrough: merged.removedThrough,
            tcUpdatedAt: merged.tcUpdatedAt,
            legacyAccounts: merged.legacyAccounts,
          };
          if (existing) {
            if (
              decryptToken(existing.encToken) !== merged.token ||
              (existing.pairedAt ?? existing.updatedAt) !== merged.pairedAt
            )
              replaced = existing.id;
            state.sessions[state.sessions.indexOf(existing)] = row;
          } else state.sessions.push(row);
          saveSyncItem(state, { account, payload: JSON.stringify(merged) });
        }
        await writeState(state);
      });
      if (replaced) notifyCredentialReplaced(replaced);
      for (const id of removed) notifyRemovedBySync(id);
    },
  };
}
