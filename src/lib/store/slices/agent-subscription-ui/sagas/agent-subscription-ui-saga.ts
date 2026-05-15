/**
 * Agent Subscription UI Saga
 *
 * Manages long-lived IPC event listeners for agent event subscriptions,
 * dispatches snapshot updates to the slice, handles woken-up
 * auto-dismiss, and stop/cancel cleanup.
 */

import {
  call,
  delay,
  fork,
  put,
  takeEvery,
} from 'typed-redux-saga';
import {
  extractEventData,
  invoke,
} from '$lib/electron-bridge';
import { takeEveryFromListenSync } from '$lib/store/utils/ipc-channel';
import { workspaceUnmounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import {
  setSubscriptionSnapshot,
  setWokenUp,
  clearWokenUp,
  resetSubscriptionUI,
  requestSubscriptionFetch,
  makeKey,
} from '../agent-subscription-ui-slice';
import {
  selectTrackedAgentIds,
  selectWaitingState,
} from '../agent-subscription-ui-selectors';
import type {
  Subscription,
  DelegationGroupStatus,
  AgentStatus,
  WokenUpInfo,
} from '../agent-subscription-ui-types';

// ---------------------------------------------------------------------------
// Types for IPC event payloads
// ---------------------------------------------------------------------------

type SubscriptionWorkspacePayload = {
  workspaceId?: string;
};

type AgentIdPayload = SubscriptionWorkspacePayload & {
  agentId?: string;
};

type TargetAgentIdPayload = SubscriptionWorkspacePayload & {
  targetAgentId?: string;
};

type SubscriptionsRestoredPayload = SubscriptionWorkspacePayload & {
  agentIds?: string[];
};

type WokenBySubscriptionPayload = AgentIdPayload & Pick<WokenUpInfo, 'eventCount' | 'eventTypes'>;

type WorkspaceMountedAction = {
  payload: [wsId: string];
};

// ---------------------------------------------------------------------------
// fetchAndDispatchSnapshot — fetches subscription state from main process
// ---------------------------------------------------------------------------

export function* fetchAndDispatchSnapshot(wsId: string, agentId: string): Generator<any, void, any> {
  try {
    // Read the previous waiting state before fetching new data
    const previousWaitingState = yield* selectWaitingState.effect(wsId, agentId);

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
// Event payload helpers
// ---------------------------------------------------------------------------

function extractSubscriptionPayload<T extends SubscriptionWorkspacePayload>(event: unknown): T {
  return (extractEventData<T>(event) ?? {}) as T;
}

function extractEventWorkspaceId(event: unknown, data: SubscriptionWorkspacePayload): string | undefined {
  return extractEventData<string>(event, 'workspaceId') ?? data.workspaceId;
}

function extractEventAgentId(event: unknown, data: AgentIdPayload): string | undefined {
  return extractEventData<string>(event, 'agentId') ?? data.agentId;
}

function extractEventTargetAgentId(event: unknown, data: TargetAgentIdPayload): string | undefined {
  return extractEventData<string>(event, 'targetAgentId') ?? data.targetAgentId;
}

export function* refreshAgentFromAgentIdEvent(event: unknown) {
  const data = extractSubscriptionPayload<AgentIdPayload>(event);
  const wsId = extractEventWorkspaceId(event, data);
  const agentId = extractEventAgentId(event, data);

  if (!wsId || !agentId) return;

  yield* call(fetchAndDispatchSnapshot, wsId, agentId);
}

export function* refreshAgentFromTargetAgentIdEvent(event: unknown) {
  const data = extractSubscriptionPayload<TargetAgentIdPayload>(event);
  const wsId = extractEventWorkspaceId(event, data);
  const agentId = extractEventTargetAgentId(event, data);

  if (!wsId || !agentId) return;

  yield* call(fetchAndDispatchSnapshot, wsId, agentId);
}

export function* handleAgentSubscriptionsChangedEvent(event: AgentIdPayload) {
  const data = extractSubscriptionPayload<AgentIdPayload>(event);
  const wsId = extractEventWorkspaceId(event, data);

  if (!wsId) return;

  const agentId = extractEventAgentId(event, data);
  if (agentId) {
    yield* call(fetchAndDispatchSnapshot, wsId, agentId);
    return;
  }

  // System-level subscription changes have no agentId.
  // Refresh all tracked agents so the UI picks up removals.
  const trackedIds: string[] = yield* selectTrackedAgentIds.effect(wsId);
  for (const id of trackedIds) {
    yield* call(fetchAndDispatchSnapshot, wsId, id);
  }
}

export function* handleAgentSubscriptionsRestoredEvent(event: SubscriptionsRestoredPayload) {
  const data = extractSubscriptionPayload<SubscriptionsRestoredPayload>(event);
  const wsId = extractEventWorkspaceId(event, data);

  if (!wsId || !Array.isArray(data.agentIds)) return;

  for (const agentId of data.agentIds) {
    if (typeof agentId !== 'string' || agentId.length === 0) continue;
    yield* call(fetchAndDispatchSnapshot, wsId, agentId);
  }
}

export function* handleAgentWokenBySubscriptionEvent(event: WokenBySubscriptionPayload) {
  const data = extractSubscriptionPayload<WokenBySubscriptionPayload>(event);
  const wsId = extractEventWorkspaceId(event, data);
  const agentId = extractEventAgentId(event, data);

  if (!wsId || !agentId) return;

  // Always fetch fresh snapshot on any relevant event
  yield* call(fetchAndDispatchSnapshot, wsId, agentId);

  // Special handling for woken-by-subscription — auto-dismiss after 5s
  // Forked so the delay doesn't block event processing in the parent loop
  //
  // FIX: Use a per-agent generation counter so that when a second wakeup
  // arrives before the first 5s dismiss fires, the stale fork detects
  // the generation mismatch and skips the clearWokenUp dispatch.
  const info: WokenUpInfo = {
    eventCount: data.eventCount ?? 0,
    eventTypes: data.eventTypes ?? [],
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

export function* handleAgentStoppedEvent(event: AgentIdPayload) {
  const data = extractSubscriptionPayload<AgentIdPayload>(event);
  const wsId = extractEventWorkspaceId(event, data);
  const agentId = extractEventAgentId(event, data);

  if (!wsId || !agentId) return;

  // Always fetch fresh snapshot on any relevant event
  yield* call(fetchAndDispatchSnapshot, wsId, agentId);

  // Special handling for agent:stopped — unsubscribe and reset
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

// ---------------------------------------------------------------------------
// Per-workspace lifecycle
// ---------------------------------------------------------------------------

export function* handleWorkspaceMounted(_action: WorkspaceMountedAction) {
  // Subscription IPC listeners are long-lived root watchers. Workspace mounts do
  // not create listener tasks.
}

export function* handleWorkspaceUnmounted(action: ReturnType<typeof workspaceUnmounted>) {
  const [wsId] = action.payload;

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
  // No-op retained for tests/import compatibility. Subscription IPC listeners
  // are registered by the root saga and do not need retroactive workspace mount
  // replay.
}

// ---------------------------------------------------------------------------
// Root saga
// ---------------------------------------------------------------------------

function* handleRequestSubscriptionFetch(action: ReturnType<typeof requestSubscriptionFetch>) {
  const [wsId, agentId] = action.payload;
  yield* call(fetchAndDispatchSnapshot, wsId, agentId);
}

export function* agentSubscriptionUISaga() {
  yield* takeEveryFromListenSync<AgentIdPayload>('agent:subscribed', refreshAgentFromAgentIdEvent);
  yield* takeEveryFromListenSync<AgentIdPayload>('agent:unsubscribed', refreshAgentFromAgentIdEvent);
  yield* takeEveryFromListenSync<AgentIdPayload>(
    'agent:subscriptions-changed',
    handleAgentSubscriptionsChangedEvent,
  );
  yield* takeEveryFromListenSync<AgentIdPayload>('agent:idle', refreshAgentFromAgentIdEvent);
  yield* takeEveryFromListenSync<AgentIdPayload>('agent:stopped', handleAgentStoppedEvent);
  yield* takeEveryFromListenSync<AgentIdPayload>('agent:status-changed', refreshAgentFromAgentIdEvent);
  yield* takeEveryFromListenSync<AgentIdPayload>('agent:created', refreshAgentFromAgentIdEvent);
  yield* takeEveryFromListenSync<WokenBySubscriptionPayload>(
    'agent:woken-by-subscription',
    handleAgentWokenBySubscriptionEvent,
  );
  yield* takeEveryFromListenSync<TargetAgentIdPayload>(
    'agent:event-delivery-failed',
    refreshAgentFromTargetAgentIdEvent,
  );
  yield* takeEveryFromListenSync<TargetAgentIdPayload>(
    'agent:event-delivery-timeout',
    refreshAgentFromTargetAgentIdEvent,
  );
  yield* takeEveryFromListenSync<SubscriptionsRestoredPayload>(
    'agent:subscriptions-restored',
    handleAgentSubscriptionsRestoredEvent,
  );

  yield* takeEvery(workspaceUnmounted, handleWorkspaceUnmounted);
  yield* takeEvery(requestSubscriptionFetch, handleRequestSubscriptionFetch);
}
