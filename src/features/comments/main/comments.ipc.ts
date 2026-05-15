/**
 * Comments IPC
 *
 * IPC layer for note comment operations.
 * Provides direct access to comment functionality without going through MCP.
 */

import { ipcMain } from 'electron';
import type { Result, CommandResponse, WorkspaceId, NoteComment } from '../../../shared/types';
import { protocolAdapter } from '../../protocol/main/protocol-adapter';
import { Logger } from '../../../shared/logger';
import { mainDispatch } from '../../../store/main/redux-store-bridge';
import {
  commentUpdatedBatch,
  commentDeleted,
} from '../../../store/main/slices/note-events/note-events-slice';
import { COMMENTS_CHANNELS } from '../../../shared/ipc/channels';
import { createSafeValidatedHandler } from '../../../main/ipc-validation-middleware';
import {
  CommentsListSchema,
  CommentsCreateSchema,
  CommentsSuggestChangeSchema,
  CommentsUpdateSchema,
  CommentsDeleteSchema,
} from '../../../main/ipc-schemas';

const logger = new Logger('CommentsIPC');

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

/**
 * Broadcast comment update event to all windows
 */
function broadcastCommentUpdate(
  workspaceId: WorkspaceId,
  noteId: string,
  action: 'added' | 'updated' | 'resolved' | 'deleted',
  comment: NoteComment,
): void {
  // Redux dispatch broadcasts to all windows via saga
  mainDispatch(commentUpdatedBatch({
    workspaceId,
    noteId,
    action,
    comment,
  }));
}

// ============================================================================
// Main Process Handlers
// ============================================================================

export function setupCommentsIPC() {
  logger.info('Setting up comments IPC handlers');

  // List comments for a note
  ipcMain.handle(
    COMMENTS_CHANNELS.LIST,
    createSafeValidatedHandler(
      CommentsListSchema,
      async (_, validated) => {
        const result = await protocolAdapter.listComments({
          workspaceId: validated.workspaceId,
          noteId: validated.noteId,
          filters: { status: validated.status, type: validated.type, author: validated.author },
        });
        return resultToCommandResponse(result);
      },
      COMMENTS_CHANNELS.LIST,
    ),
  );

  // Add a comment to a note
  ipcMain.handle(
    COMMENTS_CHANNELS.ADD,
    createSafeValidatedHandler(
      CommentsCreateSchema,
      async (_, validated) => {
        const result = await protocolAdapter.addComment(validated);

        if (result.ok) {
          // Event is already emitted by the service via Redux dispatch
          // Still broadcast for backward compatibility
          broadcastCommentUpdate(
            validated.workspaceId as WorkspaceId,
            validated.noteId,
            'added',
            result.data,
          );
        }

        return resultToCommandResponse(result);
      },
      COMMENTS_CHANNELS.ADD,
    ),
  );

  // Suggest a change to a note
  ipcMain.handle(
    COMMENTS_CHANNELS.SUGGEST_CHANGE,
    createSafeValidatedHandler(
      CommentsSuggestChangeSchema,
      async (_, validated) => {
        const result = await protocolAdapter.suggestChange(validated);

        if (result.ok) {
          // Event is already emitted by the service via Redux dispatch
          // Still broadcast for backward compatibility
          broadcastCommentUpdate(
            validated.workspaceId as WorkspaceId,
            validated.noteId,
            'added',
            result.data,
          );
        }

        return resultToCommandResponse(result);
      },
      COMMENTS_CHANNELS.SUGGEST_CHANGE,
    ),
  );

  // Update comment status
  ipcMain.handle(
    COMMENTS_CHANNELS.UPDATE_STATUS,
    createSafeValidatedHandler(
      CommentsUpdateSchema,
      async (_, validated) => {
        const result = await protocolAdapter.updateCommentStatus(validated);

        if (result.ok) {
          // Event is already emitted by the service via Redux dispatch
          // Still broadcast for backward compatibility
          broadcastCommentUpdate(
            validated.workspaceId as WorkspaceId,
            validated.noteId,
            'updated',
            result.data,
          );
        }

        return resultToCommandResponse(result);
      },
      COMMENTS_CHANNELS.UPDATE_STATUS,
    ),
  );

  // Delete a comment
  ipcMain.handle(
    COMMENTS_CHANNELS.DELETE,
    createSafeValidatedHandler(
      CommentsDeleteSchema,
      async (_, validated) => {
        const result = await protocolAdapter.deleteComment(validated);

        if (result.ok) {
          mainDispatch(commentDeleted({
            workspaceId: validated.workspaceId as WorkspaceId,
            noteId: validated.noteId,
            commentId: validated.commentId,
          }));
        }

        return resultToCommandResponse(result);
      },
      COMMENTS_CHANNELS.DELETE,
    ),
  );

  logger.info('Comments IPC handlers setup complete');
}
