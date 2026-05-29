/**
 * Agent Subscription UI Slice
 *
 * Manages renderer-side UI state for agent event subscriptions,
 * delegation groups, and woken-up indicators.
 */

import { createAction } from 'svelte-redux-toolkit/utils/store/create-action';
import { createReducer } from 'svelte-redux-toolkit/utils/store/create-reducer';
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

/** Dispatched by the AgentSubscriptions component to request an initial fetch
 *  when the component mounts or the agentId changes. The saga handles the
 *  actual IPC call so no side effects live in the component. */
export const requestSubscriptionFetch = createAction<[workspaceId: string, agentId: string]>(
  'agentSubscriptionUI/requestSubscriptionFetch',
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
    if (!state.entries[key]) return state;
    const { [key]: _, ...rest } = state.entries;
    return {
      ...state,
      entries: rest,
    };
  });
