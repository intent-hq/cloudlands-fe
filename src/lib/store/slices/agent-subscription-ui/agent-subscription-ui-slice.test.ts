import { describe, it, expect } from 'vitest';
import {
  agentSubscriptionUIReducer,
  initialState,
  emptyEntry,
  makeKey,
  setSubscriptionSnapshot,
  setWokenUp,
  clearWokenUp,
  resetSubscriptionUI,
} from './agent-subscription-ui-slice';
import {
  selectAgentSubscriptions,
  selectDelegationGroups,
  selectWaitingState,
  selectWokenUpInfo,
  selectShowSubscriptionRow,
  selectCompletionStatus,
} from './agent-subscription-ui-selectors';
import type { AgentSubscriptionUIState, Subscription, DelegationGroupStatus } from './agent-subscription-ui-types';

const WS = 'ws-1';
const AGENT = 'agent-1';

const sub: Subscription = {
  id: 'sub-1',
  agentId: AGENT,
  eventTypes: ['file:*'],
  actorIds: [],
  createdAt: '2026-01-01T00:00:00Z',
  description: 'Watch files',
};

const group: DelegationGroupStatus = {
  groupId: 'g-1',
  awaitMode: 'all',
  expectedAgentIds: ['a-1', 'a-2', 'a-3'],
  completedAgentIds: ['a-1'],
  deletedAgentIds: [],
  agentStatuses: { 'a-1': 'completed', 'a-2': 'responding', 'a-3': 'idle' },
  delivered: false,
};

function stateWith(slice: AgentSubscriptionUIState) {
  return { agentSubscriptionUI: slice } as any;
}

describe('agentSubscriptionUIReducer', () => {
  it('returns initial state', () => {
    expect(agentSubscriptionUIReducer(undefined, { type: '@@INIT' })).toEqual(initialState);
  });

  it('makeKey produces composite key', () => {
    expect(makeKey('ws', 'ag')).toBe('ws:ag');
  });


  describe('setSubscriptionSnapshot', () => {
    it('sets snapshot data for a new key', () => {
      const action = setSubscriptionSnapshot(WS, AGENT, {
        subscriptions: [sub],
        delegationGroups: [group],
        agentStatuses: { 'a-1': 'completed' },
        waitingState: 'waiting',
      });
      const state = agentSubscriptionUIReducer(initialState, action);
      const key = makeKey(WS, AGENT);
      expect(state.entries[key]).toBeDefined();
      expect(state.entries[key].subscriptions).toEqual([sub]);
      expect(state.entries[key].delegationGroups).toEqual([group]);
      expect(state.entries[key].waitingState).toBe('waiting');
    });

    it('overwrites existing snapshot data', () => {
      const first = agentSubscriptionUIReducer(
        initialState,
        setSubscriptionSnapshot(WS, AGENT, {
          subscriptions: [sub],
          delegationGroups: [],
          agentStatuses: {},
          waitingState: 'idle',
        }),
      );
      const second = agentSubscriptionUIReducer(
        first,
        setSubscriptionSnapshot(WS, AGENT, {
          subscriptions: [],
          delegationGroups: [group],
          agentStatuses: { x: 'idle' },
          waitingState: 'waiting',
        }),
      );
      const key = makeKey(WS, AGENT);
      expect(second.entries[key].subscriptions).toEqual([]);
      expect(second.entries[key].delegationGroups).toEqual([group]);
      expect(second.entries[key].waitingState).toBe('waiting');
    });
  });

  describe('setWokenUp', () => {
    it('sets woken state and info', () => {
      const info = { eventCount: 3, eventTypes: ['file:changed'], timestamp: 1000 };
      const state = agentSubscriptionUIReducer(initialState, setWokenUp(WS, AGENT, info));
      const key = makeKey(WS, AGENT);
      expect(state.entries[key].waitingState).toBe('woken');
      expect(state.entries[key].wokenUpInfo).toEqual(info);
    });
  });

  describe('clearWokenUp', () => {
    it('clears woken state back to idle when no subscriptions', () => {
      const info = { eventCount: 1, eventTypes: [], timestamp: 1000 };
      let state = agentSubscriptionUIReducer(initialState, setWokenUp(WS, AGENT, info));
      state = agentSubscriptionUIReducer(state, clearWokenUp(WS, AGENT));
      const key = makeKey(WS, AGENT);
      expect(state.entries[key].waitingState).toBe('idle');
      expect(state.entries[key].wokenUpInfo).toBeNull();
    });

    it('clears woken state back to waiting when subscriptions exist', () => {
      let state = agentSubscriptionUIReducer(
        initialState,
        setSubscriptionSnapshot(WS, AGENT, {
          subscriptions: [sub],
          delegationGroups: [],
          agentStatuses: {},
          waitingState: 'waiting',
        }),
      );
      const info = { eventCount: 1, eventTypes: [], timestamp: 1000 };
      state = agentSubscriptionUIReducer(state, setWokenUp(WS, AGENT, info));
      state = agentSubscriptionUIReducer(state, clearWokenUp(WS, AGENT));
      const key = makeKey(WS, AGENT);
      expect(state.entries[key].waitingState).toBe('waiting');
      expect(state.entries[key].wokenUpInfo).toBeNull();
    });

    it('clears woken state back to waiting when delegation groups exist', () => {
      let state = agentSubscriptionUIReducer(
        initialState,
        setSubscriptionSnapshot(WS, AGENT, {
          subscriptions: [],
          delegationGroups: [group],
          agentStatuses: {},
          waitingState: 'waiting',
        }),
      );
      const info = { eventCount: 1, eventTypes: [], timestamp: 1000 };
      state = agentSubscriptionUIReducer(state, setWokenUp(WS, AGENT, info));
      state = agentSubscriptionUIReducer(state, clearWokenUp(WS, AGENT));
      expect(state.entries[makeKey(WS, AGENT)].waitingState).toBe('waiting');
    });

    it('preserves waiting state if not woken', () => {
      let state = agentSubscriptionUIReducer(
        initialState,
        setSubscriptionSnapshot(WS, AGENT, {
          subscriptions: [],
          delegationGroups: [],
          agentStatuses: {},
          waitingState: 'waiting',
        }),
      );
      state = agentSubscriptionUIReducer(state, clearWokenUp(WS, AGENT));
      expect(state.entries[makeKey(WS, AGENT)].waitingState).toBe('waiting');
    });

    it('preserves completed state and does not override it', () => {
      let state = agentSubscriptionUIReducer(
        initialState,
        setSubscriptionSnapshot(WS, AGENT, {
          subscriptions: [],
          delegationGroups: [],
          agentStatuses: {},
          waitingState: 'completed',
        }),
      );
      state = agentSubscriptionUIReducer(state, clearWokenUp(WS, AGENT));
      expect(state.entries[makeKey(WS, AGENT)].waitingState).toBe('completed');
      expect(state.entries[makeKey(WS, AGENT)].wokenUpInfo).toBeNull();
    });

    it('returns same reference when key does not exist', () => {
      const state = agentSubscriptionUIReducer(initialState, clearWokenUp('no', 'exist'));
      expect(state).toBe(initialState);
    });
  });

  describe('resetSubscriptionUI', () => {
    it('removes the entry for the given key', () => {
      let state = agentSubscriptionUIReducer(
        initialState,
        setSubscriptionSnapshot(WS, AGENT, {
          subscriptions: [sub],
          delegationGroups: [],
          agentStatuses: {},
          waitingState: 'idle',
        }),
      );
      state = agentSubscriptionUIReducer(state, resetSubscriptionUI(WS, AGENT));
      expect(state.entries[makeKey(WS, AGENT)]).toBeUndefined();
    });

    it('returns same reference when key does not exist', () => {
      const state = agentSubscriptionUIReducer(initialState, resetSubscriptionUI('no', 'exist'));
      expect(state).toBe(initialState);
    });
  });
});

