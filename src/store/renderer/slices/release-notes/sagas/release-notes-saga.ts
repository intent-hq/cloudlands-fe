import { END, eventChannel, type EventChannel } from 'redux-saga';
import { call, fork, put, take, takeEvery, type SagaGenerator } from 'typed-redux-saga';

import { releaseNotesClient } from '$features/release-notes/release-notes.client';
import type { ShowReleaseNotesPayload } from '$features/release-notes/types';
import { createLogger } from '$lib/utils/client-logger';
import {
  closeReleaseNotesModal,
  dismissReleaseNotes,
  initializeReleaseNotes,
  setInitialized,
  showReleaseNotes,
  showReleaseNotesSuccess,
  showReleaseNotesUnavailable,
} from '../release-notes-slice';

const logger = createLogger('ReleaseNotesSaga');

const CLOSE_EVENT = 'close';
type CloseEvent = typeof CLOSE_EVENT;

function createReleaseNotesChannel(): EventChannel<ShowReleaseNotesPayload> {
  return eventChannel((emit) => releaseNotesClient.onShow(emit));
}

function createCloseChannel(): EventChannel<CloseEvent> {
  return eventChannel((emit) => releaseNotesClient.onClose(() => emit(CLOSE_EVENT)));
}

function* fetchReleaseNotes(): SagaGenerator<void> {
  try {
    const notes = yield* call([releaseNotesClient, releaseNotesClient.getReleaseNotes]);
    yield* put(notes ? showReleaseNotesSuccess(notes) : showReleaseNotesUnavailable());
  } catch (error) {
    logger.warn('Failed to fetch release notes', error);
    yield* put(showReleaseNotesUnavailable());
  }
}

/**
 * Read the startup notes main parked (kept until dismissed in any window).
 * The read does not clear them, so dedup per version here — the `show` push
 * may deliver the same notes.
 */
function* claimPending(surfaced: Set<string>): SagaGenerator<void> {
  try {
    const notes = yield* call([releaseNotesClient, releaseNotesClient.claimPendingReleaseNotes]);
    if (notes && !surfaced.has(notes.version)) {
      surfaced.add(notes.version);
      yield* put(showReleaseNotesSuccess(notes));
    }
  } catch (error) {
    logger.warn('Failed to claim pending release notes', error);
  }
}

function* notifyDismiss(): SagaGenerator<void> {
  try {
    yield* call([releaseNotesClient, releaseNotesClient.dismissReleaseNotes]);
  } catch (error) {
    logger.warn('Failed to notify main of release notes dismissal', error);
  }
}

/**
 * Main broadcast a close (another window dismissed): close locally via the
 * non-propagating action so we never invoke `release-notes:dismiss` back.
 */
function* watchCloseEvents(channel: EventChannel<CloseEvent>): SagaGenerator<void> {
  try {
    while (true) {
      const event = yield* take(channel);
      if (event === (END as unknown as CloseEvent)) return;
      yield* put(closeReleaseNotesModal());
    }
  } finally {
    channel.close();
  }
}

function* watchShowEvents(
  channel: EventChannel<ShowReleaseNotesPayload>,
  surfaced: Set<string>,
): SagaGenerator<void> {
  try {
    while (true) {
      const payload: ShowReleaseNotesPayload = yield* take(channel);
      if (payload === (END as unknown as ShowReleaseNotesPayload)) return;
      const notes = payload?.notes ?? null;
      if (!notes) {
        yield* put(showReleaseNotes());
      } else if (!surfaced.has(notes.version)) {
        surfaced.add(notes.version);
        yield* put(showReleaseNotesSuccess(notes));
      }
    }
  } finally {
    channel.close();
  }
}

export function* releaseNotesSaga(): SagaGenerator<void> {
  yield* take(initializeReleaseNotes);
  const surfaced = new Set<string>();
  const channel = createReleaseNotesChannel();
  const closeChannel = createCloseChannel();
  yield* put(setInitialized());
  yield* fork(claimPending, surfaced);
  yield* fork(watchShowEvents, channel, surfaced);
  yield* fork(watchCloseEvents, closeChannel);
  yield* takeEvery(dismissReleaseNotes, notifyDismiss);
  yield* takeEvery(showReleaseNotes, fetchReleaseNotes);
}
