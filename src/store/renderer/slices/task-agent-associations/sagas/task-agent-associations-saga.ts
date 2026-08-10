import { call, takeEvery, type SagaGenerator } from 'typed-redux-saga';

import { appClient } from '$lib/client';
import { createLogger } from '$lib/utils/client-logger';
import { store } from '../../../store';
import type { StoreState } from '../../../types';
import { workspaceUnmounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import {
  addTaskAgentAssociation,
  applyTaskAgentLinked,
  applyTaskAgentUnlinked,
  hydrateTaskAgentAssociations,
  pruneTaskAgentAssociationsForNote,
  removeTaskAgentAssociation,
} from '../task-agent-associations-slice';
import type { TaskAgentAssociationsByTaskKey } from '../task-agent-associations-types';

const logger = createLogger('TaskAgentAssociationsSaga');
// eslint-disable-next-line themis/saga-local-selector -- Keep this port isolated to the saga directory.
const selectAllTaskAgentAssociationWorkspaces = store.createSelector(
  (state: StoreState) => state.taskAgentAssociations.byWorkspaceId,
);
// eslint-disable-next-line themis/saga-local-selector -- Keep this port isolated to the saga directory.
const selectTaskAgentAssociationsForNote = store.createSelector<
  [workspaceId: string, noteId: string],
  TaskAgentAssociationsByTaskKey
>(
  (state, workspaceId, noteId) =>
    state.taskAgentAssociations.byWorkspaceId[workspaceId]?.byNoteId[noteId] ?? {},
);
type NoteSnapshotAction =
  ReturnType<typeof applyTaskAgentLinked> | ReturnType<typeof applyTaskAgentUnlinked>;
type NoteRemovalAction =
  | ReturnType<typeof pruneTaskAgentAssociationsForNote>
  | ReturnType<typeof removeTaskAgentAssociation>;
type AssociationSnapshotTracker = {
  snapshots: Map<string, TaskAgentAssociationsByTaskKey>;
};

function noteKey(workspaceId: string, noteId: string): string {
  return `${workspaceId}\u0000${noteId}`;
}

function cloneNote(
  value: TaskAgentAssociationsByTaskKey | undefined,
): TaskAgentAssociationsByTaskKey {
  return { ...(value ?? {}) };
}

function clearWorkspaceSnapshots(tracker: AssociationSnapshotTracker, workspaceId: string): void {
  for (const key of tracker.snapshots.keys()) {
    if (key.startsWith(`${workspaceId}\u0000`)) tracker.snapshots.delete(key);
  }
}

function* refreshNoteSnapshot(
  tracker: AssociationSnapshotTracker,
  workspaceId: string,
  noteId: string,
): SagaGenerator<TaskAgentAssociationsByTaskKey> {
  const associations = yield* selectTaskAgentAssociationsForNote.effect(workspaceId, noteId);
  tracker.snapshots.set(noteKey(workspaceId, noteId), cloneNote(associations));
  return associations;
}

function* linkAssociation(
  tracker: AssociationSnapshotTracker,
  action: ReturnType<typeof addTaskAgentAssociation>,
): SagaGenerator<void> {
  const [workspaceId, noteId, association] = action.payload;
  yield* call(refreshNoteSnapshot, tracker, workspaceId, noteId);
  try {
    yield* call([appClient.tasks, appClient.tasks.linkAgent], workspaceId, noteId, association);
  } catch (error) {
    logger.error('task.linkAgent failed', { workspaceId, noteId, association, error });
  }
}

function* unlinkRemovedAssociations(
  tracker: AssociationSnapshotTracker,
  action: NoteRemovalAction,
): SagaGenerator<void> {
  const [workspaceId, noteId] = action.payload;
  const before = tracker.snapshots.get(noteKey(workspaceId, noteId)) ?? {};
  const after = yield* call(refreshNoteSnapshot, tracker, workspaceId, noteId);
  for (const taskKey of Object.keys(before)) {
    if (taskKey in after) continue;
    try {
      yield* call([appClient.tasks, appClient.tasks.unlinkAgent], workspaceId, noteId, taskKey);
    } catch (error) {
      logger.error('task.unlinkAgent failed', { workspaceId, noteId, taskKey, error });
    }
  }
}

function* captureNoteSnapshot(
  tracker: AssociationSnapshotTracker,
  action: NoteSnapshotAction,
): SagaGenerator<void> {
  const [workspaceId, noteId] = action.payload;
  yield* call(refreshNoteSnapshot, tracker, workspaceId, noteId);
}

function* replaceWorkspaceSnapshots(
  tracker: AssociationSnapshotTracker,
  action: ReturnType<typeof hydrateTaskAgentAssociations>,
): SagaGenerator<void> {
  const [workspaceId, byNoteId] = action.payload;
  clearWorkspaceSnapshots(tracker, workspaceId);
  for (const [noteId, associations] of Object.entries(byNoteId)) {
    tracker.snapshots.set(noteKey(workspaceId, noteId), cloneNote(associations));
  }
}

function* removeWorkspaceSnapshots(
  tracker: AssociationSnapshotTracker,
  action: ReturnType<typeof workspaceUnmounted>,
): SagaGenerator<void> {
  clearWorkspaceSnapshots(tracker, action.payload[0]);
}

export function* taskAgentAssociationsSaga(): SagaGenerator<void> {
  const initial = yield* selectAllTaskAgentAssociationWorkspaces.effect();
  const tracker: AssociationSnapshotTracker = { snapshots: new Map() };
  for (const [workspaceId, workspace] of Object.entries(initial)) {
    for (const [noteId, associations] of Object.entries(workspace.byNoteId)) {
      tracker.snapshots.set(noteKey(workspaceId, noteId), cloneNote(associations));
    }
  }

  yield* takeEvery(addTaskAgentAssociation, linkAssociation, tracker);
  yield* takeEvery(
    [removeTaskAgentAssociation, pruneTaskAgentAssociationsForNote],
    unlinkRemovedAssociations,
    tracker,
  );
  yield* takeEvery([applyTaskAgentLinked, applyTaskAgentUnlinked], captureNoteSnapshot, tracker);
  yield* takeEvery(hydrateTaskAgentAssociations, replaceWorkspaceSnapshots, tracker);
  yield* takeEvery(workspaceUnmounted, removeWorkspaceSnapshots, tracker);
}
