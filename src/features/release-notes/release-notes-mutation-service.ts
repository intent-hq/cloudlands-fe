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

function handleInitialize(): void {
  if (listenerRegistered) return;
  listenerRegistered = true;

  try {
    releaseNotesClient.onShow((payload) => {
      if (payload?.notes) {
        appStore.dispatch(showReleaseNotesSuccess(payload.notes));
      } else {
        // Menu-triggered push — open the modal and fetch on demand.
        appStore.dispatch(showReleaseNotes());
      }
    });
    appStore.dispatch(setInitialized());
  } catch (error) {
    logger.error('Failed to register release-notes listener', error);
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
 * Test-only reset of the listener guard between tests.
 * @internal
 */
export function __resetReleaseNotesMiddlewareForTests(): void {
  listenerRegistered = false;
}
