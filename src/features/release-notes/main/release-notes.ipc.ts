/**
 * Release Notes IPC Handlers
 *
 * `release-notes:get` lets the renderer fetch the running version's notes on
 * demand (Help ▸ Show Release Notes); `release-notes:show` is the main →
 * renderer push that opens the modal after an update.
 */

import { BrowserWindow, ipcMain } from 'electron';
import { z } from 'zod';
import { createSafeValidatedHandler } from '../../../main/ipc-validation-middleware';
import { Logger } from '../../../shared/logger';
import { RELEASE_NOTES_CHANNELS, type ShowReleaseNotesPayload } from '../types';
import { checkForReleaseNotesOnStartup, getCurrentReleaseNotes } from './release-notes.service';

const logger = new Logger('ReleaseNotesIPC');

const EmptySchema = z.object({}).optional();

/** Register the release-notes ipcMain handlers. */
export function setupReleaseNotesIPC(): void {
  ipcMain.handle(
    RELEASE_NOTES_CHANNELS.GET,
    createSafeValidatedHandler(
      EmptySchema,
      async () => ({ success: true, data: await getCurrentReleaseNotes() }),
      RELEASE_NOTES_CHANNELS.GET,
    ),
  );
}

/** Push the modal-open event to a window. */
export function sendShowReleaseNotes(
  window: BrowserWindow | null,
  payload: ShowReleaseNotesPayload,
): void {
  if (!window || window.isDestroyed()) return;
  window.webContents.send(RELEASE_NOTES_CHANNELS.SHOW, payload);
}

/**
 * Run the startup version-change check and push the notes to `window` when a
 * showing is due. Never throws — a failure here must not affect startup.
 */
export async function initializeReleaseNotesOnStartup(
  window: BrowserWindow | null,
): Promise<void> {
  try {
    await checkForReleaseNotesOnStartup((notes) => sendShowReleaseNotes(window, { notes }));
  } catch (error) {
    logger.warn('Release-notes startup check failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
