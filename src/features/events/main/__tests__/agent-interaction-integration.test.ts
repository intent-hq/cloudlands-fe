/**
 * Integration Tests for Agent Interaction System
 *
 * Tests the subscription operations (subscribe, unsubscribe, status) via
 * the standalone ops functions backed by the Redux store.
 *
 * Event delivery is now handled by sagas and tested in
 * agent-subscriptions-saga.test.ts.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Mock logger
vi.mock('$shared/logger', () => ({
  Logger: class {
    debug = vi.fn();
    info = vi.fn();
    warn = vi.fn();
    error = vi.fn();
  },
}));

vi.mock('../../../../store/main/redux-store-bridge', () => ({
  mainDispatch: vi.fn((action: unknown) => action),
}));

import {
  agentSubscribe,
  agentUnsubscribe,
  updateAgentStatus,
} from '$features/events/main/agent-subscription-ops';
import {
  getAgentSubscriptionStatus,
  getWorkspaceSubscriptionState,
  resetAgentSubscriptionState,
} from '../agent-subscription-state.service';

describe('Agent Interaction Integration', () => {
  const workspaceId = 'test-workspace-id';

  beforeEach(() => {
    resetAgentSubscriptionState();
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
      expect(getAgentSubscriptionStatus(workspaceId, 'agent-1')).toBe('responding');

      updateAgentStatus(workspaceId, 'agent-1', 'idle');
      expect(getAgentSubscriptionStatus(workspaceId, 'agent-1')).toBe('idle');
    });

    it('should report pending events correctly', () => {
      agentSubscribe(workspaceId, 'agent-1', 'Test Agent', {
        eventTypes: ['agent:idle'],
      });

      // Initially no pending events
      expect(getWorkspaceSubscriptionState(workspaceId).agentQueues['agent-1'] ?? []).toHaveLength(
        0,
      );
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
      expect(getAgentSubscriptionStatus(workspaceId, 'agent-1')).toBe('idle');
    });

    // NOTE: Event delivery tests (high priority delivery, etc.) are now handled
    // by the delivery saga and tested in agent-subscriptions-saga.test.ts.
  });
});
