/**
 * Agent Subscription UI Slice
 *
 * Manages renderer-side UI state for agent event subscriptions,
 * delegation groups, and woken-up indicators.
 */

import { createAction, createAsyncAction } from '$lib/store-shim/utils/store/create-action';
import { createReducer } from '$lib/store-shim/utils/store/create-reducer';
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
 * in the workspace: one-shot watches on it, its membership in delegation
 * groups (a group whose expectedAgentIds empties is dropped), and its status
 * rows. Dispatched by the agent-deletion soft-hide; on undo the daemon's
 * still-live watch repopulates via a workspace refetch.
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

/**
 * Cancel the agent's completion watches / delegation groups via
 * `agent.cancelSubscriptions` (PROTOCOL §5.5). `scope.subscriptionId` cancels
 * exactly one completion watch; `scope.groupId` cancels one delegation group
 * plus its grouped watches; omitting both cancels everything the agent
 * registered. Handled by the agent mutation middleware — the daemon's
 * `agent:subscriptions-changed` event (§6.5) drives the UI refetch, so no
 * reducer case mutates the local entry.
 */
export const cancelAgentSubscriptionsRequested = createAsyncAction<[
  workspaceId: string,
  agentId: string,
  scope?: { subscriptionId?: string; groupId?: string },
], void>(
  'agentSubscriptionUI/cancelAgentSubscriptions',
  'agentSubscriptionUI/cancelAgentSubscriptionsRequested',
);

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export const agentSubscriptionUIReducer = createReducer<AgentSubscriptionUIState>(initialState)
  .with(setSubscriptionSnapshot, (state, { payload }) => {
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
        },
      },
    };
  })
  .with(setWokenUp, (state, { payload }) => {
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
  })
  .with(clearWokenUp, (state, { payload: [workspaceId, agentId] }) => {
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
          waitingState: existing.waitingState === 'woken'
            ? (existing.subscriptions.length > 0 || existing.delegationGroups.length > 0 ? 'waiting' : 'idle')
            : existing.waitingState,
          wokenUpInfo: null,
        },
      },
    };
  })
  .with(resetSubscriptionUI, (state, { payload: [workspaceId, agentId] }) => {
    const key = makeKey(workspaceId, agentId);
    const existing = state.entries[key];
    if (!existing) return state;
    // STAB-23: keep an idle entry instead of deleting so future
    // refreshWorkspaceSubscriptionEntries fan-outs still reach this agent.
    // Actual deletion happens on workspace deleted (via deleteSubscriptionUI).
    return {
      ...state,
      entries: {
        ...state.entries,
        [key]: {
          ...emptyEntry,
          waitingState: 'idle',
        },
      },
    };
  })
  .with(deleteSubscriptionUI, (state, { payload: [workspaceId, agentId] }) => {
    const key = makeKey(workspaceId, agentId);
    if (!state.entries[key]) return state;
    const { [key]: _, ...rest } = state.entries;
    return {
      ...state,
      entries: rest,
    };
  })
  .with(removeWatchedAgent, (state, { payload: [workspaceId, watchedAgentId] }) => {
    const prefix = `${workspaceId}:`;
    let changed = false;
    const entries = { ...state.entries };
    for (const [key, entry] of Object.entries(state.entries)) {
      if (!key.startsWith(prefix)) continue;

      const subscriptions = entry.subscriptions.filter(
        (sub) => !sub.actorIds.includes(watchedAgentId),
      );
      const subsChanged = subscriptions.length !== entry.subscriptions.length;

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
        // Drop a group whose expected membership emptied out.
        if (expectedAgentIds.length === 0) continue;
        const { [watchedAgentId]: _droppedGroupStatus, ...groupStatuses } = group.agentStatuses;
        delegationGroups.push({
          ...group,
          expectedAgentIds,
          completedAgentIds: group.completedAgentIds.filter((id) => id !== watchedAgentId),
          deletedAgentIds: group.deletedAgentIds.filter((id) => id !== watchedAgentId),
          agentStatuses: groupStatuses,
        });
      }

      const statusChanged = watchedAgentId in entry.agentStatuses;
      if (!subsChanged && !groupsChanged && !statusChanged) continue;

      let agentStatuses = entry.agentStatuses;
      if (statusChanged) {
        const { [watchedAgentId]: _droppedStatus, ...rest } = entry.agentStatuses;
        agentStatuses = rest;
      }
      const finalGroups = groupsChanged ? delegationGroups : entry.delegationGroups;
      const finalSubs = subsChanged ? subscriptions : entry.subscriptions;
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
  });
