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
import { EventEmitter } from 'events';

// Mock dependencies - must be defined inline for hoisting
vi.mock('$features/events/main/workspace-event-bus', () => {
  const { EventEmitter } = require('events');

  class MockEventBus extends EventEmitter {
    private subscriptions = new Map();
    private subscriptionCounter = 0;

    subscribe(config: { filters?: any[]; callback?: (event: any) => void }) {
      const id = `sub-${++this.subscriptionCounter}`;
      this.subscriptions.set(id, config);

      // Listen for events and call callback
      if (config.callback) {
        const handler = (event: any) => config.callback!(event);
        this.on('event', handler);
      }

      return { id, unsubscribe: () => this.subscriptions.delete(id) };
    }

    emitEvent(event: any) {
      this.emit('event', event);
      this.emit(event.type, event);
    }
  }

  class MockEventFilterBuilder {
    private filters: any[] = [];
    byType(type: string) {
      this.filters.push({ type: 'type', value: type });
      return this;
    }
    ofType(type: string) {
      this.filters.push({ type: 'type', value: type });
      return this;
    }
    ofTypes(types: string[]) {
      this.filters.push({ type: 'types', value: types });
      return this;
    }
    byTypes(types: string[]) {
      this.filters.push({ type: 'types', value: types });
      return this;
    }
    byActor(actorId: string) {
      this.filters.push({ type: 'actor', value: actorId });
      return this;
    }
    byActors(actorIds: string[]) {
      this.filters.push({ type: 'actors', value: actorIds });
      return this;
    }
    build() {
      return this.filters;
    }
  }

  const mockEventBus = new MockEventBus();

  return {
    getWorkspaceEventBus: () => mockEventBus,
    EventFilterBuilder: MockEventFilterBuilder,
    WorkspaceEventBus: MockEventBus,
  };
});

vi.mock('$shared/logger', () => ({
  Logger: class {
    debug = vi.fn();
    info = vi.fn();
    warn = vi.fn();
    error = vi.fn();
  },
}));

const mockDeliveryCallback = vi.fn();

// Import after mocks
import {
  AgentEventSubscriptionService,
  type DelegationGroup,
} from '$features/events/main/agent-event-subscription.service';
import { getWorkspaceEventBus } from '$features/events/main/workspace-event-bus';

// Helper to create properly structured events
function createAgentEvent(type: string, agentId: string, workspaceId: string) {
  return {
    type,
    workspaceId,
    actorId: agentId,
    actor: { id: agentId, type: 'agent', name: `Agent ${agentId}` },
    timestamp: new Date().toISOString(),
    data: { agentId },
  };
}

