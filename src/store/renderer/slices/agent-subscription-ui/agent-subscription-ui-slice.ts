/**
 * Agent Subscription UI Slice
 *
 * Manages renderer-side UI state for agent event subscriptions,
 * delegation groups, and woken-up indicators.
 */

import { createAction, createAsyncAction } from '@augmentcode/themis/utils/store/create-action';
import { createReducer } from '@augmentcode/themis/utils/store/create-reducer';
import { markAgentAsViewed } from '../unread-tracking/unread-tracking-slice';
import type {
  AgentSubscriptionUIState,
  AgentSubscriptionUIEntry,
  AgentStatus,
  Subscription,
  DelegationGroupStatus,
  WokenUpInfo,
} from './agent-subscription-ui-types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function makeKey(workspaceId: string, agentId: string): string {
  return `${workspaceId}:${agentId}`;
}

export const emptyEntry: AgentSubscriptionUIEntry = {
  subscriptions: [],
  delegationGroups: [],
  agentStatuses: {},
  waitingState: 'idle',
  wokenUpInfo: null,
  snapshotFetched: false,
};

export const initialState: AgentSubscriptionUIState = {
  entries: {},
};

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export const setSubscriptionSnapshot = createAction(
  'agentSubscriptionUI/setSubscriptionSnapshot',
  (
    workspaceId: string,
    agentId: string,
    data: {
      subscriptions: Subscription[];
      delegationGroups: DelegationGroupStatus[];
      agentStatuses: Record<string, AgentStatus>;
      waitingState: 'idle' | 'waiting' | 'woken' | 'completed';
    },
  ) => ({ workspaceId, agentId, data }),
);

export const setWokenUp = createAction(
  'agentSubscriptionUI/setWokenUp',
  (workspaceId: string, agentId: string, info: WokenUpInfo) => ({
    workspaceId,
    agentId,
    info,
  }),
);

export const clearWokenUp = createAction<[workspaceId: string, agentId: string]>(
  'agentSubscriptionUI/clearWokenUp',
);

export const resetSubscriptionUI = createAction<[workspaceId: string, agentId: string]>(
  'agentSubscriptionUI/resetSubscriptionUI',
);

export const deleteSubscriptionUI = createAction<[workspaceId: string, agentId: string]>(
  'agentSubscriptionUI/deleteSubscriptionUI',
);

/**
 * Optimistically drop a (soft-)deleted agent from every subscription-UI entry
 * in the workspace: watch actorIds, delegation-group membership, and status
 * rows. Multi-actor watches/groups survive with the deleted agent pruned;
 * entries that become empty return to idle if they were waiting.
 */
export const removeWatchedAgent = createAction<[workspaceId: string, watchedAgentId: string]>(
  'agentSubscriptionUI/removeWatchedAgent',
);

/** Dispatched by the AgentSubscriptions component to request an initial fetch
 *  when the component mounts or the agentId changes. The saga handles the
 *  actual IPC call so no side effects live in the component. */
export const requestSubscriptionFetch = createAction<[workspaceId: string, agentId: string]>(
  'agentSubscriptionUI/requestSubscriptionFetch',
);

/** Saga → reducer: a snapshot read failed. Latches `snapshotFetched` so the
 *  utility-footer readiness gate treats the failure as ready-with-empty and
 *  never wedges the transcript reveal on subscription data. */
export const subscriptionSnapshotFetchFailed = createAction<[workspaceId: string, agentId: string]>(
  'agentSubscriptionUI/subscriptionSnapshotFetchFailed',
);

export const cancelAgentSubscriptionsRequested = createAsyncAction<
  [workspaceId: string, agentId: string, scope?: { subscriptionId?: string; groupId?: string }],
  void
>(
  'agentSubscriptionUI/cancelAgentSubscriptions',
  'agentSubscriptionUI/cancelAgentSubscriptionsRequested',
);

