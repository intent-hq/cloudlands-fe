/**
 * Config ↔ Daemon Sync
 *
 * Routes the daemon-owned sub-keys of `ConfigManager` (the fields of `AppConfig`
 * that PROTOCOL.md §5.12 lists as canonical settings) through the daemon
 * settings catalog via `settings.get` / `settings.update`. Wraps a
 * batched `{ changes: [{ path, value }] }` push and a straight
 * `{ path }` read.
 *
 * The former `workspace-config` electron-store held the entire `AppConfig`
 * blob; this module is the successor for the daemon-owned subset. Non-secret
 * sub-keys are hydrated into `ConfigManager` on startup so callers see the
 * daemon-authoritative value. `SECRET_DAEMON_KEYS` is currently empty (the
 * retired `ai.apiToken` was the only entry); if a secret key returns, its
 * reads must never hydrate plaintext — the daemon only ever exposes a
 * redacted placeholder — while writes push through to the daemon secret
 * store.
 *
 * FE-local `AppConfig` sub-keys (`appearance`, `editor`, `shortcuts`,
 * `experimental`, and the `workspace.*` UI knobs) are intentionally NOT
 * routed here — the audit tags them as renderer/env-only transient state.
 */

import type { ConfigManager } from '../../../shared/services/config-manager';
import { Logger } from '../../../shared/logger';
import type { JsonRpcClient } from '../../backend/main/json-rpc-client';

const logger = new Logger('ConfigDaemonSync');

/** Daemon settings-catalog paths that mirror `AppConfig` sub-keys. */
export const NON_SECRET_DAEMON_KEYS = ['permissions.rules', 'userRules', 'workspaceRules'] as const;

/** Sensitive keys — writes push through, reads never hydrate plaintext. */
const SECRET_DAEMON_KEYS = [] as const;

const ALL_DAEMON_KEYS = [...NON_SECRET_DAEMON_KEYS, ...SECRET_DAEMON_KEYS] as const;

type SettingsClient = Pick<JsonRpcClient, 'request'>;

/**
 * Per-key sync state for the daemon-owned sub-keys mirrored in `ConfigManager`.
 * Hydration runs in the background and can overlap with local writes, so:
 *
 * - `localWriteVersions` is bumped on every local write; a `settings.get`
 *   that was in flight across the bump is discarded as stale (same pattern
 *   as `deltaVersions` in app-settings.service.ts).
 * - `canonicalKeys` holds the keys whose in-memory value is known-good —
 *   hydrated from the daemon or written locally this session. Only those
 *   may be pushed back: an un-hydrated in-memory default must never reach
 *   the daemon as canonical state.
 */
const localWriteVersions = new Map<string, number>();
const canonicalKeys = new Set<string>();

async function resolveClient(client?: SettingsClient): Promise<SettingsClient> {
  if (client) return client;
  const { getBackendClient } = await import('../../backend/main/backend.ipc');
  return getBackendClient();
}

export async function readDaemonKey(path: string, client?: SettingsClient): Promise<unknown> {
  const result = (await (await resolveClient(client)).request('settings.get', { path })) as {
    value?: unknown;
  } | null;
  return result?.value;
}

async function daemonUpdate(
  changes: Array<{ path: string; value: unknown }>,
  client?: SettingsClient,
): Promise<void> {
  if (changes.length === 0) return;
  await (await resolveClient(client)).request('settings.update', { changes });
}

/**
 * Record a local write of a daemon-owned sub-key in `ConfigManager`. Bumps
 * the key's write version so an older in-flight hydration read cannot land
 * on top of it, and marks the key canonical (pushable). Call this — not
 * `configManager.set` directly — for every local write of a daemon-owned key
 * whose value has already been pushed to (or is authoritative over) the daemon.
 */
export function applyLocalDaemonKeyWrite(
  configManager: ConfigManager,
  path: string,
  value: unknown,
): void {
  configManager.set(path as never, value as never);
  localWriteVersions.set(path, (localWriteVersions.get(path) ?? 0) + 1);
  canonicalKeys.add(path);
}

/**
 * Hydrate ConfigManager's non-secret daemon-owned sub-keys from the daemon.
 * Secrets are skipped so plaintext never enters `ConfigManager`. Never
 * rejects: failures are warn-logged and leave the affected keys at their
 * current values (and not canonical, so they are not pushed back). A result
 * for a key that was written locally while its read was in flight is
 * discarded — the local write is newer. A `null` daemon value counts as a
 * successful read: the key is simply unset there.
 */
export async function hydrateFromDaemon(
  configManager: ConfigManager,
  client?: SettingsClient,
): Promise<void> {
  // Resolve the client once up front so the fan-out shares it.
  let resolved: SettingsClient;
  try {
    resolved = await resolveClient(client);
  } catch (error) {
    logger.warn('Failed to hydrate config from daemon: no backend client', error as Error);
    return;
  }
  // Fetch every key in parallel: one slow or failing read must not delay or
  // skip the others, and per-key failures stay independent.
  await Promise.allSettled(
    NON_SECRET_DAEMON_KEYS.map(async (path) => {
      const versionAtStart = localWriteVersions.get(path) ?? 0;
      try {
        const value = await readDaemonKey(path, resolved);
        if ((localWriteVersions.get(path) ?? 0) !== versionAtStart) {
          logger.debug('Discarding stale hydration result for locally written key', { path });
        } else if (value !== undefined && value !== null) {
          configManager.set(path, value as never);
        }
        canonicalKeys.add(path);
      } catch (error) {
        logger.warn(`Failed to hydrate ${path} from daemon`, error as Error);
      }
    }),
  );
}

export function isDaemonOwnedKey(path: string): boolean {
  return (ALL_DAEMON_KEYS as readonly string[]).includes(path);
}

/**
 * Push a single daemon-owned sub-key to the daemon via `settings.update`.
 */
export async function pushDaemonKey(
  path: string,
  value: unknown,
  client?: SettingsClient,
): Promise<void> {
  if (!isDaemonOwnedKey(path)) return;
  try {
    await daemonUpdate([{ path, value }], client);
  } catch (error) {
    logger.error(`Failed to push ${path} to daemon`, error as Error);
    throw error;
  }
}

/**
 * Push the canonical daemon-owned sub-keys' current values from ConfigManager
 * to the daemon in one batched `settings.update` call. Called by
 * `persistConfig()` on user-rules changes so rules land on the
 * daemon-authoritative store. Keys that are neither hydrated yet nor written
 * locally this session are skipped — pushing their in-memory defaults would
 * erase the user's saved values. Secrets are omitted (ConfigManager holds no
 * plaintext to push).
 */
export async function pushAllDaemonKeys(
  configManager: ConfigManager,
  client?: SettingsClient,
): Promise<void> {
  const changes: Array<{ path: string; value: unknown }> = [];
  for (const path of NON_SECRET_DAEMON_KEYS) {
    if (!canonicalKeys.has(path)) continue;
    const value = configManager.get(path);
    if (value !== undefined) {
      changes.push({ path, value });
    }
  }
  await daemonUpdate(changes, client);
}
