/**
 * Assets IPC
 *
 * IPC handlers for saving and retrieving image assets for notes.
 */

import { ipcMain } from 'electron';
import { ASSETS_CHANNELS } from '$shared/ipc/channels';
import { createSafeValidatedHandler } from '../../../main/ipc-validation-middleware';
import {
  AssetsGetSchema,
  AssetsDeleteSchema,
  AssetsListSchema,
} from '../../../main/ipc-schemas';
import { Logger } from '../../../shared/logger';
import { assetsService } from './assets.service';
import { getMetadataFS } from '../../metadata-fs/main/metadata-fs-factory';

const logger = new Logger('AssetsIPC');

export function setupAssetsIPC() {
  logger.info('Setting up assets IPC handlers');

  // Wire up IMetadataFS resolver for remote workspace support
  assetsService.setMetadataFSResolver(getMetadataFS);

  // Asset saves from the renderer go to the daemon via `note.saveAsset`
  // (PROTOCOL §5.2); main-process MCP tools still use assetsService directly.

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
