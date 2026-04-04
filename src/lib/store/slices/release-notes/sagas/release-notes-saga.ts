/**
 * Release Notes — Saga
 *
 * Handles localStorage persistence (last seen version) and fetch calls.
 */

import { call, put, fork, takeEvery, type SagaGenerator } from "typed-redux-saga";
import { DEFAULTS } from "$shared/constants";
import {
  getLocalStorageItem,
  setLocalStorageItem,
} from "../../../utils/safe-local-storage-saga";
import {
  initializeReleaseNotes,
  setReleaseNotes,
  setLoading,
  setError,
  setInitialized,
  showReleaseNotes,
  showReleaseNotesSuccess,
} from "../release-notes-slice";
import type { ReleaseNotes } from "../release-notes-types";
import { selectReleaseNotesInitialized } from "../release-notes-selectors";

const LAST_VERSION_KEY = "lastSeenVersion";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fetchReleaseNotesFromCDN(channel: string): Promise<ReleaseNotes | null> {
  const baseUrl = DEFAULTS.AUTO_UPDATE_URL;
  const url = `${baseUrl}/${channel}/release-notes.json`;

  return fetch(url, { cache: "no-cache" })
    .then((response) => {
      if (!response.ok) {
        throw new Error(`Failed to fetch release notes: ${response.status}`);
      }
      return response.json() as Promise<ReleaseNotes>;
    })
    .catch((err) => {
      console.warn("[ReleaseNotes] Failed to fetch release notes:", err);
      return null;
    });
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

function* handleInitialize(
  action: ReturnType<typeof initializeReleaseNotes>,
): SagaGenerator<void> {
  const [currentVersion, channel] = action.payload;

  // Guard: only initialize once
  const alreadyInitialized = yield* selectReleaseNotesInitialized.effect();
  if (alreadyInitialized) return;

  yield* put(setInitialized());

  const lastSeenVersion = yield* call(getLocalStorageItem, LAST_VERSION_KEY);

  // If version changed (and we have a previous version), fetch and show release notes
  if (lastSeenVersion && lastSeenVersion !== currentVersion) {
    yield* put(setLoading(true));

    try {
      const notes: ReleaseNotes | null = yield* call(fetchReleaseNotesFromCDN, channel);

      // Only show if we got notes and they match current version
      if (notes && notes.version === currentVersion) {
        yield* put(setReleaseNotes(notes));
      }
    } catch (err) {
      yield* put(setError((err as Error).message));
    } finally {
      yield* put(setLoading(false));
    }
  }

  // Always save current version
  yield* call(setLocalStorageItem, LAST_VERSION_KEY, currentVersion);
}

function* handleShowReleaseNotes(
  action: ReturnType<typeof showReleaseNotes>,
): SagaGenerator<void> {
  const [channel] = action.payload;

  yield* put(setLoading(true));
  yield* put(setError(null));

  try {
    const notes: ReleaseNotes | null = yield* call(fetchReleaseNotesFromCDN, channel);
    if (notes) {
      yield* put(showReleaseNotesSuccess(notes));
    } else {
      yield* put(setError("No release notes available"));
      yield* put(setLoading(false));
    }
  } catch (err) {
    yield* put(setError((err as Error).message));
    yield* put(setLoading(false));
  }
}

// ---------------------------------------------------------------------------
// Root Saga
// ---------------------------------------------------------------------------

function* watchInitialize(): SagaGenerator<void> {
  yield* takeEvery(initializeReleaseNotes, handleInitialize);
}

function* watchShowReleaseNotes(): SagaGenerator<void> {
  yield* takeEvery(showReleaseNotes, handleShowReleaseNotes);
}

export function* releaseNotesSaga(): SagaGenerator<void> {
  yield* fork(watchInitialize);
  yield* fork(watchShowReleaseNotes);
}