describe('agentSubscriptionUI selectors', () => {
  it('selectAgentSubscriptions returns subscriptions', () => {
    const key = makeKey(WS, AGENT);
    const slice: AgentSubscriptionUIState = {
      entries: { [key]: { ...emptyEntry, subscriptions: [sub] } },
    };
    expect(selectAgentSubscriptions.select(stateWith(slice), WS, AGENT)).toEqual([sub]);
  });

  it('selectDelegationGroups returns groups', () => {
    const key = makeKey(WS, AGENT);
    const slice: AgentSubscriptionUIState = {
      entries: { [key]: { ...emptyEntry, delegationGroups: [group] } },
    };
    expect(selectDelegationGroups.select(stateWith(slice), WS, AGENT)).toEqual([group]);
  });

  it('selectWaitingState returns state or idle for missing entries', () => {
    expect(selectWaitingState.select(stateWith(initialState), WS, AGENT)).toBe('idle');
  });

  it('selectWokenUpInfo returns null for missing entries', () => {
    expect(selectWokenUpInfo.select(stateWith(initialState), WS, AGENT)).toBeNull();
  });

  it('selectShowSubscriptionRow returns true when subscriptions exist', () => {
    const key = makeKey(WS, AGENT);
    const slice: AgentSubscriptionUIState = {
      entries: { [key]: { ...emptyEntry, subscriptions: [sub] } },
    };
    expect(selectShowSubscriptionRow.select(stateWith(slice), WS, AGENT)).toBe(true);
  });

  it('selectShowSubscriptionRow returns false when empty', () => {
    expect(selectShowSubscriptionRow.select(stateWith(initialState), WS, AGENT)).toBe(false);
  });

  it('selectShowSubscriptionRow returns true when waitingState is completed', () => {
    const key = makeKey(WS, AGENT);
    const slice: AgentSubscriptionUIState = {
      entries: { [key]: { ...emptyEntry, waitingState: 'completed' } },
    };
    expect(selectShowSubscriptionRow.select(stateWith(slice), WS, AGENT)).toBe(true);
  });

  it('selectWaitingState returns completed when set', () => {
    const key = makeKey(WS, AGENT);
    const slice: AgentSubscriptionUIState = {
      entries: { [key]: { ...emptyEntry, waitingState: 'completed' } },
    };
    expect(selectWaitingState.select(stateWith(slice), WS, AGENT)).toBe('completed');
  });

  it('selectCompletionStatus aggregates across groups', () => {
    const key = makeKey(WS, AGENT);
    const g2: DelegationGroupStatus = {
      groupId: 'g-2',
      awaitMode: 'all',
      expectedAgentIds: ['b-1', 'b-2'],
      completedAgentIds: ['b-1', 'b-2'],
      deletedAgentIds: [],
      agentStatuses: { 'b-1': 'completed', 'b-2': 'completed' },
      delivered: true,
    };
    const slice: AgentSubscriptionUIState = {
      entries: { [key]: { ...emptyEntry, delegationGroups: [group, g2] } },
    };
    const result = selectCompletionStatus.select(stateWith(slice), WS, AGENT);
    expect(result).toEqual({ total: 5, completed: 3 });
  });

  it('selectCompletionStatus returns zeros when no groups', () => {
    expect(selectCompletionStatus.select(stateWith(initialState), WS, AGENT)).toEqual({
      total: 0,
      completed: 0,
    });
  });
});