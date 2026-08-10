import { all, call, delay, put, race, take, takeEvery, takeLatest, takeLeading } from 'typed-redux-saga';

import { backendRequest } from '$lib/client/live/backend-transport';
import { createLogger } from '$lib/utils/client-logger';
import type {
  AgentStatus,
  DelegationGroupStatus,
  Subscription,
  WaitingState,
} from '../agent-subscription-ui-types';
import {
  deleteSubscriptionUI,
  makeKey,
  refreshWorkspaceSubscriptionEntriesRequested,
  requestSubscriptionFetch,
  resetSubscriptionUI,
  setSubscriptionSnapshot,
} from '../agent-subscription-ui-slice';
import {
  selectTrackedAgentIds,
  selectWaitingState,
} from '../agent-subscription-ui-selectors';
import {
  workspaceDeleted,
  workspaceUnmounted,
} from '../../workspace-lifecycle/workspace-lifecycle-slice';

export const COMPLETED_DISPLAY_DURATION_MS = 3000;
const logger = createLogger('AgentSubscriptionReadSaga');

type WireSubscription = Omit<Subscription, 'delegationGroup'> & {
  delegationGroup?: Subscription['delegationGroup'] | null;
};

type WireDelegationGroup = Omit<DelegationGroupStatus, 'agentStatuses'> & {
  parentAgentId?: string;
};

interface WireResult {
  subscriptions?: WireSubscription[];
  delegationGroups?: WireDelegationGroup[];
  agentStatuses?: Record<string, AgentStatus>;
}

type WorkspaceCleanupAction =
  | ReturnType<typeof workspaceDeleted>
  | ReturnType<typeof workspaceUnmounted>;

function matchesWorkspaceCleanup(wsId: string) {
  return (action: WorkspaceCleanupAction) =>
    (action.type === workspaceDeleted.type || action.type === workspaceUnmounted.type) &&
    action.payload[0] === wsId;
}

function mapResult(result: WireResult) {
  const agentStatuses = result.agentStatuses ?? {};
  const subscriptions: Subscription[] = (result.subscriptions ?? []).map((item) => ({
    id: item.id,
    agentId: item.agentId,
    eventTypes: item.eventTypes,
    actorIds: item.actorIds,
    createdAt: item.createdAt,
    description: item.description,
    ...(item.delegationGroup ? { delegationGroup: item.delegationGroup } : {}),
  }));
  const delegationGroups: DelegationGroupStatus[] = (result.delegationGroups ?? []).map((group) => ({
    groupId: group.groupId,
    awaitMode: group.awaitMode,
    expectedAgentIds: group.expectedAgentIds,
    completedAgentIds: group.completedAgentIds,
    deletedAgentIds: group.deletedAgentIds,
    agentStatuses: Object.fromEntries(
      group.expectedAgentIds
        .filter((id) => agentStatuses[id] !== undefined)
        .map((id) => [id, agentStatuses[id]]),
    ),
    delivered: group.delivered,
  }));
  return { subscriptions, delegationGroups, agentStatuses };
}

function* completedCleanupSaga(wsId: string, agentId: string) {
  yield* delay(COMPLETED_DISPLAY_DURATION_MS);
  try {
    const fresh: WireResult = yield* call(backendRequest<WireResult>, 'agent.getSubscriptions', {
      workspaceId: wsId,
      agentId,
    });
    if ((fresh.subscriptions?.length ?? 0) > 0 || (fresh.delegationGroups?.length ?? 0) > 0) {
      yield* put(requestSubscriptionFetch(wsId, agentId));
      return;
    }
  } catch {
    // The empty snapshot was already authoritative; reset after a failed confirmation read.
  }
  yield* put(resetSubscriptionUI(wsId, agentId));
}

function* fetchSnapshotSaga(wsId: string, agentId: string) {
  const key = makeKey(wsId, agentId);
  try {
    const previous: WaitingState = yield* selectWaitingState.effect(wsId, agentId);
    const result: WireResult = yield* call(backendRequest<WireResult>, 'agent.getSubscriptions', {
      workspaceId: wsId,
      agentId,
    });
    const mapped = mapResult(result);
    const hasData = mapped.subscriptions.length > 0 || mapped.delegationGroups.length > 0;
    const completed = !hasData && (previous === 'waiting' || previous === 'woken');
    yield* put(
      setSubscriptionSnapshot(wsId, agentId, {
        ...mapped,
        waitingState: completed ? 'completed' : hasData ? 'waiting' : 'idle',
      }),
    );
  } catch (error) {
    logger.error(`Failed to fetch agent subscriptions for ${key}`, error);
  }
}

function* requestSubscriptionFetchWorker(action: ReturnType<typeof requestSubscriptionFetch>) {
  const [wsId, agentId] = action.payload;
  if (!wsId || !agentId) return;
  yield* race({
    read: call(fetchSnapshotSaga, wsId, agentId),
    cleanup: take(matchesWorkspaceCleanup(wsId)),
  });
}

function* refreshWorkspaceSubscriptionsWorker(
  action: ReturnType<typeof refreshWorkspaceSubscriptionEntriesRequested>,
) {
  const [wsId] = action.payload;
  if (!wsId) return;
  const agentIds: string[] = yield* selectTrackedAgentIds.effect(wsId);
  yield* race({
    reads: all(agentIds.map((agentId) => call(fetchSnapshotSaga, wsId, agentId))),
    cleanup: take(matchesWorkspaceCleanup(wsId)),
  });
}

function* completedSnapshotWorker(action: ReturnType<typeof setSubscriptionSnapshot>) {
  const { workspaceId, agentId, data } = action.payload;
  if (data.waitingState !== 'completed') return;
  yield* race({
    cleanup: call(completedCleanupSaga, workspaceId, agentId),
    workspaceCleanup: take(matchesWorkspaceCleanup(workspaceId)),
  });
}

function* deleteWorkspaceSubscriptionsWorker(action: ReturnType<typeof workspaceDeleted>) {
  const [wsId] = action.payload;
  const agentIds: string[] = yield* selectTrackedAgentIds.effect(wsId);
  for (const agentId of agentIds) yield* put(deleteSubscriptionUI(wsId, agentId));
}

export function* agentSubscriptionReadSaga() {
  yield* all([
    takeLeading(requestSubscriptionFetch, requestSubscriptionFetchWorker),
    takeLeading(
      refreshWorkspaceSubscriptionEntriesRequested,
      refreshWorkspaceSubscriptionsWorker,
    ),
    takeLatest(setSubscriptionSnapshot, completedSnapshotWorker),
    takeEvery(workspaceDeleted, deleteWorkspaceSubscriptionsWorker),
  ]);
}