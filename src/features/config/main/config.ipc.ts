/**
 * Config IPC
 *
 * Exposes read/write access to the application configuration from the renderer.
 * Kept minimal and read-mostly for safety.
 *
 * P3-4: the legacy `workspace-config` electron-store is retired. Daemon-owned
 * sub-keys of `AppConfig` (permissions.rules, userRules, workspaceRules)
 * are hydrated from and pushed to the daemon settings catalog via
 * `settings.get` / `settings.update` (PROTOCOL.md §5.12). FE-local sub-keys
 * (`appearance`, `editor`, `shortcuts`, `experimental`, `workspace.*`) are
 * held in `ConfigManager` memory only for the session, per the P3-4 audit —
 * they no longer have their own on-disk store.
 *
 * Backend policy: per-sender for the IPC handlers (each request resolves the
 * invoking window's backend via `getBackendClientForId`, fail-closed when
 * that backend has no live client) and local-pinned for hydration /
 * `persistConfig` (the in-memory ConfigManager mirrors the LOCAL daemon's
 * values only).
 */

import { ipcMain } from 'electron';
import { ConfigManager } from '../../../shared/services/config-manager';
import { Logger } from '../../../shared/logger';
import { m } from '$shared/paraglide/messages.js';
import { CONFIG_CHANNELS } from '../../../shared/ipc/channels';
import { createSafeValidatedHandler } from '../../../main/ipc-validation-middleware';
import { ConfigGetSchema, ConfigSetSchema, ConfigGetAllSchema } from '../../../main/ipc-schemas';
import {
  hydrateFromDaemon,
  isDaemonOwnedKey,
  NON_SECRET_DAEMON_KEYS,
  pushDaemonKey,
  pushAllDaemonKeys,
  readDaemonKey,
} from './config-daemon-sync';
import {
  getBackendClientForId,
  getBackendIdForIpcSender,
  getLocalBackendClient,
} from '../../backend/main/backend.ipc';
import type { JsonRpcClient } from '../../backend/main/json-rpc-client';
import { LOCAL_CONNECTION_ID } from '../../backend/main/connections-store';

const logger = new Logger('ConfigIPC');

let configManager: ConfigManager | null = null;

function getLocalClient(): JsonRpcClient | undefined {
  try {
    return getLocalBackendClient();
  } catch {
    return undefined;
  }
}

function setPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const segments = path.split('.');
  const leaf = segments.pop();
  if (!leaf) return;
  let cursor = target;
  for (const segment of segments) {
    const next = cursor[segment];
    if (!next || typeof next !== 'object' || Array.isArray(next)) cursor[segment] = {};
    cursor = cursor[segment] as Record<string, unknown>;
  }
  cursor[leaf] = value;
}

async function getAllForBackend(
  client: JsonRpcClient,
): Promise<ReturnType<ConfigManager['getAll']>> {
  if (!configManager) throw new Error('ConfigManager not initialized');
  const config = structuredClone(configManager.getAll()) as unknown as Record<string, unknown>;
  await Promise.all(
    NON_SECRET_DAEMON_KEYS.map(async (path) => {
      try {
        const value = await readDaemonKey(path, client);
        if (value !== undefined && value !== null) setPath(config, path, value);
      } catch (err) {
        logger.warn('Failed to read daemon-owned config key', err as Error, { path });
      }
    }),
  );
  return config as unknown as ReturnType<ConfigManager['getAll']>;
}

/**
 * Get the shared ConfigManager instance
 */
export function getConfigManager(): ConfigManager | null {
  return configManager;
}

/**
 * Persist the daemon-owned subset of the current config to the daemon.
 * Kept as an async function for backward compatibility with existing
 * callers (e.g. `user-rules.ipc.ts`) that awaited a filesystem flush.
 */
export async function persistConfig(): Promise<void> {
  if (!configManager) return;
  try {
    const localClient = getLocalClient();
    if (!localClient) throw new Error('Local backend client is not connected');
    await pushAllDaemonKeys(configManager, localClient);
    logger.debug('Persisted daemon-owned config sub-keys to daemon');
  } catch (err) {
    logger.error('Failed to persist config to daemon', err as Error);
    throw err;
  }
}

export async function setupConfigIPC() {
  logger.info('Setting up config IPC handlers');

  if (!configManager) {
    configManager = new ConfigManager();

    // Hydrate the daemon-owned sub-keys of AppConfig from the daemon so the
    // renderer sees canonical values. FE-local sub-keys stay at their in-memory
    // defaults for the session.
    try {
      const localClient = getLocalClient();
      if (localClient) await hydrateFromDaemon(configManager, localClient);
      await configManager.initialize();
    } catch (err) {
      logger.error('Failed to initialize ConfigManager', err as Error);
    }
  }

  // Read a namespaced key (e.g., "shortcuts" or "appearance.theme")
  ipcMain.handle(
    CONFIG_CHANNELS.GET,
    createSafeValidatedHandler(
      ConfigGetSchema,
      async (event, validated) => {
        try {
          if (!configManager) throw new Error('ConfigManager not initialized');
          if (validated.key) {
            if (isDaemonOwnedKey(validated.key)) {
              const client = getBackendClientForId(getBackendIdForIpcSender(event.sender));
              return await readDaemonKey(validated.key, client);
            }
            return configManager.get(validated.key as any);
          }
          const client = getBackendClientForId(getBackendIdForIpcSender(event.sender));
          return await getAllForBackend(client);
        } catch (err) {
          logger.error('config:get error', err as Error, { key: validated.key });
          return null;
        }
      },
      CONFIG_CHANNELS.GET,
    ),
  );

  // Optional: write a namespaced key
  ipcMain.handle(
    CONFIG_CHANNELS.SET,
    createSafeValidatedHandler(
      ConfigSetSchema,
      async (event, validated) => {
        try {
          if (!configManager) throw new Error('ConfigManager not initialized');

          if (validated.value === undefined) {
            return { success: false, error: m.config_ipc_valueUndefined_error() };
          }

          // Daemon-owned sub-keys are pushed to the daemon; FE-local sub-keys
          // stay in-memory for the session. A failed daemon push fails closed
          // (success: false) — the value was NOT persisted.
          if (isDaemonOwnedKey(validated.key)) {
            try {
              const backendId = getBackendIdForIpcSender(event.sender);
              await pushDaemonKey(validated.key, validated.value, getBackendClientForId(backendId));
              // The in-memory ConfigManager mirrors the LOCAL daemon only.
              if (backendId === LOCAL_CONNECTION_ID) {
                configManager.set(validated.key, validated.value);
              }
              logger.debug('Pushed daemon-owned config change', { key: validated.key });
            } catch (err) {
              logger.warn('Failed to push config change to daemon', err as Error);
              return { success: false, error: String(err) };
            }
          } else configManager.set(validated.key, validated.value);

          return { success: true };
        } catch (err) {
          logger.error('config:set error', err as Error, { key: validated.key });
          return { success: false, error: String(err) };
        }
      },
      CONFIG_CHANNELS.SET,
    ),
  );

  // Read entire config
  ipcMain.handle(
    CONFIG_CHANNELS.GET_ALL,
    createSafeValidatedHandler(
      ConfigGetAllSchema,
      async (event) => {
        try {
          if (!configManager) throw new Error('ConfigManager not initialized');
          const client = getBackendClientForId(getBackendIdForIpcSender(event.sender));
          return await getAllForBackend(client);
        } catch (err) {
          logger.error('config:getAll error', err as Error);
          return null;
        }
      },
      CONFIG_CHANNELS.GET_ALL,
    ),
  );

  logger.info('Config IPC handlers setup complete');
}
