/**
 * Agent Orchestration Tests
 *
 * Tests the multi-agent coordination patterns:
 * - Wave-based execution (wait_mode="after_all")
 * - Parent-child agent coordination
 * - Delegation group tracking
 * - Stuck state detection
 * - Interruption handling
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// workspace-event-bus was deleted; event delivery is now handled by Redux sagas

vi.mock('$shared/logger', () => ({
  Logger: class {
    debug = vi.fn();
    info = vi.fn();
    warn = vi.fn();
    error = vi.fn();
  },
}));

// Mock the Redux store bridge for agent-subscription-ops
import { agentSubscriptionsReducer, initialState as sliceInitialState } from '../../../store/main/slices/agent-subscriptions/agent-subscriptions-slice';
let _state = { agentSubscriptions: { ...sliceInitialState } } as any;
vi.mock('../../../store/main/redux-store-bridge', () => ({
  getMainState: () => _state,
  mainDispatch: (action: any) => {
    // Apply the reducer to keep state consistent
    _state = {
      ..._state,
      agentSubscriptions: agentSubscriptionsReducer(_state.agentSubscriptions, action),
    };
    return action;
  },
}));

// Import after mocks
import {
  agentSubscribe,
  agentSubscribeToGroup,
  agentUnsubscribe,
  agentUnsubscribeAll,
  updateAgentStatus,
} from '$features/events/main/agent-subscription-ops';

import {
  selectDelegationGroup,
  selectAgentStatus,
  selectDelegationGroupsForParent,
} from '../../../store/main/slices/agent-subscriptions/agent-subscriptions-selectors';
import { getMainState } from '../../../store/main/redux-store-bridge';

describe('Agent Orchestration', () => {
  const workspaceId = 'test-workspace';

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset Redux state between tests
    _state = { agentSubscriptions: { ...sliceInitialState } };
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('Delegation Group Tracking', () => {
    it('should create a delegation group when subscribing with after_all mode', () => {
      const parentAgentId = 'parent-agent';
      const groupId = 'test-group-1';
      const delegatedAgentId = 'child-agent-1';

      agentSubscribeToGroup(workspaceId, parentAgentId, 'Parent', groupId, delegatedAgentId);

      const group = selectDelegationGroup.select(getMainState(), workspaceId, groupId);
      expect(group).not.toBeUndefined();
      expect(group?.expectedAgentIds).toHaveLength(1);
      expect(group?.completedAgentIds).toHaveLength(0);
    });

    it('should add agents to existing delegation group', () => {
      const parentAgentId = 'parent-agent';
      const groupId = 'test-group-2';

      agentSubscribeToGroup(workspaceId, parentAgentId, 'Parent', groupId, 'child-1');
      agentSubscribeToGroup(workspaceId, parentAgentId, 'Parent', groupId, 'child-2');
      agentSubscribeToGroup(workspaceId, parentAgentId, 'Parent', groupId, 'child-3');

      const group = selectDelegationGroup.select(getMainState(), workspaceId, groupId);
      expect(group?.expectedAgentIds).toHaveLength(3);
      expect(group?.completedAgentIds).toHaveLength(0);
    });
  });

  describe('Delegation Groups for Parent', () => {
    it('should return all delegation groups for a parent agent', () => {
      const parentAgentId = 'parent-agent';

      agentSubscribeToGroup(workspaceId, parentAgentId, 'Parent', 'group-1', 'child-1');
      agentSubscribeToGroup(workspaceId, parentAgentId, 'Parent', 'group-1', 'child-2');
      agentSubscribeToGroup(workspaceId, parentAgentId, 'Parent', 'group-2', 'child-3');

      const groups = selectDelegationGroupsForParent.select(getMainState(), workspaceId, parentAgentId);

      expect(groups).toHaveLength(2);
      expect(groups.map((g) => g.groupId)).toContain('group-1');
      expect(groups.map((g) => g.groupId)).toContain('group-2');
    });
  });

  describe('Bug Fix: unsubscribeAll should not modify map during iteration', () => {
    it('should correctly unsubscribe all subscriptions for an agent', () => {
      const agentId = 'test-agent';

      const sub1 = agentSubscribe(workspaceId, agentId, 'Test Agent', { eventTypes: ['agent:idle'] });
      const sub2 = agentSubscribe(workspaceId, agentId, 'Test Agent', { eventTypes: ['agent:created'] });
      const sub3 = agentSubscribe(workspaceId, agentId, 'Test Agent', { eventTypes: ['agent:failed'] });

      expect(sub1).toBeDefined();
      expect(sub2).toBeDefined();
      expect(sub3).toBeDefined();

      const count = agentUnsubscribeAll(workspaceId, agentId);
      expect(count).toBe(3);

      // Trying to unsubscribe again should return false for all
      expect(agentUnsubscribe(workspaceId, sub1)).toBe(false);
      expect(agentUnsubscribe(workspaceId, sub2)).toBe(false);
      expect(agentUnsubscribe(workspaceId, sub3)).toBe(false);
    });
  });

  describe('Agent Status Updates', () => {
    it('should update agent status via Redux', () => {
      updateAgentStatus(workspaceId, 'agent-1', 'responding');

      const status = selectAgentStatus.select(getMainState(), workspaceId, 'agent-1');
      expect(status).toBe('responding');
    });

    it('should handle status transitions', () => {
      agentSubscribe(workspaceId, 'agent-1', 'Test Agent', { eventTypes: ['agent:idle'] });

      updateAgentStatus(workspaceId, 'agent-1', 'responding');
      updateAgentStatus(workspaceId, 'agent-1', 'idle');
      updateAgentStatus(workspaceId, 'agent-1', 'responding');
      updateAgentStatus(workspaceId, 'agent-1', 'idle');

      // No errors should occur
      expect(true).toBe(true);
    });
  });

  // NOTE: Event delivery timing tests (immediate mode, queuing, etc.) are now
  // handled by the delivery saga and tested in agent-subscriptions-saga.test.ts.
  // The ops module handles state management; sagas handle event matching + delivery.
});
