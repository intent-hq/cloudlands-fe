/**
 * Release notes belong to the desktop app, not to each machine renderer.
 * Main reserves startup notes for one shown renderer and keeps a one-shot
 * pending read to cover pushes sent before its listener is ready. Manual
 * opening and dismissal close stale notes in every other renderer.
 */
import { BrowserWindow, ipcMain } from 'electron';
import { z } from 'zod';
import { createSafeValidatedHandler } from '../../../main/ipc-validation-middleware';
import { getAppWindows } from '../../../main/offscreen-window';
import {
  getRendererWebContents,
  getShownRendererWebContents,
  getWindowForWebContents,
} from '../../../main/window-backend';
import { Logger } from '../../../shared/logger';
import {
  RELEASE_NOTES_CHANNELS,
  type ReleaseNotesContent,
  type ShowReleaseNotesPayload,
} from '../types';
import { checkForReleaseNotesOnStartup, getCurrentReleaseNotes } from './release-notes.service';

const logger = new Logger('ReleaseNotesIPC');
const EmptySchema = z.object({}).optional();
let pendingReleaseNotes: ReleaseNotesContent | null = null;
let startupOwner: Electron.WebContents | null = null;
let startupSuppressed = false;

/** Close stale notes, including in hidden machine views. */
function closeOtherRenderers(except?: Electron.WebContents): void {
  for (const window of getAppWindows()) {
    if (window.isDestroyed()) continue;
    for (const renderer of getRendererWebContents(window)) {
      if (renderer !== except && !renderer.isDestroyed()) {
        renderer.send(RELEASE_NOTES_CHANNELS.CLOSE, undefined);
      }
    }
  }
}

function clearStartupNotes(): void {
  startupSuppressed = true;
  pendingReleaseNotes = null;
  startupOwner = null;
}

/** A hidden machine may start first, but must never consume the startup slot. */
function claimPending(sender: Electron.WebContents): ReleaseNotesContent | null {
  if (!pendingReleaseNotes) return null;
  const window = getWindowForWebContents(sender);
  if (!window || getShownRendererWebContents(window) !== sender) return null;
  if (startupOwner && !startupOwner.isDestroyed() && startupOwner !== sender) return null;
  startupOwner = sender;
  const notes = pendingReleaseNotes;
  pendingReleaseNotes = null;
  return notes;
}

export function setupReleaseNotesIPC(): void {
  ipcMain.handle(
    RELEASE_NOTES_CHANNELS.GET,
    createSafeValidatedHandler(
      EmptySchema,
      async (event) => {
        // Settings opens notes through GET directly, without a Help-menu push.
        clearStartupNotes();
        closeOtherRenderers(event.sender);
        return { success: true, data: await getCurrentReleaseNotes() };
      },
      RELEASE_NOTES_CHANNELS.GET,
    ),
  );
  ipcMain.handle(
    RELEASE_NOTES_CHANNELS.GET_PENDING,
    createSafeValidatedHandler(
      EmptySchema,
      async (event) => ({ success: true, data: claimPending(event.sender) }),
      RELEASE_NOTES_CHANNELS.GET_PENDING,
    ),
  );
  ipcMain.handle(
    RELEASE_NOTES_CHANNELS.DISMISS,
    createSafeValidatedHandler(
      EmptySchema,
      async () => {
        clearStartupNotes();
        closeOtherRenderers();
        return { success: true };
      },
      RELEASE_NOTES_CHANNELS.DISMISS,
    ),
  );
}

/** Help opens notes in the visible renderer and retires any previous showing. */
export function sendShowReleaseNotes(
  window: BrowserWindow | null,
  payload: ShowReleaseNotesPayload,
): void {
  if (!window || window.isDestroyed()) return;
  const renderer = getShownRendererWebContents(window);
  if (renderer.isDestroyed()) return;
  clearStartupNotes();
  closeOtherRenderers(renderer);
  renderer.send(RELEASE_NOTES_CHANNELS.SHOW, payload);
}

/** Park startup notes and push to one window, enumerated after the async fetch. */
export async function initializeReleaseNotesOnStartup(): Promise<void> {
  try {
    await checkForReleaseNotesOnStartup((notes) => {
      if (startupSuppressed) return;
      pendingReleaseNotes = notes;
      const windows = getAppWindows().filter((window) => !window.isDestroyed());
      const focused = BrowserWindow.getFocusedWindow();
      const window = windows.find((candidate) => candidate === focused) ?? windows[0];
      if (!window) return;
      const renderer = getShownRendererWebContents(window);
      if (renderer.isDestroyed()) return;
      startupOwner = renderer;
      renderer.send(RELEASE_NOTES_CHANNELS.SHOW, { notes } satisfies ShowReleaseNotesPayload);
    });
  } catch (error) {
    logger.warn('Release-notes startup check failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** @internal Test-only reset of startup ownership. */
export function __resetPendingReleaseNotesForTests(): void {
  pendingReleaseNotes = null;
  startupOwner = null;
  startupSuppressed = false;
}
