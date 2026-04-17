/**
 * Agent Subscription UI Saga
 *
 * Manages IPC event listeners for agent event subscriptions,
 * dispatches snapshot updates to the slice, handles woken-up
 * auto-dismiss, and stop/cancel cleanup.
 *
 * Lifecycle: forked per-workspace on workspaceMounted,
 * cancelled on workspaceUnmounted.
 */

import type { Task } from 'redux-saga';
import { eventChannel, type EventChannel, END } from 'redux-saga';
import { cancel, call, delay, fork, put, select, take, takeEvery } from 'typed-redux-saga';
import { listenSync, extractEventData, invoke } from '$lib/electron-bridge';
import type { ElectronEventName } from '$shared/ipc-registry';
import {
  workspaceMounted,
  workspaceUnmounted,
} from '../../workspace-lifecycle/workspace-lifecycle-slice';
import { selectActiveWorkspaceId } from '../../workspace/workspace-selectors';
import {
  setSubscriptionSnapshot,
  setWokenUp,
  clearWokenUp,
  resetSubscriptionUI,
  requestSubscriptionFetch,
  makeKey,
} from '../agent-subscription-ui-slice';
import { selectTrackedAgentIds, selectWaitingState } from '../agent-subscription-ui-selectors';
import type {
  Subscription,
  DelegationGroupStatus,
  AgentStatus,
  WokenUpInfo,
} from '../agent-subscription-ui-types';

// ---------------------------------------------------------------------------
// IPC event names this saga listens to
// ---------------------------------------------------------------------------

const SUBSCRIPTION_IPC_EVENTS: ElectronEventName[] = [
  'agent:subscribed',
  'agent:unsubscribed',
  'agent:subscriptions-changed',
  'agent:idle',
  'agent:stopped',
  'agent:status-changed',
  'agent:created',
  'agent:woken-by-subscription',
  'agent:event-delivery-failed',
  'agent:event-delivery-timeout',
  'agent:subscriptions-restored',
];

// ---------------------------------------------------------------------------
// Types for IPC event payloads
// ---------------------------------------------------------------------------

type SubscriptionIpcEvent = {
  eventName: ElectronEventName;
  workspaceId?: string;
  agentId?: string;
  data: any;
};

// ---------------------------------------------------------------------------
// Event channel: bridges all subscription IPC events into a single channel
// ---------------------------------------------------------------------------

function createSubscriptionChannel(wsId: string): EventChannel<SubscriptionIpcEvent> {
  return eventChannel<SubscriptionIpcEvent>((emitter) => {
    if (typeof window === 'undefined' || !window.electronAPI) {
      emitter(END as any);
      return () => {};
    }

    const cleanups: Array<() => void> = [];

    for (const eventName of SUBSCRIPTION_IPC_EVENTS) {
      const cleanup = listenSync(eventName, (event: any) => {
        const eventData = extractEventData(event);
        const eventWsId = extractEventData<string>(event, 'workspaceId') ?? eventData?.workspaceId;

        // Only process events that explicitly match this workspace
        if (!eventWsId || eventWsId !== wsId) return;

        const agentId = extractEventData<string>(event, 'agentId')
          ?? eventData?.agentId
          ?? extractEventData<string>(event, 'targetAgentId')
          ?? eventData?.targetAgentId;

        emitter({
          eventName,
          workspaceId: eventWsId,
          agentId,
          data: eventData,
        });
      });
      cleanups.push(cleanup);
    }

    return () => {
      for (const cleanup of cleanups) {
        cleanup();
      }
    };
  });
}

// ---------------------------------------------------------------------------
// fetchAndDispatchSnapshot — fetches subscription state from main process
// ---------------------------------------------------------------------------

