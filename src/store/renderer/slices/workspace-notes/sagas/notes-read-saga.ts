import { hasFullNoteEditLease } from '../note-full-edit-lease';
import { isMissingNote } from '$lib/client/note-page-errors';
import { isNoteContentStale } from '$shared/utils/note-content';
import { pageReset } from '../../note-pages/note-pages-slice';
import { selectNotePageSession } from '../../note-pages/note-pages-selectors';
import { call, put, race, take } from 'typed-redux-saga';

import { appClient } from '$lib/client';
import { createLogger } from '$lib/utils/client-logger';
import { SPEC_NOTE_ID } from '$shared/constants/notes';
import {
  workspaceUnmounted,
  backendReconnected,
} from '../../workspace-lifecycle/workspace-lifecycle-slice';
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
  specTaskLinksReceived,
  workspaceNotesHydrationRequested,
  type NoteEventType,
} from '../workspace-notes-slice';
import { toRuntimeNote } from './note-payload-mappers';

const logger = createLogger('NotesReadSaga');

type ObservedAction = { type: string; payload?: unknown };

function isWorkspaceCleanup(action: ObservedAction, workspaceId: string): boolean {
  return (
    action.type === backendReconnected.type ||
    (action.type === workspaceUnmounted.type &&
      Array.isArray(action.payload) &&
      action.payload[0] === workspaceId)
  );
}

function isDeletedNote(action: ObservedAction, workspaceId: string, noteId: string): boolean {
  return (
    action.type === applyNoteDeleted.type &&
    Array.isArray(action.payload) &&
    action.payload[0] === workspaceId &&
    action.payload[1] === noteId
  );
}

function* hydrateWorkspaceNotes(workspaceId: string, force = false) {
  const current = yield* selectWorkspaceNotesState.effect(workspaceId);
  if (current.loading || (!force && current.initialized)) return;
  try {
    const fetchSlimListAndLinks = async (id: string) => {
      const [rows, links] = await Promise.all([
        appClient.notes.list(id, { projection: 'slim' }),
        (appClient.notes.listTaskLinks?.(id, SPEC_NOTE_ID) ?? Promise.resolve(null)).catch(
          (error) => {
            if (isMissingNote(error)) return [];
            throw error;
          },
        ),
      ]);
      // Viewing never hydrates a complete body as an unsupported-capability fallback.
      return { rows, links };
    };
    const { rows, links } = yield* call(fetchSlimListAndLinks, workspaceId);
    const latest = yield* selectWorkspaceNotesState.effect(workspaceId);
    const summaryCurrent = latest.specTaskLinksGeneration === current.specTaskLinksGeneration;
    const acceptedRows = summaryCurrent
      ? rows
      : rows.flatMap((n) => {
          if (String(n.id) !== SPEC_NOTE_ID) return [n];
          if (latest.specDeleted) return [];
          return [latest.notes.map[SPEC_NOTE_ID] ?? n];
        });
    const notes = acceptedRows.map(toRuntimeNote);
    if (links !== null || current.specTaskLinks !== null)
      yield* put(specTaskLinksReceived(workspaceId, links, current.specTaskLinksGeneration));
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
  const owner = yield* selectWorkspaceNotesState.effect(workspaceId);
  if (noteId === SPEC_NOTE_ID && eventType !== 'note:deleted' && appClient.notes.listTaskLinks) {
    try {
      const links = yield* call(
        [appClient.notes, appClient.notes.listTaskLinks],
        workspaceId,
        noteId,
      );
      if (links !== null) {
        yield* put(specTaskLinksReceived(workspaceId, links, owner.specTaskLinksGeneration));
        const latest = yield* selectWorkspaceNotesState.effect(workspaceId);
        if (latest.specTaskLinksGeneration !== owner.specTaskLinksGeneration) return;
        const complete = yield* selectNoteById.effect(workspaceId, noteId);
        if (!complete || isNoteContentStale(complete)) return;
      }
    } catch (error) {
      if (isMissingNote(error))
        yield* put(specTaskLinksReceived(workspaceId, [], owner.specTaskLinksGeneration));
      else logger.error('Failed to refresh task links', error);
      return;
    }
  }
  const paged = yield* selectNotePageSession.effect(workspaceId, noteId);
  if (paged && Object.keys(paged.panels).length && !hasFullNoteEditLease(workspaceId, noteId)) {
    // The bounded state subscription is authoritative; legacy events contain no page epochs.
    if (eventType === 'note:deleted') yield* put(pageReset(workspaceId, noteId, 'Note deleted'));
    return;
  }
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
    const currentPage = yield* selectNotePageSession.effect(workspaceId, noteId);
    if (
      currentPage &&
      Object.keys(currentPage.panels).length &&
      !hasFullNoteEditLease(workspaceId, noteId)
    )
      return;
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
    cleanup: take(
      (cleanup: ObservedAction) =>
        isWorkspaceCleanup(cleanup, workspaceId) || isDeletedNote(cleanup, workspaceId, noteId),
    ),
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
