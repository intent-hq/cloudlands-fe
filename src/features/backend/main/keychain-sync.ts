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
  /** Primary remote host/IP (identity, with `port`). */
  host: string;
  /** Candidate hosts (primary first) — mirrors the store's `hosts` semantics. */
  hosts: string[];
  port: number;
  fingerprint: string;
  hostname: string | null;
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

/** Serialize a record into the keychain payload string (token scrubbed on
 * tombstones so forgotten backends never keep a secret in the keychain). */
export function serializeRecord(record: KeychainSyncRecord): string {
  const payload: Record<string, unknown> = {
    v: KEYCHAIN_PAYLOAD_VERSION,
    label: record.label,
    host: record.host,
    hosts: record.hosts,
    port: record.port,
    fingerprint: record.fingerprint,
    hostname: record.hostname,
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
    host: obj.host,
    hosts:
      Array.isArray(obj.hosts) && obj.hosts.every((h) => typeof h === 'string')
        ? (obj.hosts as string[])
        : [obj.host],
    port: obj.port,
    fingerprint: obj.fingerprint,
    hostname: typeof obj.hostname === 'string' ? obj.hostname : null,
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
}

export type KeychainClientResult<T> =
  ({ ok: true } & T) | { ok: false; code: HelperErrorCode; message: string };

/**
 * Thin async facade over the helper CLI. `createHelperKeychainClient()`
 * builds the real spawn-based client; tests (and T3, if it ever needs to)
 * can substitute an in-memory implementation.
 */
export interface KeychainClient {
  list(): Promise<KeychainClientResult<{ items: KeychainItem[] }>>;
  upsert(account: string, payload: string): Promise<KeychainClientResult<object>>;
  delete(account: string): Promise<KeychainClientResult<object>>;
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
      return { ok: true, items };
    },
    upsert(account, payload) {
      return invoke(['upsert', account], JSON.stringify({ payload }));
    },
    delete(account) {
      return invoke(['delete', account]);
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
 * {@link HelperErrorCode} naming why the keychain cannot be used. */
export type KeychainSyncStatus =
  { state: 'active' } | { state: 'unavailable'; reason: HelperErrorCode; message: string };

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
    errors: [],
  };
}

function isExpiredTombstone(record: KeychainSyncRecord, now: number): boolean {
  return (
    record.deleted === true && (record.deletedAt ?? record.updatedAt) + TOMBSTONE_TTL_MS <= now
  );
}

/** Options for {@link reconcile} (injectable for tests). */
export interface ReconcileOptions {
  client?: KeychainClient;
  now?: number;
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
 * Keychain unavailable (missing helper, non-mac, unsigned build, locked
 * keychain) is a clean no-op: the local store is never touched and the result
 * carries the `unavailable` status. Individual push/purge failures after a
 * successful list are fail-soft (collected in `errors`); this function never
 * throws for keychain reasons (adapter errors propagate).
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

  const remote = new Map<string, KeychainSyncRecord>();
  const frozen = new Set<string>();
  for (const item of listResult.items) {
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

  async function push(account: string, record: KeychainSyncRecord): Promise<void> {
    const pushed = await client.upsert(account, serializeRecord(record));
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
    if (frozen.has(account)) continue;
    const r = remote.get(account);
    const l = local.get(account);

    if (r && !l) {
      if (r.deleted === true) {
        // Nothing local to delete; just purge the tombstone once expired.
        if (isExpiredTombstone(r, now)) await purge(account);
      } else {
        await adapter.applyRemote(account, r);
        result.pulled.push(account);
      }
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

    // Identical clocks with both sides live = in sync. Otherwise strictly
    // newer wins; on an exact live/tombstone tie the tombstone wins so both
    // machines converge on the same outcome.
    if (r.updatedAt === l.updatedAt && r.deleted !== true && l.deleted !== true) continue;
    const remoteWins =
      r.updatedAt > l.updatedAt || (r.updatedAt === l.updatedAt && r.deleted === true);

    if (remoteWins) {
      await adapter.applyRemote(account, r);
      if (r.deleted === true) {
        result.deletedLocally.push(account);
        if (isExpiredTombstone(r, now)) await purge(account);
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

  return result;
}
