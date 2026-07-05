/**
 * Config IPC
 *
 * Exposes read/write access to the application configuration from the renderer.
 * Kept minimal and read-mostly for safety.
 *
 * P3-4: the legacy `workspace-config` electron-store is retired. Daemon-owned
 * sub-keys of `AppConfig` (ai.*, permissions.rules, userRules, workspaceRules)
 * are hydrated from and pushed to the daemon settings catalog via
 * `settings.get` / `settings.update` (PROTOCOL.md §5.12). FE-local sub-keys
 * (`appearance`, `editor`, `shortcuts`, `experimental`, `workspace.*`) are
 * held in `ConfigManager` memory only for the session, per the P3-4 audit —
 * they no longer have their own on-disk store.
 */

import { ipcMain } from 'electron';
import { ConfigManager } from '../../../shared/services/config-manager';
import { Logger } from '../../../shared/logger';
import { CONFIG_CHANNELS } from '../../../shared/ipc/channels';
import { createSafeValidatedHandler } from '../../../main/ipc-validation-middleware';
import {
  ConfigGetSchema,
  ConfigSetSchema,
  ConfigGetAllSchema,
} from '../../../main/ipc-schemas';
import {
  hydrateFromDaemon,
  isDaemonOwnedKey,
  pushDaemonKey,
  pushAllDaemonKeys,
} from './config-daemon-sync';

const logger = new Logger('ConfigIPC');

let configManager: ConfigManager | null = null;

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
    await pushAllDaemonKeys(configManager);
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
      await hydrateFromDaemon(configManager);
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
      async (_evt, validated) => {
        try {
          if (!configManager) throw new Error('ConfigManager not initialized');
          if (validated.key) {
            return configManager.get(validated.key as any);
          }
          return configManager.getAll();
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
      async (_evt, validated) => {
        try {
          if (!configManager) throw new Error('ConfigManager not initialized');

          if (validated.value === undefined) {
            return { success: false, error: 'Config value cannot be undefined' };
          }

          configManager.set(validated.key, validated.value);

          // Daemon-owned sub-keys are pushed to the daemon; FE-local sub-keys
          // stay in-memory for the session.
          if (isDaemonOwnedKey(validated.key)) {
            try {
              await pushDaemonKey(validated.key, validated.value);
              logger.debug('Pushed daemon-owned config change', { key: validated.key });
            } catch (err) {
              logger.warn('Failed to push config change to daemon', err as Error);
            }
          }

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
      async () => {
        try {
          if (!configManager) throw new Error('ConfigManager not initialized');
          return configManager.getAll();
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
