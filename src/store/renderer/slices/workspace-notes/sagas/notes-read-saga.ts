import { buffers, eventChannel, type EventChannel } from 'redux-saga';
import {
  actionChannel,
  call,
  cancelled,
  delay,
  flush,
  fork,
  put,
  take,
  takeEvery,
} from 'typed-redux-saga';

import { appClient } from '$lib/client';
import { backendRequest } from '$lib/client/live/backend-transport';
import { invoke } from '$lib/electron-bridge';
import { createLogger } from '$lib/utils/client-logger';
import {
  commentLoadFinished,
  commentLoadReleased,
  commentLoadRequested,
  replaceNoteCommentsAction,
} from '../../comments/comments-slice';
import { selectPrincipalConnectionContext } from '../../principal/principal-selectors';
import {
  paletteNoteSearchAuthorityCaptured,
  paletteNoteSearchFinished,
  paletteNoteSearchRequested,
} from '../../palette/palette-slice';
import type { PaletteNoteSearchUpdate } from '../../palette/palette-types';
import {
  takeLatestInContext,
  takeSingleFlightInContext,
} from '../../../utils/context-saga-effects';
import {
  commentEventReceived,
  loadNoteCommentsRequested,
  noteAttributionInvalidated,
  noteAttributionViewFinished,
  noteAttributionViewReleased,
  noteAttributionViewRequested,
  notePresenceViewReleased,
  notePresenceViewRequested,
  notePresenceViewersReceived,
  noteWorkspaceRootFinished,
  noteWorkspaceRootReleased,
  noteWorkspaceRootRequested,
  searchNotesRequested,
} from '../workspace-notes-slice';
import {
  joinNotePresence,
  registerOwnedNotePresenceSession,
  type NotePresenceSession,
  type RemoteNoteViewer,
} from '$features/notes/note-presence/note-presence-service';
import type { NotePresenceViewer } from '../workspace-notes-types';
import { takeEveryFromListenSync } from '../../../utils/ipc-channel';
import { adaptNoteSearchResponse } from '$lib/utils/palette-note-search';

import { selectNoteById, selectWorkspaceNotesState } from '../workspace-notes-selectors';
import { createNotesContentReadSaga } from './notes-content-read-saga-factory';

const logger = createLogger('NotesReadSaga');
const notesContentReadSaga = createNotesContentReadSaga({
  notes: appClient.notes,
  selectPrincipalConnectionContext,
  selectWorkspaceNotesState,
  selectNoteById,
  logger,
});

type AttributionInvalidationAction = { type: string; payload?: [string, string] };
const PALETTE_NOTE_SEARCH_DEBOUNCE_MS = 150;

function getWorkspaceRoot(workspaceId: string): Promise<string | null> {
  return invoke<string | null>('workspace:get-root', { workspaceId });
}

function* noteWorkspaceRootWorker(
  action: ReturnType<typeof noteWorkspaceRootRequested | typeof noteWorkspaceRootReleased>,
) {
  if (action.type === noteWorkspaceRootReleased.type) return;
  const requestAction = action as ReturnType<typeof noteWorkspaceRootRequested>;
  const [consumerId, requestId, workspaceId] = requestAction.payload;
  const authority = yield* selectPrincipalConnectionContext.effect();
  try {
    const path = yield* call(getWorkspaceRoot, workspaceId);
    if (authority !== (yield* selectPrincipalConnectionContext.effect())) return;
    yield* put(noteWorkspaceRootFinished(workspaceId, consumerId, requestId, authority, path));
  } catch (error) {
    if (authority !== (yield* selectPrincipalConnectionContext.effect())) return;
    yield* put(
      noteWorkspaceRootFinished(
        workspaceId,
        consumerId,
        requestId,
        authority,
        null,
        error instanceof Error ? error.message : String(error),
      ),
    );
  }
}

function projectPresenceViewers(viewers: RemoteNoteViewer[]): NotePresenceViewer[] {
  return viewers.map(({ principalId, login, displayName, avatarUrl, cursor, cursorSeenAt }) => ({
    principalId,
    login: login ?? null,
    displayName: displayName ?? null,
    avatarUrl: avatarUrl ?? null,
    cursor,
    cursorSeenAt,
  }));
}

function createNotePresenceChannel(session: NotePresenceSession): EventChannel<RemoteNoteViewer[]> {
  return eventChannel<RemoteNoteViewer[]>(
    (emit) => session.subscribe(emit),
    buffers.sliding<RemoteNoteViewer[]>(1),
  );
}

