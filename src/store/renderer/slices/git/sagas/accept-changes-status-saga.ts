import { trackWorktreeSnapshotRead } from '$features/file-tracking/worktree-read-lane';
import {
  rendererEventRecovery,
  type RendererRecoveryHandle,
} from '$features/events/renderer-event-recovery';
import { registerAcceptStatusRecovery } from '$features/file-tracking/accept-status-event-recovery';
import { acceptStatusRecoveryKey } from '$features/file-tracking/worktree-recovery-keys';
import { getRecoveryAdmission, withRecoveryLifetime } from '../../../middlewares/event-recovery';
import { store } from '../../../store';
import { selectWorkspaceById } from '../../workspace/workspace-selectors';
import { all, call, put, takeEvery, type SagaGenerator } from 'typed-redux-saga';

import { AcceptChangesClient } from '$features/accept-changes/accept-changes.client';
import { createLogger } from '$lib/utils/client-logger';
import type { WorkspaceId } from '$shared/types/branded-ids';
import { takeSingleFlightInContext } from '../../../utils/context-saga-effects';
import { changesEventReceived, refreshAcceptChangesStatus } from '../../changes/changes-slice';
import { isPushedAcceptChangesStatus } from '$features/events/accept-changes-status-events';
import { selectPrincipalActionContext } from '../../principal/principal-selectors';
import { selectCurrentWorkspaceTabId } from '../../tab-state/tab-state-selectors';
import { CURRENT_WORKSPACE_TAB_SELECTION_ACTIONS } from '../../tab-state/tab-state-slice';
import {
  backendReconnected,
  workspaceUnmounted,
} from '../../workspace-lifecycle/workspace-lifecycle-slice';
import {
  clearAcceptSnapshot,
  acceptChangesConsumerMounted,
  acceptChangesConsumerUnmounted,
  acceptChangesStatusInvalidated,
  setAcceptChangesStatus,
  setAcceptChangesStatusLoading,
  setPostMergeState,
} from '../git-slice';
import { selectAcceptChangesStatus, selectPostMergeState } from '../git-selectors';

const logger = createLogger('AcceptChangesStatusSaga');

type Entry = {
  consumers: number;
  dirty: boolean;
  generation: number;
  recovery?: RendererRecoveryHandle;
  stopRecovery?: () => void;
};
type Coordinator = Map<string, Entry>;

function entryFor(coordinator: Coordinator, workspaceId: string): Entry {
  const existing = coordinator.get(workspaceId);
  if (existing) return existing;
  const entry = { consumers: 0, dirty: false, generation: 0 };
  coordinator.set(workspaceId, entry);
  return entry;
}

function ensureRecovery(coordinator: Coordinator, workspaceId: string, entry: Entry) {
  if (!entry.stopRecovery)
    entry.stopRecovery = rendererEventRecovery.onSession((scope) => {
      const context = selectPrincipalActionContext.select(store.state);
      const token = store.state.workspace.deletionTokens[workspaceId];
      const handle = registerAcceptStatusRecovery(scope, workspaceId, {
        isCurrent: () =>
          coordinator.get(workspaceId) === entry &&
          context === selectPrincipalActionContext.select(store.state) &&
          store.state.workspace.deletionTokens[workspaceId] === token &&
          !!selectWorkspaceById.select(store.state, workspaceId),
        active:
          entry.consumers > 0 && selectCurrentWorkspaceTabId.select(store.state) === workspaceId,
        invalidate: () => {
          entry.generation++;
          entry.dirty = true;
        },
        apply: (status) => {
          entry.dirty = false;
          const current = selectPostMergeState.select(store.state, workspaceId);
          store.dispatch(setAcceptChangesStatus(workspaceId, status));
          store.dispatch(setAcceptChangesStatusLoading(workspaceId, false));
          store.dispatch(
            setPostMergeState(workspaceId, {
              ...current,
              aheadOfTrunk: status.aheadOfTrunk,
              behindTrunk: status.behindTrunk,
              hasConflicts: status.hasConflicts ?? false,
              hasRemote: status.hasRemote,
              isContentMergedToTrunk: status.isContentMergedToTrunk ?? false,
            }),
          );
        },
        retire: () => {
          store.dispatch(clearAcceptSnapshot(workspaceId));
        },
      });
      entry.recovery = handle;
      return () => {
        if (entry.recovery === handle) entry.recovery = undefined;
        handle.dispose();
      };
    });
  entry.recovery?.setActive(
    entry.consumers > 0 && selectCurrentWorkspaceTabId.select(store.state) === workspaceId,
  );
}

