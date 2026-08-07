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
export interface EncryptedToken {
  encrypted: boolean;
  value: string;
}

/** A remote connection as persisted on disk (token included). */
export interface StoredConnection {
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
  encToken: EncryptedToken;
}

/** Fields required to register a new remote connection. */
export interface NewConnection {
  label: string;
  host: string;
  port: number;
  fingerprint: string;
  token: string;
}

interface PersistedState {
  connections: StoredConnection[];
  activeId: string;
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
    port: null,
    fingerprint: null,
    isLocal: true,
  };
}

function toRecord(stored: StoredConnection): ConnectionRecord {
  return {
    id: stored.id,
    label: stored.label,
    host: stored.host,
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
    !!tok &&
    typeof tok === 'object' &&
    typeof tok.encrypted === 'boolean' &&
    typeof tok.value === 'string'
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
      return { connections, activeId };
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') {
      logger.warn('Failed to read backend-connections', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { connections: [], activeId: LOCAL_CONNECTION_ID };
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
 * List all connections: the synthesized local entry first, then persisted
 * remotes in insertion order. Tokens are never included.
 */
export async function list(): Promise<ConnectionRecord[]> {
  const state = await readState();
  return [localRecord(), ...state.connections.map(toRecord)];
}

/**
 * Register a new remote connection. The plaintext token is encrypted (or
 * marked plaintext) before it hits disk. Returns the token-free record.
 */
export async function add(conn: NewConnection): Promise<ConnectionRecord> {
  const stored: StoredConnection = {
    id: randomUUID(),
    label: conn.label,
    host: conn.host,
    port: conn.port,
    fingerprint: conn.fingerprint,
    encToken: encryptToken(conn.token),
  };
  await mutate((state) => {
    state.connections.push(stored);
    return writeState(state);
  });
  return toRecord(stored);
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
  await mutate((state) => {
    const conn = state.connections.find((c) => c.id === id);
    if (!conn) return; // unknown id: nothing to label
    conn.hostname = trimmed;
    return writeState(state);
  });
}

/**
 * Forget a remote connection. Rejects the reserved `local` id. If the
 * forgotten connection was active, the active selection falls back to `local`.
 */
export async function forget(id: string): Promise<void> {
  if (id === LOCAL_CONNECTION_ID) {
    throw new Error('Cannot forget the local connection');
  }
  await mutate((state) => {
    state.connections = state.connections.filter((c) => c.id !== id);
    if (state.activeId === id) {
      state.activeId = LOCAL_CONNECTION_ID;
    }
    return writeState(state);
  });
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
