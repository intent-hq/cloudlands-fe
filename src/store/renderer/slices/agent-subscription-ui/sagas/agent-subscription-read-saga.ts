import { trackAgentRecoveryRead } from '$features/agent/agent-recovery-read-lane';
import { rendererEventRecovery } from '$features/events/renderer-event-recovery';
import {
  agentSubscriptionsRecoveryKey,
  agentMetadataRecoveryKey,
} from '$features/agent/agent-recovery-keys';
import {
  withRecoveryLifetime,
  getRecoveryAdmission,
  getRecoveryLifetime,
} from '$store/renderer/middlewares/event-recovery';
import type { RecoveryLifetime } from '$shared/event-recovery/resource';
import { mapResult, type WireResult } from './agent-subscription-snapshot';
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

import { normalizeAgent } from '$lib/client/live/live-agents-client';
import { isAgentDeletionPending } from '$features/agent/utils/pending-agent-deletions';
import type { AgentSession } from '$shared/types';
import { bulkUpsertSessions } from '../../agent-session/agent-session-slice';
import { backendRequest } from '$lib/client/live/backend-transport';
import { createLogger } from '$lib/utils/client-logger';
import type { WaitingState } from '../agent-subscription-ui-types';
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
  selectAgentSubscriptions,
  selectDelegationGroups,
  selectTrackedAgentIds,
  selectWaitingState,
  selectSubscriptionSnapshotStatus,
} from '../agent-subscription-ui-selectors';
import {
  backendReconnected,
  workspaceUnmounted,
} from '../../workspace-lifecycle/workspace-lifecycle-slice';
import { selectDaemonEventsSubscriptionGeneration } from '../../workspace-events/workspace-events-selectors';
import { initializeChatRequested } from '../../chat-state/chat-state-slice';
import { markAgentAsViewed } from '../../unread-tracking/unread-tracking-slice';
import {
  selectAgentSession,
  selectAgentSessionsById,
} from '../../agent-session/agent-session-selectors';

export const COMPLETED_DISPLAY_DURATION_MS = 3000;
const logger = createLogger('AgentSubscriptionReadSaga');

interface ReadCoordinator {
  displayed: Set<string>;
  contexts: Map<string, { wsId: string; agentId: string }>;
  reads: Map<string, Task>;
  completedCleanups: Map<string, Task>;
  pendingSnapshots: Map<string, ReadReceipts>;
  pendingConfirmations: Map<string, ReadReceipts>;
}

type ReadMode = 'snapshot' | 'confirmation';
interface ReadReceipts {
  recovery: RecoveryLifetime;
  metadata: (workspaceId: string) => RecoveryLifetime | null;
}

function withWorkspaceAuthority(
  metadata: RecoveryLifetime | null,
  authority: RecoveryLifetime,
): RecoveryLifetime | null {
  if (!metadata) return null;
  return {
    key: metadata.key,
    isCurrent: () => authority.isCurrent() && metadata.isCurrent(),
    commit: (write) => authority.isCurrent() && metadata.commit(write),
  };
}

function matchesWorkspaceCleanup(wsId: string) {
  return (action: { type: string; payload?: unknown }) =>
    action.type === workspaceUnmounted.type &&
    Array.isArray(action.payload) &&
    action.payload[0] === wsId;
}

/** Publish participant rows before readiness can mount missing-session AgentCards. */
function* ingestBundledAgents(
  result: WireResult,
  beforeRead: Readonly<Record<string, AgentSession>>,
  metadata: ReadReceipts['metadata'],
) {
  const groups = new Map<string, { agents: AgentSession[]; recovery: RecoveryLifetime }>();
  const current = yield* selectAgentSessionsById.effect();
  for (const raw of result.agents ?? []) {
    const id = String(raw.id);
    // Any local/event/detail write since request start wins over this snapshot.
    // This also keeps removed rows removed; a later fresh read can update again.
    if (current[id] !== beforeRead[id]) continue;
    const session = normalizeAgent(raw);
    if (session.pendingDeleteAt || isAgentDeletionPending(String(session.id))) continue;
    const workspaceId = String(session.workspaceId);
    const recovery = metadata(workspaceId);
    if (!recovery?.commit(() => undefined)) continue;
    const group = groups.get(workspaceId) ?? { agents: [], recovery };
    groups.set(workspaceId, group);
    const existing = yield* selectAgentSession.effect(String(session.id));
    // Slim rows have no transcript. Keep history hydrated by the chat/detail
    // paths, but never carry it across workspace identities.
    group.agents.push(
      existing?.workspaceId === session.workspaceId
        ? { ...session, messages: existing.messages }
        : session,
    );
  }
  for (const { agents, recovery } of groups.values())
    yield* put(
      withRecoveryLifetime(bulkUpsertSessions(agents, { listProjection: true }), recovery),
    );
}

