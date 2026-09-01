/**
 * iCloud-keychain sync for remote backend connections (macOS, main process).
 *
 * Owns the sync protocol on top of the bundled `intent-keychain-helper` CLI
 * (resources/keychain/sync-helper.swift): the versioned JSON payload schema,
 * the helper spawn wrapper, and the two-way reconciliation between the synced
 * keychain registry and the local connections store.
 *
 * Model: ONE keychain item per backend under the fixed service
 * `com.cloudlands.intent.backends`, keyed by the normalized `host:port`
 * account (mirrors the local store's dedupe identity). Conflicts resolve
 * last-writer-wins by the payload's `updatedAt`. Deletes are TOMBSTONES
 * (`deleted: true`, token scrubbed) rather than raw item deletion, so "item
 * missing" is never ambiguous with "keychain unreadable"; tombstones are
 * purged from the keychain after `TOMBSTONE_TTL_MS` (~30 days).
 *
 * Fail-soft everywhere: a missing helper (dev build, non-mac), an unsigned/
 * ad-hoc build (the helper's structured `unavailable` error), or any helper
 * failure makes `reconcile()` a clean no-op that NEVER mutates the local
 * store — the result carries an `unavailable` status + reason for the UI.
 *
 * Token boundary: bearer tokens travel only inside payloads over the
 * helper's stdin/stdout — NEVER argv — and are never logged. Accounts
 * (`host:port`) are backend identity, not secret.
 *
 * The local-store side is abstracted behind {@link LocalSyncAdapter} so the
 * lifecycle wiring (T3) owns how records/tombstones map onto
 * `connections-store.ts`; this module has no store imports.
 */

import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { Logger } from '../../../shared/logger';
import {
  DEFAULT_CONNECTION_ACCENT,
  isConnectionAccent,
  type ConnectionAccent,
} from '../../../shared/types/connections';

const logger = new Logger('KeychainSync');

/** Current payload schema version. Items with a NEWER `v` (written by a newer
 * app) freeze their account: neither pulled nor overwritten by a push. */
export const KEYCHAIN_PAYLOAD_VERSION = 1;

/** Tombstones older than this are purged from the keychain on reconcile. */
export const TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const HELPER_TIMEOUT_MS = 15_000;
/** Exact cap on collected helper stdout; overflow is sliced off (truncated
 * output then degrades to a structured `helper-failed` on parse). */
export const MAX_HELPER_OUTPUT_BYTES = 8 * 1024 * 1024;

// ============================================================================
// Payload schema
// ============================================================================

/**
 * One synced backend record — the JSON payload stored in the keychain item
 * and the shape exchanged with the local store via {@link LocalSyncAdapter}.
 * Tombstones keep the identity fields but always carry an empty `token`.
 */
export interface KeychainSyncRecord {
  label: string;
  /** Optional only for compatibility with payloads written before metadata accents. */
  accent?: ConnectionAccent;
  /** Primary remote host/IP (identity, with `port`). */
  host: string;
  /** Candidate hosts (primary first) — mirrors the store's `hosts` semantics. */
  hosts: string[];
  port: number;
  fingerprint: string;
  hostname: string | null;
  /**
   * tc address of the backend's tailcat tunnel endpoint (PROTOCOL §12.3), or
   * null when none is known. Additive: payloads written before the field
   * existed parse as null, and every machine learns the same address from the
   * same daemon — so syncing it lets a device that can ONLY reach the daemon
   * through the tunnel inherit the address from a device that paired locally.
   */
  tcAddress: string | null;
  detectHosts: boolean;
  /** Bearer token; always `''` on tombstones. */
  token: string;
  /** Last-writer-wins conflict clock, ms since epoch. */
  updatedAt: number;
  /** Tombstone marker: the backend was forgotten on some machine. */
  deleted?: boolean;
  /** When the tombstone was written (ms since epoch); TTL anchor. */
  deletedAt?: number;
}

/**
 * Keychain account key for a backend: normalized `host:port`, mirroring the
 * local store's host+port dedupe identity (host trimmed + lowercased).
 */
export function accountKeyFor(host: string, port: number): string {
  return `${host.trim().toLowerCase()}:${port}`;
}

/**
 * Normalized cert-fingerprint identity key (trimmed, case-insensitive), or
 * null when the record carries no usable fingerprint (legacy/blank). The
 * fingerprint is the canonical MACHINE identity: accounts are still keyed by
 * `host:port`, but reconcile pairs records across accounts by fingerprint so
 * a machine whose address changed never appears twice.
 */
function fingerprintKeyOf(record: Pick<KeychainSyncRecord, 'fingerprint'>): string | null {
  const key = record.fingerprint.trim().toUpperCase();
  return key === '' ? null : key;
}

/** Serialize a record into the keychain payload string (token scrubbed on
 * tombstones so forgotten backends never keep a secret in the keychain). */
