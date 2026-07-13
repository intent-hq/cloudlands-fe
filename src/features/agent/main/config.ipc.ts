/**
 * Config IPC Handler
 *
 * Handles IPC communication for config cache operations between renderer and main process.
 */

import { ipcMain } from 'electron';
import { configCache } from './config-cache.service';
import type { CommandResponse } from '../../../shared/types';
import { CONFIG_CHANNELS } from '../../../shared/ipc/channels';
import { createSafeValidatedHandler } from '../../../main/ipc-validation-middleware';
import {
  ConfigGetModelSchema,
  ConfigGetAllModelsSchema,
  ConfigClearCacheSchema,
  ConfigInvalidateSchema,
} from '../../../main/ipc-schemas';

export function setupConfigIPC(): void {
  // Get model configuration
  ipcMain.handle(
    CONFIG_CHANNELS.GET_MODEL,
    createSafeValidatedHandler(
      ConfigGetModelSchema,
      async (event, validated) => {
        try {
          const config = await configCache.getModelConfig(validated.modelId);
          return {
            success: true,
            data: config,
          } as CommandResponse;
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to get model config',
          } as CommandResponse;
        }
      },
      CONFIG_CHANNELS.GET_MODEL,
    ),
  );

  // Get all models
  ipcMain.handle(
    CONFIG_CHANNELS.GET_ALL_MODELS,
    createSafeValidatedHandler(
      ConfigGetAllModelsSchema,
      async () => {
        try {
          const models = await configCache.getAllModels();
          return {
            success: true,
            data: models,
          } as CommandResponse;
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to get models',
          } as CommandResponse;
        }
      },
      CONFIG_CHANNELS.GET_ALL_MODELS,
    ),
  );

  // Clear cache
  ipcMain.handle(
    CONFIG_CHANNELS.CLEAR_CACHE,
    createSafeValidatedHandler(
      ConfigClearCacheSchema,
      async () => {
        try {
          configCache.clearCache();
          return { success: true } as CommandResponse;
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to clear cache',
          } as CommandResponse;
        }
      },
      CONFIG_CHANNELS.CLEAR_CACHE,
    ),
  );

  // Invalidate cache entry
  ipcMain.handle(
    CONFIG_CHANNELS.INVALIDATE,
    createSafeValidatedHandler(
      ConfigInvalidateSchema,
      async (event, validated) => {
        try {
          configCache.invalidate(validated.key);
          return { success: true } as CommandResponse;
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to invalidate cache',
          } as CommandResponse;
        }
      },
      CONFIG_CHANNELS.INVALIDATE,
    ),
  );
}

// Cleanup function
export function cleanupConfigIPC(): void {
  configCache.dispose();
}
