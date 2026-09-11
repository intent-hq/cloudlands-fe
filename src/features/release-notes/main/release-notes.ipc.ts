/**
 * Release Notes IPC Handlers
 *
 * `release-notes:get` lets the renderer fetch the running version's notes on
 * demand (Help ▸ Show Release Notes); `release-notes:show` is the main →
 * renderer push that opens the modal after an update.
 *
 * The startup push goes to *every* open window (one modal per window). It can
 * win the race against a renderer registering its listener (`webContents.send`
 * does not queue for future listeners), so the startup notes are also parked
 * as *pending* and read by each renderer over `release-notes:get-pending` when
 * it initializes. The slot is not cleared on read — late-initializing or
 * newly created windows must see the notes too — and renderers dedup per
 * version. Dismissing in any window invokes `release-notes:dismiss`, which
 * clears the slot and fans `release-notes:close` out to every window.
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

/**
 * Startup notes not yet dismissed. In-memory only: the pref advances right
 * after these are parked, so a process exit before a renderer reads (or a
 * window receives) them skips that version's notes — an accepted trade-off to
 * keep the modal opening at most once per version.
 */
let pendingReleaseNotes: ReleaseNotesContent | null = null;

/** Send an event to every live window. */
function broadcastToAllWindows(channel: string, payload?: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue;
    window.webContents.send(channel, payload);
  }
}

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
      async () => ({ success: true, data: pendingReleaseNotes }),
      RELEASE_NOTES_CHANNELS.GET_PENDING,
    ),
  );

  ipcMain.handle(
    RELEASE_NOTES_CHANNELS.DISMISS,
    createSafeValidatedHandler(
      EmptySchema,
      async () => {
        pendingReleaseNotes = null;
        broadcastToAllWindows(RELEASE_NOTES_CHANNELS.CLOSE);
        return { success: true };
      },
      RELEASE_NOTES_CHANNELS.DISMISS,
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
 * Run the startup version-change check and push the notes to every open
 * window when a showing is due. Windows are enumerated at send time — not
 * captured before the async check/fetch — so a window created meanwhile still
 * receives the push (intent-hq/monorepo#3054); when none exists the notes
 * stay parked as pending for the renderer get-pending path. Never throws — a
 * failure here must not affect startup.
 */
export async function initializeReleaseNotesOnStartup(): Promise<void> {
  try {
    await checkForReleaseNotesOnStartup((notes) => {
      pendingReleaseNotes = notes;
      const payload: ShowReleaseNotesPayload = { notes };
      broadcastToAllWindows(RELEASE_NOTES_CHANNELS.SHOW, payload);
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