function* isVisible(entry: Entry, workspaceId: string): SagaGenerator<boolean> {
  const activeWorkspaceId = yield* selectCurrentWorkspaceTabId.effect();
  return entry.consumers > 0 && activeWorkspaceId === workspaceId;
}

type RefreshAction =
  ReturnType<typeof refreshAcceptChangesStatus> | ReturnType<typeof workspaceUnmounted>;

function refreshContext(coordinator: Coordinator, action: RefreshAction) {
  const [workspaceId] = action.payload;
  if (action.type === workspaceUnmounted.type) {
    coordinator.get(workspaceId)?.stopRecovery?.();
    coordinator.delete(workspaceId);
    return { context: workspaceId, cancel: true as const };
  }
  const entry = entryFor(coordinator, workspaceId);
  entry.dirty = true;
  entry.generation += 1;
  return workspaceId;
}

function* refreshStatus(coordinator: Coordinator, action: RefreshAction): SagaGenerator<void> {
  if (action.type === workspaceUnmounted.type) return;
  const [workspaceId] = action.payload;
  const entry = entryFor(coordinator, workspaceId);
  ensureRecovery(coordinator, workspaceId, entry);
  if (!entry.dirty || entry.recovery?.status.stale) return;
  const receipt = rendererEventRecovery.capture(acceptStatusRecoveryKey(workspaceId));
  const generation = entry.generation;
  const context = yield* selectPrincipalActionContext.effect();
  entry.dirty = false;
  yield* put(withRecoveryLifetime(setAcceptChangesStatusLoading(workspaceId, true), receipt));
  try {
    const status = yield* call(() =>
      trackWorktreeSnapshotRead(acceptStatusRecoveryKey(workspaceId), () => {
        if (!receipt.commit(() => undefined)) throw new Error('Accept status authority expired');
        return AcceptChangesClient.getStatus(workspaceId as WorkspaceId);
      }),
    );
    if ((yield* selectPrincipalActionContext.effect()) !== context) return;
    const visible = yield* isVisible(entry, workspaceId);
    if (visible && entry.generation === generation && !entry.dirty) {
      const current = yield* selectPostMergeState.effect(workspaceId);
      yield* put(withRecoveryLifetime(setAcceptChangesStatus(workspaceId, status), receipt));
      yield* put(
        withRecoveryLifetime(
          setPostMergeState(workspaceId, {
            ...current,
            aheadOfTrunk: status.aheadOfTrunk,
            behindTrunk: status.behindTrunk,
            hasConflicts: status.hasConflicts ?? false,
            hasRemote: status.hasRemote,
            isContentMergedToTrunk: status.isContentMergedToTrunk ?? false,
          }),
          receipt,
        ),
      );
    } else if (!visible) {
      entry.dirty = true;
    }
  } catch (error) {
    logger.warn('Failed to fetch accept-changes status', { workspaceId, error });
  } finally {
    if (
      coordinator.get(workspaceId) === entry &&
      entry.generation === generation &&
      (yield* selectPrincipalActionContext.effect()) === context
    ) {
      yield* put(withRecoveryLifetime(setAcceptChangesStatusLoading(workspaceId, false), receipt));
    }
  }
}

function* queueRefresh(workspaceId: string): SagaGenerator<void> {
  yield* put(refreshAcceptChangesStatus(workspaceId));
}

