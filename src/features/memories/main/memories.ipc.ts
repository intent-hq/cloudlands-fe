/**
 * Memories IPC
 *
 * IPC handlers for memories management
 */

import { ipcMain } from 'electron';
import { memoriesService } from './memories.service';
import { Logger } from '$shared/logger';
import { MEMORIES_CHANNELS } from '$shared/ipc/channels';
import { createSafeValidatedHandler } from '../../../main/ipc-validation-middleware';
import {
  MemoriesListSchema,
  MemoriesGetSchema,
  MemoriesCreateSchema,
  MemoriesUpdateSchema,
  MemoriesDeleteSchema,
  MemoriesSearchSchema,
  MemoriesGetContextSchema,
} from '../../../main/ipc-schemas';

const logger = new Logger('MemoriesIPC');

function resultToCommandResponse(result: any) {
  if (result.ok) {
    return { success: true, data: result.data };
  } else {
    return { success: false, error: result.error };
  }
}

export function setupMemoriesIPC() {
  logger.info('Setting up memories IPC handlers');

  // List memories
  ipcMain.handle(
    MEMORIES_CHANNELS.LIST,
    createSafeValidatedHandler(
      MemoriesListSchema,
      async (_, validated) => {
        const result = await memoriesService.listMemories(validated.workspaceId);
        return resultToCommandResponse(result);
      },
      MEMORIES_CHANNELS.LIST,
    ),
  );

  // Get memory
  ipcMain.handle(
    MEMORIES_CHANNELS.GET,
    createSafeValidatedHandler(
      MemoriesGetSchema,
      async (_, validated) => {
        const result = await memoriesService.getMemory(validated.id);
        return resultToCommandResponse(result);
      },
      MEMORIES_CHANNELS.GET,
    ),
  );

  // Create memory
  ipcMain.handle(
    MEMORIES_CHANNELS.CREATE,
    createSafeValidatedHandler(
      MemoriesCreateSchema,
      async (_, validated) => {
        const result = await memoriesService.createMemory(validated);
        return resultToCommandResponse(result);
      },
      MEMORIES_CHANNELS.CREATE,
    ),
  );

  // Update memory
  ipcMain.handle(
    MEMORIES_CHANNELS.UPDATE,
    createSafeValidatedHandler(
      MemoriesUpdateSchema,
      async (_, validated) => {
        const result = await memoriesService.updateMemory(validated.id, validated.updates);
        return resultToCommandResponse(result);
      },
      MEMORIES_CHANNELS.UPDATE,
    ),
  );

  // Delete memory
  ipcMain.handle(
    MEMORIES_CHANNELS.DELETE,
    createSafeValidatedHandler(
      MemoriesDeleteSchema,
      async (_, validated) => {
        const result = await memoriesService.deleteMemory(validated.id);
        return resultToCommandResponse(result);
      },
      MEMORIES_CHANNELS.DELETE,
    ),
  );

  // Search memories
  ipcMain.handle(
    MEMORIES_CHANNELS.SEARCH,
    createSafeValidatedHandler(
      MemoriesSearchSchema,
      async (_, validated) => {
        const result = await memoriesService.searchMemories(validated.query, validated.workspaceId);
        return resultToCommandResponse(result);
      },
      MEMORIES_CHANNELS.SEARCH,
    ),
  );

  // Get memories as context
  ipcMain.handle(
    MEMORIES_CHANNELS.GET_CONTEXT,
    createSafeValidatedHandler(
      MemoriesGetContextSchema,
      async (_, validated) => {
        const result = await memoriesService.getMemoriesAsContext(validated.workspaceId);
        return resultToCommandResponse(result);
      },
      MEMORIES_CHANNELS.GET_CONTEXT,
    ),
  );

  logger.info('Memories IPC handlers setup complete');
}