export function* fetchAndDispatchSnapshot(wsId: string, agentId: string): Generator<any, void, any> {
  try {
    // Read the previous waiting state before fetching new data
    const previousWaitingState = yield* select(selectWaitingState.select, wsId, agentId);

    const result: any = yield* call(invoke, 'events:get-agent-subscriptions', {
      workspaceId: wsId,
      agentId,
    });

    if (result?.success) {
      const subscriptions: Subscription[] = result.data ?? [];
      const delegationGroups: DelegationGroupStatus[] = result.delegationGroups ?? [];
      const agentStatuses: Record<string, AgentStatus> = result.agentStatuses ?? {};

      const hasData = subscriptions.length > 0 || delegationGroups.length > 0;

      // Detect transition: was waiting/woken but now empty → show "completed"
      if (!hasData && (previousWaitingState === 'waiting' || previousWaitingState === 'woken')) {
        yield* put(
          setSubscriptionSnapshot(wsId, agentId, {
            subscriptions,
            delegationGroups,
            agentStatuses,
            waitingState: 'completed',
          }),
        );

        // Fork delayed cleanup
        const key = makeKey(wsId, agentId);
        const gen = (completionGeneration.get(key) ?? 0) + 1;
        completionGeneration.set(key, gen);
        yield* fork(function* () {
          yield* delay(COMPLETED_DISPLAY_DURATION);
          // Only clean up if no newer completion arrived during the delay
          if (completionGeneration.get(key) !== gen) return;

          // Re-fetch snapshot to check if new subscriptions or delegation
          // groups arrived during the "completed" display window.  If the
          // agent now has active data, skip the reset to avoid wiping it.
          try {
            const freshResult: any = yield* call(invoke, 'events:get-agent-subscriptions', {
              workspaceId: wsId,
              agentId,
            });
            if (freshResult?.success) {
              const freshSubs: Subscription[] = freshResult.data ?? [];
              const freshGroups: DelegationGroupStatus[] = freshResult.delegationGroups ?? [];
              if (freshSubs.length > 0 || freshGroups.length > 0) {
                // New active data appeared — refresh instead of resetting
                yield* call(fetchAndDispatchSnapshot, wsId, agentId);
                return;
              }
            }
          } catch {
            // If the re-fetch fails, proceed with reset — the original
            // snapshot already showed empty data.
          }

          yield* put(resetSubscriptionUI(wsId, agentId));
        });
        return;
      }

      // Normal path: determine waiting state from data presence
      const waitingState: 'idle' | 'waiting' | 'woken' =
        hasData ? 'waiting' : 'idle';

      yield* put(
        setSubscriptionSnapshot(wsId, agentId, {
          subscriptions,
          delegationGroups,
          agentStatuses,
          waitingState,
        }),
      );
    }
  } catch {
    // Ignore fetch errors — IPC events will trigger retry
  }
}

// ---------------------------------------------------------------------------
// Per-agent wakeup generation tracker: prevents a stale auto-dismiss fork
// from clearing a newer wakeup event's indicator.
// ---------------------------------------------------------------------------

const wakeupGeneration = new Map<string, number>();

/** @internal Exported for testing only. */
export function _getWakeupGeneration(key: string): number {
  return wakeupGeneration.get(key) ?? 0;
}

// ---------------------------------------------------------------------------
// Per-agent completion generation tracker: prevents a stale cleanup fork
// from resetting the UI when a new completion arrives.
// ---------------------------------------------------------------------------

const completionGeneration = new Map<string, number>();

/** @internal Exported for testing only. */
export function _getCompletionGeneration(key: string): number {
  return completionGeneration.get(key) ?? 0;
}

/** Duration (ms) the "Completed" indicator is shown before cleanup. */
const COMPLETED_DISPLAY_DURATION = 3000;

// ---------------------------------------------------------------------------
// Per-workspace event handler
// ---------------------------------------------------------------------------

