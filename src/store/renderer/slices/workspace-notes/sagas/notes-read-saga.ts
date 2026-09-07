import { call, put, race, take } from 'typed-redux-saga';

import { appClient } from '$lib/client';
import { createLogger } from '$lib/utils/client-logger';
import { SPEC_NOTE_ID } from '$shared/constants/notes';
import { workspaceUnmounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import {
  takeLatestByContext,
  takeSingleFlightInContext,
} from '../../../utils/context-saga-effects';
import { selectNoteById, selectWorkspaceNotesState } from '../workspace-notes-selectors';
import {
  applyNoteCreated,
  applyNoteDeleted,
  applyNoteUpdated,
  loadWorkspaceNotesFailed,
  loadWorkspaceNotesSucceeded,
  noteEventReceived,
  selectNote,
  workspaceNotesHydrationRequested,
  type NoteEventType,
} from '../workspace-notes-slice';
import { toRuntimeNote } from './note-payload-mappers';

const logger = createLogger('NotesReadSaga');

type ObservedAction = { type: string; payload?: unknown };

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
    yield* put(applyNoteDeleted(workspaceId, noteId));
    return;
  }
  try {
    // Targeted refetch (§5.2): one note changed, so fetch that note instead of
    // re-listing the whole workspace with full bodies.
    const found: Awaited<ReturnType<typeof appClient.notes.get>> = yield* call(
      [appClient.notes, appClient.notes.get],
      noteId,
      workspaceId,
    );
    if (!found || String(found.workspaceId) !== workspaceId) return;
    const note = toRuntimeNote(found);
    const existing = yield* selectNoteById.effect(workspaceId, noteId);
    if (eventType === 'note:created' && !existing) {
      yield* put(applyNoteCreated(workspaceId, note));
    } else {
      yield* put(applyNoteUpdated(workspaceId, noteId, note));
    }
  } catch (error) {
    logger.error('Failed to apply note event', error);
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
  yield* takeLatestByContext(
    workspaceNotesHydrationRequested,
    (action) => ({ context: action.payload[0], generation: action.payload[1] }),
    hydrateWorkspaceNotesWorker,
  );
  // Per-note single-flight with trailing coalesce: events for different notes
  // run concurrently (a global takeLeading would drop a second note's event
  // while the first is fetching), while a burst of events for one note
  // collapses to the in-flight fetch plus at most one trailing refetch.
  yield* takeSingleFlightInContext(
    noteEventReceived,
    (action) => `${action.payload[0]}:${action.payload[1]}`,
    applyNoteEventWorker,
  );
}