function* confirmCompletedSnapshotSaga(wsId: string, agentId: string, receipts: ReadReceipts) {
  const { recovery, metadata } = receipts;
  if (!recovery.commit(() => undefined)) return;
  try {
    const beforeRead = yield* selectAgentSessionsById.effect();
    const fresh: WireResult = yield* call(() =>
      trackAgentRecoveryRead(
        agentSubscriptionsRecoveryKey(wsId, agentId),
        () => {
          if (!recovery.commit(() => undefined))
            throw new Error('Subscription read authority retired');
          return backendRequest<WireResult>('agent.getSubscriptions', {
            workspaceId: wsId,
            agentId,
          });
        },
        rendererEventRecovery.hasOwner(agentSubscriptionsRecoveryKey(wsId, agentId))
          ? recovery
          : undefined,
      ),
    );
    if (!recovery.commit(() => undefined)) return;
    yield* ingestBundledAgents(fresh, beforeRead, metadata);
    const mapped = mapResult(fresh);
    const hasData =
      mapped.subscriptions.length > 0 ||
      mapped.delegationGroups.length > 0 ||
      (mapped.eventSubscriptions?.length ?? 0) > 0;
    // A view arriving during this read joins it, including an authoritative empty response.
    yield* put(
      withRecoveryLifetime(
        setSubscriptionSnapshot(wsId, agentId, {
          ...mapped,
          waitingState: hasData ? 'waiting' : 'idle',
        }),
        recovery,
      ),
    );
    if (hasData) return;
  } catch {
    if (!recovery.commit(() => undefined)) return;
    // Keep the prior empty snapshot for background cleanup, but a joined view
    // must settle as failed rather than remaining loading or claiming freshness.
    if ((yield* selectSubscriptionSnapshotStatus.effect(wsId, agentId)) === 'loading') {
      yield* put(withRecoveryLifetime(subscriptionSnapshotFetchFailed(wsId, agentId), recovery));
    }
  }
  yield* put(withRecoveryLifetime(resetSubscriptionUI(wsId, agentId), recovery));
}

function* fetchSnapshotSaga(wsId: string, agentId: string, receipts: ReadReceipts) {
  const { recovery, metadata } = receipts;
  if (!recovery.commit(() => undefined)) return;
  const key = makeKey(wsId, agentId);
  try {
    const previous: WaitingState = yield* selectWaitingState.effect(wsId, agentId);
    const beforeRead = yield* selectAgentSessionsById.effect();
    const result: WireResult = yield* call(() =>
      trackAgentRecoveryRead(
        agentSubscriptionsRecoveryKey(wsId, agentId),
        () => {
          if (!recovery.commit(() => undefined))
            throw new Error('Subscription read authority retired');
          return backendRequest<WireResult>('agent.getSubscriptions', {
            workspaceId: wsId,
            agentId,
          });
        },
        rendererEventRecovery.hasOwner(agentSubscriptionsRecoveryKey(wsId, agentId))
          ? recovery
          : undefined,
      ),
    );
    if (!recovery.commit(() => undefined)) return;
    yield* ingestBundledAgents(result, beforeRead, metadata);
    const mapped = mapResult(result);
    const hasData =
      mapped.subscriptions.length > 0 ||
      mapped.delegationGroups.length > 0 ||
      (mapped.eventSubscriptions?.length ?? 0) > 0;
    const completed = !hasData && (previous === 'waiting' || previous === 'woken');
    yield* put(
      withRecoveryLifetime(
        setSubscriptionSnapshot(wsId, agentId, {
          ...mapped,
          waitingState: completed ? 'completed' : hasData ? 'waiting' : 'idle',
        }),
        recovery,
      ),
    );
    return completed;
  } catch (error) {
    if (!recovery.commit(() => undefined)) return false;
    logger.error(`Failed to fetch agent subscriptions for ${key}`, error);
    // Preserve cached rows and let the footer surface this failure independently.
    yield* put(withRecoveryLifetime(subscriptionSnapshotFetchFailed(wsId, agentId), recovery));
    return false;
  }
}

