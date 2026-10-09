import { buffers, eventChannel, type EventChannel, type Task } from 'redux-saga';
import {
  call,
  cancelled,
  delay,
  fork,
  join,
  put,
  race,
  take,
  takeEvery,
  type SagaGenerator,
} from 'typed-redux-saga';

import { appClient } from '$lib/client';
import { backendRequest } from '$lib/client/live/backend-transport';
import { invoke } from '$lib/electron-bridge';
import { createLogger } from '$lib/utils/client-logger';
import { SPEC_NOTE_ID } from '$shared/constants/notes';
import { isNoteContentStale } from '$shared/utils/note-content';
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
import { workspaceUnmounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import {
  takeLatestInContext,
  takeLatestByContext,
  takeSingleFlightInContext,
} from '../../../utils/context-saga-effects';
import { selectNoteById, selectWorkspaceNotesState } from '../workspace-notes-selectors';
import {
  applyNoteCreated,
  applyNoteDeleted,
  applyNoteUpdated,
  commentEventReceived,
  ensureNoteContentLoadedRequested,
  listSlimNotesRequested,
  loadNoteCommentsRequested,
  loadWorkspaceNotesFailed,
  loadWorkspaceNotesSucceeded,
  noteEventReceived,
  noteAttributionInvalidated,
  noteAttributionViewFinished,
  noteAttributionViewReleased,
  noteAttributionViewRequested,
  noteContentViewFinished,
  noteContentViewReleased,
  noteContentViewRequested,
  notePresenceViewReleased,
  notePresenceViewRequested,
  notePresenceViewersReceived,
  noteWorkspaceRootFinished,
  noteWorkspaceRootReleased,
  noteWorkspaceRootRequested,
  readNoteRequested,
  refreshNoteFromEventRequested,
  searchNotesRequested,
  selectNote,
  workspaceNotesHydrationRequested,
  type NoteEventType,
} from '../workspace-notes-slice';
import {
  joinNotePresence,
  registerOwnedNotePresenceSession,
  type NotePresenceSession,
  type RemoteNoteViewer,
} from '$features/notes/note-presence/note-presence-service';
import type { NotePresenceViewer } from '../workspace-notes-types';
import { takeEveryFromListenSync } from '../../../utils/ipc-channel';
import { toRuntimeNote } from './note-payload-mappers';
import { adaptNoteSearchResponse } from '$lib/utils/palette-note-search';

const logger = createLogger('NotesReadSaga');

type ObservedAction = { type: string; payload?: unknown };
type ReadAction = ReturnType<typeof readNoteRequested>;
type ReadResult = { note: ReturnType<typeof toRuntimeNote> | null } | { error: Error };
type ReadSlot = {
  generation: number;
  task: Task;
  leaderSeq: number;
  eventType?: NoteEventType;
  authority: string | null;
};
type ReadAdmission = { current?: ReadSlot; trailing?: ReadSlot };
type ReadCoordinator = {
  admissions: Map<string, ReadAdmission>;
  nextGeneration: number;
};

const NOTE_READ_CANCELLED = 'Note read cancelled';
const PALETTE_NOTE_SEARCH_DEBOUNCE_MS = 150;

function getWorkspaceRoot(workspaceId: string): Promise<string | null> {
  return invoke<string | null>('workspace:get-root', { workspaceId });
}

function isWorkspaceCleanup(action: ObservedAction, workspaceId: string): boolean {
  return (
    action.type === workspaceUnmounted.type &&
    Array.isArray(action.payload) &&
    action.payload[0] === workspaceId
  );
}

function isNoteReadCleanup(action: ObservedAction, workspaceId: string, noteId: string): boolean {
  return (
    isWorkspaceCleanup(action, workspaceId) ||
    (action.type === applyNoteDeleted.type &&
      Array.isArray(action.payload) &&
      action.payload[0] === workspaceId &&
      action.payload[1] === noteId)
  );
}

function releaseReadSlot(coordinator: ReadCoordinator, key: string, generation: number) {
  const admission = coordinator.admissions.get(key);
  if (!admission) return;
  if (admission.current?.generation === generation) {
    if (admission.trailing) {
      admission.current = admission.trailing;
      admission.trailing = undefined;
    } else {
      coordinator.admissions.delete(key);
    }
  } else if (admission.trailing?.generation === generation) {
    admission.trailing = undefined;
  }
}

function* fetchNoteSlot(
  coordinator: ReadCoordinator,
  key: string,
  workspaceId: string,
  noteId: string,
  generation: number,
  after?: Task,
): SagaGenerator<ReadResult> {
  try {
    if (after) {
      const { cleanup } = yield* race({
        previous: join(after),
        cleanup: take((action: ObservedAction) => isNoteReadCleanup(action, workspaceId, noteId)),
      });
      if (cleanup) return { note: null };
    }
    const { found, cleanup } = yield* race({
      found: call([appClient.notes, appClient.notes.get], noteId, workspaceId),
      cleanup: take((action: ObservedAction) => isNoteReadCleanup(action, workspaceId, noteId)),
    });
    if (cleanup || !found) return { note: null };
    if (String(found.workspaceId) !== workspaceId || String(found.id) !== noteId) {
      return { note: null };
    }
    return { note: toRuntimeNote(found) };
  } catch (error) {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  } finally {
    releaseReadSlot(coordinator, key, generation);
  }
}

function* createReadSlot(
  coordinator: ReadCoordinator,
  key: string,
  workspaceId: string,
  noteId: string,
  action: ReadAction,
  authority: string | null,
  after?: Task,
): SagaGenerator<ReadSlot> {
  const generation = ++coordinator.nextGeneration;
  const task = yield* fork(fetchNoteSlot, coordinator, key, workspaceId, noteId, generation, after);
  return { generation, task, leaderSeq: action.seq, eventType: action.payload[2], authority };
}

function* admitNoteRead(
  coordinator: ReadCoordinator,
  action: ReadAction,
  authority: string | null,
): SagaGenerator<ReadSlot> {
  const [workspaceId, noteId, eventType] = action.payload;
  const key = `${authority ?? 'none'}:${workspaceId}:${noteId}`;
  let admission = coordinator.admissions.get(key);
  if (!admission?.current) {
    admission = {};
    coordinator.admissions.set(key, admission);
    const slot = yield* createReadSlot(coordinator, key, workspaceId, noteId, action, authority);
    admission.current = slot;
    return slot;
  }
  if (!eventType) return admission.current;
  if (!admission.trailing) {
    admission.trailing = yield* createReadSlot(
      coordinator,
      key,
      workspaceId,
      noteId,
      action,
      authority,
      admission.current.task,
    );
  }
  return admission.trailing;
}

function* hydrateWorkspaceNotes(workspaceId: string, force = false) {
  const current = yield* selectWorkspaceNotesState.effect(workspaceId);
  if (current.loading || (!force && current.initialized)) return;
  try {
    // Slim projection (§5.2): the initial hydrate does not need full bodies —
    // sidebar surfaces read titles/tags/metadata, and slim rows carry
    // contentPreview/contentLength. The spec is the one structural exception
    // (task links, ordering), so fetch it full alongside the slim list.
    // The spec fetch is fail-soft: a workspace without a spec note must not
    // fail the hydrate (its slim row, if any, is kept as-is).
    const fetchSlimListAndSpec = (id: string) =>
      Promise.all([
        appClient.notes.list(id, { projection: 'slim' }),
        appClient.notes.get(SPEC_NOTE_ID, id).catch(() => null),
      ]);
    const [response, specNote]: Awaited<ReturnType<typeof fetchSlimListAndSpec>> = yield* call(
      fetchSlimListAndSpec,
      workspaceId,
    );
    const notes = response.map((note) =>
      specNote && String(note.id) === SPEC_NOTE_ID ? toRuntimeNote(specNote) : toRuntimeNote(note),
    );
    yield* put(loadWorkspaceNotesSucceeded([workspaceId], { [workspaceId]: notes }));
    const spec = notes.find((note) => String(note.id) === SPEC_NOTE_ID);
    if (spec) yield* put(selectNote(workspaceId, String(spec.id)));
  } catch (error) {
    logger.error('Failed to hydrate workspace notes', error);
    yield* put(
      loadWorkspaceNotesFailed(
        [workspaceId],
        error instanceof Error ? error.message : String(error),
      ),
    );
  }
}

function* applyNoteEvent(workspaceId: string, noteId: string, eventType: NoteEventType) {
  try {
    const request = readNoteRequested(workspaceId, noteId, eventType);
    yield* put(request);
    yield* call(() => request.promise);
  } catch (error) {
    logger.error('Failed to apply note event', error);
  }
}

function* readNoteWorker(
  coordinator: ReadCoordinator,
  action: ReturnType<typeof readNoteRequested>,
) {
  const [workspaceId, noteId, eventType] = action.payload;
  let settled = false;
  try {
    const authority = yield* selectPrincipalConnectionContext.effect();
    const slot = yield* call(admitNoteRead, coordinator, action, authority);
    const result = (yield* join(slot.task)) as ReadResult;
    if ('error' in result) throw result.error;
    const { note } = result;
    const authorityStillMatches =
      slot.authority === (yield* selectPrincipalConnectionContext.effect());
    if (note && authorityStillMatches && slot.leaderSeq === action.seq) {
      const existing = yield* selectNoteById.effect(workspaceId, noteId);
      if (eventType === 'note:created' && !existing) {
        yield* put(applyNoteCreated(workspaceId, note));
      } else {
        yield* put(applyNoteUpdated(workspaceId, noteId, note));
      }
    }
    yield* put(action.success(authorityStillMatches ? note : null));
    settled = true;
  } catch (error) {
    yield* put(action.failure(error instanceof Error ? error : new Error(String(error))));
    settled = true;
  } finally {
    if (!settled && (yield* cancelled())) {
      yield* put(action.failure(new Error(NOTE_READ_CANCELLED)));
    }
  }
}

function* noteContentViewWorker(
  action: ReturnType<typeof noteContentViewRequested | typeof noteContentViewReleased>,
) {
  if (action.type === noteContentViewReleased.type) return;
  const requestAction = action as ReturnType<typeof noteContentViewRequested>;
  const [consumerId, requestId, workspaceId, noteId] = requestAction.payload;
  const authority = yield* selectPrincipalConnectionContext.effect();
  try {
    const request = ensureNoteContentLoadedRequested(workspaceId, noteId);
    yield* put(request);
    const loaded = yield* call(() => request.promise);
    if (authority !== (yield* selectPrincipalConnectionContext.effect())) return;
    yield* put(
      noteContentViewFinished(
        workspaceId,
        consumerId,
        requestId,
        authority,
        loaded ? undefined : 'Unable to load note content',
      ),
    );
  } catch (error) {
    if (authority !== (yield* selectPrincipalConnectionContext.effect())) return;
    yield* put(
      noteContentViewFinished(
        workspaceId,
        consumerId,
        requestId,
        authority,
        error instanceof Error ? error.message : String(error),
      ),
    );
  }
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
    while (true) {
      const next = yield* take(noteAttributionInvalidated);
      if (next.payload[0] === workspaceId && next.payload[1] === noteId) break;
    }
  }
}

