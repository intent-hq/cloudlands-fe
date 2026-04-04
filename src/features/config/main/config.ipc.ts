/**
 * Config IPC
 *
 * Exposes read/write access to the application configuration from the renderer.
 * Kept minimal and read-mostly for safety.
 */

import { ipcMain } from 'electron';
import { ConfigManager } from '../../../shared/services/config-manager';
import { Logger } from '../../../shared/logger';
import { CONFIG_CHANNELS } from '../../../shared/ipc/channels';
import { createSafeValidatedHandler } from '../../../main/ipc-validation-middleware';
import { ConfigGetSchema, ConfigSetSchema, ConfigGetAllSchema } from '../../../main/ipc-schemas';

const logger = new Logger('ConfigIPC');

let configManager: ConfigManager | null = null;
// We'll use dynamic import for electron-store to avoid ESM issues
let configStore: any = null;

/**
 * Get the shared ConfigManager instance
 */
export function getConfigManager(): ConfigManager | null {
  return configManager;
}

/**
 * Persist the current config to electron-store
 */
export async function persistConfig(): Promise<void> {
  if (configManager && configStore) {
    try {
      const allConfig = configManager.getAll();
      configStore.set('config', allConfig);
      logger.debug('Persisted configuration to electron-store');
    } catch (err) {
      logger.error('Failed to persist config', err as Error);
      throw err;
    }
  }
}

export async function setupConfigIPC() {
  logger.info('Setting up config IPC handlers');

  // Use dynamic import to avoid ESM issues
  if (!configStore) {
    try {
      const ElectronStore = (await import('electron-store')).default;
      configStore = new ElectronStore({ name: 'workspace-config' });
      logger.info('Initialized electron-store for config persistence');
    } catch (err) {
      logger.error('Failed to initialize electron-store', err as Error);
      // Continue without persistence
    }
  }

  if (!configManager) {
    configManager = new ConfigManager();

    // Load persisted config and apply to ConfigManager if store is available
    try {
      if (configStore) {
        const persistedConfig = configStore.get('config');
        if (persistedConfig) {
          // Apply persisted values to ConfigManager
          for (const [key, value] of Object.entries(persistedConfig)) {
            configManager.set(key as any, value);
          }
          logger.info('Loaded persisted configuration', {
            hasWorkspaceRules: !!persistedConfig.workspaceRules,
            workspaceRulesContent: persistedConfig.workspaceRules?.content?.substring(0, 100),
          });
        } else {
          logger.info('No persisted configuration found, using defaults');
        }
      }

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

          // If key is provided, use it; otherwise return all config
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

          // Basic validation for value - ensure it's not undefined when not intended
          if (validated.value === undefined) {
            return { success: false, error: 'Config value cannot be undefined' };
          }

          configManager.set(validated.key, validated.value);

          // Persist the entire config to electron-store if available
          if (configStore) {
            try {
              const allConfig = configManager.getAll();
              configStore.set('config', allConfig);
              logger.debug('Persisted configuration change', { key: validated.key });
            } catch (err) {
              logger.warn('Failed to persist config change', err as Error);
              // Continue - the change is still in memory
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
