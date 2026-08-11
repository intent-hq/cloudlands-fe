import type { Task } from 'redux-saga';
import {
  all,
  call,
  cancel,
  cancelled,
  delay,
  fork,
  put,
  race,
  take,
  takeEvery,
  type SagaGenerator,
} from 'typed-redux-saga';

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
import { selectTrackedAgentIds, selectWaitingState } from '../agent-subscription-ui-selectors';
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

interface ReadCoordinator {
  reads: Map<string, Task>;
  completedCleanups: Map<string, Task>;
  pendingConfirmations: Set<string>;
}

type ReadMode = 'snapshot' | 'confirmation';

function matchesWorkspaceCleanup(wsId: string) {
  return (action: { type: string; payload?: unknown }) =>
    (action.type === workspaceDeleted.type || action.type === workspaceUnmounted.type) &&
    Array.isArray(action.payload) &&
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
  const delegationGroups: DelegationGroupStatus[] = (result.delegationGroups ?? []).map(
    (group) => ({
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
    }),
  );
  return { subscriptions, delegationGroups, agentStatuses };
}

function* confirmCompletedSnapshotSaga(wsId: string, agentId: string) {
  try {
    const fresh: WireResult = yield* call(backendRequest<WireResult>, 'agent.getSubscriptions', {
      workspaceId: wsId,
      agentId,
    });
    const mapped = mapResult(fresh);
    if (mapped.subscriptions.length > 0 || mapped.delegationGroups.length > 0) {
      yield* put(
        setSubscriptionSnapshot(wsId, agentId, {
          ...mapped,
          waitingState: 'waiting',
        }),
      );
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
    return completed;
  } catch (error) {
    logger.error(`Failed to fetch agent subscriptions for ${key}`, error);
    return false;
  }
}

function* completedCleanupTask(
  coordinator: ReadCoordinator,
  wsId: string,
  agentId: string,
): SagaGenerator<void> {
  const key = makeKey(wsId, agentId);
  try {
    const { elapsed } = yield* race({
      elapsed: delay(COMPLETED_DISPLAY_DURATION_MS, true),
      cleanup: take(matchesWorkspaceCleanup(wsId)),
    });
    if (elapsed) yield* startSnapshotRead(coordinator, wsId, agentId, 'confirmation');
  } finally {
    coordinator.completedCleanups.delete(key);
  }
}

function* scheduleCompletedCleanup(
  coordinator: ReadCoordinator,
  wsId: string,
  agentId: string,
): SagaGenerator<void> {
  const key = makeKey(wsId, agentId);
  if (coordinator.completedCleanups.has(key)) return;
  const task = yield* fork(completedCleanupTask, coordinator, wsId, agentId);
  coordinator.completedCleanups.set(key, task);
}

function* readSnapshotTask(
  coordinator: ReadCoordinator,
  wsId: string,
  agentId: string,
  mode: ReadMode,
): SagaGenerator<void> {
  const key = makeKey(wsId, agentId);
  let completed = false;
  let workspaceCleanedUp = false;
  try {
    const outcome = yield* race({
      read: call(
        mode === 'confirmation' ? confirmCompletedSnapshotSaga : fetchSnapshotSaga,
        wsId,
        agentId,
      ),
      cleanup: take(matchesWorkspaceCleanup(wsId)),
    });
    completed = mode === 'snapshot' && outcome.read === true;
    workspaceCleanedUp = outcome.cleanup !== undefined;
  } finally {
    coordinator.reads.delete(key);
    const taskCancelled = yield* cancelled();
    const confirmationPending = coordinator.pendingConfirmations.delete(key);
    if (!taskCancelled && !workspaceCleanedUp) {
      if (confirmationPending) {
        yield* startSnapshotRead(coordinator, wsId, agentId, 'confirmation');
      } else if (completed) {
        yield* scheduleCompletedCleanup(coordinator, wsId, agentId);
      }
    }
  }
}

function* startSnapshotRead(
  coordinator: ReadCoordinator,
  wsId: string,
  agentId: string,
  mode: ReadMode,
): SagaGenerator<void> {
  const key = makeKey(wsId, agentId);
  if (coordinator.reads.has(key)) {
    if (mode === 'confirmation') coordinator.pendingConfirmations.add(key);
    return;
  }
  if (mode === 'snapshot') {
    const cleanup = coordinator.completedCleanups.get(key);
    if (cleanup) yield* cancel(cleanup);
  }
  const task = yield* fork(readSnapshotTask, coordinator, wsId, agentId, mode);
  coordinator.reads.set(key, task);
}

function* requestSubscriptionFetchWorker(
  coordinator: ReadCoordinator,
  action: ReturnType<typeof requestSubscriptionFetch>,
) {
  const [wsId, agentId] = action.payload;
  if (!wsId || !agentId) return;
  yield* startSnapshotRead(coordinator, wsId, agentId, 'snapshot');
}

function* refreshWorkspaceSubscriptionsWorker(
  coordinator: ReadCoordinator,
  action: ReturnType<typeof refreshWorkspaceSubscriptionEntriesRequested>,
) {
  const [wsId] = action.payload;
  if (!wsId) return;
  const agentIds: string[] = yield* selectTrackedAgentIds.effect(wsId);
  for (const agentId of agentIds) {
    yield* startSnapshotRead(coordinator, wsId, agentId, 'snapshot');
  }
}

function* deleteWorkspaceSubscriptionsWorker(action: ReturnType<typeof workspaceDeleted>) {
  const [wsId] = action.payload;
  const agentIds: string[] = yield* selectTrackedAgentIds.effect(wsId);
  for (const agentId of agentIds) yield* put(deleteSubscriptionUI(wsId, agentId));
}

export function* agentSubscriptionReadSaga() {
  const coordinator: ReadCoordinator = {
    reads: new Map(),
    completedCleanups: new Map(),
    pendingConfirmations: new Set(),
  };
  yield* all([
    takeEvery(requestSubscriptionFetch, requestSubscriptionFetchWorker, coordinator),
    takeEvery(
      refreshWorkspaceSubscriptionEntriesRequested,
      refreshWorkspaceSubscriptionsWorker,
      coordinator,
    ),
    takeEvery(workspaceDeleted, deleteWorkspaceSubscriptionsWorker),
  ]);
}
