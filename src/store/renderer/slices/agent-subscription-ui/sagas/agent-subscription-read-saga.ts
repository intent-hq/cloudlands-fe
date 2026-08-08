import type { Task } from 'redux-saga';
import { call, cancel, delay, fork, put, spawn, take } from 'typed-redux-saga';

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

type TrackedTask = { wsId: string; task: Task; token: symbol };

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

function* fetchSnapshotSaga(
  wsId: string,
  agentId: string,
  cleanupTasks: Map<string, TrackedTask>,
) {
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
    if (!completed) return;

    const prior = cleanupTasks.get(key);
    if (prior) yield* cancel(prior.task);
    const token = Symbol(key);
    const task = yield* spawn(function* () {
      try {
        yield* call(completedCleanupSaga, wsId, agentId);
      } finally {
        if (cleanupTasks.get(key)?.token === token) cleanupTasks.delete(key);
      }
    });
    cleanupTasks.set(key, { wsId, task, token });
  } catch (error) {
    logger.error(`Failed to fetch agent subscriptions for ${key}`, error);
  }
}

function* startFetch(
  wsId: string,
  agentId: string,
  fetchTasks: Map<string, TrackedTask>,
  cleanupTasks: Map<string, TrackedTask>,
) {
  const key = makeKey(wsId, agentId);
  if (fetchTasks.has(key)) return;
  const token = Symbol(key);
  const task = yield* fork(function* () {
    try {
      yield* call(fetchSnapshotSaga, wsId, agentId, cleanupTasks);
    } finally {
      if (fetchTasks.get(key)?.token === token) fetchTasks.delete(key);
    }
  });
  fetchTasks.set(key, { wsId, task, token });
}

export function* agentSubscriptionReadSaga() {
  const fetchTasks = new Map<string, TrackedTask>();
  const cleanupTasks = new Map<string, TrackedTask>();
  try {
    while (true) {
      const action: { type: string; payload: unknown } = yield* take([
        requestSubscriptionFetch,
        refreshWorkspaceSubscriptionEntriesRequested,
        workspaceDeleted,
        workspaceUnmounted,
      ]);
      if (action.type === requestSubscriptionFetch.type) {
        const [wsId, agentId] = action.payload as [string, string];
        yield* fork(startFetch, wsId, agentId, fetchTasks, cleanupTasks);
        continue;
      }
      const [wsId] = action.payload as [string];
      if (action.type === refreshWorkspaceSubscriptionEntriesRequested.type) {
        const agentIds: string[] = yield* selectTrackedAgentIds.effect(wsId);
        for (const agentId of agentIds) {
          yield* fork(startFetch, wsId, agentId, fetchTasks, cleanupTasks);
        }
        continue;
      }

      for (const tasks of [fetchTasks, cleanupTasks]) {
        for (const [key, tracked] of tasks) {
          if (tracked.wsId !== wsId) continue;
          tasks.delete(key);
          yield* cancel(tracked.task);
        }
      }
      if (action.type === workspaceDeleted.type) {
        const agentIds: string[] = yield* selectTrackedAgentIds.effect(wsId);
        for (const agentId of agentIds) yield* put(deleteSubscriptionUI(wsId, agentId));
      }
    }
  } finally {
    for (const tasks of [fetchTasks, cleanupTasks]) {
      for (const tracked of tasks.values()) yield* cancel(tracked.task);
      tasks.clear();
    }
  }
}