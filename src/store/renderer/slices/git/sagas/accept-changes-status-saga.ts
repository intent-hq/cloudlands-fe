import type { Task } from 'redux-saga';
import { all, call, cancel, fork, put, takeEvery, type SagaGenerator } from 'typed-redux-saga';

import { AcceptChangesClient } from '$features/accept-changes/accept-changes.client';
import { createLogger } from '$lib/utils/client-logger';
import type { WorkspaceId } from '$shared/types/branded-ids';
import { refreshAcceptChangesStatus } from '../../changes/changes-slice';
import { selectCurrentWorkspaceTabId } from '../../tab-state/tab-state-selectors';
import { CURRENT_WORKSPACE_TAB_SELECTION_ACTIONS } from '../../tab-state/tab-state-slice';
import {
  backendReconnected,
  workspaceUnmounted,
} from '../../workspace-lifecycle/workspace-lifecycle-slice';
import {
  acceptChangesConsumerMounted,
  acceptChangesConsumerUnmounted,
  acceptChangesStatusInvalidated,
  setAcceptChangesStatus,
  setAcceptChangesStatusLoading,
  setPostMergeState,
} from '../git-slice';
import { selectAcceptChangesStatus, selectPostMergeState } from '../git-selectors';

const logger = createLogger('AcceptChangesStatusSaga');

type Entry = { consumers: number; dirty: boolean; task?: Task };
type Coordinator = Map<string, Entry>;

function entryFor(coordinator: Coordinator, workspaceId: string): Entry {
  const existing = coordinator.get(workspaceId);
  if (existing) return existing;
  const entry = { consumers: 0, dirty: false };
  coordinator.set(workspaceId, entry);
  return entry;
}

function* isVisible(entry: Entry, workspaceId: string): SagaGenerator<boolean> {
  const activeWorkspaceId = yield* selectCurrentWorkspaceTabId.effect();
  return entry.consumers > 0 && activeWorkspaceId === workspaceId;
}

function* refreshLoop(coordinator: Coordinator, workspaceId: string): SagaGenerator<void> {
  const entry = entryFor(coordinator, workspaceId);
  try {
    do {
      entry.dirty = false;
      yield* put(setAcceptChangesStatusLoading(workspaceId, true));
      try {
        const status = yield* call(
          [AcceptChangesClient, AcceptChangesClient.getStatus],
          workspaceId as WorkspaceId,
        );
        if ((yield* isVisible(entry, workspaceId)) && !entry.dirty) {
          const current = yield* selectPostMergeState.effect(workspaceId);
          yield* put(setAcceptChangesStatus(workspaceId, status));
          yield* put(
            setPostMergeState(workspaceId, {
              ...current,
              aheadOfTrunk: status.aheadOfTrunk,
              behindTrunk: status.behindTrunk,
              hasConflicts: status.hasConflicts,
              hasRemote: status.hasRemote,
              isContentMergedToTrunk: status.isContentMergedToTrunk ?? false,
            }),
          );
        } else if (!(yield* isVisible(entry, workspaceId))) {
          entry.dirty = true;
        }
      } catch (error) {
        logger.warn('Failed to fetch accept-changes status', { workspaceId, error });
      }
    } while (entry.dirty && (yield* isVisible(entry, workspaceId)));
  } finally {
    entry.task = undefined;
    if (coordinator.get(workspaceId) === entry) {
      yield* put(setAcceptChangesStatusLoading(workspaceId, false));
    }
  }
}

function* startRefresh(coordinator: Coordinator, workspaceId: string): SagaGenerator<void> {
  const entry = entryFor(coordinator, workspaceId);
  if (entry.task) {
    entry.dirty = true;
    return;
  }
  entry.task = yield* fork(refreshLoop, coordinator, workspaceId);
}

function* refreshIfVisible(coordinator: Coordinator, workspaceId: string): SagaGenerator<void> {
  const entry = entryFor(coordinator, workspaceId);
  if (yield* isVisible(entry, workspaceId)) yield* startRefresh(coordinator, workspaceId);
}

function* consumerMounted(
  coordinator: Coordinator,
  action: ReturnType<typeof acceptChangesConsumerMounted>,
): SagaGenerator<void> {
  const [workspaceId] = action.payload;
  const entry = entryFor(coordinator, workspaceId);
  entry.consumers += 1;
  const cached = yield* selectAcceptChangesStatus.effect(workspaceId);
  if (entry.consumers === 1 && (!cached || entry.dirty))
    yield* refreshIfVisible(coordinator, workspaceId);
}

function consumerUnmounted(
  coordinator: Coordinator,
  action: ReturnType<typeof acceptChangesConsumerUnmounted>,
): void {
  const [workspaceId] = action.payload;
  const entry = entryFor(coordinator, workspaceId);
  entry.consumers = Math.max(0, entry.consumers - 1);
}

function* invalidate(coordinator: Coordinator, workspaceId: string): SagaGenerator<void> {
  entryFor(coordinator, workspaceId).dirty = true;
  yield* refreshIfVisible(coordinator, workspaceId);
}

function* invalidated(
  coordinator: Coordinator,
  action: ReturnType<typeof acceptChangesStatusInvalidated>,
) {
  yield* invalidate(coordinator, action.payload[0]);
}

function* explicitRefresh(
  coordinator: Coordinator,
  action: ReturnType<typeof refreshAcceptChangesStatus>,
) {
  yield* startRefresh(coordinator, action.payload[0]);
}

function* activeWorkspaceChanged(coordinator: Coordinator): SagaGenerator<void> {
  const workspaceId = yield* selectCurrentWorkspaceTabId.effect();
  if (!workspaceId) return;
  const entry = entryFor(coordinator, workspaceId);
  const cached = yield* selectAcceptChangesStatus.effect(workspaceId);
  if (entry.consumers > 0 && (entry.dirty || !cached))
    yield* startRefresh(coordinator, workspaceId);
}

function* reconnected(coordinator: Coordinator): SagaGenerator<void> {
  for (const [workspaceId, entry] of coordinator) {
    entry.dirty = true;
    yield* refreshIfVisible(coordinator, workspaceId);
  }
}

function* clearWorkspace(
  coordinator: Coordinator,
  action: ReturnType<typeof workspaceUnmounted>,
): SagaGenerator<void> {
  const [workspaceId] = action.payload;
  const entry = coordinator.get(workspaceId);
  coordinator.delete(workspaceId);
  if (entry?.task) yield* cancel(entry.task);
}

export function* acceptChangesStatusSaga(): SagaGenerator<void> {
  const coordinator: Coordinator = new Map();
  yield* all([
    takeEvery(acceptChangesConsumerMounted, consumerMounted, coordinator),
    takeEvery(acceptChangesConsumerUnmounted, consumerUnmounted, coordinator),
    takeEvery(acceptChangesStatusInvalidated, invalidated, coordinator),
    takeEvery(refreshAcceptChangesStatus, explicitRefresh, coordinator),
    takeEvery(CURRENT_WORKSPACE_TAB_SELECTION_ACTIONS, activeWorkspaceChanged, coordinator),
    takeEvery(backendReconnected, reconnected, coordinator),
    takeEvery(workspaceUnmounted, clearWorkspace, coordinator),
  ]);
}
