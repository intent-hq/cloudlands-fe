import { buffers, channel as createChannel } from 'redux-saga';
import { actionChannel, call, delay, put, race, take, type SagaGenerator } from 'typed-redux-saga';

import { CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';
import {
  hasChatInterestLease,
  onLastChatInterestLeaseReleased,
} from '$features/agent/utils/chat-interest-leases';
import {
  selectAgentIsRunning,
  selectAgentSessionIdsForWorkspace,
} from '../../agent-session/agent-session-selectors';
import { bulkUpsertSessions } from '../../agent-session/agent-session-slice';
import { selectChatAgentState } from '../../chat-state/chat-state-selectors';
import {
  chatInterrupted,
  chatLastAttemptedMessageSet,
  chatQueuedRetryRecordsCleared,
  chatRebindEnded,
  chatReset,
  chatSendFailed,
  chatStopCompleted,
  messageBlockHydrated,
  messageBlockHydrationFailed,
  pendingProposalRecoveryPruned,
  pendingProposalRecoverySettled,
  pendingQuestionRecoveryCleared,
  pendingQuestionRecoverySettled,
  scrollbackGapPageSettled,
  scrollbackOlderPageSettled,
  scrollbackSeekSettled,
  streamCompleted,
  streamTimedOut,
} from '../../chat-state/chat-state-slice';
import { eventReceived } from '../../workspace-events/workspace-events-slice';
import {
  selectActiveWorkspaceIds,
  selectCurrentWorkspaceTabId,
} from '../../tab-state/tab-state-selectors';
import {
  CURRENT_WORKSPACE_TAB_SELECTION_ACTIONS,
  restoreWorkspaceTab,
} from '../../tab-state/tab-state-slice';
import {
  workspaceChatStateReclaimed,
  workspaceDeleted,
  workspaceLoadRequested,
  workspaceMounted,
  workspaceUnmounted,
} from '../workspace-lifecycle-slice';
import { selectIsWorkspaceSessionLive } from '../workspace-lifecycle-selectors';

const RECLAMATION_RECHECK_ACTIONS = [
  bulkUpsertSessions,
  eventReceived,
  chatInterrupted,
  chatLastAttemptedMessageSet,
  chatQueuedRetryRecordsCleared,
  chatRebindEnded,
  chatReset,
  chatSendFailed,
  chatStopCompleted,
  messageBlockHydrated,
  messageBlockHydrationFailed,
  pendingProposalRecoveryPruned,
  pendingProposalRecoverySettled,
  pendingQuestionRecoveryCleared,
  pendingQuestionRecoverySettled,
  scrollbackGapPageSettled,
  scrollbackOlderPageSettled,
  scrollbackSeekSettled,
  streamCompleted,
  streamTimedOut,
  workspaceMounted,
] as const;

const WORKSPACE_TAB_LIFECYCLE_ACTIONS = [
  ...CURRENT_WORKSPACE_TAB_SELECTION_ACTIONS,
  restoreWorkspaceTab,
] as const;

const RECLAMATION_EVENT_TYPES = new Set(['agent:deleted', 'agent:failed', 'agent:idle']);

function isReclamationSettlementEvent(action: ReturnType<typeof eventReceived>): boolean {
  const event = action.payload[1];
  if (RECLAMATION_EVENT_TYPES.has(event.type)) return true;
  if (event.type !== 'agent:status-changed') return false;
  const status = event.data?.status;
  return (
    typeof status === 'string' &&
    status !== 'active' &&
    status !== 'processing' &&
    status !== 'responding'
  );
}

function* agentHasActiveChatOperation(agentId: string): SagaGenerator<boolean> {
  if (yield* call(hasChatInterestLease, agentId)) return true;
  if (yield* selectAgentIsRunning.effect(agentId)) return true;
  const chat = yield* selectChatAgentState.effect(agentId);
  if (
    chat.isInterrupting ||
    chat.isRebinding ||
    chat.fetchingOlderHistory ||
    chat.fetchingGapFill ||
    chat.fetchingHistorySeek ||
    Object.values(chat.hydratedBlocks ?? {}).some((entry) => entry.status === 'loading') ||
    chat.pendingQuestionRecovery?.status === 'loading' ||
    Object.values(chat.pendingProposalRecovery ?? {}).some((entry) => entry.status === 'loading')
  ) {
    return true;
  }
  return false;
}

function* reclaimClosedWorkspaceChats(
  pending: Map<string, Set<string>>,
  openWorkspaceIds: Set<string>,
): SagaGenerator<void> {
  for (const [workspaceId, agentIds] of pending) {
    if (openWorkspaceIds.has(workspaceId)) {
      pending.delete(workspaceId);
      continue;
    }
    const reclaimable: string[] = [];
    for (const agentId of agentIds) {
      if (!(yield* agentHasActiveChatOperation(agentId))) reclaimable.push(agentId);
    }
    if (reclaimable.length === 0) continue;
    yield* put(workspaceChatStateReclaimed(workspaceId, reclaimable));
    for (const agentId of reclaimable) agentIds.delete(agentId);
    if (agentIds.size === 0) pending.delete(workspaceId);
  }
}

export function* workspaceTabCleanupSaga(): SagaGenerator<void> {
  const lifecycleChanges = yield* actionChannel(
    [...WORKSPACE_TAB_LIFECYCLE_ACTIONS, workspaceDeleted, ...RECLAMATION_RECHECK_ACTIONS],
    buffers.expanding(),
  );
  const leaseReleases = createChannel(buffers.expanding<string>());
  const unsubscribeLeaseReleases = onLastChatInterestLeaseReleased((agentId) =>
    leaseReleases.put(agentId),
  );
  let previousFocusedId = yield* selectCurrentWorkspaceTabId.effect();
  let previousIds = yield* selectActiveWorkspaceIds.effect();
  const unmountedWorkspaceIds = new Set<string>();
  const pendingReclamation = new Map<string, Set<string>>();

  try {
    if (previousFocusedId && !(yield* selectIsWorkspaceSessionLive.effect(previousFocusedId))) {
      yield* put(workspaceLoadRequested(previousFocusedId));
    }

    while (true) {
      const { action } = yield* race({
        action: take(lifecycleChanges),
        leaseReleased: take(leaseReleases),
      });
      const currentFocusedId = yield* selectCurrentWorkspaceTabId.effect();
      const currentIds = yield* selectActiveWorkspaceIds.effect();
      const currentIdSet = new Set(currentIds);
      const isTabLifecycleAction =
        action !== undefined &&
        (WORKSPACE_TAB_LIFECYCLE_ACTIONS.some((candidate) => candidate.type === action.type) ||
          action.type === workspaceDeleted.type);
      const focusChanged = isTabLifecycleAction && currentFocusedId !== previousFocusedId;
      const shouldRecheckReclamation =
        action === undefined ||
        isTabLifecycleAction ||
        action.type !== eventReceived.type ||
        isReclamationSettlementEvent(action as ReturnType<typeof eventReceived>);
      const unmountedIds = new Set<string>();

      // Focus changes keep the previous workspace session warm. Teardown is
      // reserved for tabs that disappear or workspaces that are deleted.
      if (isTabLifecycleAction)
        for (const workspaceId of previousIds) {
          if (!currentIdSet.has(workspaceId)) unmountedIds.add(workspaceId);
        }
      if (action?.type === workspaceDeleted.type) {
        unmountedIds.add((action as ReturnType<typeof workspaceDeleted>).payload[0]);
      }

      if (isTabLifecycleAction) {
        previousFocusedId = currentFocusedId;
        previousIds = currentIds;
        for (const workspaceId of currentIds) unmountedWorkspaceIds.delete(workspaceId);
      }

      for (const workspaceId of unmountedIds) {
        if (unmountedWorkspaceIds.has(workspaceId)) continue;
        unmountedWorkspaceIds.add(workspaceId);
        const agentIds = [...(yield* selectAgentSessionIdsForWorkspace.effect(workspaceId))];
        yield* put(workspaceUnmounted(workspaceId));
        if (
          action?.type !== workspaceDeleted.type &&
          workspaceId !== CHIEF_WORKSPACE_ID &&
          agentIds.length > 0
        ) {
          pendingReclamation.set(workspaceId, new Set(agentIds));
        }
      }
      if (focusChanged && currentFocusedId) {
        if (!(yield* selectIsWorkspaceSessionLive.effect(currentFocusedId))) {
          yield* put(workspaceLoadRequested(currentFocusedId));
        }
      }
      // Let unread tracking finish its close boundary while the departing
      // transcript is still available. Both sagas observe the post-reducer
      // tab action, so yielding here makes reclamation ordering explicit.
      if (unmountedIds.size > 0) yield* delay(0);
      if (shouldRecheckReclamation) {
        const openWorkspaceIds =
          unmountedIds.size > 0 ? new Set(yield* selectActiveWorkspaceIds.effect()) : currentIdSet;
        yield* reclaimClosedWorkspaceChats(pendingReclamation, openWorkspaceIds);
      }
    }
  } finally {
    unsubscribeLeaseReleases();
    lifecycleChanges.close();
    leaseReleases.close();
    pendingReclamation.clear();
  }
}
