/**
 * Agent Subscription Operations — Standalone functions for direct Redux usage.
 *
 * Replaces AgentEventSubscriptionService class methods with pure functions
 * that dispatch actions and read selectors directly.
 */
import { v4 as uuidv4 } from 'uuid';
import { Logger } from '../../../shared/logger';
import { createWorkspaceEvent } from '../types';
import { getMainState, mainDispatch } from '../../../store/main/redux-store-bridge';
import { emitWorkspaceEvent as reduxEmitWorkspaceEvent } from '../../../store/main/slices/workspace-events/workspace-events-slice';
import {
  addSubscription, removeSubscription, removeAllSubscriptions,
  setAgentStatus as setAgentStatusAction,
  setDelegationGroup,
  subscribeToDelegationGroup,
  markAgentDeleted as markAgentDeletedAction, bumpVersion,
  type AgentSubscriptionRecord,
  type AgentEventFilter,
} from '../../../store/main/slices/agent-subscriptions/agent-subscriptions-slice';
import {
  selectWorkspaceSubscriptionState,
  selectAgentSubscriptions,
  selectAgentStatus,
  selectDelegationGroup,
  selectIsAgentDeleted,
} from '../../../store/main/slices/agent-subscriptions/agent-subscriptions-selectors';
import { notifyPendingWorkClearedForAgent } from '../../agent/main/agent-process-registry';

// Re-export types that consumers need
export type { AgentEventFilter, AgentSubscriptionRecord } from '../../../store/main/slices/agent-subscriptions/agent-subscriptions-slice';
export type { AgentStatus } from '../../../store/main/slices/agent-subscriptions/types';

const logger = new Logger('AgentSubscriptionOps');

// ---------------------------------------------------------------------------
// Write operations (dispatch + side effects)
// ---------------------------------------------------------------------------

/** Subscribe an agent to events. Returns subscription ID (empty string if agent is deleted). */
export function agentSubscribe(
  workspaceId: string, agentId: string, agentName: string, filter: AgentEventFilter,
): string {
  if (selectIsAgentDeleted.select(getMainState(), workspaceId, agentId)) {
    logger.warn('Rejecting subscription for deleted agent', { agentId, agentName });
    return '';
  }
  const id = uuidv4();
  const record: AgentSubscriptionRecord = {
    id, agentId, agentName, workspaceId,
    filter: filter as AgentSubscriptionRecord['filter'],
    createdAt: new Date().toISOString(),
  };
  mainDispatch(addSubscription(workspaceId, record));
  if (filter.delegationGroup) {
    const g = filter.delegationGroup;
    if (!selectDelegationGroup.select(getMainState(), workspaceId, g.groupId)) {
      mainDispatch(setDelegationGroup(workspaceId, {
        groupId: g.groupId, parentAgentId: agentId, parentAgentName: agentName,
        awaitMode: g.awaitMode, expectedAgentIds: [...g.expectedAgentIds],
        completedAgentIds: [], deletedAgentIds: [], events: [],
        subscriptionId: id, delivered: false,
      }));
    }
  }
  mainDispatch(bumpVersion(workspaceId));
  logger.info('Agent subscribed', { subscriptionId: id, agentId, agentName });
  return id;
}

/**
 * Subscribe a delegated agent to an existing or new delegation group.
 *
 * All find-or-create decisions happen inside a single reducer case
 * (`subscribeToDelegationGroup`), so N concurrent callers targeting the
 * same `(parentAgentId, groupId)` pair end up with exactly one subscription
 * whose `actorIds` and `delegationGroup.expectedAgentIds` contain all N
 * delegated agents. Without this atomicity, concurrent callers could each
 * observe an empty snapshot and dispatch `addSubscription`, creating
 * duplicate subscriptions that would split child-completion events across
 * unrelated delegation-group trackers.
 */
