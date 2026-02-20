/**
 * Delegation Flow Tests
 *
 * Tests for the agent delegation system including:
 * - DelegateTaskTool execution flow
 * - Specialist default assignment (implementor)
 * - wait_mode grouping behavior
 * - Delegation group cleanup
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WorkspaceEventBus } from '../../src/features/events/main/workspace-event-bus';
import {
  AgentEventSubscriptionService,
  disposeAgentEventSubscriptionService,
} from '../../src/features/events/main/agent-event-subscription.service';
import { createWorkspaceEvent } from '../../src/features/events/types';
import { getDeduplicationService } from '../../src/features/events/event-deduplication.service';
import { SPECIALISTS } from '../../src/lib/constants/specialists';

const ORCHESTRATOR_AGENT_ID = 'orchestrator-1';
const ORCHESTRATOR_AGENT_NAME = 'Orchestrator';

describe('Delegation Flow', () => {
  let eventBus: WorkspaceEventBus;
  let subscriptionService: AgentEventSubscriptionService;
  let deliveredEvents: Map<string, any[]>;
  let testWorkspaceId: string;

  beforeEach(() => {
    vi.useFakeTimers();
    testWorkspaceId = `test-workspace-delegation-${Math.random().toString(36).slice(2)}`;
    getDeduplicationService().clear();
    eventBus = new WorkspaceEventBus(testWorkspaceId);
    subscriptionService = new AgentEventSubscriptionService(eventBus, testWorkspaceId);
    deliveredEvents = new Map();

    subscriptionService.setDeliveryCallback((agentId, events) => {
      const existing = deliveredEvents.get(agentId) || [];
      deliveredEvents.set(agentId, [...existing, ...events]);
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    subscriptionService.dispose();
    deliveredEvents.clear();
  });

  describe('Specialist Default Behavior', () => {
    it('implementor specialist should be the default for delegation', () => {
      const implementor = SPECIALISTS.find((s) => s.id === 'implementor');
      expect(implementor).toBeDefined();
      expect(implementor!.defaultModelTier).toBe('smart');
    });

    it('implementor behavior should constrain scope', () => {
      const implementor = SPECIALISTS.find((s) => s.id === 'implementor');
      const prompt = implementor!.defaultBehaviorPrompt;

      // These constraints prevent scope creep - tests updated to match optimized content
      expect(prompt).toContain('assigned task');
      expect(prompt).toContain('No scope creep');
      expect(prompt).toContain('No refactors');
    });
  });

  describe('Delegation Event Subscription', () => {
    it('orchestrator should subscribe to delegated agent completion', () => {
      subscriptionService.setAgentStatus(ORCHESTRATOR_AGENT_ID, 'idle');

      // Subscribe to agent completion events
      const subscriptionId = subscriptionService.subscribe(
        ORCHESTRATOR_AGENT_ID,
        ORCHESTRATOR_AGENT_NAME,
        {
          eventTypes: ['agent:idle', 'agent:failed'],
          excludeActorIds: [ORCHESTRATOR_AGENT_ID],
          priority: 'high',
        },
      );

      expect(subscriptionId).toBeDefined();

      const subs = subscriptionService.getAgentSubscriptions(ORCHESTRATOR_AGENT_ID);
      expect(subs.length).toBe(1);
    });

    it('should receive agent:idle when delegated agent completes', () => {
      subscriptionService.setAgentStatus(ORCHESTRATOR_AGENT_ID, 'idle');

      subscriptionService.subscribe(ORCHESTRATOR_AGENT_ID, ORCHESTRATOR_AGENT_NAME, {
        eventTypes: ['agent:idle'],
        excludeActorIds: [ORCHESTRATOR_AGENT_ID],
        priority: 'high',
      });

      // Delegated agent completes
      eventBus.emitEvent(
        createWorkspaceEvent(
          'agent:idle',
          testWorkspaceId,
          { type: 'agent', id: 'implementor-1', name: 'Implementor Agent' },
          { agentId: 'implementor-1', agentName: 'Implementor Agent', messageCount: 5 },
        ),
      );

      const events = deliveredEvents.get(ORCHESTRATOR_AGENT_ID) || [];
      expect(events.length).toBe(1);
      expect(events[0].type).toBe('agent:idle');
      expect(events[0].data.agentId).toBe('implementor-1');
    });

    it('should receive agent:failed when delegated agent fails', () => {
      subscriptionService.setAgentStatus(ORCHESTRATOR_AGENT_ID, 'idle');

      subscriptionService.subscribe(ORCHESTRATOR_AGENT_ID, ORCHESTRATOR_AGENT_NAME, {
        eventTypes: ['agent:failed'],
        excludeActorIds: [ORCHESTRATOR_AGENT_ID],
        priority: 'high',
      });

      // Delegated agent fails
      eventBus.emitEvent(
        createWorkspaceEvent(
          'agent:failed',
          testWorkspaceId,
          { type: 'agent', id: 'implementor-1', name: 'Implementor Agent' },
          { agentId: 'implementor-1', agentName: 'Implementor Agent', error: 'Test error' },
        ),
      );

      const events = deliveredEvents.get(ORCHESTRATOR_AGENT_ID) || [];
      expect(events.length).toBe(1);
      expect(events[0].type).toBe('agent:failed');
    });
  });

  describe('Wave Execution Pattern', () => {
    it('orchestrator should not receive events while responding', () => {
      // Orchestrator is busy processing
      subscriptionService.setAgentStatus(ORCHESTRATOR_AGENT_ID, 'responding');

      subscriptionService.subscribe(ORCHESTRATOR_AGENT_ID, ORCHESTRATOR_AGENT_NAME, {
        eventTypes: ['agent:idle'],
        batchWindow: 100,
      });

      // Delegated agent completes while orchestrator is busy
      eventBus.emitEvent(
        createWorkspaceEvent(
          'agent:idle',
          testWorkspaceId,
          { type: 'agent', id: 'implementor-1', name: 'Implementor Agent' },
          { agentId: 'implementor-1', agentName: 'Implementor Agent', messageCount: 5 },
        ),
      );

      // Events should be queued
      expect(deliveredEvents.get(ORCHESTRATOR_AGENT_ID)).toBeUndefined();
      expect(subscriptionService.getPendingEventCount(ORCHESTRATOR_AGENT_ID)).toBe(1);
    });
  });

  describe('OneShot Double-Fire Prevention', () => {
    it('oneShot subscription should deliver exactly once for multiple matching events', () => {
      subscriptionService.setAgentStatus(ORCHESTRATOR_AGENT_ID, 'idle');

      // Subscribe with oneShot and multiple completion event types (same as AGENT_COMPLETION_EVENT_TYPES)
      subscriptionService.subscribe(ORCHESTRATOR_AGENT_ID, ORCHESTRATOR_AGENT_NAME, {
        eventTypes: ['agent:idle', 'agent:completed', 'agent:failed', 'agent:deleted'],
        actorIds: ['implementor-1'],
        priority: 'high',
        oneShot: true,
      });

      // Emit agent:idle — this should trigger delivery and cleanup
      eventBus.emitEvent(
        createWorkspaceEvent(
          'agent:idle',
          testWorkspaceId,
          { type: 'agent', id: 'implementor-1', name: 'Implementor Agent' },
          { agentId: 'implementor-1', agentName: 'Implementor Agent', messageCount: 5 },
        ),
      );

      // Emit agent:idle again — this should NOT trigger a second delivery
      eventBus.emitEvent(
        createWorkspaceEvent(
          'agent:idle',
          testWorkspaceId,
          { type: 'agent', id: 'implementor-1', name: 'Implementor Agent' },
          { agentId: 'implementor-1', agentName: 'Implementor Agent', messageCount: 6 },
        ),
      );

      const events = deliveredEvents.get(ORCHESTRATOR_AGENT_ID) || [];
      expect(events.length).toBe(1);
      expect(events[0].type).toBe('agent:idle');
    });

    it('oneShot subscription should be fully cleaned up after firing', () => {
      subscriptionService.setAgentStatus(ORCHESTRATOR_AGENT_ID, 'idle');

      subscriptionService.subscribe(ORCHESTRATOR_AGENT_ID, ORCHESTRATOR_AGENT_NAME, {
        eventTypes: ['agent:idle', 'agent:completed', 'agent:failed', 'agent:deleted'],
        actorIds: ['implementor-1'],
        priority: 'high',
        oneShot: true,
      });

      // Verify subscription exists
      expect(subscriptionService.getAgentSubscriptions(ORCHESTRATOR_AGENT_ID).length).toBe(1);

      // Emit event to trigger oneShot
      eventBus.emitEvent(
        createWorkspaceEvent(
          'agent:idle',
          testWorkspaceId,
          { type: 'agent', id: 'implementor-1', name: 'Implementor Agent' },
          { agentId: 'implementor-1', agentName: 'Implementor Agent', messageCount: 5 },
        ),
      );

      // Subscription should be fully cleaned up
      expect(subscriptionService.getAgentSubscriptions(ORCHESTRATOR_AGENT_ID).length).toBe(0);
    });

    it('oneShot guard should prevent queued double-delivery', () => {
      // Orchestrator is busy — events will be queued
      subscriptionService.setAgentStatus(ORCHESTRATOR_AGENT_ID, 'responding');

      subscriptionService.subscribe(ORCHESTRATOR_AGENT_ID, ORCHESTRATOR_AGENT_NAME, {
        eventTypes: ['agent:idle', 'agent:completed', 'agent:failed', 'agent:deleted'],
        actorIds: ['implementor-1'],
        priority: 'normal',
        oneShot: true,
        batchWindow: 100,
      });

      // Emit two matching events while agent is busy
      eventBus.emitEvent(
        createWorkspaceEvent(
          'agent:idle',
          testWorkspaceId,
          { type: 'agent', id: 'implementor-1', name: 'Implementor Agent' },
          { agentId: 'implementor-1', agentName: 'Implementor Agent', messageCount: 5 },
        ),
      );

      // The second event should be skipped by the oneShot guard
      eventBus.emitEvent(
        createWorkspaceEvent(
          'agent:idle',
          testWorkspaceId,
          { type: 'agent', id: 'implementor-1', name: 'Implementor Agent' },
          { agentId: 'implementor-1', agentName: 'Implementor Agent', messageCount: 6 },
        ),
      );

      // Only one event should be queued
      expect(subscriptionService.getPendingEventCount(ORCHESTRATOR_AGENT_ID)).toBe(1);
    });
  });
});
