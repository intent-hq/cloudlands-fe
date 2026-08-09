/**
 * User Activity IPC Handlers
 *
 * Exposes user activity service to the renderer process via IPC.
 */

import { app, ipcMain } from 'electron';
import * as path from 'path';
import { z } from 'zod';
import { Logger } from '../../../shared/logger';
import { m } from '$shared/paraglide/messages.js';
import { createSafeValidatedHandler } from '../../../main/ipc-validation-middleware';
import { USER_ACTIVITY_CHANNELS } from '../../../shared/ipc/channels';
import { UserActivityService } from './user-activity.service';
import { FileSystemUserActivityRepository } from './user-activity.repository';
import { WorkspaceId, NoteId } from '../../../shared/types/branded-ids';
import { getActiveId } from '../../backend/main/connections-store';
import { onBackendReconnected } from '../../backend/main/backend.ipc';

const logger = new Logger('UserActivityIPC');

const USER_ACTIVITY_DIR = 'user-activity';

/**
 * Base directory for user-activity persistence, keyed by the active backend
 * id so two backends surfacing a workspace with the SAME id never clobber
 * each other's read-state (monorepo#1759 — re-homed to userData; this data
 * never needed the workspace checkout dir). The backend id is sanitized to a
 * filesystem-safe token, mirroring panelLayoutHistoryFileName.
 */
async function resolveUserActivityBase(): Promise<string> {
  const backendId = await getActiveId();
  const safe = backendId.replace(/[^A-Za-z0-9._-]/g, '_');
  return path.join(app.getPath('userData'), USER_ACTIVITY_DIR, safe);
}

// Zod schemas for validation
const MarkNoteReadSchema = z.object({
  workspaceId: z.string(),
  noteId: z.string(),
});

const GetNoteReadStatusSchema = z.object({
  workspaceId: z.string(),
  noteId: z.string(),
});

const GetUnreadNoteIdsSchema = z.object({
  workspaceId: z.string(),
  notes: z.array(
    z.object({
      id: z.string(),
      updatedAt: z.string(),
      createdAt: z.string().optional(),
    }),
  ),
});

// Singleton service instance
let service: UserActivityService | null = null;

function getService(): UserActivityService {
  if (!service) {
    const repository = new FileSystemUserActivityRepository(() => resolveUserActivityBase());
    service = new UserActivityService(repository);
    // The in-memory cache is keyed by workspaceId only, while persistence is
    // partitioned per backend id. A backend switch (surfaced as a reconnect)
    // must drop the cache so a workspace with the SAME id on another backend
    // never reads — or persists — the previous backend's read-state.
    onBackendReconnected(() => service?.clearCache());
  }
  return service;
}

/**
 * Setup user activity IPC handlers
 */
export function setupUserActivityIPC(): void {
  logger.info('Setting up user activity IPC handlers');

  // Mark a note as read
  ipcMain.handle(
    USER_ACTIVITY_CHANNELS.MARK_NOTE_READ,
    createSafeValidatedHandler(
      MarkNoteReadSchema,
      async (_, validated) => {
        try {
          await getService().markNoteRead(
            WorkspaceId(validated.workspaceId),
            NoteId(validated.noteId),
          );
          return { success: true };
        } catch (error) {
          logger.error('Failed to mark note as read', error as Error);
          return {
            success: false,
            error: error instanceof Error ? error.message : m.userActivity_ipc_unknown_error(),
          };
        }
      },
      USER_ACTIVITY_CHANNELS.MARK_NOTE_READ,
    ),
  );

  // Get read status for a note
  ipcMain.handle(
    USER_ACTIVITY_CHANNELS.GET_NOTE_READ_STATUS,
    createSafeValidatedHandler(
      GetNoteReadStatusSchema,
      async (_, validated) => {
        try {
          const status = await getService().getNoteReadStatus(
            WorkspaceId(validated.workspaceId),
            NoteId(validated.noteId),
          );
          return { success: true, data: status };
        } catch (error) {
          logger.error('Failed to get note read status', error as Error);
          return {
            success: false,
            error: error instanceof Error ? error.message : m.userActivity_ipc_unknown_error(),
          };
        }
      },
      USER_ACTIVITY_CHANNELS.GET_NOTE_READ_STATUS,
    ),
  );

  // Get unread note IDs
  ipcMain.handle(
    USER_ACTIVITY_CHANNELS.GET_UNREAD_NOTE_IDS,
    createSafeValidatedHandler(
      GetUnreadNoteIdsSchema,
      async (_, validated) => {
        try {
          const notes = validated.notes.map((n) => ({
            id: NoteId(n.id),
            updatedAt: n.updatedAt,
            createdAt: n.createdAt,
          }));
          const unreadIds = await getService().getUnreadNoteIds(
            WorkspaceId(validated.workspaceId),
            notes,
          );
          return { success: true, data: unreadIds };
        } catch (error) {
          logger.error('Failed to get unread note IDs', error as Error);
          return {
            success: false,
            error: error instanceof Error ? error.message : m.userActivity_ipc_unknown_error(),
          };
        }
      },
      USER_ACTIVITY_CHANNELS.GET_UNREAD_NOTE_IDS,
    ),
  );

  logger.info('User activity IPC handlers registered');
}
