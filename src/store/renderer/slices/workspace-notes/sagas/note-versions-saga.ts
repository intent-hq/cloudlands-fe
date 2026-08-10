import type { Task } from 'redux-saga';
import { call, cancel, fork, join, put, take, type SagaGenerator } from 'typed-redux-saga';

import { appClient } from '$lib/client';
import { createLogger } from '$lib/utils/client-logger';
import { workspaceDeleted, workspaceUnmounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import {
  applyNoteUpdated,
  applyNoteVersions,
  applyNoteVersionsError,
  fetchNoteVersions,
  restoreNoteVersion,
} from '../workspace-notes-slice';
import { toRuntimeNote, toRuntimeNoteVersion } from './note-payload-mappers';
import { flushPendingNoteContent } from './notes-write-saga';

const logger = createLogger('NoteVersionsSaga');
type RunningTask = { workspaceId: string; task?: Task; token: symbol };

function versionKey(workspaceId: string, noteId: string): string {
  return `${workspaceId}:${noteId}`;
}

function* fetchVersions(workspaceId: string, noteId: string) {
  try {
    const response: Awaited<ReturnType<typeof appClient.notes.listVersions>> = yield* call(
      [appClient.notes, appClient.notes.listVersions],
      workspaceId,
      noteId,
    );
    const versions = response.map(toRuntimeNoteVersion);
    yield* put(applyNoteVersions(workspaceId, noteId, versions));
  } catch (error) {
    logger.error('Failed to fetch note versions', error);
    yield* put(
      applyNoteVersionsError(
        workspaceId,
        error instanceof Error ? error.message : String(error),
      ),
    );
  }
}

function* startLatestFetch(
  running: Map<string, RunningTask>,
  workspaceId: string,
  noteId: string,
): SagaGenerator<void> {
  const key = versionKey(workspaceId, noteId);
  const previous = running.get(key);
  if (previous?.task) yield* cancel(previous.task);
  const token = Symbol(key);
  running.set(key, { workspaceId, token });
  const task = yield* fork(function* () {
    try {
      yield* call(fetchVersions, workspaceId, noteId);
    } finally {
      if (running.get(key)?.token === token) running.delete(key);
    }
  });
  if (running.get(key)?.token === token) running.set(key, { workspaceId, task, token });
}

function* restoreVersion(workspaceId: string, noteId: string, versionId: string) {
  yield* call(flushPendingNoteContent, workspaceId, noteId);
  try {
    const result: Awaited<ReturnType<typeof appClient.notes.restoreVersion>> = yield* call(
      [appClient.notes, appClient.notes.restoreVersion],
      workspaceId,
      noteId,
      versionId,
    );
    if (!result.success) {
      logger.error('Failed to restore note version', {
        workspaceId,
        noteId,
        versionId,
        error: result.error,
      });
      return;
    }
    if (result.note && String(result.note.workspaceId) === workspaceId) {
      yield* put(applyNoteUpdated(workspaceId, noteId, toRuntimeNote(result.note)));
    }
    yield* call(fetchVersions, workspaceId, noteId);
  } catch (error) {
    logger.error('Error restoring note version', error);
  }
}

function* queueRestore(
  restores: Map<string, RunningTask>,
  workspaceId: string,
  noteId: string,
  versionId: string,
): SagaGenerator<void> {
  const key = versionKey(workspaceId, noteId);
  const previous = restores.get(key)?.task;
  const token = Symbol(key);
  restores.set(key, { workspaceId, token });
  const task = yield* fork(function* () {
    try {
      if (previous) yield* join(previous);
      yield* call(restoreVersion, workspaceId, noteId, versionId);
    } finally {
      if (restores.get(key)?.token === token) restores.delete(key);
    }
  });
  if (restores.get(key)?.token === token) restores.set(key, { workspaceId, task, token });
}

function* cancelWorkspaceTasks(tasks: Map<string, RunningTask>, workspaceId: string) {
  for (const [key, running] of tasks) {
    if (running.workspaceId !== workspaceId) continue;
    tasks.delete(key);
    if (running.task) yield* cancel(running.task);
  }
}

export function* noteVersionsSaga() {
  const fetches = new Map<string, RunningTask>();
  const restores = new Map<string, RunningTask>();
  try {
    while (true) {
      const action: { type: string; payload: unknown } = yield* take([
        fetchNoteVersions,
        restoreNoteVersion,
        workspaceUnmounted,
        workspaceDeleted,
      ]);
      if (action.type === fetchNoteVersions.type) {
        const [workspaceId, noteId] = action.payload as [string, string];
        if (workspaceId && noteId) yield* startLatestFetch(fetches, workspaceId, noteId);
        continue;
      }
      if (action.type === restoreNoteVersion.type) {
        const [workspaceId, noteId, versionId] = action.payload as [string, string, string];
        if (!workspaceId || !noteId || !versionId) continue;
        const fetch = fetches.get(versionKey(workspaceId, noteId));
        if (fetch?.task) yield* cancel(fetch.task);
        fetches.delete(versionKey(workspaceId, noteId));
        yield* queueRestore(restores, workspaceId, noteId, versionId);
        continue;
      }
      const [workspaceId] = action.payload as [string];
      yield* call(cancelWorkspaceTasks, fetches, workspaceId);
      yield* call(cancelWorkspaceTasks, restores, workspaceId);
    }
  } finally {
    for (const running of fetches.values()) if (running.task) yield* cancel(running.task);
    for (const running of restores.values()) if (running.task) yield* cancel(running.task);
    fetches.clear();
    restores.clear();
  }
}