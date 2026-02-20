/**
 * Assets IPC
 *
 * IPC handlers for saving and retrieving image assets for notes.
 */

import { ipcMain } from 'electron';
import { ASSETS_CHANNELS } from '$shared/ipc/channels';
import { createSafeValidatedHandler } from '../../../main/ipc-validation-middleware';
import {
  AssetsSaveSchema,
  AssetsGetSchema,
  AssetsDeleteSchema,
  AssetsListSchema,
} from '../../../main/ipc-schemas';
import { Logger } from '../../../shared/logger';
import { assetsService } from './assets.service';

const logger = new Logger('AssetsIPC');

export function setupAssetsIPC() {
  logger.info('Setting up assets IPC handlers');

  // Save an asset
  ipcMain.handle(
    ASSETS_CHANNELS.SAVE,
    createSafeValidatedHandler(
      AssetsSaveSchema,
      async (_, validated) => {
        try {
          const result = await assetsService.saveAsset(
            validated.workspaceId,
            validated.data,
            validated.mimeType,
            validated.originalName,
          );
          return { success: true, data: result };
        } catch (error) {
          logger.error('Failed to save asset', error as Error);
          return { success: false, error: (error as Error).message };
        }
      },
      ASSETS_CHANNELS.SAVE,
    ),
  );

  // Get asset as data URL
  ipcMain.handle(
    ASSETS_CHANNELS.GET_DATA_URL,
    createSafeValidatedHandler(
      AssetsGetSchema,
      async (_, validated) => {
        try {
          const dataUrl = await assetsService.readAssetAsDataUrl(
            validated.workspaceId,
            validated.assetId,
          );
          return { success: true, data: dataUrl };
        } catch (error) {
          logger.error('Failed to get asset', error as Error);
          return { success: false, error: (error as Error).message };
        }
      },
      ASSETS_CHANNELS.GET_DATA_URL,
    ),
  );

  // Delete an asset
  ipcMain.handle(
    ASSETS_CHANNELS.DELETE,
    createSafeValidatedHandler(
      AssetsDeleteSchema,
      async (_, validated) => {
        try {
          await assetsService.deleteAsset(validated.workspaceId, validated.assetId);
          return { success: true, data: null };
        } catch (error) {
          logger.error('Failed to delete asset', error as Error);
          return { success: false, error: (error as Error).message };
        }
      },
      ASSETS_CHANNELS.DELETE,
    ),
  );

  // List assets for a workspace
  ipcMain.handle(
    ASSETS_CHANNELS.LIST,
    createSafeValidatedHandler(
      AssetsListSchema,
      async (_, validated) => {
        try {
          const assets = await assetsService.listAssets(validated.workspaceId);
          return { success: true, data: assets };
        } catch (error) {
          logger.error('Failed to list assets', error as Error);
          return { success: false, error: (error as Error).message };
        }
      },
      ASSETS_CHANNELS.LIST,
    ),
  );

  logger.info('Assets IPC handlers registered');
}
