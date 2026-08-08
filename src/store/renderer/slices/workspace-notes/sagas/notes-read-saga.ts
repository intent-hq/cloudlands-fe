import type { Task } from 'redux-saga';
import { call, cancel, fork, put, take, type SagaGenerator } from 'typed-redux-saga';

import { appClient } from '$lib/client';
import { createLogger } from '$lib/utils/client-logger';
import { SPEC_NOTE_ID } from '$shared/constants/notes';
import {
  workspaceDeleted,
  workspaceMounted,
  workspaceUnmounted,
} from '../../workspace-lifecycle/workspace-lifecycle-slice';
import { selectNoteById, selectWorkspaceNotesState } from '../workspace-notes-selectors';
import {
  applyNoteCreated,
  applyNoteDeleted,
  applyNoteUpdated,
  loadWorkspaceNotesFailed,
  loadWorkspaceNotesSucceeded,
  selectNote,
} from '../workspace-notes-slice';
import { toRuntimeNote } from './note-payload-mappers';

const logger = createLogger('NotesReadSaga');

export type NoteEventType = 'note:created' | 'note:updated' | 'note:deleted';
const NOTE_EVENT_RECEIVED = 'workspaceNotes/noteEventReceived';
export const noteEventReceived = Object.assign(
  (workspaceId: string, noteId: string, eventType: NoteEventType) => ({
    type: NOTE_EVENT_RECEIVED,
    payload: [workspaceId, noteId, eventType] as const,
  }),
  { type: NOTE_EVENT_RECEIVED },
);

type RunningRead = { workspaceId: string; task?: Task; token: symbol };

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

function* applyNoteEvent(workspaceId: string, noteId: string, eventType: NoteEventType) {
  if (eventType === 'note:deleted') {
    yield* put(applyNoteDeleted(workspaceId, noteId));
    return;
  }
  try {
    const response: Awaited<ReturnType<typeof appClient.notes.list>> = yield* call(
      [appClient.notes, appClient.notes.list],
      workspaceId,
    );
    const found = response.find((note) => String(note.id) === noteId);
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

function* startRead(
  running: Map<string, RunningRead>,
  key: string,
  workspaceId: string,
  worker: () => SagaGenerator<void>,
): SagaGenerator<void> {
  if (running.has(key)) return;
  const token = Symbol(key);
  running.set(key, { workspaceId, token });
  const task = yield* fork(function* () {
    try {
      yield* call(worker);
    } finally {
      if (running.get(key)?.token === token) running.delete(key);
    }
  });
  if (running.get(key)?.token === token) running.set(key, { workspaceId, task, token });
}

function* cancelWorkspaceReads(running: Map<string, RunningRead>, workspaceId: string) {
  for (const [key, read] of running) {
    if (read.workspaceId !== workspaceId) continue;
    running.delete(key);
    if (read.task) yield* cancel(read.task);
  }
}

export function* notesReadSaga() {
  const running = new Map<string, RunningRead>();
  try {
    while (true) {
      const action: { type: string; payload: unknown } = yield* take([
        workspaceMounted,
        workspaceUnmounted,
        workspaceDeleted,
        NOTE_EVENT_RECEIVED,
      ]);
      if (action.type === workspaceMounted.type) {
        const [workspaceId] = action.payload as [string];
        if (!workspaceId) continue;
        yield* startRead(
          running,
          `notes:${workspaceId}`,
          workspaceId,
          function* () {
            yield* call(hydrateWorkspaceNotes, workspaceId);
          },
        );
        continue;
      }
      if (action.type === NOTE_EVENT_RECEIVED) {
        const [workspaceId, noteId, eventType] = action.payload as [
          string,
          string,
          NoteEventType,
        ];
        if (!workspaceId || !noteId) continue;
        yield* startRead(
          running,
          `note:${workspaceId}:${noteId}:${eventType}`,
          workspaceId,
          function* () {
            yield* call(applyNoteEvent, workspaceId, noteId, eventType);
          },
        );
        continue;
      }
      const [workspaceId] = action.payload as [string];
      yield* call(cancelWorkspaceReads, running, workspaceId);
    }
  } finally {
    for (const read of running.values()) {
      if (read.task) yield* cancel(read.task);
    }
    running.clear();
  }
}