function* notePresenceViewWorker(
  action: ReturnType<typeof notePresenceViewRequested | typeof notePresenceViewReleased>,
) {
  if (action.type === notePresenceViewReleased.type) return;
  const [consumerId, requestId, workspaceId, noteId] = action.payload as ReturnType<
    typeof notePresenceViewRequested
  >['payload'];
  const authority = yield* selectPrincipalConnectionContext.effect();
  const session: NotePresenceSession = yield* call(joinNotePresence, workspaceId, noteId);
  const unregisterOwned = registerOwnedNotePresenceSession(workspaceId, noteId, session);
  const channel = createNotePresenceChannel(session);
  try {
    yield* put(
      notePresenceViewersReceived(
        workspaceId,
        consumerId,
        requestId,
        authority,
        projectPresenceViewers(session.getViewers()),
      ),
    );
    while (true) {
      const viewers = yield* take(channel);
      if (authority !== (yield* selectPrincipalConnectionContext.effect())) return;
      yield* put(
        notePresenceViewersReceived(
          workspaceId,
          consumerId,
          requestId,
          authority,
          projectPresenceViewers(viewers),
        ),
      );
    }
  } finally {
    channel.close();
    unregisterOwned();
    session.release();
  }
}

function* noteAttributionViewWorker(
  action: ReturnType<typeof noteAttributionViewRequested | typeof noteAttributionViewReleased>,
) {
  if (action.type === noteAttributionViewReleased.type) return;
  const [consumerId, requestId, workspaceId, noteId] = action.payload as ReturnType<
    typeof noteAttributionViewRequested
  >['payload'];
  const authority = yield* selectPrincipalConnectionContext.effect();
  const invalidations = yield* actionChannel(
    (next: AttributionInvalidationAction) =>
      next.type === noteAttributionInvalidated.type &&
      next.payload?.[0] === workspaceId &&
      next.payload?.[1] === noteId,
    buffers.sliding(1),
  );
  try {
    while (true) {
      try {
        const data = yield* call(
          [appClient.notes.lineAttribution, appClient.notes.lineAttribution.load],
          workspaceId,
          noteId,
        );
        if (authority !== (yield* selectPrincipalConnectionContext.effect())) return;
        const valid =
          data === null ||
          (String(data.workspaceId) === workspaceId && String(data.noteId) === noteId);
        yield* put(
          noteAttributionViewFinished(
            consumerId,
            requestId,
            workspaceId,
            authority,
            valid ? data : null,
            valid ? undefined : 'Attribution response did not match the requested note',
          ),
        );
      } catch (error) {
        if (authority !== (yield* selectPrincipalConnectionContext.effect())) return;
        yield* put(
          noteAttributionViewFinished(
            consumerId,
            requestId,
            workspaceId,
            authority,
            null,
            error instanceof Error ? error.message : String(error),
          ),
        );
      }
      // The channel is registered before each load so update events received while
      // it is pending produce exactly one trailing refresh rather than being lost.
      if ((yield* flush(invalidations)).length > 0) continue;
      yield* take(invalidations);
    }
  } finally {
    invalidations.close();
  }
}

type LineAttributionUpdatedPayload = { workspaceId?: unknown; noteId?: unknown };

function* routeLineAttributionUpdated(payload: LineAttributionUpdatedPayload) {
  const workspaceId = typeof payload.workspaceId === 'string' ? payload.workspaceId : '';
  const noteId = typeof payload.noteId === 'string' ? payload.noteId : '';
  if (workspaceId && noteId) yield* put(noteAttributionInvalidated(workspaceId, noteId));
}

function* searchNotesWorker(action: ReturnType<typeof searchNotesRequested>) {
  const [query, preferWorkspaceId] = action.payload;
  try {
    const response: unknown = yield* call(backendRequest, 'search.notes', {
      query,
      limit: 10,
      includeArchived: false,
      ...(preferWorkspaceId ? { preferWorkspaceId } : {}),
    });
    yield* put(action.success(response));
  } catch (error) {
    yield* put(action.failure(error instanceof Error ? error : new Error(String(error))));
  }
}

function* paletteNoteSearchWorker(action: ReturnType<typeof paletteNoteSearchRequested>) {
  const [consumerId, requestId, query, preferWorkspaceId] = action.payload;
  let settled = false;
  let authority: string | null = null;
  const cancelledUpdate: PaletteNoteSearchUpdate = {
    items: [],
    loading: false,
    capability: 'unknown',
    fallback: true,
  };
  try {
    authority = yield* selectPrincipalConnectionContext.effect();
    yield* put(paletteNoteSearchAuthorityCaptured(consumerId, requestId, authority));
    if (!query.trim()) {
      yield* put(paletteNoteSearchFinished(consumerId, requestId, authority, cancelledUpdate));
      yield* put(action.success(cancelledUpdate));
      settled = true;
      return;
    }
    yield* delay(PALETTE_NOTE_SEARCH_DEBOUNCE_MS);
    if ((yield* selectPrincipalConnectionContext.effect()) !== authority) {
      yield* put(paletteNoteSearchFinished(consumerId, requestId, authority, cancelledUpdate));
      yield* put(action.success(cancelledUpdate));
      settled = true;
      return;
    }
    const response: unknown = yield* call(backendRequest, 'search.notes', {
      query,
      limit: 10,
      includeArchived: false,
      ...(preferWorkspaceId ? { preferWorkspaceId } : {}),
    });
    const update = adaptNoteSearchResponse(response, []);
    if ((yield* selectPrincipalConnectionContext.effect()) === authority) {
      yield* put(paletteNoteSearchFinished(consumerId, requestId, authority, update));
    } else {
      yield* put(paletteNoteSearchFinished(consumerId, requestId, authority, cancelledUpdate));
      yield* put(action.success(cancelledUpdate));
      settled = true;
      return;
    }
    yield* put(action.success(update));
    settled = true;
  } catch (error) {
    const update: PaletteNoteSearchUpdate = {
      ...cancelledUpdate,
      error: error instanceof Error ? error.message : String(error),
    };
    authority = yield* selectPrincipalConnectionContext.effect();
    yield* put(paletteNoteSearchFinished(consumerId, requestId, authority, update));
    yield* put(action.success(update));
    settled = true;
  } finally {
    if (!settled && (yield* cancelled())) {
      yield* put(paletteNoteSearchFinished(consumerId, requestId, authority, cancelledUpdate));
      yield* put(action.success(cancelledUpdate));
    }
  }
}

