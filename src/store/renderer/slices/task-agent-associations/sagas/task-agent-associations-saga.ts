import { call, fork, take, type SagaGenerator } from 'typed-redux-saga';

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
type WireEffect =
  | { kind: 'link'; workspaceId: string; noteId: string; association: TaskAgentAssociation }
  | { kind: 'unlink'; workspaceId: string; noteId: string; taskKey: string };
type AssociationAction =
  | ReturnType<typeof addTaskAgentAssociation>
  | ReturnType<typeof applyTaskAgentLinked>
  | ReturnType<typeof applyTaskAgentUnlinked>
  | ReturnType<typeof hydrateTaskAgentAssociations>
  | ReturnType<typeof pruneTaskAgentAssociationsForNote>
  | ReturnType<typeof removeTaskAgentAssociation>
  | ReturnType<typeof workspaceUnmounted>;
type NoteAssociationAction = Exclude<
  AssociationAction,
  ReturnType<typeof hydrateTaskAgentAssociations> | ReturnType<typeof workspaceUnmounted>
>;

function noteKey(workspaceId: string, noteId: string): string {
  return `${workspaceId}\u0000${noteId}`;
}

function effectKey(effect: WireEffect): string {
  const taskKey =
    effect.kind === 'link'
      ? (effect.association.taskKey ?? effect.association.taskText)
      : effect.taskKey;
  return `${effect.workspaceId}\u0000${effect.noteId}\u0000${taskKey}`;
}

function* runQueue(
  key: string,
  queues: Map<string, WireEffect[]>,
  running: Set<string>,
): SagaGenerator<void> {
  try {
    const queue = queues.get(key);
    while (queue && queue.length > 0) {
      const effect = queue.shift();
      if (!effect) continue;
      try {
        if (effect.kind === 'link') {
          yield* call(
            [appClient.tasks, appClient.tasks.linkAgent],
            effect.workspaceId,
            effect.noteId,
            effect.association,
          );
        } else {
          yield* call(
            [appClient.tasks, appClient.tasks.unlinkAgent],
            effect.workspaceId,
            effect.noteId,
            effect.taskKey,
          );
        }
      } catch (error) {
        logger.error(`task.${effect.kind}Agent failed`, { effect, error });
      }
    }
  } finally {
    queues.delete(key);
    running.delete(key);
  }
}

function* enqueue(
  effect: WireEffect,
  queues: Map<string, WireEffect[]>,
  running: Set<string>,
): SagaGenerator<void> {
  const key = effectKey(effect);
  const queue = queues.get(key) ?? [];
  queue.push(effect);
  queues.set(key, queue);
  if (running.has(key)) return;
  running.add(key);
  yield* fork(runQueue, key, queues, running);
}

function cloneNote(
  value: TaskAgentAssociationsByTaskKey | undefined,
): TaskAgentAssociationsByTaskKey {
  return { ...(value ?? {}) };
}

export function* taskAgentAssociationsSaga(): SagaGenerator<void> {
  const initial = yield* selectAllTaskAgentAssociationWorkspaces.effect();
  const snapshots = new Map<string, TaskAgentAssociationsByTaskKey>();
  for (const [workspaceId, workspace] of Object.entries(initial)) {
    for (const [noteId, associations] of Object.entries(workspace.byNoteId)) {
      snapshots.set(noteKey(workspaceId, noteId), cloneNote(associations));
    }
  }
  const queues = new Map<string, WireEffect[]>();
  const running = new Set<string>();

  while (true) {
    const action: AssociationAction = yield* take([
      addTaskAgentAssociation,
      removeTaskAgentAssociation,
      pruneTaskAgentAssociationsForNote,
      hydrateTaskAgentAssociations,
      applyTaskAgentLinked,
      applyTaskAgentUnlinked,
      workspaceUnmounted,
    ]);

    if (action.type === workspaceUnmounted.type) {
      const workspaceId = action.payload[0];
      for (const key of snapshots.keys()) {
        if (key.startsWith(`${workspaceId}\u0000`)) snapshots.delete(key);
      }
      continue;
    }
    if (action.type === hydrateTaskAgentAssociations.type) {
      const [workspaceId, byNoteId] = action.payload as ReturnType<
        typeof hydrateTaskAgentAssociations
      >['payload'];
      for (const key of snapshots.keys()) {
        if (key.startsWith(`${workspaceId}\u0000`)) snapshots.delete(key);
      }
      for (const [noteId, associations] of Object.entries(byNoteId)) {
        snapshots.set(noteKey(workspaceId, noteId), cloneNote(associations));
      }
      continue;
    }

    const noteAction = action as NoteAssociationAction;
    const [workspaceId, noteId] = noteAction.payload;
    const key = noteKey(workspaceId, noteId);
    const before = snapshots.get(key) ?? {};
    const after = yield* selectTaskAgentAssociationsForNote.effect(workspaceId, noteId);
    snapshots.set(key, cloneNote(after));

    if (noteAction.type === addTaskAgentAssociation.type) {
      const association = noteAction.payload[2] as TaskAgentAssociation;
      yield* enqueue({ kind: 'link', workspaceId, noteId, association }, queues, running);
      continue;
    }
    if (
      noteAction.type === removeTaskAgentAssociation.type ||
      noteAction.type === pruneTaskAgentAssociationsForNote.type
    ) {
      for (const taskKey of Object.keys(before)) {
        if (!(taskKey in after)) {
          yield* enqueue({ kind: 'unlink', workspaceId, noteId, taskKey }, queues, running);
        }
      }
    }
  }
}
