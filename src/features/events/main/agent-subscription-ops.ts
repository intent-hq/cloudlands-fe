/**
 * Agent Subscription Operations — standalone functions over the canonical
 * process-local subscription state service.
 *
 * The daemon remains authoritative for renderer reads. This compatibility path
 * owns only the main-process subscription operations and their local snapshot.
 */
import { v4 as uuidv4 } from 'uuid';
import { Logger } from '../../../shared/logger';
import { createWorkspaceEvent } from '../types';
import type { CanonicalAgentStatusFields } from '../types';
import {
  agentSubscriptionState,
  getAgentSubscriptions,
  getAgentSubscriptionStatus,
  getWorkspaceSubscriptionState,
  isAgentDeleted,
} from './agent-subscription-state.service';
import type {
  AgentEventFilter,
  AgentSubscriptionRecord,
} from '../../../store/main/slices/agent-subscriptions/types';
import { mainDispatch } from '../../../store/main/redux-store-bridge';
import { emitWorkspaceEvent as reduxEmitWorkspaceEvent } from '../../../store/main/slices/workspace-events/workspace-events-slice';
import { notifyPendingWorkClearedForAgent } from '../../agent/main/agent-process-registry';

// Re-export types that consumers need
export type {
  AgentEventFilter,
  AgentSubscriptionRecord,
} from '../../../store/main/slices/agent-subscriptions/agent-subscriptions-slice';
export type { AgentStatus } from '../../../store/main/slices/agent-subscriptions/types';

const logger = new Logger('AgentSubscriptionOps');

function canonicalFieldsForStatus(
  status: import('../../../store/main/slices/agent-subscriptions/types').AgentStatus,
): CanonicalAgentStatusFields {
  switch (status) {
    case 'responding':
      return {
        status,
        activationState: 'active',
        isActive: true,
        isStreaming: true,
        isProcessing: true,
        isResponding: true,
        stopReason: null,
      };
    case 'waiting':
      return {
        status,
        activationState: 'active',
        isActive: true,
        isStreaming: false,
        isProcessing: true,
        isResponding: false,
        stopReason: null,
      };
    case 'idle':
    case 'completed':
    case 'failed':
      return {
        status,
        activationState: status === 'failed' ? 'error' : null,
        isActive: false,
        isStreaming: false,
        isProcessing: false,
        isResponding: false,
        stopReason: status === 'idle' ? null : status,
      };
    default:
      return {
        status,
        activationState: null,
        isActive: null,
        isStreaming: null,
        isProcessing: null,
        isResponding: null,
        stopReason: null,
      };
  }
}

// ---------------------------------------------------------------------------
// Write operations (dispatch + side effects)
// ---------------------------------------------------------------------------

