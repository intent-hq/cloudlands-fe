/**
 * Release-notes mutation service — handlers for the release-notes triggers.
 *
 * `initializeReleaseNotes` registers the main → renderer "show release notes"
 * listener exactly once (the startup-after-update push, and the Help ▸ Show
 * Release Notes push which arrives with `notes: null`). `showReleaseNotes`
 * opens the modal in its loading state and fetches the running version's
 * notes on demand.
 *
 * Dependency-light per src/store AGENTS.md: imports only the client, the
 * configured store, the slice actions, and the logger.
 */
import type { StoreMiddleware } from '$lib/store-shim/types';
import { releaseNotesClient } from './release-notes.client';
import type { ReleaseNotesContent } from './types';
import { store as appStore } from '$store/renderer/store';
import {
  initializeReleaseNotes,
  setInitialized,
  showReleaseNotes,
  showReleaseNotesSuccess,
  showReleaseNotesUnavailable,
} from '$store/renderer/slices/release-notes/release-notes-slice';
import { createLogger } from '$lib/utils/client-logger';

const logger = createLogger('ReleaseNotesMutationService');

/** Guard so the IPC listener registers exactly once. */
let listenerRegistered = false;

/**
 * Version already surfaced by the startup flow. The push and the pending-claim
 * are two routes to the same showing, so whichever lands second is ignored.
 */
let surfacedStartupVersion: string | null = null;

function surfaceStartupNotes(notes: ReleaseNotesContent): void {
  if (surfacedStartupVersion === notes.version) return;
  surfacedStartupVersion = notes.version;
  appStore.dispatch(showReleaseNotesSuccess(notes));
}

function handleInitialize(): void {
  if (listenerRegistered) return;
  listenerRegistered = true;

  try {
    releaseNotesClient.onShow((payload) => {
      if (payload?.notes) {
        surfaceStartupNotes(payload.notes);
      } else {
        // Menu-triggered push — open the modal and fetch on demand.
        appStore.dispatch(showReleaseNotes());
      }
    });
    appStore.dispatch(setInitialized());
    void claimPendingReleaseNotes();
  } catch (error) {
    logger.error('Failed to register release-notes listener', error);
  }
}

/**
 * Claim any startup notes the main process pushed before this listener
 * existed. `webContents.send` does not queue for future listeners, so without
 * this the notes would be dropped while the pref had already advanced.
 */
async function claimPendingReleaseNotes(): Promise<void> {
  try {
    const pending = await releaseNotesClient.claimPendingReleaseNotes();
    if (pending) {
      surfaceStartupNotes(pending);
    }
  } catch (error) {
    logger.warn('Failed to claim pending release notes', error);
  }
}

async function handleShowReleaseNotes(): Promise<void> {
  try {
    const notes = await releaseNotesClient.getReleaseNotes();
    if (notes) {
      appStore.dispatch(showReleaseNotesSuccess(notes));
    } else {
      appStore.dispatch(showReleaseNotesUnavailable());
    }
  } catch (error) {
    logger.warn('Failed to fetch release notes', error);
    appStore.dispatch(showReleaseNotesUnavailable());
  }
}

/**
 * Middleware giving the release-notes triggers real handlers: `initialize`
 * registers the main-process push listener once, and `showReleaseNotes`
 * (dispatched by the menu push or the reducer's loading transition) fetches
 * the notes and resolves the modal into its content or fallback state.
 */
export function createReleaseNotesMutationMiddleware(): StoreMiddleware {
  return () => (next) => (action) => {
    const result = next(action);
    if (!action || typeof action !== 'object') return result;
    const type = (action as { type?: unknown }).type;
    if (type === initializeReleaseNotes.type) {
      handleInitialize();
    } else if (type === showReleaseNotes.type) {
      void handleShowReleaseNotes();
    }
    return result;
  };
}

/**
 * Test-only reset of the listener guard and startup dedup between tests.
 * @internal
 */
export function __resetReleaseNotesMiddlewareForTests(): void {
  listenerRegistered = false;
  surfacedStartupVersion = null;
}
