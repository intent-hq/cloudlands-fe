/**
 * Diffs IPC
 *
 * Thin IPC layer for diff operations.
 * Handles communication between renderer and main process.
 */

import { ipcMain } from 'electron';
import type { CommandResponse, Result } from '../../../shared/types';
import { WorkspaceId } from '../../../shared/types/branded-ids';
import { diffsService } from '../diffs.service';
import { DIFFS_CHANNELS } from '../../../shared/ipc/channels';
import { createSafeValidatedHandler } from '../../../main/ipc-validation-middleware';
import {
  DiffsListSchema,
  DiffsCreateSchema,
  DiffsUpdateSchema,
} from '../../../main/ipc-schemas';

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Convert Result type to CommandResponse type for IPC
 */
function resultToCommandResponse<T>(result: Result<T, string>): CommandResponse<T> {
  if (result.ok) {
    return {
      success: true,
      data: result.data,
    };
  } else {
    return {
      success: false,
      error: result.error,
    };
  }
}

// ============================================================================
// Main Process Handlers
// ============================================================================

export function setupDiffsIPC() {
  // List diffs for a workspace
  ipcMain.handle(
    DIFFS_CHANNELS.LIST,
    createSafeValidatedHandler(
      DiffsListSchema,
      async (_, validated) => {
        const result = await diffsService.listDiffs(validated.workspaceId);
        return resultToCommandResponse(result);
      },
      DIFFS_CHANNELS.LIST,
    ),
  );

  // Create a diff
  ipcMain.handle(
    DIFFS_CHANNELS.CREATE,
    createSafeValidatedHandler(
      DiffsCreateSchema,
      async (_, validated) => {
        const result = await diffsService.createDiff(
          validated.workspaceId as WorkspaceId,
          validated.diff,
        );
        return resultToCommandResponse(result);
      },
      DIFFS_CHANNELS.CREATE,
    ),
  );

  // Update a diff
  ipcMain.handle(
    DIFFS_CHANNELS.UPDATE,
    createSafeValidatedHandler(
      DiffsUpdateSchema,
      async (_, validated) => {
        const result = await diffsService.updateDiff(
          validated.workspaceId as WorkspaceId,
          validated.diff,
        );
        return resultToCommandResponse(result);
      },
      DIFFS_CHANNELS.UPDATE,
    ),
  );

  // diffs:get removed as dead code: the renderer's invoke() routes all
  // channels through the mock IPC router, so the GitService-backed per-file
  // diff handler here was unreachable.
}
