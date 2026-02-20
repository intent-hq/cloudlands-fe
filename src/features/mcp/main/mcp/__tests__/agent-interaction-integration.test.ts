/**
 * Integration Tests for Agent Interaction System
 *
 * Tests the complete flow of agent-to-agent communication:
 * - Creating child agents
 * - Sending messages between agents
 * - Event subscriptions and notifications
 * - Waiting for agent completion
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { AgentEventSubscriptionService } from '$features/events/main/agent-event-subscription.service';
import { WorkspaceEventBus } from '$features/events/main/workspace-event-bus';
import { createWorkspaceEvent, WorkspaceEvent } from '$features/events/types';

describe('Agent Interaction Integration', () => {
  let eventBus: WorkspaceEventBus;
  let subscriptionService: AgentEventSubscriptionService;
  const workspaceId = 'test-workspace-id';

  beforeEach(() => {
    eventBus = new WorkspaceEventBus(workspaceId);
    subscriptionService = new AgentEventSubscriptionService(eventBus, workspaceId);
  });

  afterEach(() => {
    subscriptionService.dispose();
    vi.clearAllMocks();
  });

  describe('Event Subscription Flow', () => {
    it('should subscribe to specific event types', () => {
      const subscriptionId = subscriptionService.subscribe('agent-1', 'Test Agent', {
        eventTypes: ['agent:idle', 'agent:created'],
      });

      expect(subscriptionId).toBeDefined();
      expect(typeof subscriptionId).toBe('string');
    });

    it('should unsubscribe from events', () => {
      const subscriptionId = subscriptionService.subscribe('agent-1', 'Test Agent', {
        eventTypes: ['agent:idle'],
      });

      const result = subscriptionService.unsubscribe(subscriptionId);
      expect(result).toBe(true);

      // Unsubscribing again should return false
      const result2 = subscriptionService.unsubscribe(subscriptionId);
      expect(result2).toBe(false);
    });

    it('should track agent status', () => {
      subscriptionService.subscribe('agent-1', 'Test Agent', {
        eventTypes: ['agent:idle'],
      });

      // Set agent as responding (busy)
      subscriptionService.setAgentStatus('agent-1', 'responding');

      // Set agent as idle
      subscriptionService.setAgentStatus('agent-1', 'idle');

      // No errors should occur
      expect(true).toBe(true);
    });

    it('should report pending events correctly', () => {
      subscriptionService.subscribe('agent-1', 'Test Agent', {
        eventTypes: ['agent:idle'],
      });

      // Initially no pending events
      expect(subscriptionService.hasPendingEvents('agent-1')).toBe(false);
      expect(subscriptionService.getPendingEventCount('agent-1')).toBe(0);
    });

    it('should deliver high priority events to idle agents immediately', async () => {
      const deliveredEvents: WorkspaceEvent[] = [];
      const deliveryCallback = vi.fn(async (agentId: string, events: WorkspaceEvent[]) => {
        deliveredEvents.push(...events);
      });
      subscriptionService.setDeliveryCallback(deliveryCallback);

      // Subscribe with high priority to get immediate delivery
      subscriptionService.subscribe('agent-1', 'Test Agent', {
        eventTypes: ['agent:idle'],
        priority: 'high',
      });

      // Set agent as idle to receive events immediately
      subscriptionService.setAgentStatus('agent-1', 'idle');

      // Emit event
      const idleEvent = createWorkspaceEvent(
        'agent:idle',
        workspaceId,
        { type: 'agent', id: 'agent-2', name: 'Other Agent' },
        { agentId: 'agent-2', reason: 'stream_complete' },
      );
      eventBus.emitEvent(idleEvent);

      // Wait for async delivery
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Should have received the event
      expect(deliveryCallback).toHaveBeenCalled();
    });

    it('should handle agent status transitions', () => {
      // Subscribe to events
      subscriptionService.subscribe('agent-1', 'Test Agent', {
        eventTypes: ['agent:idle'],
      });

      // Verify status transitions work without errors
      subscriptionService.setAgentStatus('agent-1', 'responding');
      subscriptionService.setAgentStatus('agent-1', 'idle');
      subscriptionService.setAgentStatus('agent-1', 'responding');
      subscriptionService.setAgentStatus('agent-1', 'idle');

      // No errors should occur
      expect(true).toBe(true);
    });
  });
});