/** Subscribe an agent to events. Returns subscription ID (empty string if agent is deleted). */
export function agentSubscribe(
  workspaceId: string,
  agentId: string,
  agentName: string,
  filter: AgentEventFilter,
): string {
  if (isAgentDeleted(workspaceId, agentId)) {
    logger.warn('Rejecting subscription for deleted agent', { agentId, agentName });
    return '';
  }
  const id = uuidv4();
  const record: AgentSubscriptionRecord = {
    id,
    agentId,
    agentName,
    workspaceId,
    filter: filter as AgentSubscriptionRecord['filter'],
    createdAt: new Date().toISOString(),
  };
  agentSubscriptionState.add(workspaceId, record);
  if (filter.delegationGroup) {
    const g = filter.delegationGroup;
    if (!getWorkspaceSubscriptionState(workspaceId).delegationGroups[g.groupId]) {
      agentSubscriptionState.setDelegationGroup(workspaceId, {
        groupId: g.groupId,
        parentAgentId: agentId,
        parentAgentName: agentName,
        awaitMode: g.awaitMode,
        expectedAgentIds: [...g.expectedAgentIds],
        completedAgentIds: [],
        deletedAgentIds: [],
        events: [],
        subscriptionId: id,
        delivered: false,
      });
    }
  }
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
  workspaceId: string,
  parentAgentId: string,
  parentAgentName: string,
  groupId: string,
  delegatedAgentId: string,
): string {
  if (isAgentDeleted(workspaceId, parentAgentId)) {
    logger.warn('Rejecting delegation-group subscription for deleted agent', {
      agentId: parentAgentId,
      groupId,
      delegatedAgentId,
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
  agentSubscriptionState.subscribeToGroup(workspaceId, seed);

  // Read the canonical subscription id after the reducer has run. It is
  // `seed.id` when we just created the subscription, or a prior caller's id
  // when we extended an existing one for the same group.
  const subs = getAgentSubscriptions(workspaceId, parentAgentId);
  const canonical = subs.find((s) => s.filter.delegationGroup?.groupId === groupId);
  const canonicalId = canonical?.id ?? seed.id;
  logger.info(
    canonicalId === seed.id
      ? 'Created delegation-group subscription' // i18n-ignore (developer log message)
      : 'Added agent to existing delegation-group subscription', // i18n-ignore (developer log message)
    { groupId, parentAgentId, delegatedAgentId, subscriptionId: canonicalId },
  );
  return canonicalId;
}

/** Unsubscribe a specific subscription. Returns true if found. */
export function agentUnsubscribe(
  workspaceId: string,
  subscriptionId: string,
  reason?: 'manual-unsubscribe' | 'delegation-complete',
  groupId?: string,
): boolean {
  const ws = getWorkspaceSubscriptionState(workspaceId);
  const sub = ws.subscriptions[subscriptionId];
  if (!sub) return false;
  agentSubscriptionState.remove(workspaceId, subscriptionId);
  mainDispatch(
    reduxEmitWorkspaceEvent(
      createWorkspaceEvent(
        'agent:unsubscribed',
        workspaceId,
        { type: 'agent', id: sub.agentId, name: sub.agentName },
        { agentId: sub.agentId, agentName: sub.agentName, subscriptionId, reason, groupId },
      ),
    ),
  );
  logger.info('Agent unsubscribed', { subscriptionId, agentId: sub.agentId, reason, groupId });

  // If agent has no remaining subscriptions, notify process registry
  // so queued spawns waiting for a slot can re-evaluate
  try {
    const remaining = getAgentSubscriptions(workspaceId, sub.agentId);
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
  const subs = getAgentSubscriptions(workspaceId, agentId);
  const count = subs.length;
  if (count > 0) {
    agentSubscriptionState.removeAll(workspaceId, agentId);
    notifyPendingWorkClearedForAgent(agentId);
  }
  return count;
}

/** Update agent status and emit status-changed event if changed. */
export function updateAgentStatus(
  workspaceId: string,
  agentId: string,
  status: import('../../../store/main/slices/agent-subscriptions/types').AgentStatus,
  canonicalFields: Partial<CanonicalAgentStatusFields> = {},
): void {
  const prev = getAgentSubscriptionStatus(workspaceId, agentId);
  agentSubscriptionState.setStatus(workspaceId, agentId, status);
  logger.debug('Agent status updated', { agentId, previousStatus: prev, status });
  if (prev !== status) {
    const data = {
      agentId,
      previousStatus: prev,
      ...canonicalFieldsForStatus(status),
      ...canonicalFields,
      status,
    };
    mainDispatch(
      reduxEmitWorkspaceEvent(
        createWorkspaceEvent(
          'agent:status-changed',
          workspaceId,
          { type: 'agent', id: agentId },
          data,
        ),
      ),
    );
  }
}

/** Mark agent as deleted and remove all its subscriptions. */
export function markAgentAsDeleted(workspaceId: string, agentId: string): void {
  agentSubscriptionState.markDeleted(workspaceId, agentId, Date.now());
  logger.info('Agent marked as deleted', { agentId });
  const removedCount = agentUnsubscribeAll(workspaceId, agentId);
  logger.info('Cleaned up subscriptions for deleted agent', {
    agentId,
    removedSubscriptions: removedCount,
  });
}
