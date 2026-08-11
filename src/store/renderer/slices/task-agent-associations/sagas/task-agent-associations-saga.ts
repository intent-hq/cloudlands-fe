import { buffers, channel, type Channel, type Task } from 'redux-saga';
import { actionChannel, cancel, call, fork, put, take, type SagaGenerator } from 'typed-redux-saga';

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
import type {
  TaskAgentAssociation,
  TaskAgentAssociationsByTaskKey,
} from '../task-agent-associations-types';

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
type AssociationMutation =
  | {
      kind: 'link';
      workspaceId: string;
      noteId: string;
      association: TaskAgentAssociation;
    }
  | { kind: 'unlink'; workspaceId: string; noteId: string; taskKey: string };
type AssociationMutationQueue = {
  channel: Channel<AssociationMutation>;
  task?: Task;
};
type AssociationSnapshotTracker = {
  snapshots: Map<string, TaskAgentAssociationsByTaskKey>;
  mutationQueues: Map<string, AssociationMutationQueue>;
};
type ObservedAssociationAction =
  | ReturnType<typeof addTaskAgentAssociation>
  | NoteRemovalAction
  | NoteSnapshotAction
  | ReturnType<typeof hydrateTaskAgentAssociations>
  | ReturnType<typeof workspaceUnmounted>;

function isAddAction(
  action: ObservedAssociationAction,
): action is ReturnType<typeof addTaskAgentAssociation> {
  return action.type === addTaskAgentAssociation.type;
}

function isRemovalAction(action: ObservedAssociationAction): action is NoteRemovalAction {
  return (
    action.type === removeTaskAgentAssociation.type ||
    action.type === pruneTaskAgentAssociationsForNote.type
  );
}

function isSnapshotAction(action: ObservedAssociationAction): action is NoteSnapshotAction {
  return action.type === applyTaskAgentLinked.type || action.type === applyTaskAgentUnlinked.type;
}

function isHydrationAction(
  action: ObservedAssociationAction,
): action is ReturnType<typeof hydrateTaskAgentAssociations> {
  return action.type === hydrateTaskAgentAssociations.type;
}

function noteKey(workspaceId: string, noteId: string): string {
  return `${workspaceId}\u0000${noteId}`;
}

function mutationKey(workspaceId: string, noteId: string, taskKey: string): string {
  return `${noteKey(workspaceId, noteId)}\u0000${taskKey}`;
}

function associationTaskKey(association: TaskAgentAssociation): string {
  return association.taskKey ?? association.taskText;
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

function* runAssociationMutation(mutation: AssociationMutation): SagaGenerator<void> {
  if (mutation.kind === 'link') {
    const { workspaceId, noteId, association } = mutation;
    try {
      yield* call([appClient.tasks, appClient.tasks.linkAgent], workspaceId, noteId, association);
    } catch (error) {
      logger.error('task.linkAgent failed', { workspaceId, noteId, association, error });
    }
    return;
  }

  const { workspaceId, noteId, taskKey } = mutation;
  try {
    yield* call([appClient.tasks, appClient.tasks.unlinkAgent], workspaceId, noteId, taskKey);
  } catch (error) {
    logger.error('task.unlinkAgent failed', { workspaceId, noteId, taskKey, error });
  }
}

function* consumeAssociationMutations(
  tracker: AssociationSnapshotTracker,
  key: string,
  queue: Channel<AssociationMutation>,
): SagaGenerator<void> {
  try {
    while (true) {
      const mutation = yield* take(queue);
      yield* call(runAssociationMutation, mutation);
    }
  } finally {
    queue.close();
    if (tracker.mutationQueues.get(key)?.channel === queue) tracker.mutationQueues.delete(key);
  }
}

function* enqueueAssociationMutation(
  tracker: AssociationSnapshotTracker,
  mutation: AssociationMutation,
): SagaGenerator<void> {
  const taskKey =
    mutation.kind === 'link' ? associationTaskKey(mutation.association) : mutation.taskKey;
  const key = mutationKey(mutation.workspaceId, mutation.noteId, taskKey);
  let queue = tracker.mutationQueues.get(key);
  if (!queue) {
    queue = { channel: channel<AssociationMutation>(buffers.expanding()) };
    tracker.mutationQueues.set(key, queue);
    queue.task = yield* fork(consumeAssociationMutations, tracker, key, queue.channel);
  }
  yield* put(queue.channel, mutation);
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
  yield* enqueueAssociationMutation(tracker, {
    kind: 'link',
    workspaceId,
    noteId,
    association,
  });
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
    yield* enqueueAssociationMutation(tracker, {
      kind: 'unlink',
      workspaceId,
      noteId,
      taskKey,
    });
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
  const workspaceId = action.payload[0];
  clearWorkspaceSnapshots(tracker, workspaceId);
  const prefix = `${workspaceId}\u0000`;
  for (const [key, queue] of tracker.mutationQueues) {
    if (!key.startsWith(prefix)) continue;
    tracker.mutationQueues.delete(key);
    queue.channel.close();
    if (queue.task?.isRunning()) yield* cancel(queue.task);
  }
}

function* consumeAssociationActions(
  tracker: AssociationSnapshotTracker,
  actions: Channel<ObservedAssociationAction>,
): SagaGenerator<void> {
  while (true) {
    const action = yield* take(actions);
    if (isAddAction(action)) {
      yield* linkAssociation(tracker, action);
    } else if (isRemovalAction(action)) {
      yield* unlinkRemovedAssociations(tracker, action);
    } else if (isSnapshotAction(action)) {
      yield* captureNoteSnapshot(tracker, action);
    } else if (isHydrationAction(action)) {
      yield* replaceWorkspaceSnapshots(tracker, action);
    } else {
      yield* removeWorkspaceSnapshots(tracker, action);
    }
  }
}

export function* taskAgentAssociationsSaga(): SagaGenerator<void> {
  const initial = yield* selectAllTaskAgentAssociationWorkspaces.effect();
  const tracker: AssociationSnapshotTracker = {
    snapshots: new Map(),
    mutationQueues: new Map(),
  };
  for (const [workspaceId, workspace] of Object.entries(initial)) {
    for (const [noteId, associations] of Object.entries(workspace.byNoteId)) {
      tracker.snapshots.set(noteKey(workspaceId, noteId), cloneNote(associations));
    }
  }

  const actions = yield* actionChannel<ObservedAssociationAction>(
    [
      addTaskAgentAssociation,
      removeTaskAgentAssociation,
      pruneTaskAgentAssociationsForNote,
      applyTaskAgentLinked,
      applyTaskAgentUnlinked,
      hydrateTaskAgentAssociations,
      workspaceUnmounted,
    ],
    buffers.expanding(),
  );
  try {
    yield* call(consumeAssociationActions, tracker, actions);
  } finally {
    actions.close();
    for (const queue of tracker.mutationQueues.values()) queue.channel.close();
    tracker.mutationQueues.clear();
    tracker.snapshots.clear();
  }
}
