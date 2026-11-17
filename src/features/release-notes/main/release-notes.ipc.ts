/**
 * Release notes belong to the desktop app, not to each machine renderer.
 * Main reserves startup notes for the machine view one frame shows (never a
 * frame page) and keeps a one-shot pending read to cover pushes sent before
 * its listener is ready. Manual opening and dismissal close stale notes in
 * every other machine view.
 */
import { BrowserWindow, ipcMain } from 'electron';
import { z } from 'zod';
import { createSafeValidatedHandler } from '../../../main/ipc-validation-middleware';
import { mostRecentFrame } from '../../../main/frames';
import { getAppWindows } from '../../../main/offscreen-window';
import {
  getRendererWebContents,
  getShownRendererWebContents,
  getWindowForWebContents,
  isShownRenderer,
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
  if (!window || !isShownRenderer(window, sender)) return null;
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

/**
 * The machine view `window` shows, or null when it shows none yet (a frame
 * whose view has not started: its frame page must never get app content).
 */
function shownMachineRenderer(window: BrowserWindow): Electron.WebContents | null {
  const renderer = getShownRendererWebContents(window);
  return !renderer.isDestroyed() && isShownRenderer(window, renderer) ? renderer : null;
}

/** Help opens notes in the visible machine view and retires any previous showing. */
export function sendShowReleaseNotes(
  window: BrowserWindow | null,
  payload: ShowReleaseNotesPayload,
): void {
  if (!window || window.isDestroyed()) return;
  const renderer = shownMachineRenderer(window);
  if (!renderer) return;
  clearStartupNotes();
  closeOtherRenderers(renderer);
  renderer.send(RELEASE_NOTES_CHANNELS.SHOW, payload);
}

/**
 * Park startup notes and push them to the machine view of one frame (the
 * focused one, else the most recently focused), chosen after the async fetch.
 * With no shown view yet, the notes stay parked for the first shown view to
 * claim over get-pending.
 */
export async function initializeReleaseNotesOnStartup(): Promise<void> {
  try {
    await checkForReleaseNotesOnStartup((notes) => {
      if (startupSuppressed) return;
      pendingReleaseNotes = notes;
      const window = mostRecentFrame();
      const renderer = window ? shownMachineRenderer(window) : null;
      if (!renderer) return;
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
