/**
 * Third-Party Sources IPC Handlers
 *
 * Handles IPC communication for third-party sources between main and renderer processes
 */

import { ipcMain } from 'electron';
import { Logger } from '../../../shared/logger';
import { thirdPartySourcesService } from './third-party-sources.service';
import { resultToCommandResponse } from '../../../shared/ipc-utils';
import { SOURCES_CHANNELS } from '$shared/ipc/channels';

const logger = new Logger('third-party-sources-ipc');

export function setupThirdPartySourcesIPC() {
  logger.info('Setting up third-party sources IPC handlers');

  // Create source
  ipcMain.handle(SOURCES_CHANNELS.CREATE, async (_, data) => {
    const result = await thirdPartySourcesService.createSource(data);
    return resultToCommandResponse(result);
  });

  // Update source
  ipcMain.handle(SOURCES_CHANNELS.UPDATE, async (_, { workspaceId, sourceId, data }) => {
    const result = await thirdPartySourcesService.updateSource(workspaceId, sourceId, data);
    return resultToCommandResponse(result);
  });

  // Get source
  ipcMain.handle(SOURCES_CHANNELS.GET, async (_, { workspaceId, sourceId }) => {
    const result = await thirdPartySourcesService.getSource(workspaceId, sourceId);
    return resultToCommandResponse(result);
  });

  // List sources for workspace
  ipcMain.handle(SOURCES_CHANNELS.LIST, async (_, { workspaceId }) => {
    const result = await thirdPartySourcesService.listByWorkspace(workspaceId);
    return resultToCommandResponse(result);
  });

  // Delete source
  ipcMain.handle(SOURCES_CHANNELS.DELETE, async (_, { workspaceId, sourceId }) => {
    const result = await thirdPartySourcesService.deleteSource(workspaceId, sourceId);
    return resultToCommandResponse(result);
  });

  // Refresh metadata
  ipcMain.handle(SOURCES_CHANNELS.REFRESH, async (_, { workspaceId, sourceId }) => {
    const result = await thirdPartySourcesService.refreshMetadata(workspaceId, sourceId);
    return resultToCommandResponse(result);
  });

  // Extract metadata from URL (for preview during drag & drop)
  ipcMain.handle(SOURCES_CHANNELS.EXTRACT_METADATA, async (_, { url, type }) => {
    const { MetadataExtractor } = await import('../metadata-extractor');
    const extractor = new MetadataExtractor();
    const result = await extractor.extract(url, type);
    return resultToCommandResponse(result);
  });

  logger.info('Third-party sources IPC handlers registered');
}
