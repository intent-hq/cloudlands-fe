/**
 * Integration Tests for Agent Interaction System
 *
 * Tests the subscription operations (subscribe, unsubscribe, status) via
 * the standalone ops functions backed by the Redux store.
 *
 * Event delivery is now handled by sagas and tested in
 * agent-subscriptions-saga.test.ts.
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  vi,
  afterEach,
} from 'vitest';

// Mock logger
vi.mock('$shared/logger', () => ({
  Logger: class {
    debug = vi.fn();
    info = vi.fn();
    warn = vi.fn();
    error = vi.fn();
  },
}));

// Set up in-memory Redux store
import {
  agentSubscriptionsReducer,
  initialState as sliceInitialState,
} from '../../../../store/main/slices/agent-subscriptions/agent-subscriptions-slice';
let _state = { agentSubscriptions: { ...sliceInitialState } } as any;
vi.mock('../../../../store/main/redux-store-bridge', () => ({
  getMainState: () => _state,
  mainDispatch: (action: any) => {
    _state = {
      ..._state,
      agentSubscriptions: agentSubscriptionsReducer(_state.agentSubscriptions, action),
    };
    return action;
  },
}));

import {
  agentSubscribe,
  agentUnsubscribe,
  updateAgentStatus,
} from '$features/events/main/agent-subscription-ops';
import {
  selectAgentQueueLength,
  selectAgentStatus,
} from '../../../../store/main/slices/agent-subscriptions/agent-subscriptions-selectors';
import { getMainState } from '../../../../store/main/redux-store-bridge';

describe('Agent Interaction Integration', () => {
  const workspaceId = 'test-workspace-id';

  beforeEach(() => {
    _state = { agentSubscriptions: { ...sliceInitialState } };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Event Subscription Flow', () => {
    it('should subscribe to specific event types', () => {
      const subscriptionId = agentSubscribe(workspaceId, 'agent-1', 'Test Agent', {
        eventTypes: ['agent:idle', 'agent:created'],
      });

      expect(subscriptionId).toBeDefined();
      expect(typeof subscriptionId).toBe('string');
    });

    it('should unsubscribe from events', () => {
      const subscriptionId = agentSubscribe(workspaceId, 'agent-1', 'Test Agent', {
        eventTypes: ['agent:idle'],
      });

      const result = agentUnsubscribe(workspaceId, subscriptionId);
      expect(result).toBe(true);

      // Unsubscribing again should return false
      const result2 = agentUnsubscribe(workspaceId, subscriptionId);
      expect(result2).toBe(false);
    });

    it('should track agent status', () => {
      agentSubscribe(workspaceId, 'agent-1', 'Test Agent', {
        eventTypes: ['agent:idle'],
      });

      updateAgentStatus(workspaceId, 'agent-1', 'responding');
      expect(selectAgentStatus.select(getMainState(), workspaceId, 'agent-1')).toBe('responding');

      updateAgentStatus(workspaceId, 'agent-1', 'idle');
      expect(selectAgentStatus.select(getMainState(), workspaceId, 'agent-1')).toBe('idle');
    });

    it('should report pending events correctly', () => {
      agentSubscribe(workspaceId, 'agent-1', 'Test Agent', {
        eventTypes: ['agent:idle'],
      });

      // Initially no pending events
      expect(selectAgentQueueLength.select(getMainState(), workspaceId, 'agent-1')).toBe(0);
    });

    it('should handle agent status transitions', () => {
      agentSubscribe(workspaceId, 'agent-1', 'Test Agent', {
        eventTypes: ['agent:idle'],
      });

      updateAgentStatus(workspaceId, 'agent-1', 'responding');
      updateAgentStatus(workspaceId, 'agent-1', 'idle');
      updateAgentStatus(workspaceId, 'agent-1', 'responding');
      updateAgentStatus(workspaceId, 'agent-1', 'idle');

      // No errors should occur
      expect(selectAgentStatus.select(getMainState(), workspaceId, 'agent-1')).toBe('idle');
    });

    // NOTE: Event delivery tests (high priority delivery, etc.) are now handled
    // by the delivery saga and tested in agent-subscriptions-saga.test.ts.
  });
});