function* completedCleanupTask(
  coordinator: ReadCoordinator,
  wsId: string,
  agentId: string,
  receipts: ReadReceipts,
): SagaGenerator<void> {
  const key = makeKey(wsId, agentId);
  const { recovery } = receipts;
  try {
    const { elapsed } = yield* race({
      elapsed: delay(COMPLETED_DISPLAY_DURATION_MS, true),
      cleanup: take(matchesWorkspaceCleanup(wsId)),
    });
    if (elapsed && recovery.commit(() => undefined))
      yield* startSnapshotRead(coordinator, wsId, agentId, 'confirmation', receipts);
  } finally {
    coordinator.completedCleanups.delete(key);
  }
}

function* scheduleCompletedCleanup(
  coordinator: ReadCoordinator,
  wsId: string,
  agentId: string,
  receipts: ReadReceipts,
): SagaGenerator<void> {
  const key = makeKey(wsId, agentId);
  if (coordinator.completedCleanups.has(key)) return;
  const task = yield* fork(completedCleanupTask, coordinator, wsId, agentId, receipts);
  coordinator.completedCleanups.set(key, task);
}

function* readSnapshotTask(
  coordinator: ReadCoordinator,
  wsId: string,
  agentId: string,
  mode: ReadMode,
  receipts: ReadReceipts,
): SagaGenerator<void> {
  const key = makeKey(wsId, agentId);
  let completed = false;
  let invalidated = false;
  try {
    const outcome = yield* race({
      read: call(
        mode === 'confirmation' ? confirmCompletedSnapshotSaga : fetchSnapshotSaga,
        wsId,
        agentId,
        receipts,
      ),
      cleanup: take(matchesWorkspaceCleanup(wsId)),
      reconnected: take(backendReconnected),
    });
    completed = mode === 'snapshot' && outcome.read === true;
    invalidated = outcome.cleanup !== undefined || outcome.reconnected !== undefined;
  } finally {
    coordinator.reads.delete(key);
    const taskCancelled = yield* cancelled();
    const snapshotPending = coordinator.pendingSnapshots.get(key);
    const confirmationPending = coordinator.pendingConfirmations.get(key);
    coordinator.pendingSnapshots.delete(key);
    coordinator.pendingConfirmations.delete(key);
    if (!taskCancelled && !invalidated) {
      if (confirmationPending?.recovery.commit(() => undefined)) {
        yield* startSnapshotRead(coordinator, wsId, agentId, 'confirmation', confirmationPending);
      } else if (snapshotPending) {
        yield* startSnapshotRead(coordinator, wsId, agentId, 'snapshot', snapshotPending);
      } else if (completed && receipts.recovery.commit(() => undefined)) {
        yield* scheduleCompletedCleanup(coordinator, wsId, agentId, receipts);
      }
    }
  }
}

