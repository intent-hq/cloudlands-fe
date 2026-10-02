import type { Task } from 'redux-saga';
import { createChannelFromSelector } from '@themislib/themis/saga';
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
  subscriptionSnapshotFetchFailed,
  subscriptionSnapshotFetchStarted,
} from '../agent-subscription-ui-slice';
import {
  selectDisplayedSubscriptionTargets,
  selectTrackedAgentIds,
  selectWaitingState,
  selectSubscriptionSnapshotStatus,
} from '../agent-subscription-ui-selectors';
import { workspaceUnmounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import { selectDaemonEventsSubscriptionGeneration } from '../../workspace-events/workspace-events-selectors';
import { initializeChatRequested } from '../../chat-state/chat-state-slice';
import { markAgentAsViewed } from '../../unread-tracking/unread-tracking-slice';
import { selectAgentSession } from '../../agent-session/agent-session-selectors';

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
  displayed: Set<string>;
  contexts: Map<string, { wsId: string; agentId: string }>;
  reads: Map<string, Task>;
  completedCleanups: Map<string, Task>;
  pendingSnapshots: Set<string>;
  pendingConfirmations: Set<string>;
}

type ReadMode = 'snapshot' | 'confirmation';

function matchesWorkspaceCleanup(wsId: string) {
  return (action: { type: string; payload?: unknown }) =>
    action.type === workspaceUnmounted.type &&
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
    const hasData = mapped.subscriptions.length > 0 || mapped.delegationGroups.length > 0;
    // A view arriving during this read joins it, including an authoritative empty response.
    yield* put(
      setSubscriptionSnapshot(wsId, agentId, {
        ...mapped,
        waitingState: hasData ? 'waiting' : 'idle',
      }),
    );
    if (hasData) return;
  } catch {
    // Keep the prior empty snapshot for background cleanup, but a joined view
    // must settle as failed rather than remaining loading or claiming freshness.
    if ((yield* selectSubscriptionSnapshotStatus.effect(wsId, agentId)) === 'loading') {
      yield* put(subscriptionSnapshotFetchFailed(wsId, agentId));
    }
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
    // Preserve cached rows and let the footer surface this failure independently.
    yield* put(subscriptionSnapshotFetchFailed(wsId, agentId));
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
    const snapshotPending = coordinator.pendingSnapshots.delete(key);
    const confirmationPending = coordinator.pendingConfirmations.delete(key);
    if (!taskCancelled && !workspaceCleanedUp) {
      if (confirmationPending) {
        yield* startSnapshotRead(coordinator, wsId, agentId, 'confirmation');
      } else if (snapshotPending) {
        yield* startSnapshotRead(coordinator, wsId, agentId, 'snapshot');
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
  coordinator.contexts.set(key, { wsId, agentId });
  if (coordinator.reads.has(key)) {
    if (mode === 'confirmation') {
      coordinator.pendingConfirmations.add(key);
    } else {
      coordinator.pendingSnapshots.add(key);
    }
    return;
  }
  if (mode === 'snapshot') {
    yield* put(subscriptionSnapshotFetchStarted(wsId, agentId));
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
  const [wsId, agentId, ensure] = action.payload;
  if (!wsId || !agentId) return;
  if (ensure) {
    yield* ensureSnapshotRead(coordinator, wsId, agentId);
  } else {
    yield* startSnapshotRead(coordinator, wsId, agentId, 'snapshot');
  }
}

/** Mount demand joins current work; only invalidation requires a trailing read. */
function* ensureSnapshotRead(coordinator: ReadCoordinator, wsId: string, agentId: string) {
  coordinator.contexts.set(makeKey(wsId, agentId), { wsId, agentId });
  if (coordinator.reads.has(makeKey(wsId, agentId))) {
    yield* put(subscriptionSnapshotFetchStarted(wsId, agentId));
    return;
  }
  if ((yield* selectSubscriptionSnapshotStatus.effect(wsId, agentId)) === 'ready') return;
  yield* startSnapshotRead(coordinator, wsId, agentId, 'snapshot');
}

/** View-time prefetch: start the snapshot read as soon as chat initialization
 *  begins for an agent, so `agent.getSubscriptions` races the transcript
 *  snapshot instead of starting after the card mounts post-reveal. */
function* initializeChatPrefetchWorker(
  coordinator: ReadCoordinator,
  action: ReturnType<typeof initializeChatRequested>,
) {
  const { agentId, wsId } = action.payload;
  if (!wsId || !agentId) return;
  yield* ensureSnapshotRead(coordinator, wsId, agentId);
}

/** View-time prefetch on agent switch (`markAgentAsViewed` carries only the
 *  agentId — the workspace is resolved from the session; a not-yet-upserted
 *  session skips silently and the card's mount-time fetch backstops). */
function* markAgentAsViewedPrefetchWorker(
  coordinator: ReadCoordinator,
  action: ReturnType<typeof markAgentAsViewed>,
) {
  const [agentId] = action.payload;
  if (!agentId) return;
  const session = yield* selectAgentSession.effect(agentId);
  if (!session?.workspaceId) return;
  const key = makeKey(session.workspaceId, agentId);
  // Selection already refreshed this visibility interval, even if the read
  // completed before ChatPanel mounted. Failed prefetch still gets a retry.
  if (coordinator.displayed.has(key)) {
    yield* ensureSnapshotRead(coordinator, session.workspaceId, agentId);
    return;
  }
  if (coordinator.reads.has(key)) {
    yield* put(subscriptionSnapshotFetchStarted(session.workspaceId, agentId));
    return;
  }
  yield* startSnapshotRead(coordinator, session.workspaceId, agentId, 'snapshot');
}

/** Demand follows displayed conversations before their components mount. Leaving
 * a target removes its visibility lease; revisiting refreshes cached snapshots.
 */
function* watchDisplayedSubscriptions(coordinator: ReadCoordinator): SagaGenerator<void> {
  const channel = yield* createChannelFromSelector(selectDisplayedSubscriptionTargets);
  try {
    while (true) {
      const { payload: targets } = yield* take(channel);
      const previous = coordinator.displayed;
      coordinator.displayed = new Set(targets.map(({ wsId, agentId }) => makeKey(wsId, agentId)));
      for (const { wsId, agentId } of targets) {
        const key = makeKey(wsId, agentId);
        if (previous.has(key) || coordinator.reads.has(key)) continue;
        yield* startSnapshotRead(coordinator, wsId, agentId, 'snapshot');
      }
    }
  } finally {
    channel.close();
  }
}

function* refreshWorkspaceSubscriptionsWorker(
  coordinator: ReadCoordinator,
  action: ReturnType<typeof refreshWorkspaceSubscriptionEntriesRequested>,
) {
  const [wsId, changedAgentId] = action.payload;
  if (!wsId) return;
  // Pending initial reads are demanded contexts even before Redux has a snapshot.
  const agentIds = new Set(yield* selectTrackedAgentIds.effect(wsId));
  for (const context of coordinator.contexts.values()) {
    if (context.wsId === wsId) agentIds.add(context.agentId);
  }
  for (const agentId of agentIds) {
    if (!changedAgentId || changedAgentId === agentId) {
      yield* startSnapshotRead(coordinator, wsId, agentId, 'snapshot');
    }
  }
}

function* clearWorkspaceSubscriptionsWorker(
  coordinator: ReadCoordinator,
  action: ReturnType<typeof workspaceUnmounted>,
) {
  const [wsId] = action.payload;
  for (const [key, context] of coordinator.contexts) {
    if (context.wsId === wsId) coordinator.contexts.delete(key);
  }
  const agentIds: string[] = yield* selectTrackedAgentIds.effect(wsId);
  for (const agentId of agentIds) yield* put(deleteSubscriptionUI(wsId, agentId));
}

/** Reconcile only after the event lease is live, so no watch change falls
 * between the recovery snapshot and the replacement subscription. */
function* watchSubscriptionGeneration(coordinator: ReadCoordinator): SagaGenerator<void> {
  const channel = yield* createChannelFromSelector(selectDaemonEventsSubscriptionGeneration);
  let generation = yield* selectDaemonEventsSubscriptionGeneration.effect();
  try {
    while (true) {
      const { payload } = yield* take(channel);
      if (payload === generation) continue;
      generation = payload;
      for (const { wsId, agentId } of coordinator.contexts.values()) {
        yield* startSnapshotRead(coordinator, wsId, agentId, 'snapshot');
      }
    }
  } finally {
    channel.close();
  }
}

export function* agentSubscriptionReadSaga() {
  const coordinator: ReadCoordinator = {
    displayed: new Set(),
    contexts: new Map(),
    reads: new Map(),
    completedCleanups: new Map(),
    pendingSnapshots: new Set(),
    pendingConfirmations: new Set(),
  };
  yield* all([
    takeEvery(requestSubscriptionFetch, requestSubscriptionFetchWorker, coordinator),
    takeEvery(initializeChatRequested, initializeChatPrefetchWorker, coordinator),
    takeEvery(markAgentAsViewed, markAgentAsViewedPrefetchWorker, coordinator),
    takeEvery(
      refreshWorkspaceSubscriptionEntriesRequested,
      refreshWorkspaceSubscriptionsWorker,
      coordinator,
    ),
    takeEvery(workspaceUnmounted, clearWorkspaceSubscriptionsWorker, coordinator),
    fork(watchSubscriptionGeneration, coordinator),
    fork(watchDisplayedSubscriptions, coordinator),
  ]);
}