export function serializeRecord(record: KeychainSyncRecord): string {
  const payload: Record<string, unknown> = {
    v: KEYCHAIN_PAYLOAD_VERSION,
    label: record.label,
    accent: record.accent === undefined ? DEFAULT_CONNECTION_ACCENT : record.accent,
    host: record.host,
    hosts: record.hosts,
    port: record.port,
    fingerprint: record.fingerprint,
    hostname: record.hostname,
    tcAddress: record.tcAddress,
    detectHosts: record.detectHosts,
    token: record.deleted === true ? '' : record.token,
    updatedAt: record.updatedAt,
  };
  if (record.deleted === true) {
    payload.deleted = true;
    payload.deletedAt = record.deletedAt ?? record.updatedAt;
  }
  return JSON.stringify(payload);
}

/** Result of parsing a keychain payload string. */
export type ParsedPayload =
  { kind: 'record'; record: KeychainSyncRecord } | { kind: 'newer-version' } | { kind: 'invalid' };

/** Parse + validate a keychain payload. Never throws. */
export function parsePayload(payload: string): ParsedPayload {
  let raw: unknown;
  try {
    raw = JSON.parse(payload);
  } catch {
    return { kind: 'invalid' };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { kind: 'invalid' };
  const obj = raw as Record<string, unknown>;
  if (typeof obj.v !== 'number') return { kind: 'invalid' };
  if (obj.v > KEYCHAIN_PAYLOAD_VERSION) return { kind: 'newer-version' };
  if (
    typeof obj.label !== 'string' ||
    (obj.accent !== undefined && !isConnectionAccent(obj.accent)) ||
    typeof obj.host !== 'string' ||
    obj.host.trim() === '' ||
    typeof obj.port !== 'number' ||
    typeof obj.fingerprint !== 'string' ||
    typeof obj.updatedAt !== 'number'
  ) {
    return { kind: 'invalid' };
  }
  const record: KeychainSyncRecord = {
    label: obj.label,
    accent: isConnectionAccent(obj.accent) ? obj.accent : DEFAULT_CONNECTION_ACCENT,
    host: obj.host,
    hosts:
      Array.isArray(obj.hosts) && obj.hosts.every((h) => typeof h === 'string')
        ? (obj.hosts as string[])
        : [obj.host],
    port: obj.port,
    fingerprint: obj.fingerprint,
    hostname: typeof obj.hostname === 'string' ? obj.hostname : null,
    tcAddress:
      typeof obj.tcAddress === 'string' && obj.tcAddress.trim() !== '' ? obj.tcAddress : null,
    detectHosts: typeof obj.detectHosts === 'boolean' ? obj.detectHosts : true,
    token: typeof obj.token === 'string' ? obj.token : '',
    updatedAt: obj.updatedAt,
  };
  if (obj.deleted === true) {
    record.deleted = true;
    record.deletedAt = typeof obj.deletedAt === 'number' ? obj.deletedAt : record.updatedAt;
    record.token = '';
  }
  return { kind: 'record', record };
}

// ============================================================================
// Helper client (spawn wrapper)
// ============================================================================

/**
 * Failure codes surfaced by {@link KeychainClient}. The first three are
 * client-side (helper never ran / produced no result); the rest map 1:1 to
 * the helper's structured error codes (see sync-helper.swift). Every code
 * except `not-found` means "keychain state unknown" — callers must never
 * treat them as "no items".
 */
export type HelperErrorCode =
  | 'unsupported-platform'
  | 'helper-missing'
  | 'helper-failed'
  | 'unavailable'
  | 'not-found'
  | 'bad-arguments'
  | 'keychain-error';

/** One item as returned by the helper's `list`. */
export interface KeychainItem {
  account: string;
  payload: string;
  modifiedAtMs?: number;
  /** Keychain access group holding the item (absent when the helper could
   * not report it). Compared against the list result's `sharedGroup` to spot
   * legacy default-group items needing migration. */
  group?: string;
}

type KeychainClientResult<T> =
  ({ ok: true } & T) | { ok: false; code: HelperErrorCode; message: string };

/**
 * Thin async facade over the helper CLI. `createHelperKeychainClient()`
 * builds the real spawn-based client; tests (and T3, if it ever needs to)
 * can substitute an in-memory implementation.
 *
 * `list()`'s `sharedGroup` is the cross-app shared access group the helper
 * resolved from its own entitlements — absent when the build's provisioning
 * profile does not authorize it yet (helper degrades to the default group).
 * Upserts always land in the helper's active group (shared when available);
 * `delete(account, group)` scopes the delete to one group so migration can
 * remove only the legacy copy.
 */
export interface KeychainClient {
  list(): Promise<KeychainClientResult<{ items: KeychainItem[]; sharedGroup?: string }>>;
  upsert(account: string, payload: string): Promise<KeychainClientResult<object>>;
  delete(account: string, group?: string): Promise<KeychainClientResult<object>>;
}

/**
 * Where the helper bundle's binary may live. Packaged: mac extraResources
 * (`process.resourcesPath/keychain-helper/`). Dev: the staging dir from
 * build-keychain-helper.cjs at the project root (same resolution as
 * voice-local.ipc.ts's speech helper).
 */
function helperPathCandidates(): string[] {
  const bundleBin = path.join(
    'intent-keychain-helper.app',
    'Contents',
    'MacOS',
    'intent-keychain-helper',
  );
  if (app.isPackaged) {
    return [path.join(process.resourcesPath, 'keychain-helper', bundleBin)];
  }
  return [
    path.join(app.getAppPath(), '..', '..', 'resources', 'keychain-helper', bundleBin),
    path.join(app.getAppPath(), 'resources', 'keychain-helper', bundleBin),
  ];
}

/** First existing candidate, or null when the helper is not built/bundled. */
async function resolveHelperPath(): Promise<string | null> {
  for (const candidate of helperPathCandidates()) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // Not here — try the next candidate.
    }
  }
  return null;
}

