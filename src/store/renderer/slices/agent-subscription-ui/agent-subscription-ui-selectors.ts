/**
 * Selectors for the agent-subscription-ui slice.
 */

import { store } from '../../store';
import { makeKey, emptyEntry } from './agent-subscription-ui-slice';
import { isAgentRunningState, toAgentRuntimeStateInput } from '$shared/utils/agent-runtime-state';
import type {
  AgentSubscriptionUIEntry,
  Subscription,
  DelegationGroupStatus,
  AgentStatus,
  WaitingState,
  WokenUpInfo,
} from './agent-subscription-ui-types';

// ---------------------------------------------------------------------------
// Internal helper
// ---------------------------------------------------------------------------

const selectEntry = store.createSelector<
  [workspaceId: string, agentId: string],
  AgentSubscriptionUIEntry
>((state, workspaceId, agentId) => {
  const key = makeKey(workspaceId, agentId);
  return state.agentSubscriptionUI.entries[key] ?? emptyEntry;
});

// ---------------------------------------------------------------------------
// Public selectors
// ---------------------------------------------------------------------------

/** All subscriptions for a given agent */
export const selectAgentSubscriptions = store.createSelector<
  [workspaceId: string, agentId: string],
  Subscription[]
>((state, workspaceId, agentId) => {
  return selectEntry.select(state, workspaceId, agentId).subscriptions;
});

/** Delegation groups for a given agent */
export const selectDelegationGroups = store.createSelector<
  [workspaceId: string, agentId: string],
  DelegationGroupStatus[]
>((state, workspaceId, agentId) => {
  return selectEntry.select(state, workspaceId, agentId).delegationGroups;
});

/** Latest daemon-reported status for each watched agent. */
export const selectAgentSubscriptionStatuses = store.createSelector<
  [workspaceId: string, agentId: string],
  Record<string, AgentStatus>
>((state, workspaceId, agentId) => {
  return selectEntry.select(state, workspaceId, agentId).agentStatuses;
});

/** Current waiting state ('idle' | 'waiting' | 'woken') */
export const selectWaitingState = store.createSelector<
  [workspaceId: string, agentId: string],
  WaitingState
>((state, workspaceId, agentId) => {
  return selectEntry.select(state, workspaceId, agentId).waitingState;
});

/** Woken-up info or null */
export const selectWokenUpInfo = store.createSelector<
  [workspaceId: string, agentId: string],
  WokenUpInfo | null
>((state, workspaceId, agentId) => {
  return selectEntry.select(state, workspaceId, agentId).wokenUpInfo;
});

export interface AgentSubscriptionLane {
  visible: boolean;
  count: number;
  participantAgentIds: string[];
}

function uniqueIds(ids: readonly string[]): string[] {
  return [...new Set(ids.filter(Boolean))];
}

/** Store-backed agent lane used even when the subscription card body is unmounted. */
export const selectAgentSubscriptionLane = store.createSelector<
  [workspaceId: string, agentId: string],
  AgentSubscriptionLane
>((state, workspaceId, agentId) => {
  const entry = selectEntry.select(state, workspaceId, agentId);
  const participantIds: string[] = [];
  const seenIds = new Set<string>();
  const addIds = (ids: readonly string[]) => {
    for (const id of uniqueIds(ids)) {
      if (seenIds.has(id)) continue;
      seenIds.add(id);
      participantIds.push(id);
    }
  };
  const subscriptions = [...entry.subscriptions].sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  );
  for (const subscription of subscriptions) {
    if (subscription.delegationGroup?.awaitMode !== 'all') addIds(subscription.actorIds);
  }
  const groupsById = new Map<string, DelegationGroupStatus>();
  for (const group of entry.delegationGroups) {
    if (group.awaitMode === 'all') groupsById.set(group.groupId, group);
  }
  for (const group of groupsById.values()) addIds(group.expectedAgentIds);
  for (const subscription of subscriptions) {
    const group = subscription.delegationGroup;
    if (group?.awaitMode === 'all' && !groupsById.has(group.groupId)) {
      addIds(group.expectedAgentIds);
    }
  }

  const completedIds = new Set<string>();
  for (const group of entry.delegationGroups) {
    for (const id of group.completedAgentIds) completedIds.add(id);
    for (const id of group.deletedAgentIds) completedIds.add(id);
    for (const [id, status] of Object.entries(group.agentStatuses)) {
      if (status === 'completed') completedIds.add(id);
    }
  }
  for (const [id, status] of Object.entries(entry.agentStatuses)) {
    if (status === 'completed') completedIds.add(id);
  }

  const sessionsById = state.agentSessions?.byAgentId ?? {};
  const finishedIds = new Set(
    [...completedIds].filter((id) => {
      const session = sessionsById[id];
      return !session || !isAgentRunningState(toAgentRuntimeStateInput(session));
    }),
  );
  const sourceIndex = new Map(participantIds.map((id, index) => [id, index]));
  const priority = (id: string): number => {
    const session = sessionsById[id];
    if (!session) return 2;
    if (session.attentionRequestKind === 'blocker') return 0;
    if (session.attentionRequestKind === 'discussion') return 1;
    if (finishedIds.has(id)) return 4;
    const status = String(session.status).toLowerCase();
    return status === 'responding' || status === 'active' || status === 'processing' ? 2 : 3;
  };
  const activeIds = participantIds
    .filter((id) => !finishedIds.has(id))
    .sort(
      (a, b) => priority(a) - priority(b) || (sourceIndex.get(a) ?? 0) - (sourceIndex.get(b) ?? 0),
    );

  return {
    visible:
      entry.waitingState === 'completed' || participantIds.length > 0 || entry.wokenUpInfo !== null,
    count: activeIds.length,
    participantAgentIds: activeIds,
  };
});

/**
 * Utility-footer readiness latch: true once an `agent.getSubscriptions`
 * snapshot read has settled (success OR failure) for this (workspace, agent).
 * A failed read counts as ready-with-empty so the footer readiness gate can
 * never wedge the transcript reveal on subscription data.
 */
export const selectSubscriptionSnapshotFetched = store.createSelector<
  [workspaceId: string, agentId: string],
  boolean
>((state, workspaceId, agentId) => {
  return selectEntry.select(state, workspaceId, agentId).snapshotFetched;
});

/**
 * All agent IDs that have entries in the subscription UI for a given workspace.
 * Used by sagas to refresh all tracked agents on system-level events.
 */
export const selectTrackedAgentIds = store.createSelector<[workspaceId: string], string[]>(
  (state, workspaceId) => {
    const prefix = `${workspaceId}:`;
    const agentIds: string[] = [];
    for (const key of Object.keys(state.agentSubscriptionUI.entries)) {
      if (key.startsWith(prefix)) {
        agentIds.push(key.slice(prefix.length));
      }
    }
    return agentIds;
  },
);

/**
 * Completion status across all delegation groups.
 * Returns { total, completed } counting all expected agents.
 */
export const selectCompletionStatus = store.createSelector<
  [workspaceId: string, agentId: string],
  { total: number; completed: number }
>((state, workspaceId, agentId) => {
  const groups = selectDelegationGroups.select(state, workspaceId, agentId);
  let total = 0;
  let completed = 0;
  for (const group of groups) {
    total += group.expectedAgentIds.length;
    completed += group.completedAgentIds.length + group.deletedAgentIds.length;
  }
  return { total, completed };
});