function* loadNoteComments(workspaceId: string, noteId: string, apply = true) {
  const comments: Awaited<ReturnType<typeof appClient.comments.list>> = yield* call(
    [appClient.comments, appClient.comments.list],
    noteId,
    workspaceId,
  );
  if (apply) yield* put(replaceNoteCommentsAction(workspaceId, noteId, comments));
  return comments;
}

function* loadNoteCommentsWorker(action: ReturnType<typeof loadNoteCommentsRequested>) {
  const [workspaceId, noteId] = action.payload;
  try {
    const comments = yield* call(loadNoteComments, workspaceId, noteId, false);
    yield* put(action.success(comments));
  } catch (error) {
    yield* put(action.failure(error instanceof Error ? error : new Error(String(error))));
  }
}

function* commentLoadViewWorker(
  action: ReturnType<typeof commentLoadRequested | typeof commentLoadReleased>,
) {
  if (action.type === commentLoadReleased.type) return;
  const requestAction = action as ReturnType<typeof commentLoadRequested>;
  const [consumerId, requestId, workspaceId, noteId] = requestAction.payload;
  const authority = yield* selectPrincipalConnectionContext.effect();
  let settled = false;
  try {
    const comments = yield* call(loadNoteComments, workspaceId, noteId);
    if (authority !== (yield* selectPrincipalConnectionContext.effect())) {
      yield* put(requestAction.failure(new Error('Comment load authority changed')));
      settled = true;
      return;
    }
    yield* put(commentLoadFinished(consumerId, requestId, workspaceId, authority));
    yield* put(requestAction.success(comments));
    settled = true;
  } catch (error) {
    const normalized = error instanceof Error ? error : new Error(String(error));
    if (authority === (yield* selectPrincipalConnectionContext.effect())) {
      yield* put(
        commentLoadFinished(consumerId, requestId, workspaceId, authority, normalized.message),
      );
    }
    yield* put(requestAction.failure(normalized));
    settled = true;
  } finally {
    if (!settled && (yield* cancelled())) {
      yield* put(requestAction.failure(new Error('Comment load cancelled')));
    }
  }
}

function* applyCommentEventWorker(action: ReturnType<typeof commentEventReceived>) {
  const [workspaceId, noteId] = action.payload;
  if (!workspaceId || !noteId) return;
  try {
    yield* call(loadNoteComments, workspaceId, noteId);
  } catch (error) {
    logger.error('Failed to apply comment event', error);
  }
}

export function* notesReadSaga() {
  yield* fork(notesContentReadSaga);
  yield* takeEvery(searchNotesRequested, searchNotesWorker);
  yield* takeLatestInContext(
    paletteNoteSearchRequested,
    (action) => action.payload[0],
    paletteNoteSearchWorker,
  );
  yield* takeEvery(loadNoteCommentsRequested, loadNoteCommentsWorker);
  yield* takeLatestInContext(
    [commentLoadRequested, commentLoadReleased],
    (action) => action.payload[0],
    commentLoadViewWorker,
  );
  yield* takeLatestInContext(
    [noteWorkspaceRootRequested, noteWorkspaceRootReleased],
    (action) =>
      action.type === noteWorkspaceRootReleased.type ? action.payload[1] : action.payload[0],
    noteWorkspaceRootWorker,
  );
  yield* takeLatestInContext(
    [notePresenceViewRequested, notePresenceViewReleased],
    (action) =>
      action.type === notePresenceViewReleased.type ? action.payload[1] : action.payload[0],
    notePresenceViewWorker,
  );
  yield* takeLatestInContext(
    [noteAttributionViewRequested, noteAttributionViewReleased],
    (action) =>
      action.type === noteAttributionViewReleased.type ? action.payload[1] : action.payload[0],
    noteAttributionViewWorker,
  );
  yield* takeEveryFromListenSync<LineAttributionUpdatedPayload>(
    'line-attribution:updated',
    routeLineAttributionUpdated,
  );
  yield* takeSingleFlightInContext(
    commentEventReceived,
    (action) => `${action.payload[0]}:${action.payload[1]}`,
    applyCommentEventWorker,
  );
}