/**
 * Spawn the helper once and collect its single-line JSON stdout. `stdinBody`
 * (the upsert payload envelope) travels over stdin — never argv. Resolves
 * with the raw output even on nonzero exit (the helper emits structured
 * errors there); rejects only on spawn failure/timeout.
 */
function runHelper(
  helperPath: string,
  args: string[],
  stdinBody?: string,
): Promise<{ stdout: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(helperPath, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      child.kill('SIGKILL');
      reject(new Error(`keychain helper timed out after ${HELPER_TIMEOUT_MS}ms`));
    }, HELPER_TIMEOUT_MS);
    child.stdout.on('data', (chunk: Buffer) => {
      const remaining = MAX_HELPER_OUTPUT_BYTES - stdout.length;
      if (remaining <= 0) return;
      const text = chunk.toString('utf8');
      stdout += text.length > remaining ? text.slice(0, remaining) : text;
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (stderr.trim().length > 0) {
        logger.warn('keychain helper stderr', { stderr: stderr.trim() });
      }
      resolve({ stdout, exitCode: code ?? -1 });
    });
    // A helper that exits before draining stdin makes the pipe emit EPIPE;
    // without a listener that is an unhandled stream error that crashes the
    // process instead of surfacing as a structured failure. The 'close'
    // handler still resolves with whatever the helper printed, so a logged
    // warning is all that is needed here.
    child.stdin.on('error', (error: NodeJS.ErrnoException) => {
      logger.warn('keychain helper stdin error', {
        code: error.code ?? 'unknown',
        error: error.message,
      });
    });
    try {
      if (stdinBody !== undefined) {
        child.stdin.write(stdinBody);
      }
      child.stdin.end();
    } catch (error) {
      // Synchronous write/end failure (stream already destroyed): reject as a
      // structured helper failure rather than throwing out of the executor.
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    }
  });
}

/** Map one helper invocation's output onto a structured client result. */
function parseHelperResult(stdout: string, exitCode: number): KeychainClientResult<object> {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(stdout.trim()) as Record<string, unknown>;
  } catch {
    return {
      ok: false,
      code: 'helper-failed',
      message: `keychain helper produced unparseable output (exit ${exitCode})`,
    };
  }
  if (typeof parsed.error === 'string') {
    const code: HelperErrorCode =
      parsed.error === 'unavailable' ||
      parsed.error === 'not-found' ||
      parsed.error === 'bad-arguments'
        ? parsed.error
        : 'keychain-error';
    return {
      ok: false,
      code,
      message: typeof parsed.message === 'string' ? parsed.message : parsed.error,
    };
  }
  return { ok: true, ...parsed };
}

/** Options for {@link createHelperKeychainClient} (injectable for tests). */
export interface HelperClientOptions {
  platform?: NodeJS.Platform;
  /** Skip candidate probing and use this binary path directly. */
  helperPath?: string;
}