function* startSnapshotRead(
  coordinator: ReadCoordinator,
  wsId: string,
  agentId: string,
  mode: ReadMode,
  receipts?: ReadReceipts,
): SagaGenerator<void> {
  let started = false;
  if (
    !receipts &&
    mode === 'snapshot' &&
    !rendererEventRecovery.hasOwner(agentSubscriptionsRecoveryKey(wsId, agentId))
  ) {
    // Initial demand installs the owner synchronously. Event continuations
    // always supply receipts and must never enter this recapture path.
    yield* put(subscriptionSnapshotFetchStarted(wsId, agentId));
    started = true;
  }
  if (!receipts) {
    const captured = rendererEventRecovery.captureSelector();
    const authority = rendererEventRecovery.captureAuthoritySelector();
    receipts = {
      recovery: rendererEventRecovery.capture(agentSubscriptionsRecoveryKey(wsId, agentId)),
      metadata: (workspaceId) =>
        withWorkspaceAuthority(
          captured(agentMetadataRecoveryKey(workspaceId)),
          authority(`agent-workspace-authority:${JSON.stringify([workspaceId])}`),
        ),
    };
  }
  if (!receipts.recovery.commit(() => undefined)) return;
  const key = makeKey(wsId, agentId);
  coordinator.contexts.set(key, { wsId, agentId });
  if (coordinator.reads.has(key)) {
    if (mode === 'confirmation') coordinator.pendingConfirmations.set(key, receipts);
    else coordinator.pendingSnapshots.set(key, receipts);
    return;
  }
  if (mode === 'snapshot') {
    if (!started)
      yield* put(
        withRecoveryLifetime(subscriptionSnapshotFetchStarted(wsId, agentId), receipts.recovery),
      );
    const cleanup = coordinator.completedCleanups.get(key);
    if (cleanup) yield* cancel(cleanup);
  }
  const task = yield* fork(readSnapshotTask, coordinator, wsId, agentId, mode, receipts);
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
  const captured = rendererEventRecovery.captureSelector();
  const authority = rendererEventRecovery.captureAuthoritySelector();
  const [wsId, changedAgentId, watchedAgentId] = action.payload;
  if (!wsId) return;
  // Pending initial reads are demanded contexts even before Redux has a snapshot.
  const agentIds = new Set(yield* selectTrackedAgentIds.effect(wsId));
  for (const context of coordinator.contexts.values()) {
    if (context.wsId === wsId) agentIds.add(context.agentId);
  }
  const targets = new Map(
    [...agentIds].map((agentId) => [makeKey(wsId, agentId), { wsId, agentId }]),
  );
  // Cross-workspace completion watches use the parent's home workspace.
  if (watchedAgentId) {
    for (const [key, context] of coordinator.contexts) targets.set(key, context);
    const sessions = yield* selectAgentSessionsById.effect();
    for (const home of new Set(Object.values(sessions).map((session) => session.workspaceId))) {
      for (const parent of yield* selectTrackedAgentIds.effect(home)) {
        targets.set(makeKey(home, parent), { wsId: home, agentId: parent });
      }
    }
  }
  for (const { wsId: targetWs, agentId } of targets.values()) {
    if (changedAgentId && changedAgentId !== agentId) continue;
    if (watchedAgentId) {
      const subscriptions = yield* selectAgentSubscriptions.effect(targetWs, agentId);
      const groups = yield* selectDelegationGroups.effect(targetWs, agentId);
      const known = (yield* selectSubscriptionSnapshotStatus.effect(targetWs, agentId)) === 'ready';
      const watchesChild =
        subscriptions.some((watch) => watch.actorIds.includes(watchedAgentId)) ||
        groups.some((group) => group.expectedAgentIds.includes(watchedAgentId));
      // Unknown same-workspace snapshots may have captured this child before
      // the event. Known empty/unrelated snapshots, including hidden views,
      // are not invalidated by an arbitrary agent finishing.
      if (!watchesChild && (known || targetWs !== wsId)) continue;
    }
    const admission = getRecoveryAdmission(
      action,
      agentSubscriptionsRecoveryKey(targetWs, agentId),
    );
    const recovery =
      admission === undefined
        ? (getRecoveryLifetime(action) ??
          rendererEventRecovery.capture(agentSubscriptionsRecoveryKey(targetWs, agentId)))
        : admission;
    if (!recovery?.commit(() => undefined)) continue;
    const metadata = (workspaceId: string) => {
      const key = agentMetadataRecoveryKey(workspaceId);
      const admission = getRecoveryAdmission(action, key);
      return withWorkspaceAuthority(
        admission === undefined ? captured(key) : admission,
        authority(`agent-workspace-authority:${JSON.stringify([workspaceId])}`),
      );
    };
    yield* startSnapshotRead(coordinator, targetWs, agentId, 'snapshot', { recovery, metadata });
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
    pendingSnapshots: new Map(),
    pendingConfirmations: new Map(),
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