/** Refresh every subscription entry currently tracked for a workspace. */
export const refreshWorkspaceSubscriptionEntriesRequested = createAction<[workspaceId: string]>(
  'agentSubscriptionUI/refreshWorkspaceSubscriptionEntriesRequested',
);

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export const agentSubscriptionUIReducer = createReducer<AgentSubscriptionUIState>(initialState);
agentSubscriptionUIReducer.with(setSubscriptionSnapshot, (state, { payload }) => {
  const key = makeKey(payload.workspaceId, payload.agentId);
  const existing = state.entries[key] ?? emptyEntry;
  return {
    ...state,
    entries: {
      ...state.entries,
      [key]: {
        ...existing,
        subscriptions: payload.data.subscriptions,
        delegationGroups: payload.data.delegationGroups,
        agentStatuses: payload.data.agentStatuses,
        waitingState: payload.data.waitingState,
        snapshotFetched: true,
      },
    },
  };
});
agentSubscriptionUIReducer.with(
  subscriptionSnapshotFetchFailed,
  (state, { payload: [workspaceId, agentId] }) => {
    const key = makeKey(workspaceId, agentId);
    const existing = state.entries[key] ?? emptyEntry;
    if (existing.snapshotFetched) return state;
    return {
      ...state,
      entries: {
        ...state.entries,
        [key]: {
          ...existing,
          snapshotFetched: true,
        },
      },
    };
  },
);
// Switch-back freshness: drop the readiness latch the moment the agent is
// (re)viewed, so an armed utility-footer reveal gate waits for the VIEW-TIME
// `agent.getSubscriptions` read (the read saga starts it on this same action)
// instead of clearing on a cached snapshot that a post-reveal refresh would
// then update. The fresh read re-latches on success AND failure, and the
// reveal gate's bounded fallback caps a slow read — this can never wedge.
// The payload carries only the agentId; entries are keyed `${wsId}:${agentId}`,
// so every workspace entry of the agent drops (an agent has one workspace).
agentSubscriptionUIReducer.with(markAgentAsViewed, (state, { payload: [agentId] }) => {
  const suffix = `:${agentId}`;
  let changed = false;
  const entries = { ...state.entries };
  for (const [key, entry] of Object.entries(state.entries)) {
    if (!key.endsWith(suffix) || !entry.snapshotFetched) continue;
    changed = true;
    entries[key] = { ...entry, snapshotFetched: false };
  }
  return changed ? { ...state, entries } : state;
});
agentSubscriptionUIReducer.with(setWokenUp, (state, { payload }) => {
  const key = makeKey(payload.workspaceId, payload.agentId);
  const existing = state.entries[key] ?? emptyEntry;
  return {
    ...state,
    entries: {
      ...state.entries,
      [key]: {
        ...existing,
        waitingState: 'woken',
        wokenUpInfo: payload.info,
      },
    },
  };
});
agentSubscriptionUIReducer.with(clearWokenUp, (state, { payload: [workspaceId, agentId] }) => {
  const key = makeKey(workspaceId, agentId);
  const existing = state.entries[key];
  if (!existing) return state;
  // Don't override 'completed' state — let the cleanup timer handle it
  if (existing.waitingState === 'completed') {
    return {
      ...state,
      entries: {
        ...state.entries,
        [key]: {
          ...existing,
          wokenUpInfo: null,
        },
      },
    };
  }
  return {
    ...state,
    entries: {
      ...state.entries,
      [key]: {
        ...existing,
        waitingState:
          existing.waitingState === 'woken'
            ? existing.subscriptions.length > 0 || existing.delegationGroups.length > 0
              ? 'waiting'
              : 'idle'
            : existing.waitingState,
        wokenUpInfo: null,
      },
    },
  };
});
agentSubscriptionUIReducer.with(
  resetSubscriptionUI,
  (state, { payload: [workspaceId, agentId] }) => {
    const key = makeKey(workspaceId, agentId);
    const existing = state.entries[key];
    if (!existing) return state;
    // STAB-23: keep an idle entry instead of deleting so future
    // refreshWorkspaceSubscriptionEntries fan-outs still reach this agent.
    // Actual deletion happens on workspace deleted (via deleteSubscriptionUI).
    // The snapshotFetched readiness latch survives the reset: the reset means
    // "back to empty", which is still a settled snapshot.
    return {
      ...state,
      entries: {
        ...state.entries,
        [key]: {
          ...emptyEntry,
          waitingState: 'idle',
          snapshotFetched: existing.snapshotFetched,
        },
      },
    };
  },
);
agentSubscriptionUIReducer.with(
  deleteSubscriptionUI,
  (state, { payload: [workspaceId, agentId] }) => {
    const key = makeKey(workspaceId, agentId);
    if (!state.entries[key]) return state;
    const { [key]: _, ...rest } = state.entries;
    return {
      ...state,
      entries: rest,
    };
  },
);
agentSubscriptionUIReducer.with(
  removeWatchedAgent,
  (state, { payload: [workspaceId, watchedAgentId] }) => {
    const prefix = `${workspaceId}:`;
    let changed = false;
    const entries = { ...state.entries };

    for (const [key, entry] of Object.entries(state.entries)) {
      if (!key.startsWith(prefix)) continue;

      let subsChanged = false;
      const subscriptions: Subscription[] = [];
      for (const sub of entry.subscriptions) {
        if (!sub.actorIds.includes(watchedAgentId)) {
          subscriptions.push(sub);
          continue;
        }
        subsChanged = true;
        const actorIds = sub.actorIds.filter((id) => id !== watchedAgentId);
        if (actorIds.length > 0) subscriptions.push({ ...sub, actorIds });
      }

      let groupsChanged = false;
      const delegationGroups: DelegationGroupStatus[] = [];
      for (const group of entry.delegationGroups) {
        const touchesGroup =
          group.expectedAgentIds.includes(watchedAgentId) ||
          group.completedAgentIds.includes(watchedAgentId) ||
          group.deletedAgentIds.includes(watchedAgentId) ||
          watchedAgentId in group.agentStatuses;
        if (!touchesGroup) {
          delegationGroups.push(group);
          continue;
        }
        groupsChanged = true;
        const expectedAgentIds = group.expectedAgentIds.filter((id) => id !== watchedAgentId);
        if (expectedAgentIds.length === 0) continue;
        const { [watchedAgentId]: _droppedGroupStatus, ...agentStatuses } = group.agentStatuses;
        delegationGroups.push({
          ...group,
          expectedAgentIds,
          completedAgentIds: group.completedAgentIds.filter((id) => id !== watchedAgentId),
          deletedAgentIds: group.deletedAgentIds.filter((id) => id !== watchedAgentId),
          agentStatuses,
        });
      }

      const statusChanged = watchedAgentId in entry.agentStatuses;
      if (!subsChanged && !groupsChanged && !statusChanged) continue;

      const agentStatuses = statusChanged
        ? Object.fromEntries(
            Object.entries(entry.agentStatuses).filter(([agentId]) => agentId !== watchedAgentId),
          )
        : entry.agentStatuses;
      const finalSubs = subsChanged ? subscriptions : entry.subscriptions;
      const finalGroups = groupsChanged ? delegationGroups : entry.delegationGroups;
      changed = true;
      entries[key] = {
        ...entry,
        subscriptions: finalSubs,
        delegationGroups: finalGroups,
        agentStatuses,
        waitingState:
          entry.waitingState === 'waiting' && finalSubs.length === 0 && finalGroups.length === 0
            ? 'idle'
            : entry.waitingState,
      };
    }

    return changed ? { ...state, entries } : state;
  },
);
