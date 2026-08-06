/**
 * Release Notes IPC Handlers
 *
 * `release-notes:get` lets the renderer fetch the running version's notes on
 * demand (Help ▸ Show Release Notes); `release-notes:show` is the main →
 * renderer push that opens the modal after an update.
 *
 * The startup push can win the race against the renderer registering its
 * listener (`webContents.send` does not queue for future listeners), so the
 * startup notes are also parked as *pending* and claimed by the renderer over
 * `release-notes:get-pending` when it initializes. Whichever path arrives
 * first wins; the pending slot is cleared on claim so the modal opens once.
 */

import { BrowserWindow, ipcMain } from 'electron';
import { z } from 'zod';
import { createSafeValidatedHandler } from '../../../main/ipc-validation-middleware';
import { Logger } from '../../../shared/logger';
import {
  RELEASE_NOTES_CHANNELS,
  type ReleaseNotesContent,
  type ShowReleaseNotesPayload,
} from '../types';
import { checkForReleaseNotesOnStartup, getCurrentReleaseNotes } from './release-notes.service';

const logger = new Logger('ReleaseNotesIPC');

const EmptySchema = z.object({}).optional();

/** Startup notes not yet claimed by a renderer. */
let pendingReleaseNotes: ReleaseNotesContent | null = null;

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

  ipcMain.handle(
    RELEASE_NOTES_CHANNELS.GET_PENDING,
    createSafeValidatedHandler(
      EmptySchema,
      async () => {
        const pending = pendingReleaseNotes;
        pendingReleaseNotes = null;
        return { success: true, data: pending };
      },
      RELEASE_NOTES_CHANNELS.GET_PENDING,
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
 * showing is due. The notes are parked as pending first so a renderer that has
 * not yet registered its listener can claim them over `get-pending`. Never
 * throws — a failure here must not affect startup.
 */
export async function initializeReleaseNotesOnStartup(
  window: BrowserWindow | null,
): Promise<void> {
  try {
    await checkForReleaseNotesOnStartup((notes) => {
      pendingReleaseNotes = notes;
      sendShowReleaseNotes(window, { notes });
    });
  } catch (error) {
    logger.warn('Release-notes startup check failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Test-only reset of the pending-notes slot.
 * @internal
 */
export function __resetPendingReleaseNotesForTests(): void {
  pendingReleaseNotes = null;
}
