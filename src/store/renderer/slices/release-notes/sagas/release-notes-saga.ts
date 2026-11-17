import { END, eventChannel, type EventChannel } from 'redux-saga';
import { takeLatestFromSelector, type SelectorChannelPayload } from '@themislib/themis/saga';
import {
  call,
  fork,
  put,
  race,
  take,
  takeEvery,
  takeLatest,
  type SagaGenerator,
} from 'typed-redux-saga';

import { releaseNotesClient } from '$features/release-notes/release-notes.client';
import type { ReleaseNotesContent, ShowReleaseNotesPayload } from '$features/release-notes/types';
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

import { selectReleaseNotesRendererShown } from '../release-notes-selectors';

const logger = createLogger('ReleaseNotesSaga');

const CLOSE_EVENT = 'close';
type CloseEvent = typeof CLOSE_EVENT;

function createReleaseNotesChannel(): EventChannel<ShowReleaseNotesPayload> {
  return eventChannel((emit) => releaseNotesClient.onShow(emit));
}

function createCloseChannel(): EventChannel<CloseEvent> {
  return eventChannel((emit) => releaseNotesClient.onClose(() => emit(CLOSE_EVENT)));
}

function* loadReleaseNotes(): SagaGenerator<ReleaseNotesContent | null> {
  try {
    return yield* call([releaseNotesClient, releaseNotesClient.getReleaseNotes]);
  } catch (error) {
    logger.warn('Failed to fetch release notes', error);
    return null;
  }
}

/**
 * On-demand (Help menu) fetch. The result only lands while the modal is still
 * open: a close in the meantime — local dismissal or the cross-window close
 * broadcast — wins the race and the late result is dropped instead of
 * re-opening the modal.
 */
function* fetchReleaseNotes(): SagaGenerator<void> {
  const { notes, closed } = yield* race({
    notes: call(loadReleaseNotes),
    closed: take([dismissReleaseNotes, closeReleaseNotesModal]),
  });
  if (closed) return;
  yield* put(notes ? showReleaseNotesSuccess(notes) : showReleaseNotesUnavailable());
}

/**
 * Main grants startup notes to one shown renderer. The push can overlap its
 * one-shot pending claim, so dedup locally too. A close or manual open wins
 * over a delayed claim response.
 */
function* claimPending(surfaced: Set<string>): SagaGenerator<void> {
  try {
    const { notes, superseded } = yield* race({
      notes: call([releaseNotesClient, releaseNotesClient.claimPendingReleaseNotes]),
      superseded: take([dismissReleaseNotes, closeReleaseNotesModal, showReleaseNotes]),
    });
    if (!superseded && notes && !surfaced.has(notes.version)) {
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
  yield* fork(watchShowEvents, channel, surfaced);
  yield* fork(watchCloseEvents, closeChannel);
  yield* takeEvery(dismissReleaseNotes, notifyDismiss);
  yield* takeLatest(showReleaseNotes, fetchReleaseNotes);
  // Hidden renderers may mount first. Retry when main actually shows this
  // machine, rather than when a switch is merely requested.
  yield* takeLatestFromSelector(
    selectReleaseNotesRendererShown,
    function* ({ payload: shown }: SelectorChannelPayload<boolean>) {
      if (shown) yield* call(claimPending, surfaced);
    },
  );
}