function* refreshIfVisible(coordinator: Coordinator, workspaceId: string): SagaGenerator<void> {
  const entry = entryFor(coordinator, workspaceId);
  if (yield* isVisible(entry, workspaceId)) {
    yield* queueRefresh(workspaceId);
  }
}

function* consumerMounted(
  coordinator: Coordinator,
  action: ReturnType<typeof acceptChangesConsumerMounted>,
): SagaGenerator<void> {
  const [workspaceId] = action.payload;
  const entry = entryFor(coordinator, workspaceId);
  entry.consumers += 1;
  ensureRecovery(coordinator, workspaceId, entry);
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
  ensureRecovery(coordinator, workspaceId, entry);
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

function* activeWorkspaceChanged(coordinator: Coordinator): SagaGenerator<void> {
  for (const [id, entry] of coordinator) ensureRecovery(coordinator, id, entry);
  const workspaceId = yield* selectCurrentWorkspaceTabId.effect();
  if (!workspaceId) return;
  const entry = entryFor(coordinator, workspaceId);
  const cached = yield* selectAcceptChangesStatus.effect(workspaceId);
  if (entry.consumers > 0 && (entry.dirty || !cached)) yield* queueRefresh(workspaceId);
}

function* reconnected(coordinator: Coordinator): SagaGenerator<void> {
  for (const [workspaceId, entry] of coordinator) {
    entry.dirty = true;
    yield* refreshIfVisible(coordinator, workspaceId);
  }
}

function* received(
  coordinator: Coordinator,
  action: ReturnType<typeof changesEventReceived>,
): SagaGenerator<void> {
  const [workspaceId, type, data] = action.payload;
  if (type !== 'changes:git-status' || data.gitRootId || !isPushedAcceptChangesStatus(data.status))
    return;
  const admitted = getRecoveryAdmission(action, acceptStatusRecoveryKey(workspaceId));
  if (
    admitted === null ||
    (admitted
      ? !admitted.commit(() => undefined)
      : !rendererEventRecovery.push(acceptStatusRecoveryKey(workspaceId)))
  )
    return;
  const receipt = admitted ?? rendererEventRecovery.capture(acceptStatusRecoveryKey(workspaceId));
  const entry = entryFor(coordinator, workspaceId);
  entry.generation++;
  entry.dirty = false;
  const status = data.status;
  const current = yield* selectPostMergeState.effect(workspaceId);
  yield* put(withRecoveryLifetime(setAcceptChangesStatus(workspaceId, status), receipt));
  yield* put(withRecoveryLifetime(setAcceptChangesStatusLoading(workspaceId, false), receipt));
  yield* put(
    withRecoveryLifetime(
      setPostMergeState(workspaceId, {
        ...current,
        aheadOfTrunk: status.aheadOfTrunk,
        behindTrunk: status.behindTrunk,
        hasConflicts: status.hasConflicts ?? false,
        hasRemote: status.hasRemote,
        isContentMergedToTrunk: status.isContentMergedToTrunk ?? false,
      }),
      receipt,
    ),
  );
}

export function* acceptChangesStatusSaga(): SagaGenerator<void> {
  const coordinator: Coordinator = new Map();
  try {
    yield* all([
      takeSingleFlightInContext(
        [refreshAcceptChangesStatus, workspaceUnmounted],
        (action) => refreshContext(coordinator, action),
        refreshStatus,
        coordinator,
      ),
      takeEvery(acceptChangesConsumerMounted, consumerMounted, coordinator),
      takeEvery(acceptChangesConsumerUnmounted, consumerUnmounted, coordinator),
      takeEvery(acceptChangesStatusInvalidated, invalidated, coordinator),
      takeEvery(CURRENT_WORKSPACE_TAB_SELECTION_ACTIONS, activeWorkspaceChanged, coordinator),
      takeEvery(backendReconnected, reconnected, coordinator),
      takeEvery(changesEventReceived, received, coordinator),
    ]);
  } finally {
    for (const entry of coordinator.values()) entry.stopRecovery?.();
  }
}