type LineAttributionUpdatedPayload = { workspaceId?: unknown; noteId?: unknown };

function* routeLineAttributionUpdated(payload: LineAttributionUpdatedPayload) {
  const workspaceId = typeof payload.workspaceId === 'string' ? payload.workspaceId : '';
  const noteId = typeof payload.noteId === 'string' ? payload.noteId : '';
  if (workspaceId && noteId) yield* put(noteAttributionInvalidated(workspaceId, noteId));
}

function* ensureNoteContentWorker(action: ReturnType<typeof ensureNoteContentLoadedRequested>) {
  const [workspaceId, noteId] = action.payload;
  try {
    const cached = yield* selectNoteById.effect(workspaceId, noteId);
    if (!cached) {
      yield* put(action.success(false));
      return;
    }
    if (!isNoteContentStale(cached)) {
      yield* put(action.success(true));
      return;
    }
    const request = readNoteRequested(workspaceId, noteId);
    yield* put(request);
    const note = yield* call(() => request.promise);
    yield* put(action.success(note !== null && !isNoteContentStale(note)));
  } catch (error) {
    logger.error('Failed to load full note content', error);
    yield* put(action.success(false));
  }
}

function* listSlimNotesWorker(action: ReturnType<typeof listSlimNotesRequested>) {
  const [workspaceId] = action.payload;
  const authority = yield* selectPrincipalConnectionContext.effect();
  if (!authority) {
    yield* put(action.failure(new Error('Note list requires an admitted connection')));
    return;
  }
  try {
    const notes = yield* call(() => appClient.notes.list(workspaceId, { projection: 'slim' }));
    if (authority !== (yield* selectPrincipalConnectionContext.effect())) {
      yield* put(action.failure(new Error('Note list authority changed')));
      return;
    }
    yield* put(action.success(notes));
  } catch (error) {
    yield* put(action.failure(error instanceof Error ? error : new Error(String(error))));
  }
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

function* hydrateWorkspaceNotesWorker(action: ReturnType<typeof workspaceNotesHydrationRequested>) {
  const [workspaceId, , force] = action.payload;
  if (!workspaceId) return;
  yield* race({
    hydrate: call(hydrateWorkspaceNotes, workspaceId, force),
    cleanup: take((cleanup: ObservedAction) => isWorkspaceCleanup(cleanup, workspaceId)),
  });
}

function* applyNoteEventWorker(action: ReturnType<typeof refreshNoteFromEventRequested>) {
  const [workspaceId, noteId, eventType] = action.payload;
  if (!workspaceId || !noteId || eventType === 'note:deleted') return;
  yield* race({
    apply: call(applyNoteEvent, workspaceId, noteId, eventType),
    cleanup: take((cleanup: ObservedAction) => isWorkspaceCleanup(cleanup, workspaceId)),
  });
}

function* routeNoteEventWorker(action: ReturnType<typeof noteEventReceived>) {
  const [workspaceId, noteId, eventType] = action.payload;
  if (!workspaceId || !noteId) return;
  if (eventType === 'note:deleted') {
    yield* put(applyNoteDeleted(workspaceId, noteId));
  }
  yield* put(refreshNoteFromEventRequested(workspaceId, noteId, eventType));
}

export function* notesReadSaga() {
  const coordinator: ReadCoordinator = { admissions: new Map(), nextGeneration: 0 };
  yield* takeEvery(readNoteRequested, readNoteWorker, coordinator);
  yield* takeEvery(ensureNoteContentLoadedRequested, ensureNoteContentWorker);
  yield* takeEvery(listSlimNotesRequested, listSlimNotesWorker);
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
    [noteContentViewRequested, noteContentViewReleased],
    (action) =>
      action.type === noteContentViewReleased.type ? action.payload[1] : action.payload[0],
    noteContentViewWorker,
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
  yield* takeLatestByContext(
    workspaceNotesHydrationRequested,
    (action) => ({ context: action.payload[0], generation: action.payload[1] }),
    hydrateWorkspaceNotesWorker,
  );
  yield* takeEvery(noteEventReceived, routeNoteEventWorker);
  yield* takeEvery(refreshNoteFromEventRequested, applyNoteEventWorker);
  yield* takeSingleFlightInContext(
    commentEventReceived,
    (action) => `${action.payload[0]}:${action.payload[1]}`,
    applyCommentEventWorker,
  );
}