/** The real helper-backed client. Never throws — every failure is a result. */
export function createHelperKeychainClient(options: HelperClientOptions = {}): KeychainClient {
  const platform = options.platform ?? process.platform;

  async function invoke(args: string[], stdinBody?: string): Promise<KeychainClientResult<object>> {
    if (platform !== 'darwin') {
      return {
        ok: false,
        code: 'unsupported-platform',
        message: 'keychain sync requires macOS',
      };
    }
    const helperPath = options.helperPath ?? (await resolveHelperPath());
    if (helperPath === null) {
      return {
        ok: false,
        code: 'helper-missing',
        message: 'keychain helper not bundled (dev build?)',
      };
    }
    try {
      const { stdout, exitCode } = await runHelper(helperPath, args, stdinBody);
      return parseHelperResult(stdout, exitCode);
    } catch (error) {
      return {
        ok: false,
        code: 'helper-failed',
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  return {
    async list() {
      const result = await invoke(['list']);
      if (!result.ok) return result;
      const rows = (result as unknown as { items?: unknown }).items;
      const items: KeychainItem[] = Array.isArray(rows)
        ? rows.filter(
            (row): row is KeychainItem =>
              !!row &&
              typeof row === 'object' &&
              typeof (row as KeychainItem).account === 'string' &&
              typeof (row as KeychainItem).payload === 'string',
          )
        : [];
      const sharedGroup = (result as unknown as { sharedGroup?: unknown }).sharedGroup;
      return typeof sharedGroup === 'string' && sharedGroup !== ''
        ? { ok: true, items, sharedGroup }
        : { ok: true, items };
    },
    upsert(account, payload) {
      return invoke(['upsert', account], JSON.stringify({ payload }));
    },
    delete(account, group) {
      // The group is an entitlement identifier (not secret) — argv is fine.
      return invoke(group !== undefined ? ['delete', account, group] : ['delete', account]);
    },
  };
}

// ============================================================================
// Reconciliation
// ============================================================================

/**
 * Local-store side of a reconcile, implemented by the lifecycle wiring (T3)
 * on top of `connections-store.ts`. `list()` returns every locally known
 * record — live ones AND locally written tombstones — each carrying its
 * `updatedAt` clock (and the live ones their token, needed for pushes).
 * `applyRemote()` applies a remote-won record: a live record upserts into the
 * store (token included), a tombstone (`deleted: true`) removes the backend
 * and remembers the tombstone. Adapter errors propagate to the caller —
 * they are local-store faults, not keychain unavailability.
 */
export interface LocalSyncAdapter {
  list(): Promise<KeychainSyncRecord[]>;
  applyRemote(account: string, record: KeychainSyncRecord): Promise<void>;
}

/** Sync availability, surfaced to the UI (T4). `reason` is a
 * {@link HelperErrorCode} naming why the keychain cannot be used. An `active`
 * status carries `errorCount` (> 0, else absent) when the pass completed but
 * some keychain writes failed — degraded, not unavailable. */
export type KeychainSyncStatus =
  | { state: 'active'; errorCount?: number }
  | { state: 'unavailable'; reason: HelperErrorCode; message: string };

/** What a reconcile pass did, by account key. */
export interface ReconcileResult {
  status: KeychainSyncStatus;
  /** Remote live records applied to the local store (fresh pull/overwrite). */
  pulled: string[];
  /** Local records (or tombstones) written to the keychain. */
  pushed: string[];
  /** Remote tombstones applied to the local store. */
  deletedLocally: string[];
  /** Expired tombstone items removed from the keychain. */
  purged: string[];
  /** Remote items ignored (unparseable payload or newer schema version). */
  skipped: string[];
  /** Legacy default-group items migrated into the shared access group. */
  migrated: string[];
  /** Fail-soft keychain write errors (never contains payloads/tokens). */
  errors: { account: string; op: 'upsert' | 'delete'; code: HelperErrorCode }[];
}

function emptyResult(status: KeychainSyncStatus): ReconcileResult {
  return {
    status,
    pulled: [],
    pushed: [],
    deletedLocally: [],
    purged: [],
    skipped: [],
    migrated: [],
    errors: [],
  };
}

function isExpiredTombstone(record: KeychainSyncRecord, now: number): boolean {
  return (
    record.deleted === true && (record.deletedAt ?? record.updatedAt) + TOMBSTONE_TTL_MS <= now
  );
}

// ============================================================================
// Legacy access-group migration
// ============================================================================

/** What {@link migrateLegacyGroupItems} did: the effective deduped item view
 * (one item per account) for reconcile to consume, plus bookkeeping. */
export interface MigrationOutcome {
  items: KeychainItem[];
  /** Accounts where a keychain write actually succeeded during migration —
   * a verified shared-group upsert and/or at least one legacy-copy delete.
   * An account whose only attempted writes all failed is NOT counted, so
   * reconcile's "every write rejected" degrade stays sound. */
  migrated: string[];
  errors: ReconcileResult['errors'];
}

/**
 * One-time (idempotent) migration of legacy default-group items into the
 * shared access group, run right after a successful helper `list`.
 *
 * Only runs when the helper advertises a resolved `sharedGroup` (the build's
 * provisioning profile authorizes it); otherwise the items pass through
 * untouched — current behavior, nothing to migrate into. Per account:
 *
 * - Any copy whose payload is unparseable or from a newer schema version
 *   freezes the whole account in place: nothing is written or deleted (the
 *   view prefers the shared copy when present), mirroring reconcile's
 *   frozen-account rule — migration never moves data it cannot compare, and
 *   an old-profile build keeps seeing its legacy item.
 * - Legacy copy only: upsert into the shared group (the helper's active
 *   write target); the legacy copy is deleted ONLY after that write
 *   verifies. A failed write keeps the legacy copy authoritative.
 * - Both copies: newer `updatedAt` wins, comparing the shared copy against
 *   the NEWEST legacy copy (`kSecAttrSynchronizable` is part of the keychain
 *   primary key, so one account can hold both a synchronizable and a
 *   non-synchronizable legacy copy). A newer legacy copy is re-written into
 *   the shared group first; older ones are simply deleted (the shared copy
 *   already preserves the data).
 *
 * `shouldAbort` is re-checked between the upsert and the legacy deletes so a
 * disable/dispose racing the write halts before the destructive step
 * (leftover legacy copies retry next pass).
 *
 * Fail-soft: every keychain error is recorded (never thrown) and the
 * account's surviving copy stays in the returned view, so a partially failed
 * migration simply retries on the next reconcile.
 */
export async function migrateLegacyGroupItems(
  client: KeychainClient,
  items: KeychainItem[],
  sharedGroup: string | undefined,
  shouldAbort?: () => boolean | Promise<boolean>,
): Promise<MigrationOutcome> {
  const outcome: MigrationOutcome = { items: [], migrated: [], errors: [] };
  if (sharedGroup === undefined || sharedGroup === '') {
    outcome.items = items;
    return outcome;
  }

  const byAccount = new Map<string, { shared?: KeychainItem; legacy: KeychainItem[] }>();
  const order: string[] = [];
  for (const item of items) {
    let entry = byAccount.get(item.account);
    if (!entry) {
      entry = { legacy: [] };
      byAccount.set(item.account, entry);
      order.push(item.account);
    }
    // An item with no group attribute cannot be told apart — treat it as
    // already in place (never migrated, kept in the view).
    if (item.group === undefined || item.group === sharedGroup) {
      if (!entry.shared) entry.shared = item;
    } else {
      entry.legacy.push(item);
    }
  }

  let aborted = false;
  for (const account of order) {
    const entry = byAccount.get(account) as { shared?: KeychainItem; legacy: KeychainItem[] };
    if (entry.legacy.length === 0) {
      outcome.items.push(entry.shared as KeychainItem);
      continue;
    }
    if (aborted || (shouldAbort && (await shouldAbort()))) {
      aborted = true;
      outcome.items.push(entry.shared ?? entry.legacy[0]);
      continue;
    }

    // Parse every copy up front; any non-record payload (unparseable or
    // newer schema) freezes the account — nothing written or deleted.
    const legacyParsed: { item: KeychainItem; record: KeychainSyncRecord }[] = [];
    let frozen = false;
    for (const li of entry.legacy) {
      const parsed = parsePayload(li.payload);
      if (parsed.kind !== 'record') {
        frozen = true;
        break;
      }
      legacyParsed.push({ item: li, record: parsed.record });
    }
    let sharedRecord: KeychainSyncRecord | undefined;
    if (!frozen && entry.shared) {
      const parsed = parsePayload(entry.shared.payload);
      if (parsed.kind !== 'record') frozen = true;
      else sharedRecord = parsed.record;
    }
    if (frozen) {
      outcome.items.push(entry.shared ?? entry.legacy[0]);
      continue;
    }

    // Pick the surviving payload: shared vs the NEWEST legacy copy by
    // updatedAt (synchronizable variants can yield several legacy copies).
    let newestLegacy = legacyParsed[0];
    for (const candidate of legacyParsed) {
      if (candidate.record.updatedAt > newestLegacy.record.updatedAt) newestLegacy = candidate;
    }
    let winner: KeychainItem = newestLegacy.item;
    if (entry.shared && sharedRecord && sharedRecord.updatedAt >= newestLegacy.record.updatedAt) {
      winner = entry.shared;
    }

    let upsertSucceeded = false;
    if (winner !== entry.shared) {
      // Legacy copy is authoritative: write it into the shared group first.
      const upserted = await client.upsert(account, winner.payload);
      if (!upserted.ok) {
        outcome.errors.push({ account, op: 'upsert', code: upserted.code });
        logger.warn('keychain group migration write failed', { account, code: upserted.code });
        outcome.items.push(newestLegacy.item);
        continue;
      }
      upsertSucceeded = true;
    }

    // Re-check cancellation before the destructive step: a disable/dispose
    // racing the upsert await must not be followed by legacy deletes.
    if (shouldAbort && (await shouldAbort())) {
      aborted = true;
      if (upsertSucceeded) {
        outcome.migrated.push(account);
        outcome.items.push({ ...winner, group: sharedGroup });
      } else {
        outcome.items.push(entry.shared ?? newestLegacy.item);
      }
      continue;
    }

    // The shared copy now holds the surviving payload — remove the legacy
    // copies (scoped to their group so the shared item is never touched).
    let deletesOk = true;
    let anyDeleteSucceeded = false;
    for (const stale of entry.legacy) {
      const deleted = await client.delete(account, stale.group as string);
      if (deleted.ok) {
        anyDeleteSucceeded = true;
      } else if (deleted.code !== 'not-found') {
        deletesOk = false;
        outcome.errors.push({ account, op: 'delete', code: deleted.code });
        logger.warn('keychain group migration cleanup failed', { account, code: deleted.code });
      }
    }
    if (upsertSucceeded || anyDeleteSucceeded) {
      outcome.migrated.push(account);
    }
    if (!deletesOk) {
      logger.warn('keychain group migration left a legacy copy (retries next pass)', { account });
    }
    outcome.items.push({ ...winner, group: sharedGroup });
  }
  return outcome;
}

/** Options for {@link reconcile} (injectable for tests). */
export interface ReconcileOptions {
  client?: KeychainClient;
  now?: number;
  /** Cooperative cancellation, checked before each account's writes. When it
   * returns true the pass stops early (already-applied accounts stay applied;
   * the rest are untouched). The lifecycle uses it so disabling sync while a
   * reconcile is in flight halts further pull/push side effects. */
  shouldAbort?: () => boolean | Promise<boolean>;
}

/**
 * One full two-way reconcile pass: pull newer keychain records/tombstones
 * into the local store, push newer local records/tombstones to the keychain,
 * and purge expired tombstones.
 *
 * Per account (the union of both sides), strictly newer `updatedAt` wins;
 * equal clocks are treated as in-sync (except a live/tombstone tie, where the
 * tombstone wins so every machine converges on the same outcome). Accounts
 * whose keychain payload is unparseable or from a newer schema version are
 * frozen — neither pulled nor pushed over.
 *
 * The cert fingerprint is the canonical MACHINE identity across accounts:
 * a remote record with no same-account local counterpart but whose
 * fingerprint matches a live local record under a DIFFERENT account (the
 * machine's host:port changed) is paired with that record instead of being
 * pulled as a duplicate. LWW still decides: a newer remote wins and the store
 * collapses the old record by fingerprint; a newer local record survives and
 * the stale remote account is tombstoned in the keychain (clock kept strictly
 * older than the survivor's) so other machines drop the old address too. A
 * fresh remote tombstone matching by fingerprint deletes the local record
 * even under a new address (ties favor the delete). Fingerprint-less legacy
 * records keep pure account-based semantics.
 *
 * Keychain unavailable (missing helper, non-mac, unsigned build, locked
 * keychain) is a clean no-op: the local store is never touched and the result
 * carries the `unavailable` status. Individual push/purge failures after a
 * successful list are fail-soft (collected in `errors`); this function never
 * throws for keychain reasons (adapter errors propagate). The final status
 * still reflects those write failures: every attempted write failing with the
 * entitlement-flavored `unavailable` code means the keychain is rejecting
 * writes wholesale (list can succeed on such builds), so the status is
 * `unavailable` rather than a false "active"; any other failure mix stays
 * `active` but carries `errorCount` so the UI can show a degraded note.
 */
export async function reconcile(
  adapter: LocalSyncAdapter,
  options: ReconcileOptions = {},
): Promise<ReconcileResult> {
  const client = options.client ?? createHelperKeychainClient();
  const now = options.now ?? Date.now();

  const listResult = await client.list();
  if (!listResult.ok) {
    logger.info('keychain sync unavailable', { reason: listResult.code });
    return emptyResult({
      state: 'unavailable',
      reason: listResult.code,
      message: listResult.message,
    });
  }

  const result = emptyResult({ state: 'active' });

  // Migrate legacy default-group items into the shared access group first
  // (no-op until the build's profile authorizes the shared group). The rest
  // of the pass consumes the migration's deduped one-item-per-account view.
  const migration = await migrateLegacyGroupItems(
    client,
    listResult.items,
    listResult.sharedGroup,
    options.shouldAbort,
  );
  result.migrated.push(...migration.migrated);
  result.errors.push(...migration.errors);

  const remote = new Map<string, KeychainSyncRecord>();
  const frozen = new Set<string>();
  for (const item of migration.items) {
    const parsed = parsePayload(item.payload);
    if (parsed.kind === 'record') {
      remote.set(item.account, parsed.record);
    } else {
      frozen.add(item.account);
      result.skipped.push(item.account);
      logger.warn('skipping keychain item', { account: item.account, reason: parsed.kind });
    }
  }

  const local = new Map<string, KeychainSyncRecord>();
  for (const record of await adapter.list()) {
    local.set(accountKeyFor(record.host, record.port), record);
  }

  // Live local records indexed by canonical fingerprint identity, so a remote
  // record sitting under a STALE account (the machine's host:port changed)
  // pairs with the local record now living under the new account instead of
  // being pulled back in as a resurrected duplicate.
  const localLiveByFp = new Map<string, { account: string; record: KeychainSyncRecord }>();
  for (const [account, record] of local) {
    if (record.deleted === true) continue;
    const fp = fingerprintKeyOf(record);
    if (fp !== null && !localLiveByFp.has(fp)) localLiveByFp.set(fp, { account, record });
  }
  /** Local accounts consumed by a cross-account fingerprint pairing — their
   * (now stale) snapshot must not be processed again under its own key. */
  const consumedLocal = new Set<string>();

  // Freshest unexpired tombstone per fingerprint, across BOTH sides and ALL
  // accounts. An unpaired live remote must never be pulled past a fresher
  // tombstone for the same machine sitting under a different account (or in
  // the local store): the pull would resurrect a forgotten backend and its
  // applyRemote would erase the very tombstone that was just honored.
  const tombstoneByFp = new Map<string, KeychainSyncRecord>();
  const noteTombstone = (record: KeychainSyncRecord): void => {
    if (record.deleted !== true || isExpiredTombstone(record, now)) return;
    const fp = fingerprintKeyOf(record);
    if (fp === null) return;
    const prev = tombstoneByFp.get(fp);
    if (!prev || record.updatedAt > prev.updatedAt) tombstoneByFp.set(fp, record);
  };
  for (const record of remote.values()) noteTombstone(record);
  for (const record of local.values()) noteTombstone(record);

  /** Keychain accounts already overwritten with a convergence tombstone this
   * pass — each stale account gets exactly ONE tombstone push even when
   * several branches would cover it (iteration-order dependent). */
  const tombstonedRemote = new Set<string>();
  async function pushTombstone(account: string, record: KeychainSyncRecord): Promise<void> {
    if (tombstonedRemote.has(account)) return;
    tombstonedRemote.add(account);
    await push(account, record);
  }

  async function push(account: string, record: KeychainSyncRecord): Promise<void> {
    // Pre-sync records carry the epoch-old clock 0 (see listSyncRecords).
    // Stamp them at push time so the keychain never holds a zero-clock item:
    // otherwise two machines that both hold differing zero-clock copies of
    // the same target hit the equal-clock in-sync skip and stay divergent
    // until an unrelated mutation. With the stamp, the first pusher wins and
    // the other machine pulls on its next reconcile.
    const toPush = record.updatedAt === 0 ? { ...record, updatedAt: now } : record;
    const pushed = await client.upsert(account, serializeRecord(toPush));
    if (pushed.ok) {
      result.pushed.push(account);
    } else {
      result.errors.push({ account, op: 'upsert', code: pushed.code });
      logger.warn('keychain push failed', { account, code: pushed.code });
    }
  }

  async function purge(account: string): Promise<void> {
    const deleted = await client.delete(account);
    if (deleted.ok || deleted.code === 'not-found') {
      result.purged.push(account);
    } else {
      result.errors.push({ account, op: 'delete', code: deleted.code });
      logger.warn('keychain tombstone purge failed', { account, code: deleted.code });
    }
  }

  const accounts = new Set<string>([...remote.keys(), ...local.keys()]);
  for (const account of accounts) {
    if (options.shouldAbort && (await options.shouldAbort())) {
      logger.info('keychain sync reconcile aborted mid-pass');
      break;
    }
    if (frozen.has(account)) continue;
    const r = remote.get(account);
    // An account consumed by a cross-account fingerprint pairing is treated
    // as locally absent: its snapshot is stale (the record was collapsed into
    // another account) and must not be pushed or paired again.
    const l = consumedLocal.has(account) ? undefined : local.get(account);

    if (r && !l) {
      // Same machine, different account? Pair by cert fingerprint so a
      // host:port change never resurrects the old address as a second record.
      const fp = fingerprintKeyOf(r);
      const match = fp !== null ? localLiveByFp.get(fp) : undefined;
      const paired =
        match !== undefined && match.account !== account && !consumedLocal.has(match.account);

      if (r.deleted === true) {
        if (paired && !isExpiredTombstone(r, now)) {
          // A fresh tombstone matches a live local record under a DIFFERENT
          // account (the machine was forgotten elsewhere before/after its
          // address changed here). LWW by updatedAt; on a tie the tombstone
          // wins so every machine converges — an address change must not
          // dodge a delete.
          if (r.updatedAt >= match.record.updatedAt) {
            await adapter.applyRemote(account, r);
            result.deletedLocally.push(account);
            consumedLocal.add(match.account);
            localLiveByFp.delete(fp as string);
            // Propagate the delete to the SURVIVING account too: without a
            // tombstone there, machines holding the record under the new
            // address keep it, and this machine pulls it right back on its
            // next pass (the live keychain item would outlive this TTL).
            // `r.updatedAt >= match.record.updatedAt` holds here and ties
            // favor tombstones, so it wins everywhere.
            await pushTombstone(match.account, {
              ...match.record,
              token: '',
              deleted: true,
              updatedAt: r.updatedAt,
              deletedAt: now,
            });
          }
          // Else the local record is newer (re-add/edit after the forget):
          // it survives and pushes under its own account; the stale
          // tombstone ages out via its TTL.
          continue;
        }
        // Nothing local to delete; just purge the tombstone once expired.
        if (isExpiredTombstone(r, now)) await purge(account);
        continue;
      }

      if (paired) {
        // Both live, same fingerprint, different accounts: one machine, two
        // addresses. Strictly newer wins; an exact tie breaks by account key
        // so every machine picks the same survivor.
        const remoteWins =
          r.updatedAt > match.record.updatedAt ||
          (r.updatedAt === match.record.updatedAt && account > match.account);
        if (remoteWins) {
          // The remote account carries the machine's newer address/data:
          // pull it — the store collapses the old record by fingerprint.
          await adapter.applyRemote(account, r);
          result.pulled.push(account);
          consumedLocal.add(match.account);
          localLiveByFp.set(fp as string, { account, record: r });
          // If the LOSING account also sits live in the keychain (two stale
          // accounts for one machine, already-iterated or not), tombstone it
          // there too — consuming it locally alone leaves the live item
          // surfacing duplicates on every other machine.
          const staleRemote = remote.get(match.account);
          if (staleRemote && staleRemote.deleted !== true) {
            let staleClock = Math.min(staleRemote.updatedAt, r.updatedAt - 1);
            if (staleClock === 0) staleClock = -1; // 0 would be re-stamped by push()
            await pushTombstone(match.account, {
              ...staleRemote,
              token: '',
              deleted: true,
              updatedAt: staleClock,
              deletedAt: now,
            });
          }
        } else {
          // The REMOTE account is the stale one. Never pull it back in;
          // instead tombstone it in the keychain so other machines drop the
          // old address too. The tombstone's clock is kept strictly older
          // than the survivor's so it can never win over the live record
          // (ties favor tombstones); `deletedAt: now` gives it a full TTL
          // window to propagate. The survivor pushes under its own account.
          let staleClock = Math.min(r.updatedAt, match.record.updatedAt - 1);
          if (staleClock === 0) staleClock = -1; // 0 would be re-stamped by push()
          await pushTombstone(account, {
            ...r,
            token: '',
            deleted: true,
            updatedAt: staleClock,
            deletedAt: now,
          });
        }
        continue;
      }

      // An unpaired live pull must still honor a fresher (or equal)
      // unexpired tombstone for the same machine sitting under ANOTHER
      // account or in the local store: pulling would resurrect a forgotten
      // backend (and applyRemote's live path clears the very tombstone that
      // was just honored). Skip the pull and tombstone this account too so
      // every machine converges on the delete.
      const shield = fp !== null ? tombstoneByFp.get(fp) : undefined;
      if (shield && shield.updatedAt >= r.updatedAt) {
        await pushTombstone(account, {
          ...r,
          token: '',
          deleted: true,
          updatedAt: shield.updatedAt,
          deletedAt: now,
        });
        continue;
      }

      await adapter.applyRemote(account, r);
      result.pulled.push(account);
      // Register the pull as this machine's live record for the fingerprint
      // so a second stale live account for the same machine pairs with it
      // (and loses by LWW) instead of being pulled as a duplicate.
      if (fp !== null) localLiveByFp.set(fp, { account, record: r });
      continue;
    }

    if (l && !r) {
      // Expired local tombstones are dead history — never resurrect them
      // into the keychain.
      if (!isExpiredTombstone(l, now)) await push(account, l);
      continue;
    }

    if (!r || !l) continue;

    if (r.deleted === true && l.deleted === true) {
      // Both agree it is gone; only the TTL purge remains.
      if (isExpiredTombstone(r, now) || isExpiredTombstone(l, now)) await purge(account);
      continue;
    }

    // Identical clocks with both sides live = in sync. Exception: the
    // epoch-old clock 0 (pre-sync records) — two machines with differing
    // zero-clock copies would otherwise skip here forever; instead fall
    // through so the local copy is pushed with a fresh stamp and the other
    // machine pulls it on its next pass. Otherwise strictly newer wins; on an
    // exact live/tombstone tie the tombstone wins so both machines converge
    // on the same outcome.
    if (
      r.updatedAt === l.updatedAt &&
      r.updatedAt !== 0 &&
      r.deleted !== true &&
      l.deleted !== true
    )
      continue;
    const remoteWins =
      r.updatedAt > l.updatedAt || (r.updatedAt === l.updatedAt && r.deleted === true);

    if (remoteWins) {
      if (r.deleted === true && isExpiredTombstone(r, now)) {
        // The delete-propagation window closed while this machine was
        // offline: an expired tombstone is dead history and must never
        // delete a live local record. Purge the stale keychain item and
        // push the local survivor so it becomes the record of note again.
        await purge(account);
        await push(account, l);
        continue;
      }
      await adapter.applyRemote(account, r);
      if (r.deleted === true) {
        result.deletedLocally.push(account);
      } else {
        result.pulled.push(account);
      }
    } else if (l.deleted === true && isExpiredTombstone(l, now)) {
      // The keychain still holds a live (older) record for a long-forgotten
      // backend; remove the item instead of refreshing an expired tombstone.
      await purge(account);
    } else {
      await push(account, l);
    }
  }

  if (result.errors.length > 0) {
    const anyWriteSucceeded =
      result.pushed.length > 0 || result.purged.length > 0 || result.migrated.length > 0;
    if (!anyWriteSucceeded && result.errors.every((e) => e.code === 'unavailable')) {
      logger.warn('keychain sync degraded to unavailable: every write rejected', {
        errorCount: result.errors.length,
      });
      result.status = {
        state: 'unavailable',
        reason: 'unavailable',
        message: 'keychain writes are being rejected (reads OK); nothing can be pushed',
      };
    } else {
      result.status = { state: 'active', errorCount: result.errors.length };
    }
  }

  return result;
}
