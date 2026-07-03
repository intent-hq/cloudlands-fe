/**
 * Notes IPC
 *
 * Thin IPC layer for note operations.
 * Includes event tracking for note changes.
 */

import { ipcMain } from 'electron';
import type { Result, CommandResponse } from '../../../shared/types';
import { protocolAdapter } from '../../protocol/main/protocol-adapter';
import { NOTES_CHANNELS } from '$shared/ipc/channels';
import { createSafeValidatedHandler } from '../../../main/ipc-validation-middleware';
import {
  NotesListSchema,
  NotesCreateSchema,
  NotesGetSchema,
  NotesUpdateSchema,
  NotesDeleteSchema,
  NotesRestoreSpecSchema,
  NotesBatchListSchema,
} from '../../../main/ipc-schemas';

import { Logger } from '../../../shared/logger';
import { NotesService } from './notes.service';
import {
  WorkspaceId as createWorkspaceId,
  NoteId as createNoteId,
} from '$shared/types/branded-ids';
import { flushPendingVersion } from './storage/version-manager';
import { getNoteStoragePaths } from './storage/note-storage-paths';
import { getAllOpenWorkspaceIds } from '../../system/main/system.ipc';

const logger = new Logger('NotesIPC');

// ============================================================================
// State
// ============================================================================

// Create a singleton instance of NotesService
const notesServiceInstance = new NotesService();

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

