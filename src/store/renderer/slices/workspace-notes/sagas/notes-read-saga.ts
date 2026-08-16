import { call, put, race, take } from 'typed-redux-saga';

import { appClient } from '$lib/client';
import { createLogger } from '$lib/utils/client-logger';
import { SPEC_NOTE_ID } from '$shared/constants/notes';
import {
  workspaceMounted,
  workspaceUnmounted,
} from '../../workspace-lifecycle/workspace-lifecycle-slice';
import { takeLeadingByWorkspace } from '../../../utils/context-saga-effects';
import { selectWorkspaceNotesState } from '../workspace-notes-selectors';
import { loadWorkspaceNotesFailed, loadWorkspaceNotesSucceeded, selectNote } from '../workspace-notes-slice';
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

function* hydrateWorkspaceNotes(workspaceId: string) {
  const current = yield* selectWorkspaceNotesState.effect(workspaceId);
  if (current.loading || current.initialized) return;
  try {
    const response: Awaited<ReturnType<typeof appClient.notes.list>> = yield* call(
      [appClient.notes, appClient.notes.list],
      workspaceId,
    );
    const notes = response.map(toRuntimeNote);
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

function* hydrateWorkspaceNotesWorker(action: ReturnType<typeof workspaceMounted>) {
  const [workspaceId] = action.payload;
  if (!workspaceId) return;
  yield* race({
    hydrate: call(hydrateWorkspaceNotes, workspaceId),
    cleanup: take((cleanup: ObservedAction) => isWorkspaceCleanup(cleanup, workspaceId)),
  });
}

export function* notesReadSaga() {
  yield* takeLeadingByWorkspace(workspaceMounted, hydrateWorkspaceNotesWorker);
}
