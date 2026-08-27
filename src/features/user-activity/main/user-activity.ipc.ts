/**
 * User Activity IPC Handlers
 *
 * Exposes user activity service to the renderer process via IPC.
 *
 * Backend policy: per-sender routing — each handler keys off the invoking
 * window's backend id (`getBackendIdForIpcSender`), with one service
 * instance (cache + persistence directory) per backend id, so windows on
 * different backends never read or write each other's read-state. Caches
 * are additionally dropped on a reconnect of ANY backend via
 * `onAnyBackendReconnected` (the on-disk state may have changed while
 * disconnected).
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
import { getBackendIdForIpcSender, onAnyBackendReconnected } from '../../backend/main/backend.ipc';

const logger = new Logger('UserActivityIPC');

const USER_ACTIVITY_DIR = 'user-activity';

/**
 * Base directory for user-activity persistence, keyed by backend id so two
 * backends surfacing a workspace with the SAME id never clobber each
 * other's read-state (monorepo#1759 — re-homed to userData; this data never
 * needed the workspace checkout dir). The backend id is sanitized to a
 * filesystem-safe token, mirroring panelLayoutHistoryFileName.
 */
function userActivityBaseFor(backendId: string): string {
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

// One service instance per backend id — each owns its cache and its
// persistence directory, so windows on different backends never share state.
const services = new Map<string, UserActivityService>();
let reconnectListenerRegistered = false;

function getService(sender: Electron.WebContents): UserActivityService {
  const backendId = getBackendIdForIpcSender(sender);
  let svc = services.get(backendId);
  if (!svc) {
    const base = userActivityBaseFor(backendId);
    svc = new UserActivityService(new FileSystemUserActivityRepository(base));
    services.set(backendId, svc);
  }
  if (!reconnectListenerRegistered) {
    reconnectListenerRegistered = true;
    // The on-disk read-state may have changed while a backend was
    // disconnected; drop every cache on a reconnect of ANY backend.
    onAnyBackendReconnected(() => {
      for (const s of services.values()) s.clearCache();
    });
  }
  return svc;
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
      async (event, validated) => {
        try {
          await getService(event.sender).markNoteRead(
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
      async (event, validated) => {
        try {
          const status = await getService(event.sender).getNoteReadStatus(
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
      async (event, validated) => {
        try {
          const notes = validated.notes.map((n) => ({
            id: NoteId(n.id),
            updatedAt: n.updatedAt,
            createdAt: n.createdAt,
          }));
          const unreadIds = await getService(event.sender).getUnreadNoteIds(
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
