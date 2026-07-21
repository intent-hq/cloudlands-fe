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
 * daemon-authoritative value. Secret keys are never hydrated in plaintext
 * (the daemon only ever exposes a redacted placeholder on read); writes push
 * through to the daemon secret store.
 *
 * FE-local `AppConfig` sub-keys (`appearance`, `editor`, `shortcuts`,
 * `experimental`, and the `workspace.*` UI knobs) are intentionally NOT
 * routed here — the audit tags them as renderer/env-only transient state.
 */

import type { ConfigManager } from '../../../shared/services/config-manager';
import { Logger } from '../../../shared/logger';

const logger = new Logger('ConfigDaemonSync');

/** Daemon settings-catalog paths that mirror `AppConfig` sub-keys. */
export const NON_SECRET_DAEMON_KEYS = [
  'permissions.rules',
  'userRules',
  'workspaceRules',
] as const;

/** Sensitive keys — writes push through, reads never hydrate plaintext. */
export const SECRET_DAEMON_KEYS = [] as const;

export const ALL_DAEMON_KEYS = [...NON_SECRET_DAEMON_KEYS, ...SECRET_DAEMON_KEYS] as const;

async function daemonGet(path: string): Promise<unknown> {
  const { getBackendClient } = await import('../../backend/main/backend.ipc');
  const result = (await getBackendClient().request('settings.get', { path })) as {
    value?: unknown;
  } | null;
  return result?.value;
}

async function daemonUpdate(changes: Array<{ path: string; value: unknown }>): Promise<void> {
  if (changes.length === 0) return;
  const { getBackendClient } = await import('../../backend/main/backend.ipc');
  await getBackendClient().request('settings.update', { changes });
}

/**
 * Hydrate ConfigManager's non-secret daemon-owned sub-keys from the daemon.
 * Secrets are skipped so plaintext never enters `ConfigManager`.
 */
export async function hydrateFromDaemon(configManager: ConfigManager): Promise<void> {
  for (const path of NON_SECRET_DAEMON_KEYS) {
    try {
      const value = await daemonGet(path);
      if (value !== undefined && value !== null) {
        configManager.set(path, value as never);
      }
    } catch (error) {
      logger.warn(`Failed to hydrate ${path} from daemon`, error as Error);
    }
  }
}

export function isDaemonOwnedKey(path: string): boolean {
  return (ALL_DAEMON_KEYS as readonly string[]).includes(path);
}

/**
 * Push a single daemon-owned sub-key to the daemon via `settings.update`.
 */
export async function pushDaemonKey(path: string, value: unknown): Promise<void> {
  if (!isDaemonOwnedKey(path)) return;
  try {
    await daemonUpdate([{ path, value }]);
  } catch (error) {
    logger.error(`Failed to push ${path} to daemon`, error as Error);
    throw error;
  }
}

/**
 * Push all daemon-owned sub-keys' current values from ConfigManager to the
 * daemon in one batched `settings.update` call. Called by `persistConfig()`
 * on user-rules changes so rules land on the daemon-authoritative store.
 * Secrets are omitted (ConfigManager holds no plaintext to push).
 */
export async function pushAllDaemonKeys(configManager: ConfigManager): Promise<void> {
  const changes: Array<{ path: string; value: unknown }> = [];
  for (const path of NON_SECRET_DAEMON_KEYS) {
    const value = configManager.get(path);
    if (value !== undefined) {
      changes.push({ path, value });
    }
  }
  await daemonUpdate(changes);
}
