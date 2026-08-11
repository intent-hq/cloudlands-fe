import { buffers, type Channel } from 'redux-saga';
import {
  actionChannel,
  call,
  flush,
  put,
  race,
  take,
  takeEvery,
  takeLatest,
} from 'typed-redux-saga';

import { appClient } from '$lib/client';
import { createLogger } from '$lib/utils/client-logger';
import {
  workspaceDeleted,
  workspaceUnmounted,
} from '../../workspace-lifecycle/workspace-lifecycle-slice';
import { withPreservedUnmetDependsOn } from '../workspace-notes-normalization';
import { selectNoteById } from '../workspace-notes-selectors';
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
type RestoreAction = ReturnType<typeof restoreNoteVersion>;
type WorkspaceCleanupAction =
  ReturnType<typeof workspaceDeleted> | ReturnType<typeof workspaceUnmounted>;
type ObservedAction = { type: string; payload?: unknown };

function isWorkspaceCleanup(action: ObservedAction, workspaceId: string): boolean {
  return (
    (action.type === workspaceDeleted.type || action.type === workspaceUnmounted.type) &&
    Array.isArray(action.payload) &&
    action.payload[0] === workspaceId
  );
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
      applyNoteVersionsError(workspaceId, error instanceof Error ? error.message : String(error)),
    );
  }
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
      // Mutation-response notes omit the transient `unmetDependsOn` projection
      // (monorepo#2001); keep the cached value so "Waits on" doesn't flicker.
      const cached = yield* selectNoteById.effect(workspaceId, noteId);
      yield* put(
        applyNoteUpdated(
          workspaceId,
          noteId,
          withPreservedUnmetDependsOn(toRuntimeNote(result.note), cached),
        ),
      );
    }
    yield* call(fetchVersions, workspaceId, noteId);
  } catch (error) {
    logger.error('Error restoring note version', error);
  }
}

function* fetchVersionsWorker(action: ReturnType<typeof fetchNoteVersions>) {
  const [workspaceId, noteId] = action.payload;
  if (!workspaceId || !noteId) return;
  yield* race({
    fetch: call(fetchVersions, workspaceId, noteId),
    restore: take(restoreNoteVersion),
    cleanup: take((cleanup: ObservedAction) => isWorkspaceCleanup(cleanup, workspaceId)),
  });
}

function* restoreVersionWorker(action: RestoreAction) {
  const [workspaceId, noteId, versionId] = action.payload;
  if (!workspaceId || !noteId || !versionId) return;
  yield* race({
    restore: call(restoreVersion, workspaceId, noteId, versionId),
    cleanup: take((cleanup: ObservedAction) => isWorkspaceCleanup(cleanup, workspaceId)),
  });
}

function* clearQueuedWorkspaceRestores(
  restores: Channel<RestoreAction>,
  action: WorkspaceCleanupAction,
) {
  const [workspaceId] = action.payload;
  const queued = yield* flush(restores);
  for (const restore of queued) {
    if (restore.payload[0] !== workspaceId) yield* put(restores, restore);
  }
}

function* consumeRestores(restores: Channel<RestoreAction>) {
  while (true) {
    const action = yield* take(restores);
    yield* call(restoreVersionWorker, action);
  }
}

export function* noteVersionsSaga() {
  const restores = yield* actionChannel(restoreNoteVersion, buffers.expanding());
  try {
    yield* takeLatest(fetchNoteVersions, fetchVersionsWorker);
    yield* takeEvery(
      [workspaceDeleted, workspaceUnmounted],
      clearQueuedWorkspaceRestores,
      restores,
    );
    yield* call(consumeRestores, restores);
  } finally {
    restores.close();
  }
}