export function setupNotesIPC() {
  logger.info('Setting up notes IPC handlers');

  // List notes for workspace
  ipcMain.handle(
    NOTES_CHANNELS.LIST,
    createSafeValidatedHandler(
      NotesListSchema,
      async (_, validated) => {
        // Protocol adapter now returns data directly for MCP compatibility
        const notes = await protocolAdapter.listNotes(validated.workspaceId, {
          summariesOnly: validated.summariesOnly === true,
        });

        // Convert to CommandResponse format
        if (Array.isArray(notes)) {
          return { success: true, data: notes };
        } else {
          return { success: false, error: 'Failed to list notes' };
        }
      },
      NOTES_CHANNELS.LIST,
    ),
  );

  // Create note
  ipcMain.handle(
    NOTES_CHANNELS.CREATE,
    createSafeValidatedHandler(
      NotesCreateSchema,
      async (_, validated) => {
        const result = await protocolAdapter.createNote(validated);

        // Activity log tracking is now handled in notes.service.ts

        return resultToCommandResponse(result);
      },
      NOTES_CHANNELS.CREATE,
    ),
  );

  // Get note
  ipcMain.handle(
    NOTES_CHANNELS.GET,
    createSafeValidatedHandler(
      NotesGetSchema,
      async (_, validated) => {
        const result = await protocolAdapter.getNote({
          workspaceId: validated.workspaceId,
          noteId: validated.noteId,
          initializeCRDT: true,
        });
        return resultToCommandResponse(result);
      },
      NOTES_CHANNELS.GET,
    ),
  );

  // Update note
  ipcMain.handle(
    NOTES_CHANNELS.UPDATE,
    createSafeValidatedHandler(
      NotesUpdateSchema,
      async (_, validated) => {
        const result = await protocolAdapter.updateNote(validated);

        // Activity log tracking is now handled in notes.service.ts

        return resultToCommandResponse(result);
      },
      NOTES_CHANNELS.UPDATE,
    ),
  );

  // Delete note
  ipcMain.handle(
    NOTES_CHANNELS.DELETE,
    createSafeValidatedHandler(
      NotesDeleteSchema,
      async (_, validated) => {
        const result = await protocolAdapter.deleteNote({
          noteId: validated.id,
          workspaceId: validated.workspaceId,
        });

        // Activity log tracking is now handled in notes.service.ts

        return resultToCommandResponse(result);
      },
      NOTES_CHANNELS.DELETE,
    ),
  );

  // Restore spec from version
  ipcMain.handle(
    NOTES_CHANNELS.RESTORE_SPEC,
    createSafeValidatedHandler(
      NotesRestoreSpecSchema,
      async (_, validated) => {
        logger.info('Restoring spec from version', {
          workspaceId: validated.workspaceId,
          versionId: validated.versionId,
        });

        const result = await notesServiceInstance.restoreSpecFromVersion(
          createWorkspaceId(validated.workspaceId),
          validated.versionId,
        );
        return resultToCommandResponse(result);
      },
      NOTES_CHANNELS.RESTORE_SPEC,
    ),
  );

  // Restore any note to a specific version
  ipcMain.handle('notes:restore-version', async (_, { workspaceId, noteId, versionId }) => {
    logger.info('[RestoreVersion] IPC: Received restore request', {
      workspaceId,
      noteId,
      versionId,
    });

    if (!workspaceId) {
      logger.error('[RestoreVersion] IPC: Missing workspaceId');
      return resultToCommandResponse({
        ok: false,
        error: 'workspaceId is required',
      });
    }

    if (!noteId) {
      logger.error('[RestoreVersion] IPC: Missing noteId');
      return resultToCommandResponse({
        ok: false,
        error: 'noteId is required',
      });
    }

    if (!versionId) {
      logger.error('[RestoreVersion] IPC: Missing versionId');
      return resultToCommandResponse({
        ok: false,
        error: 'versionId is required',
      });
    }

    logger.debug('[RestoreVersion] IPC: Calling service');
    const result = await notesServiceInstance.restoreNoteVersion(workspaceId, noteId, versionId);

    if (result.ok) {
      logger.debug('[RestoreVersion] IPC: Service call successful, returning result');
    } else {
      logger.error('[RestoreVersion] IPC: Service call failed', { error: result.error });
    }

    return resultToCommandResponse(result);
  });

  // Task metadata operations (Phase 1A)
  ipcMain.handle(NOTES_CHANNELS.MARK_AS_TASK, async (_, data) => {
    const { workspaceId, noteId, taskMetadata } = data;
    logger.info('Marking note as task', { workspaceId, noteId });

    const result = await notesServiceInstance.markAsTask(
      createWorkspaceId(workspaceId),
      noteId,
      taskMetadata,
    );
    return resultToCommandResponse(result);
  });

  ipcMain.handle(NOTES_CHANNELS.UPDATE_TASK_STATUS, async (_, data) => {
    const { workspaceId, noteId, status } = data;
    logger.info('Updating task status', { workspaceId, noteId, status });

    const result = await notesServiceInstance.updateTaskStatus(
      createWorkspaceId(workspaceId),
      noteId,
      status,
    );
    return resultToCommandResponse(result);
  });

  ipcMain.handle(NOTES_CHANNELS.UPDATE_TASK_PEER_ORDER, async (_, data) => {
    const { workspaceId, noteId, peerOrder } = data;
    logger.info('Updating task peer order', { workspaceId, noteId, peerOrder });

    const result = await notesServiceInstance.updateTaskPeerOrder(
      createWorkspaceId(workspaceId),
      noteId,
      peerOrder,
    );
    return resultToCommandResponse(result);
  });

  ipcMain.handle(NOTES_CHANNELS.REMOVE_TASK_METADATA, async (_, data) => {
    const { workspaceId, noteId } = data;
    logger.info('Removing task metadata', { workspaceId, noteId });

    const result = await notesServiceInstance.removeTaskMetadata(
      createWorkspaceId(workspaceId),
      noteId,
    );
    return resultToCommandResponse(result);
  });

  ipcMain.handle(NOTES_CHANNELS.GET_TASK_NOTES, async (_, data) => {
    const { workspaceId, filters } = data;
    logger.info('Getting task notes', { workspaceId, filters });

    const result = await notesServiceInstance.getTaskNotes(createWorkspaceId(workspaceId), filters);
    return resultToCommandResponse(result);
  });

  // Note: ADD_DEPENDENCY, REMOVE_DEPENDENCY, GET_DEPENDENCIES handlers removed
  // Task orchestration now uses parentId (sidebar hierarchy) as the dependency graph

  ipcMain.handle(NOTES_CHANNELS.GET_DEPENDENTS, async (_, data) => {
    const { workspaceId, noteId } = data;
    logger.info('Getting children (simplified from getDependents)', { workspaceId, noteId });

    // Simplified: use getChildren instead of the old getDependents which scanned metadata.dependencies
    const result = await notesServiceInstance.getChildren(createWorkspaceId(workspaceId), noteId);
    return resultToCommandResponse(result);
  });

  ipcMain.handle(NOTES_CHANNELS.CREATE_PREREQUISITE_NOTE, async (_, data) => {
    const { workspaceId, dependentNoteId, options } = data;
    logger.info('Creating prerequisite note', { workspaceId, dependentNoteId, options });

    const result = await notesServiceInstance.createPrerequisiteNote(
      createWorkspaceId(workspaceId),
      dependentNoteId,
      options,
    );
    return resultToCommandResponse(result);
  });

  // Phase 1C: Agent assignment operations
  ipcMain.handle(NOTES_CHANNELS.ASSIGN_AGENT_TO_TASK, async (_, data) => {
    const { workspaceId, noteId, agentId } = data;
    logger.info('Assigning agent to task', { workspaceId, noteId, agentId });

    const result = await notesServiceInstance.assignAgentToTask(
      createWorkspaceId(workspaceId),
      noteId,
      agentId,
    );
    return resultToCommandResponse(result);
  });

  // Convert ```task blocks to linked Task Notes
  ipcMain.handle(NOTES_CHANNELS.CONVERT_TASK_BLOCKS, async (_, data) => {
    const { workspaceId, noteId } = data;
    logger.info('Converting task blocks', { workspaceId, noteId });

    // Service handles event emission internally with source='agent'
    const result = await notesServiceInstance.convertTaskBlocks(
      createWorkspaceId(workspaceId),
      noteId,
    );

    return resultToCommandResponse(result);
  });

  // Find next task to work on (DFS with dependency satisfaction)
  ipcMain.handle(NOTES_CHANNELS.FIND_NEXT_TASK, async (_, data) => {
    const { workspaceId, rootNoteId } = data;
    logger.info('Finding next task', { workspaceId, rootNoteId });

    const result = await notesServiceInstance.findNextTask(
      createWorkspaceId(workspaceId),
      rootNoteId,
    );

    return resultToCommandResponse(result);
  });

  // Find all ready tasks (not blocked by dependencies)
  ipcMain.handle(NOTES_CHANNELS.FIND_READY_TASKS, async (_, data) => {
    const { workspaceId } = data;
    logger.info('Finding ready tasks', { workspaceId });

    const result = await notesServiceInstance.findReadyTasks(createWorkspaceId(workspaceId));

    return resultToCommandResponse(result);
  });

  // Flush pending version for a note
  // This forces creation of a version if there are unsaved changes
  ipcMain.handle(NOTES_CHANNELS.FLUSH_PENDING_VERSION, async (_, data) => {
    const { workspaceId, noteId } = data;
    logger.info('Flushing pending version', { workspaceId, noteId });

    try {
      const paths = getNoteStoragePaths(createWorkspaceId(workspaceId), createNoteId(noteId));

      // Get the note to get its title
      const noteResult = await notesServiceInstance.getNote(
        createWorkspaceId(workspaceId),
        createNoteId(noteId),
      );
      const title = noteResult.ok ? noteResult.data.title : undefined;

      const created = await flushPendingVersion(
        createWorkspaceId(workspaceId),
        createNoteId(noteId),
        paths.versionsFile,
        title,
      );

      return { success: true, data: { created } };
    } catch (error) {
      logger.error('Failed to flush pending version', error as Error, { workspaceId, noteId });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to flush pending version',
      };
    }
  });

  // Batch list notes for multiple workspaces (for homepage progress cards).
  // Per-workspace status is surfaced explicitly so a load failure for one
  // workspace is rendered as an error state instead of being silently masked
  // as zero notes (AUDIT-P0-2).
  ipcMain.handle(
    NOTES_CHANNELS.BATCH_LIST,
    createSafeValidatedHandler(
      NotesBatchListSchema,
      async (_, validated) => {
        const { workspaceIds } = validated;
        const openWorkspaceIds = new Set(getAllOpenWorkspaceIds());
        const result: Record<
          string,
          { success: true; notes: any[] } | { success: false; error: string }
        > = {};

        // Load notes for each workspace in parallel
        const promises = workspaceIds.map(async (workspaceId: string) => {
          try {
            const notes = await protocolAdapter.listNotes(workspaceId, {
              summariesOnly: !openWorkspaceIds.has(workspaceId),
            });
            return {
              workspaceId,
              entry: {
                success: true as const,
                notes: Array.isArray(notes) ? notes : [],
              },
            };
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            logger.warn('Failed to load notes for workspace', { workspaceId, error });
            return {
              workspaceId,
              entry: { success: false as const, error: message },
            };
          }
        });

        const results = await Promise.all(promises);
        for (const { workspaceId, entry } of results) {
          result[workspaceId] = entry;
        }

        return { success: true, data: result };
      },
      NOTES_CHANNELS.BATCH_LIST,
    ),
  );

  logger.info('Notes IPC handlers setup complete');
}