export function* handleSubscriptionEvent(wsId: string, event: SubscriptionIpcEvent) {
  const { eventName, agentId, data } = event;

  // System-level subscription changes (e.g. bumpVersion cleanup) have no agentId.
  // Refresh all tracked agents so the UI picks up removals.
  if (!agentId) {
    if (eventName === 'agent:subscriptions-changed') {
      const trackedIds: string[] = yield* select(selectTrackedAgentIds.select, wsId);
      for (const id of trackedIds) {
        yield* call(fetchAndDispatchSnapshot, wsId, id);
      }
    }
    return;
  }

  // Always fetch fresh snapshot on any relevant event
  yield* call(fetchAndDispatchSnapshot, wsId, agentId);

  // Special handling for woken-by-subscription — auto-dismiss after 5s
  // Forked so the delay doesn't block event processing in the parent loop
  //
  // FIX: Use a per-agent generation counter so that when a second wakeup
  // arrives before the first 5s dismiss fires, the stale fork detects
  // the generation mismatch and skips the clearWokenUp dispatch.
  if (eventName === 'agent:woken-by-subscription') {
    const info: WokenUpInfo = {
      eventCount: data?.eventCount ?? 0,
      eventTypes: data?.eventTypes ?? [],
      timestamp: Date.now(),
    };
    const key = `${wsId}:${agentId}`;
    const gen = (wakeupGeneration.get(key) ?? 0) + 1;
    wakeupGeneration.set(key, gen);
    yield* fork(function* () {
      yield* put(setWokenUp(wsId, agentId, info));
      yield* delay(5000);
      // Only clear if no newer wakeup arrived during the delay
      if (wakeupGeneration.get(key) === gen) {
        yield* put(clearWokenUp(wsId, agentId));
      }
    });
  }

  // Special handling for agent:stopped — unsubscribe and reset
  if (eventName === 'agent:stopped') {
    try {
      yield* call(invoke, 'events:unsubscribe-agent', {
        workspaceId: wsId,
        agentId,
      });
    } catch {
      // Ignore unsubscribe errors
    }
    yield* put(resetSubscriptionUI(wsId, agentId));
  }
}

// ---------------------------------------------------------------------------
// Per-workspace watcher: consumes events from the channel
// ---------------------------------------------------------------------------

export function* watchSubscriptionsForWorkspace(wsId: string) {
  const channel = createSubscriptionChannel(wsId);

  try {
    while (true) {
      const event: SubscriptionIpcEvent = yield* take(channel);
      yield* call(handleSubscriptionEvent, wsId, event);
    }
  } finally {
    channel.close();
  }
}

// ---------------------------------------------------------------------------
// Per-workspace lifecycle
// ---------------------------------------------------------------------------

const workspaceTasks = new Map<string, Task>();

export function* handleWorkspaceMounted(action: ReturnType<typeof workspaceMounted>) {
  const [wsId] = action.payload;
  const task = yield* fork(watchSubscriptionsForWorkspace, wsId);
  workspaceTasks.set(wsId, task);
}

export function* handleWorkspaceUnmounted(action: ReturnType<typeof workspaceUnmounted>) {
  const [wsId] = action.payload;
  const task = workspaceTasks.get(wsId);
  if (task) {
    yield* cancel(task);
    workspaceTasks.delete(wsId);
  }

  // Prune generation entries for the unmounted workspace to prevent
  // the Maps from growing unbounded across workspace mount/unmount cycles.
  const prefix = `${wsId}:`;
  for (const key of wakeupGeneration.keys()) {
    if (key.startsWith(prefix)) {
      wakeupGeneration.delete(key);
    }
  }
  for (const key of completionGeneration.keys()) {
    if (key.startsWith(prefix)) {
      completionGeneration.delete(key);
    }
  }
}

// ---------------------------------------------------------------------------
// Retroactive mount check
// ---------------------------------------------------------------------------

/** @internal Exported for testing only. */
export function* retroactiveMountCheckSaga() {
  const activeWsId = yield* select(selectActiveWorkspaceId.select);

  if (!activeWsId) return;
  if (activeWsId === 'new' || activeWsId.startsWith('optimistic-') || activeWsId === 'undefined') {
    return;
  }

  // If the normal takeEvery already processed the mount, a task will exist.
  if (workspaceTasks.has(activeWsId)) return;

  // The workspace was mounted before the saga started — replay.
  yield* fork(handleWorkspaceMounted, workspaceMounted(activeWsId));
}

// ---------------------------------------------------------------------------
// Root saga
// ---------------------------------------------------------------------------

function* handleRequestSubscriptionFetch(action: ReturnType<typeof requestSubscriptionFetch>) {
  const [wsId, agentId] = action.payload;
  yield* call(fetchAndDispatchSnapshot, wsId, agentId);
}

export function* agentSubscriptionUISaga() {
  yield* takeEvery(workspaceMounted, handleWorkspaceMounted);
  yield* takeEvery(workspaceUnmounted, handleWorkspaceUnmounted);
  yield* takeEvery(requestSubscriptionFetch, handleRequestSubscriptionFetch);

  // Check if a workspace is already active (missed the mount action)
  yield* fork(retroactiveMountCheckSaga);
}