export function agentSubscribeToGroup(
  workspaceId: string, parentAgentId: string, parentAgentName: string,
  groupId: string, delegatedAgentId: string,
): string {
  if (selectIsAgentDeleted.select(getMainState(), workspaceId, parentAgentId)) {
    logger.warn('Rejecting delegation-group subscription for deleted agent', {
      agentId: parentAgentId, groupId, delegatedAgentId,
    });
    return '';
  }
  const seed: AgentSubscriptionRecord = {
    id: uuidv4(),
    agentId: parentAgentId,
    agentName: parentAgentName,
    workspaceId,
    filter: {
      eventTypes: ['agent:idle', 'agent:completed', 'agent:failed', 'agent:deleted'],
      actorIds: [delegatedAgentId],
      priority: 'high',
      delegationGroup: { groupId, awaitMode: 'all', expectedAgentIds: [delegatedAgentId] },
    },
    createdAt: new Date().toISOString(),
  };
  mainDispatch(subscribeToDelegationGroup(workspaceId, seed));
  mainDispatch(bumpVersion(workspaceId));

  // Read the canonical subscription id after the reducer has run. It is
  // `seed.id` when we just created the subscription, or a prior caller's id
  // when we extended an existing one for the same group.
  const subs = selectAgentSubscriptions.select(getMainState(), workspaceId, parentAgentId);
  const canonical = subs.find(s => s.filter.delegationGroup?.groupId === groupId);
  const canonicalId = canonical?.id ?? seed.id;
  logger.info(
    canonicalId === seed.id
      ? 'Created delegation-group subscription'
      : 'Added agent to existing delegation-group subscription',
    { groupId, parentAgentId, delegatedAgentId, subscriptionId: canonicalId },
  );
  return canonicalId;
}

/** Unsubscribe a specific subscription. Returns true if found. */
export function agentUnsubscribe(
  workspaceId: string, subscriptionId: string,
  reason?: 'manual-unsubscribe' | 'oneshot-fired' | 'delegation-complete', groupId?: string,
): boolean {
  const ws = selectWorkspaceSubscriptionState.select(getMainState(), workspaceId);
  const sub = ws.subscriptions[subscriptionId];
  if (!sub) return false;
  mainDispatch(removeSubscription(workspaceId, subscriptionId));
  mainDispatch(bumpVersion(workspaceId));
  // Emit unsubscription event (saga can't do this — record already removed from state)
  mainDispatch(reduxEmitWorkspaceEvent(createWorkspaceEvent(
    'agent:unsubscribed', workspaceId,
    { type: 'agent', id: sub.agentId, name: sub.agentName },
    { agentId: sub.agentId, agentName: sub.agentName, subscriptionId, reason, groupId },
  )));
  logger.info('Agent unsubscribed', { subscriptionId, agentId: sub.agentId, reason, groupId });

  // If agent has no remaining subscriptions, notify process registry
  // so queued spawns waiting for a slot can re-evaluate
  try {
    const remaining = selectAgentSubscriptions.select(getMainState(), workspaceId, sub.agentId);
    if (remaining.length === 0) {
      notifyPendingWorkClearedForAgent(sub.agentId);
    }
  } catch (err) {
    // If we can't check remaining subscriptions, notify anyway to be safe
    // (false positive wake-up is harmless, missed wake-up blocks spawns)
    logger.warn('Failed to check remaining subscriptions after unsubscribe', {
      agentId: sub.agentId,
      subscriptionId,
      error: err instanceof Error ? err.message : String(err),
    });
    notifyPendingWorkClearedForAgent(sub.agentId);
  }
  return true;
}

/** Unsubscribe all subscriptions for an agent. Returns count removed. */
export function agentUnsubscribeAll(workspaceId: string, agentId: string): number {
  const subs = selectAgentSubscriptions.select(getMainState(), workspaceId, agentId);
  const count = subs.length;
  if (count > 0) {
    mainDispatch(removeAllSubscriptions(workspaceId, agentId));
    mainDispatch(bumpVersion(workspaceId));
    notifyPendingWorkClearedForAgent(agentId);
  }
  return count;
}

/** Update agent status and emit status-changed event if changed. */
export function updateAgentStatus(
  workspaceId: string, agentId: string, status: import('../../../store/main/slices/agent-subscriptions/types').AgentStatus,
): void {
  const prev = selectAgentStatus.select(getMainState(), workspaceId, agentId);
  mainDispatch(setAgentStatusAction(workspaceId, agentId, status));
  logger.debug('Agent status updated', { agentId, previousStatus: prev, status });
  if (prev !== status) {
    mainDispatch(reduxEmitWorkspaceEvent(createWorkspaceEvent(
      'agent:status-changed', workspaceId,
      { type: 'agent', id: agentId }, { agentId, previousStatus: prev, status },
    )));
  }
}

/** Mark agent as deleted and remove all its subscriptions. */
export function markAgentAsDeleted(workspaceId: string, agentId: string): void {
  mainDispatch(markAgentDeletedAction(workspaceId, agentId, Date.now()));
  logger.info('Agent marked as deleted', { agentId });
  const removedCount = agentUnsubscribeAll(workspaceId, agentId);
  logger.info('Cleaned up subscriptions for deleted agent', { agentId, removedSubscriptions: removedCount });
}

