import { END, eventChannel, type EventChannel } from 'redux-saga';
import { call, fork, put, take, takeEvery, type SagaGenerator } from 'typed-redux-saga';

import { releaseNotesClient } from '$features/release-notes/release-notes.client';
import type { ShowReleaseNotesPayload } from '$features/release-notes/types';
import { createLogger } from '$lib/utils/client-logger';
import {
  initializeReleaseNotes,
  setInitialized,
  showReleaseNotes,
  showReleaseNotesSuccess,
  showReleaseNotesUnavailable,
} from '../release-notes-slice';

const logger = createLogger('ReleaseNotesSaga');

function createReleaseNotesChannel(): EventChannel<ShowReleaseNotesPayload> {
  return eventChannel((emit) => releaseNotesClient.onShow(emit));
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
  yield* put(setInitialized());
  yield* fork(claimPending, surfaced);
  yield* fork(watchShowEvents, channel, surfaced);
  yield* takeEvery(showReleaseNotes, fetchReleaseNotes);
}