describe('Agent Orchestration', () => {
  let subscriptionService: AgentEventSubscriptionService;
  let mockEventBus: any;
  const workspaceId = 'test-workspace';

  beforeEach(() => {
    vi.clearAllMocks();
    mockEventBus = getWorkspaceEventBus(workspaceId);
    mockEventBus.removeAllListeners();
    // AgentEventSubscriptionService takes (eventBus, workspaceId)
    subscriptionService = new AgentEventSubscriptionService(mockEventBus as any, workspaceId);
    subscriptionService.setDeliveryCallback(mockDeliveryCallback);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('Delegation Group Tracking', () => {
    it('should create a delegation group when subscribing with after_all mode', () => {
      const parentAgentId = 'parent-agent';
      const groupId = 'test-group-1';
      const delegatedAgentId = 'child-agent-1';

      subscriptionService.subscribeToGroup(parentAgentId, 'Parent', groupId, delegatedAgentId);

      const status = subscriptionService.getDelegationGroupStatus(groupId);
      expect(status).not.toBeNull();
      expect(status?.expected).toBe(1);
      expect(status?.completed).toBe(0);
      expect(status?.isComplete).toBe(false);
    });

    it('should add agents to existing delegation group', () => {
      const parentAgentId = 'parent-agent';
      const groupId = 'test-group-2';

      // Add first agent
      subscriptionService.subscribeToGroup(parentAgentId, 'Parent', groupId, 'child-1');

      // Add second agent
      subscriptionService.subscribeToGroup(parentAgentId, 'Parent', groupId, 'child-2');

      // Add third agent
      subscriptionService.subscribeToGroup(parentAgentId, 'Parent', groupId, 'child-3');

      const status = subscriptionService.getDelegationGroupStatus(groupId);
      expect(status?.expected).toBe(3);
      expect(status?.completed).toBe(0);
    });

    it('should track completed agents in group', () => {
      const parentAgentId = 'parent-agent';
      const groupId = 'test-group-3';

      subscriptionService.subscribeToGroup(parentAgentId, 'Parent', groupId, 'child-1');
      subscriptionService.subscribeToGroup(parentAgentId, 'Parent', groupId, 'child-2');

      // Simulate child-1 completing
      mockEventBus.emitEvent(createAgentEvent('agent:idle', 'child-1', workspaceId));

      const status = subscriptionService.getDelegationGroupStatus(groupId);
      expect(status?.completed).toBe(1);
      expect(status?.isComplete).toBe(false);
    });

    it('should mark group complete when all agents finish', () => {
      const parentAgentId = 'parent-agent';
      const groupId = 'test-group-4';

      subscriptionService.subscribeToGroup(parentAgentId, 'Parent', groupId, 'child-1');
      subscriptionService.subscribeToGroup(parentAgentId, 'Parent', groupId, 'child-2');

      // Set parent as idle so events can be delivered
      subscriptionService.setAgentStatus(parentAgentId, 'idle');

      // First child completes - group should still exist
      mockEventBus.emitEvent(createAgentEvent('agent:idle', 'child-1', workspaceId));
      const statusAfterFirst = subscriptionService.getDelegationGroupStatus(groupId);
      expect(statusAfterFirst?.completed).toBe(1);
      expect(statusAfterFirst?.isComplete).toBe(false);

      // Second child completes - group is cleaned up after delivery
      mockEventBus.emitEvent(createAgentEvent('agent:idle', 'child-2', workspaceId));

      // After all complete and events delivered, group is cleaned up
      // So status should be null (group no longer exists)
      const statusAfterAll = subscriptionService.getDelegationGroupStatus(groupId);
      expect(statusAfterAll).toBeNull();

      // But events should have been delivered
      expect(mockDeliveryCallback).toHaveBeenCalled();
    });
  });

  describe('Event Delivery Timing', () => {
    it('should NOT deliver events until all agents in group complete', () => {
      const parentAgentId = 'parent-agent';
      const groupId = 'test-group-5';

      subscriptionService.subscribeToGroup(parentAgentId, 'Parent', groupId, 'child-1');
      subscriptionService.subscribeToGroup(parentAgentId, 'Parent', groupId, 'child-2');
      subscriptionService.setAgentStatus(parentAgentId, 'idle');

      // Only first child completes
      mockEventBus.emitEvent(createAgentEvent('agent:idle', 'child-1', workspaceId));

      // Events should NOT be delivered yet
      expect(mockDeliveryCallback).not.toHaveBeenCalled();
    });

    it('should deliver all accumulated events when group completes', () => {
      const parentAgentId = 'parent-agent';
      const groupId = 'test-group-6';

      subscriptionService.subscribeToGroup(parentAgentId, 'Parent', groupId, 'child-1');
      subscriptionService.subscribeToGroup(parentAgentId, 'Parent', groupId, 'child-2');
      subscriptionService.setAgentStatus(parentAgentId, 'idle');

      // Both children complete
      mockEventBus.emitEvent(createAgentEvent('agent:idle', 'child-1', workspaceId));
      mockEventBus.emitEvent(createAgentEvent('agent:idle', 'child-2', workspaceId));

      // Now events should be delivered
      expect(mockDeliveryCallback).toHaveBeenCalledWith(
        parentAgentId,
        expect.arrayContaining([
          expect.objectContaining({ actorId: 'child-1' }),
          expect.objectContaining({ actorId: 'child-2' }),
        ]),
      );
    });
  });

  describe('Immediate Mode (Default)', () => {
    it('should deliver events immediately when agent completes', () => {
      const parentAgentId = 'parent-agent';
      const childAgentId = 'child-agent';

      // Subscribe with immediate mode (no delegation group)
      subscriptionService.subscribe(parentAgentId, 'Parent', {
        eventTypes: ['agent:idle'],
        actorIds: [childAgentId],
        priority: 'high',
      });

      subscriptionService.setAgentStatus(parentAgentId, 'idle');

      // Child completes
      mockEventBus.emitEvent(createAgentEvent('agent:idle', childAgentId, workspaceId));

      // Event should be delivered immediately
      expect(mockDeliveryCallback).toHaveBeenCalledWith(
        parentAgentId,
        expect.arrayContaining([expect.objectContaining({ actorId: childAgentId })]),
      );
    });
  });

  describe('Parent Agent Status', () => {
    it('should queue events when parent is busy', () => {
      const parentAgentId = 'parent-agent';
      const childAgentId = 'child-agent';

      subscriptionService.subscribe(parentAgentId, 'Parent', {
        eventTypes: ['agent:idle'],
        actorIds: [childAgentId],
        priority: 'high',
      });

      // Parent is busy (streaming)
      subscriptionService.setAgentStatus(parentAgentId, 'streaming');

      // Child completes
      mockEventBus.emitEvent(createAgentEvent('agent:idle', childAgentId, workspaceId));

      // Event should NOT be delivered yet
      expect(mockDeliveryCallback).not.toHaveBeenCalled();
    });

    it('should deliver queued events when parent becomes idle', () => {
      const parentAgentId = 'parent-agent';
      const childAgentId = 'child-agent';

      subscriptionService.subscribe(parentAgentId, 'Parent', {
        eventTypes: ['agent:idle'],
        actorIds: [childAgentId],
        priority: 'high',
      });

      // Parent is busy (responding state)
      subscriptionService.setAgentStatus(parentAgentId, 'responding');

      // Child completes (event queued)
      mockEventBus.emitEvent(createAgentEvent('agent:idle', childAgentId, workspaceId));

      expect(mockDeliveryCallback).not.toHaveBeenCalled();

      // Parent becomes idle - should trigger queue processing
      // The service delivers queued events when transitioning from 'responding' to 'idle'
      subscriptionService.setAgentStatus(parentAgentId, 'idle');

      expect(mockDeliveryCallback).toHaveBeenCalled();
    });
  });

  describe('Delegation Groups for Parent', () => {
    it('should return all delegation groups for a parent agent', () => {
      const parentAgentId = 'parent-agent';

      subscriptionService.subscribeToGroup(parentAgentId, 'Parent', 'group-1', 'child-1');
      subscriptionService.subscribeToGroup(parentAgentId, 'Parent', 'group-1', 'child-2');
      subscriptionService.subscribeToGroup(parentAgentId, 'Parent', 'group-2', 'child-3');

      const groups = subscriptionService.getDelegationGroupsForParent(parentAgentId);

      expect(groups).toHaveLength(2);
      expect(groups.map((g) => g.groupId)).toContain('group-1');
      expect(groups.map((g) => g.groupId)).toContain('group-2');
    });
  });

  describe('Bug Fix: unsubscribeAll should not modify map during iteration', () => {
    it('should correctly unsubscribe all subscriptions for an agent', () => {
      const agentId = 'test-agent';

      // Create multiple subscriptions for the same agent
      const sub1 = subscriptionService.subscribe(agentId, 'Test Agent', {
        eventTypes: ['agent:idle'],
      });
      const sub2 = subscriptionService.subscribe(agentId, 'Test Agent', {
        eventTypes: ['agent:created'],
      });
      const sub3 = subscriptionService.subscribe(agentId, 'Test Agent', {
        eventTypes: ['agent:failed'],
      });

      // All subscriptions should exist
      expect(sub1).toBeDefined();
      expect(sub2).toBeDefined();
      expect(sub3).toBeDefined();

      // Unsubscribe all - this should not throw and should unsubscribe all 3
      const count = subscriptionService.unsubscribeAll(agentId);

      expect(count).toBe(3);

      // Trying to unsubscribe again should return false for all
      expect(subscriptionService.unsubscribe(sub1)).toBe(false);
      expect(subscriptionService.unsubscribe(sub2)).toBe(false);
      expect(subscriptionService.unsubscribe(sub3)).toBe(false);
    });
  });

  describe('Bug Fix: agent:failed and agent:deleted events in immediate mode', () => {
    it('should deliver agent:failed events to parent in immediate mode', () => {
      const parentAgentId = 'parent-agent';
      const childAgentId = 'child-agent';

      // Subscribe with immediate mode (includes agent:failed now)
      subscriptionService.subscribe(parentAgentId, 'Parent', {
        eventTypes: ['agent:idle', 'agent:completed', 'agent:failed', 'agent:deleted'],
        actorIds: [childAgentId],
        priority: 'high',
        oneShot: true,
      });

      subscriptionService.setAgentStatus(parentAgentId, 'idle');

      // Child fails
      mockEventBus.emitEvent(createAgentEvent('agent:failed', childAgentId, workspaceId));

      // Event should be delivered immediately
      expect(mockDeliveryCallback).toHaveBeenCalledWith(
        parentAgentId,
        expect.arrayContaining([expect.objectContaining({ type: 'agent:failed', actorId: childAgentId })]),
      );
    });

    it('should deliver agent:deleted events to parent in immediate mode', () => {
      const parentAgentId = 'parent-agent';
      const childAgentId = 'child-agent';

      // Subscribe with immediate mode (includes agent:deleted now)
      subscriptionService.subscribe(parentAgentId, 'Parent', {
        eventTypes: ['agent:idle', 'agent:completed', 'agent:failed', 'agent:deleted'],
        actorIds: [childAgentId],
        priority: 'high',
        oneShot: true,
      });

      subscriptionService.setAgentStatus(parentAgentId, 'idle');

      // Child is deleted
      mockEventBus.emitEvent(createAgentEvent('agent:deleted', childAgentId, workspaceId));

      // Event should be delivered immediately
      expect(mockDeliveryCallback).toHaveBeenCalledWith(
        parentAgentId,
        expect.arrayContaining([expect.objectContaining({ type: 'agent:deleted', actorId: childAgentId })]),
      );
    });
  });
});
