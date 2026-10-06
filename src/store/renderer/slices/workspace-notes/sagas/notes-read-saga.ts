import { call, put, race, take, takeEvery } from 'typed-redux-saga';

import { appClient } from '$lib/client';
import { backendRequest } from '$lib/client/live/backend-transport';
import { createLogger } from '$lib/utils/client-logger';
import { SPEC_NOTE_ID } from '$shared/constants/notes';
import { isNoteContentStale } from '$shared/utils/note-content';
import { replaceNoteCommentsAction } from '../../comments/comments-slice';
import { workspaceUnmounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import {
  takeEveryByContextFIFO,
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
  loadNoteCommentsRequested,
  loadWorkspaceNotesFailed,
  loadWorkspaceNotesSucceeded,
  noteEventReceived,
  readNoteRequested,
  searchNotesRequested,
  selectNote,
  workspaceNotesHydrationRequested,
  type NoteEventType,
} from '../workspace-notes-slice';
import { toRuntimeNote } from './note-payload-mappers';

const logger = createLogger('NotesReadSaga');

type ObservedAction = { type: string; payload?: unknown };
type NoteReadResult = Awaited<ReturnType<typeof appClient.notes.get>>;
type NoteReadSlot = {
  dirty: boolean;
  cancelled: boolean;
  settled: Promise<NoteReadResult[]>;
};

const noteReads = new Map<string, NoteReadSlot>();
const noteReadGenerations = new Map<string, number>();

function fetchNoteSingleFlight(workspaceId: string, noteId: string, invalidate = false) {
  const key = `${workspaceId}:${noteId}`;
  const pending = noteReads.get(key);
  if (pending) {
    pending.dirty ||= invalidate;
    return pending.settled.then((results) => ({
      found: pending.cancelled ? null : (results.at(-1) ?? null),
      // eslint-disable-next-line themis/collection-state-shape -- saga-local in-flight results, not Redux state
      ownedResults: [] as NoteReadResult[],
    }));
  }

  const generation = noteReadGenerations.get(key) ?? 0;
  const slot: NoteReadSlot = { dirty: false, cancelled: false, settled: Promise.resolve([]) };
  noteReads.set(key, slot);
  slot.settled = (async () => {
    try {
      const results: NoteReadResult[] = [];
      const failures: unknown[] = [];
      let failure: unknown;
      do {
        slot.dirty = false;
        try {
          results.push(await appClient.notes.get(noteId, workspaceId));
          failure = undefined;
        } catch (error) {
          failure = error;
          failures.push(error);
        }
      } while (slot.dirty && !slot.cancelled);
      if (failure !== undefined && results.length === 0) throw failure;
      if (failures.length > 0) {
        logger.error(`Notes refresh partially failed for ${key}`, failures.at(-1));
      }
      return results;
    } finally {
      if (noteReads.get(key) === slot) noteReads.delete(key);
    }
  })();
  return slot.settled.then((results) => ({
    found:
      slot.cancelled || (noteReadGenerations.get(key) ?? 0) !== generation
        ? null
        : (results.at(-1) ?? null),
    ownedResults:
      slot.cancelled || (noteReadGenerations.get(key) ?? 0) !== generation ? [] : results,
  }));
}

function cancelNoteRead(workspaceId: string, noteId: string) {
  const key = `${workspaceId}:${noteId}`;
  noteReadGenerations.set(key, (noteReadGenerations.get(key) ?? 0) + 1);
  const slot = noteReads.get(key);
  if (slot) slot.cancelled = true;
  if (noteReads.get(key) === slot) noteReads.delete(key);
}

function clearWorkspaceNoteReads(action: ReturnType<typeof workspaceUnmounted>) {
  const [workspaceId] = action.payload;
  for (const [key, slot] of noteReads) {
    if (key.startsWith(`${workspaceId}:`)) {
      slot.cancelled = true;
      noteReads.delete(key);
    }
  }
  for (const key of noteReadGenerations.keys()) {
    if (key.startsWith(`${workspaceId}:`)) noteReadGenerations.delete(key);
  }
}

function isWorkspaceCleanup(action: ObservedAction, workspaceId: string): boolean {
  return (
    action.type === workspaceUnmounted.type &&
    Array.isArray(action.payload) &&
    action.payload[0] === workspaceId
  );
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
  if (eventType === 'note:deleted') {
    cancelNoteRead(workspaceId, noteId);
    yield* put(applyNoteDeleted(workspaceId, noteId));
    return;
  }
  try {
    // Targeted refetch (§5.2): one note changed, so fetch that note instead of
    // re-listing the whole workspace with full bodies.
    const { ownedResults } = yield* call(fetchNoteSingleFlight, workspaceId, noteId, true);
    for (const found of ownedResults) {
      if (!found || String(found.workspaceId) !== workspaceId) continue;
      const note = toRuntimeNote(found);
      const existing = yield* selectNoteById.effect(workspaceId, noteId);
      if (eventType === 'note:created' && !existing) {
        yield* put(applyNoteCreated(workspaceId, note));
      } else {
        yield* put(applyNoteUpdated(workspaceId, noteId, note));
      }
    }
  } catch (error) {
    logger.error('Failed to apply note event', error);
  }
}

function* readNote(workspaceId: string, noteId: string) {
  const { found, ownedResults } = yield* call(fetchNoteSingleFlight, workspaceId, noteId);
  for (const result of ownedResults) {
    if (result && String(result.workspaceId) === workspaceId) {
      yield* put(applyNoteUpdated(workspaceId, noteId, toRuntimeNote(result)));
    }
  }
  if (!found || String(found.workspaceId) !== workspaceId) return null;
  return toRuntimeNote(found);
}

function* readNoteWorker(action: ReturnType<typeof readNoteRequested>) {
  const [workspaceId, noteId] = action.payload;
  try {
    const note = yield* call(readNote, workspaceId, noteId);
    yield* put(action.success(note));
  } catch (error) {
    yield* put(action.failure(error instanceof Error ? error : new Error(String(error))));
  }
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
    const note = yield* call(readNote, workspaceId, noteId);
    yield* put(action.success(note !== null && !isNoteContentStale(note)));
  } catch (error) {
    logger.error('Failed to load full note content', error);
    yield* put(action.success(false));
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

function* applyNoteEventWorker(action: ReturnType<typeof noteEventReceived>) {
  const [workspaceId, noteId, eventType] = action.payload;
  if (!workspaceId || !noteId) return;
  yield* race({
    apply: call(applyNoteEvent, workspaceId, noteId, eventType),
    cleanup: take((cleanup: ObservedAction) => isWorkspaceCleanup(cleanup, workspaceId)),
  });
}

export function* notesReadSaga() {
  yield* takeEvery(workspaceUnmounted, clearWorkspaceNoteReads);
  yield* takeEvery(readNoteRequested, readNoteWorker);
  // Concurrent consumers of the same slim note share the first full-content
  // read. Every correlated request remains queued so each caller settles; once
  // the first read updates the cache, later requests resolve without another
  // note.get request.
  yield* takeEveryByContextFIFO(
    ensureNoteContentLoadedRequested,
    (action) => `${action.payload[0]}:${action.payload[1]}`,
    ensureNoteContentWorker,
    {},
  );
  yield* takeEvery(searchNotesRequested, searchNotesWorker);
  yield* takeEvery(loadNoteCommentsRequested, loadNoteCommentsWorker);
  yield* takeLatestByContext(
    workspaceNotesHydrationRequested,
    (action) => ({ context: action.payload[0], generation: action.payload[1] }),
    hydrateWorkspaceNotesWorker,
  );
  // The shared per-note coordinator owns single-flight and trailing coalescing
  // across both event refreshes and editor hydration. Every event reaches it so
  // a burst overlapping hydration still produces at most one trailing read.
  yield* takeEvery(noteEventReceived, applyNoteEventWorker);
  yield* takeSingleFlightInContext(
    commentEventReceived,
    (action) => `${action.payload[0]}:${action.payload[1]}`,
    applyCommentEventWorker,
  );
}
