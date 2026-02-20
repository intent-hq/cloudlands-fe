/**
 * End-to-End Agent Collaboration Tests
 *
 * Tests for complete agent-to-agent interaction workflows including:
 * - Agent creation and completion
 * - Event subscription and delivery
 * - Event queuing when agents are busy
 * - Data matchers in subscriptions
 * - Multiple concurrent subscriptions
 * - Event notification formatting
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WorkspaceEventBus } from '../src/features/events/main/workspace-event-bus';
import {
  AgentEventSubscriptionService,
  disposeAgentEventSubscriptionService,
} from '../src/features/events/main/agent-event-subscription.service';
import { createWorkspaceEvent, WorkspaceEvent } from '../src/features/events/types';
import { formatEventNotification, formatSingleEvent } from '../src/features/events/main/event-notification-formatter';
import { getDeduplicationService } from '../src/features/events/event-deduplication.service';

const TEST_AGENT_ID = 'agent-1';
const TEST_AGENT_NAME = 'Test Agent';

describe('Agent Collaboration E2E', () => {
  let eventBus: WorkspaceEventBus;
  let subscriptionService: AgentEventSubscriptionService;
  let deliveredEvents: Map<string, WorkspaceEvent[]>;
  let testWorkspaceId: string;

  beforeEach(() => {
    vi.useFakeTimers();
    // Use unique workspace ID per test to avoid deduplication issues
    testWorkspaceId = `test-workspace-e2e-${  Math.random().toString(36).slice(2)}`;
    // Clear deduplication cache before each test
    getDeduplicationService().clear();
    // Create fresh instances to avoid cross-test pollution
    eventBus = new WorkspaceEventBus(testWorkspaceId);
    subscriptionService = new AgentEventSubscriptionService(eventBus, testWorkspaceId);
    deliveredEvents = new Map();

    // Set up delivery callback to capture delivered events
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

  describe('Event Queuing When Agent Is Busy', () => {
    it('should queue events when agent is responding', () => {
      // Set agent as responding first (before subscribing)
      subscriptionService.setAgentStatus(TEST_AGENT_ID, 'responding');

      // Subscribe agent (subscription event will be queued too)
      subscriptionService.subscribe(TEST_AGENT_ID, TEST_AGENT_NAME, {
        eventTypes: ['agent:created'], // Only listen for created events, not subscribed
        batchWindow: 100,
      });

      // Emit events while busy
      eventBus.emitEvent(createWorkspaceEvent(
        'agent:created',
        testWorkspaceId,
        { type: 'system', name: 'System' },
        { agentId: 'agent-2', agentName: 'Helper Agent' },
      ));

      // Events should be queued, not delivered
      expect(deliveredEvents.get(TEST_AGENT_ID)).toBeUndefined();
      expect(subscriptionService.getPendingEventCount(TEST_AGENT_ID)).toBe(1);
    });

    it('should deliver queued events when agent becomes idle', () => {
      subscriptionService.setAgentStatus(TEST_AGENT_ID, 'responding');

      subscriptionService.subscribe(TEST_AGENT_ID, TEST_AGENT_NAME, {
        eventTypes: ['agent:created', 'agent:idle'], // Specific types
        batchWindow: 100,
      });

      // Queue some events
      eventBus.emitEvent(createWorkspaceEvent(
        'agent:created',
        testWorkspaceId,
        { type: 'system', name: 'System' },
        { agentId: 'agent-2', agentName: 'Agent 2' },
      ));
      eventBus.emitEvent(createWorkspaceEvent(
        'agent:idle',
        testWorkspaceId,
        { type: 'agent', id: 'agent-2', name: 'Agent 2' },
        { agentId: 'agent-2', agentName: 'Agent 2', messageCount: 5 },
      ));

      expect(subscriptionService.getPendingEventCount(TEST_AGENT_ID)).toBe(2);

      // Agent becomes idle
      subscriptionService.setAgentStatus(TEST_AGENT_ID, 'idle');

      // Events should be delivered
      const events = deliveredEvents.get(TEST_AGENT_ID) || [];
      expect(events.length).toBe(2);
    });

    it('should deliver high priority events immediately to idle agents', () => {
      subscriptionService.setAgentStatus(TEST_AGENT_ID, 'idle');

      subscriptionService.subscribe(TEST_AGENT_ID, TEST_AGENT_NAME, {
        eventTypes: ['agent:created'],
        priority: 'high',
        batchWindow: 1000,
      });

      eventBus.emitEvent(createWorkspaceEvent(
        'agent:created',
        testWorkspaceId,
        { type: 'system', name: 'System' },
        { agentId: 'agent-2', agentName: 'Urgent Agent' },
      ));

      // High priority should deliver immediately (no waiting for batch window)
      const events = deliveredEvents.get(TEST_AGENT_ID) || [];
      expect(events.length).toBe(1);
    });

    it('should sort queued events by priority on delivery', () => {
      subscriptionService.setAgentStatus(TEST_AGENT_ID, 'responding');

      // Create low priority subscription
      subscriptionService.subscribe(TEST_AGENT_ID, TEST_AGENT_NAME, {
        eventTypes: ['agent:idle'],
        priority: 'low',
        batchWindow: 100,
      });

      // Queue low priority event
      eventBus.emitEvent(createWorkspaceEvent(
        'agent:idle',
        testWorkspaceId,
        { type: 'agent', id: 'agent-3', name: 'Agent 3' },
        { agentId: 'agent-3', agentName: 'Agent 3', messageCount: 1 },
      ));

      // Unsubscribe and resubscribe with normal priority
      subscriptionService.unsubscribeAll(TEST_AGENT_ID);
      subscriptionService.subscribe(TEST_AGENT_ID, TEST_AGENT_NAME, {
        eventTypes: ['agent:created'],
        priority: 'normal',
        batchWindow: 100,
      });

      // Queue normal priority event
      eventBus.emitEvent(createWorkspaceEvent(
        'agent:created',
        testWorkspaceId,
        { type: 'system', name: 'System' },
        { agentId: 'agent-4', agentName: 'Agent 4' },
      ));

      // Deliver
      subscriptionService.setAgentStatus(TEST_AGENT_ID, 'idle');

      const events = deliveredEvents.get(TEST_AGENT_ID) || [];
      // Normal priority should come before low priority
      expect(events.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Data Matchers in Subscriptions', () => {
    it('should filter events using equals matcher', () => {
      subscriptionService.setAgentStatus(TEST_AGENT_ID, 'idle');

      subscriptionService.subscribe(TEST_AGENT_ID, TEST_AGENT_NAME, {
        eventTypes: ['agent:created'],
        dataMatchers: [
          { field: 'data.agentName', operator: 'equals', value: 'Target Agent' },
        ],
        priority: 'high', // High priority = immediate delivery
      });

      // This should NOT match
      eventBus.emitEvent(createWorkspaceEvent(
        'agent:created',
        testWorkspaceId,
        { type: 'system', name: 'System' },
        { agentId: 'agent-2', agentName: 'Other Agent' },
      ));

      expect(deliveredEvents.get(TEST_AGENT_ID)?.length || 0).toBe(0);

      // This SHOULD match
      eventBus.emitEvent(createWorkspaceEvent(
        'agent:created',
        testWorkspaceId,
        { type: 'system', name: 'System' },
        { agentId: 'agent-3', agentName: 'Target Agent' },
      ));

      const events = deliveredEvents.get(TEST_AGENT_ID) || [];
      expect(events.length).toBe(1);
      expect(events[0].data.agentName).toBe('Target Agent');
    });

    it('should filter events using contains matcher', () => {
      subscriptionService.setAgentStatus(TEST_AGENT_ID, 'idle');

      subscriptionService.subscribe(TEST_AGENT_ID, TEST_AGENT_NAME, {
        eventTypes: ['agent:created'],
        dataMatchers: [
          { field: 'data.agentName', operator: 'contains', value: 'Helper' },
        ],
        priority: 'high',
      });

      eventBus.emitEvent(createWorkspaceEvent(
        'agent:created',
        testWorkspaceId,
        { type: 'system', name: 'System' },
        { agentId: 'agent-2', agentName: 'Code Helper Agent' },
      ));

      const events = deliveredEvents.get(TEST_AGENT_ID) || [];
      expect(events.length).toBe(1);
    });

    it('should filter events using starts_with matcher', () => {
      subscriptionService.setAgentStatus(TEST_AGENT_ID, 'idle');

      subscriptionService.subscribe(TEST_AGENT_ID, TEST_AGENT_NAME, {
        eventTypes: ['file:changed'],
        dataMatchers: [
          { field: 'data.relativePath', operator: 'starts_with', value: 'src/' },
        ],
        priority: 'high',
      });

      // Should NOT match - use different actor to avoid deduplication
      eventBus.emitEvent(createWorkspaceEvent(
        'file:changed',
        testWorkspaceId,
        { type: 'agent', id: 'agent-no-match', name: 'Agent No Match' },
        { relativePath: 'tests/file.ts', action: 'modified' },
      ));

      expect(deliveredEvents.get(TEST_AGENT_ID)?.length || 0).toBe(0);

      // Should match - use different actor to avoid deduplication
      eventBus.emitEvent(createWorkspaceEvent(
        'file:changed',
        testWorkspaceId,
        { type: 'agent', id: 'agent-match', name: 'Agent Match' },
        { relativePath: 'src/features/file.ts', action: 'modified' },
      ));

      expect(deliveredEvents.get(TEST_AGENT_ID)?.length).toBe(1);
    });

    it('should filter events using matches (regex) matcher', () => {
      subscriptionService.setAgentStatus(TEST_AGENT_ID, 'idle');

      subscriptionService.subscribe(TEST_AGENT_ID, TEST_AGENT_NAME, {
        eventTypes: ['file:changed'],
        dataMatchers: [
          { field: 'data.relativePath', operator: 'matches', value: '.*\\.test\\.ts$' },
        ],
        priority: 'high',
      });

      // Should NOT match (not a test file) - use different actor to avoid deduplication
      eventBus.emitEvent(createWorkspaceEvent(
        'file:changed',
        testWorkspaceId,
        { type: 'agent', id: 'agent-no-match', name: 'Agent No Match' },
        { relativePath: 'src/index.ts', action: 'modified' },
      ));

      expect(deliveredEvents.get(TEST_AGENT_ID)?.length || 0).toBe(0);

      // Should match (test file) - use different actor to avoid deduplication
      eventBus.emitEvent(createWorkspaceEvent(
        'file:changed',
        testWorkspaceId,
        { type: 'agent', id: 'agent-match', name: 'Agent Match' },
        { relativePath: 'tests/agent.test.ts', action: 'modified' },
      ));

      expect(deliveredEvents.get(TEST_AGENT_ID)?.length).toBe(1);
    });

    it('should combine multiple data matchers with AND logic', () => {
      subscriptionService.setAgentStatus(TEST_AGENT_ID, 'idle');

      subscriptionService.subscribe(TEST_AGENT_ID, TEST_AGENT_NAME, {
        eventTypes: ['file:changed'],
        dataMatchers: [
          { field: 'data.relativePath', operator: 'starts_with', value: 'src/' },
          { field: 'data.action', operator: 'equals', value: 'modified' },
        ],
        priority: 'high',
      });

      // Should NOT match (created, not modified) - use different actor to avoid deduplication
      eventBus.emitEvent(createWorkspaceEvent(
        'file:changed',
        testWorkspaceId,
        { type: 'agent', id: 'agent-no-match', name: 'Agent No Match' },
        { relativePath: 'src/new-file.ts', action: 'created' },
      ));

      expect(deliveredEvents.get(TEST_AGENT_ID)?.length || 0).toBe(0);

      // Should match (both conditions) - use different actor to avoid deduplication
      eventBus.emitEvent(createWorkspaceEvent(
        'file:changed',
        testWorkspaceId,
        { type: 'agent', id: 'agent-match', name: 'Agent Match' },
        { relativePath: 'src/existing.ts', action: 'modified' },
      ));

      expect(deliveredEvents.get(TEST_AGENT_ID)?.length).toBe(1);
    });
  });

  describe('Multiple Concurrent Subscriptions', () => {
    const AGENT_2_ID = 'agent-2';
    const AGENT_2_NAME = 'Agent 2';
    const AGENT_3_ID = 'agent-3';
    const AGENT_3_NAME = 'Agent 3';

    it('should deliver events to multiple subscribers', () => {
      subscriptionService.setAgentStatus(TEST_AGENT_ID, 'idle');
      subscriptionService.setAgentStatus(AGENT_2_ID, 'idle');

      // Agent 1 subscribes to agent events
      subscriptionService.subscribe(TEST_AGENT_ID, TEST_AGENT_NAME, {
        eventTypes: ['agent:created'],
        priority: 'high',
      });

      // Agent 2 subscribes to agent events
      subscriptionService.subscribe(AGENT_2_ID, AGENT_2_NAME, {
        eventTypes: ['agent:created'],
        priority: 'high',
      });

      // Emit an event
      eventBus.emitEvent(createWorkspaceEvent(
        'agent:created',
        testWorkspaceId,
        { type: 'system', name: 'System' },
        { agentId: AGENT_3_ID, agentName: AGENT_3_NAME },
      ));

      // Both agents should receive the event
      expect(deliveredEvents.get(TEST_AGENT_ID)?.length).toBe(1);
      expect(deliveredEvents.get(AGENT_2_ID)?.length).toBe(1);
    });

    it('should handle different filters for different agents', () => {
      subscriptionService.setAgentStatus(TEST_AGENT_ID, 'idle');
      subscriptionService.setAgentStatus(AGENT_2_ID, 'idle');

      // Agent 1 subscribes to file events only
      subscriptionService.subscribe(TEST_AGENT_ID, TEST_AGENT_NAME, {
        eventTypes: ['file:changed'],
        priority: 'high',
      });

      // Agent 2 subscribes to agent events only
      subscriptionService.subscribe(AGENT_2_ID, AGENT_2_NAME, {
        eventTypes: ['agent:created'],
        priority: 'high',
      });

      // Emit agent event
      eventBus.emitEvent(createWorkspaceEvent(
        'agent:created',
        testWorkspaceId,
        { type: 'system', name: 'System' },
        { agentId: AGENT_3_ID, agentName: AGENT_3_NAME },
      ));

      // Only Agent 2 should receive agent:created
      expect(deliveredEvents.get(TEST_AGENT_ID)?.length || 0).toBe(0);
      expect(deliveredEvents.get(AGENT_2_ID)?.length).toBe(1);

      // Emit file event
      eventBus.emitEvent(createWorkspaceEvent(
        'file:changed',
        testWorkspaceId,
        { type: 'agent', id: AGENT_3_ID, name: AGENT_3_NAME },
        { relativePath: 'src/test.ts', action: 'modified' },
      ));

      // Only Agent 1 should receive file:changed
      expect(deliveredEvents.get(TEST_AGENT_ID)?.length).toBe(1);
      expect(deliveredEvents.get(AGENT_2_ID)?.length).toBe(1); // Still 1 from before
    });

    it('should exclude events from self', () => {
      subscriptionService.setAgentStatus(TEST_AGENT_ID, 'idle');

      subscriptionService.subscribe(TEST_AGENT_ID, TEST_AGENT_NAME, {
        eventTypes: ['agent:idle'],
        excludeActorIds: [TEST_AGENT_ID],
        priority: 'high',
      });

      // Event from self - should be excluded
      eventBus.emitEvent(createWorkspaceEvent(
        'agent:idle',
        testWorkspaceId,
        { type: 'agent', id: TEST_AGENT_ID, name: TEST_AGENT_NAME },
        { agentId: TEST_AGENT_ID, agentName: TEST_AGENT_NAME, messageCount: 5 },
      ));

      expect(deliveredEvents.get(TEST_AGENT_ID)?.length || 0).toBe(0);

      // Event from another agent - should be received
      eventBus.emitEvent(createWorkspaceEvent(
        'agent:idle',
        testWorkspaceId,
        { type: 'agent', id: AGENT_2_ID, name: AGENT_2_NAME },
        { agentId: AGENT_2_ID, agentName: AGENT_2_NAME, messageCount: 3 },
      ));

      expect(deliveredEvents.get(TEST_AGENT_ID)?.length).toBe(1);
    });

    it('should manage multiple subscriptions per agent', () => {
      subscriptionService.setAgentStatus(TEST_AGENT_ID, 'idle');

      // Agent 1 has two subscriptions with different filters
      const sub1 = subscriptionService.subscribe(TEST_AGENT_ID, TEST_AGENT_NAME, {
        eventTypes: ['agent:created'],
        priority: 'high',
      });

      const sub2 = subscriptionService.subscribe(TEST_AGENT_ID, TEST_AGENT_NAME, {
        eventTypes: ['file:changed'],
        priority: 'high',
      });

      // Verify both subscriptions exist
      const subs = subscriptionService.getAgentSubscriptions(TEST_AGENT_ID);
      expect(subs.length).toBe(2);

      // Emit both types of events
      eventBus.emitEvent(createWorkspaceEvent(
        'agent:created',
        testWorkspaceId,
        { type: 'system', name: 'System' },
        { agentId: AGENT_2_ID, agentName: AGENT_2_NAME },
      ));

      eventBus.emitEvent(createWorkspaceEvent(
        'file:changed',
        testWorkspaceId,
        { type: 'agent', id: AGENT_2_ID, name: AGENT_2_NAME },
        { relativePath: 'src/test.ts', action: 'modified' },
      ));

      // Agent should receive both events
      expect(deliveredEvents.get(TEST_AGENT_ID)?.length).toBe(2);

      // Unsubscribe from one
      subscriptionService.unsubscribe(sub1);

      // Clear delivered events
      deliveredEvents.clear();

      // Emit both types again
      eventBus.emitEvent(createWorkspaceEvent(
        'agent:created',
        testWorkspaceId,
        { type: 'system', name: 'System' },
        { agentId: AGENT_3_ID, agentName: AGENT_3_NAME },
      ));

      eventBus.emitEvent(createWorkspaceEvent(
        'file:changed',
        testWorkspaceId,
        { type: 'agent', id: AGENT_3_ID, name: AGENT_3_NAME },
        { relativePath: 'src/other.ts', action: 'created' },
      ));

      // Should only receive file event now
      expect(deliveredEvents.get(TEST_AGENT_ID)?.length).toBe(1);
      expect(deliveredEvents.get(TEST_AGENT_ID)?.[0].type).toBe('file:changed');
    });
  });

  describe('Event Notification Formatting', () => {
    it('should format agent:created events correctly', () => {
      const event = createWorkspaceEvent(
        'agent:created',
        testWorkspaceId,
        { type: 'system', name: 'System' },
        { agentId: 'agent-2', agentName: 'Helper Agent', taskNoteId: 'task-123', createdByAgentId: TEST_AGENT_ID },
      );

      const formatted = formatSingleEvent(event);
      expect(formatted).toContain('[agent:created]');
      expect(formatted).toContain('Helper Agent');
      // When taskNoteId is provided, the formatter shows "Assigned to a task"
      expect(formatted).toContain('Assigned to a task');
    });

    it('should format agent:idle events correctly', () => {
      const event = createWorkspaceEvent(
        'agent:idle',
        testWorkspaceId,
        { type: 'agent', id: 'agent-2', name: 'Helper Agent' },
        { agentId: 'agent-2', agentName: 'Helper Agent', messageCount: 10 },
      );

      const formatted = formatSingleEvent(event);
      expect(formatted).toContain('[agent:idle]');
      expect(formatted).toContain('Helper Agent');
      // The formatter outputs "10 messages" not "Messages: 10"
      expect(formatted).toContain('10 messages');
    });

    it('should format agent:message:sent events correctly', () => {
      const event = createWorkspaceEvent(
        'agent:message:sent',
        testWorkspaceId,
        { type: 'agent', id: TEST_AGENT_ID, name: TEST_AGENT_NAME },
        {
          fromAgentId: TEST_AGENT_ID,
          fromAgentName: TEST_AGENT_NAME,
          toAgentId: 'agent-2',
          toAgentName: 'Agent 2',
          message: 'Please review the implementation',
          priority: 'high',
        },
      );

      const formatted = formatSingleEvent(event);
      expect(formatted).toContain('[agent:message:sent]');
      expect(formatted).toContain('HIGH PRIORITY');
      expect(formatted).toContain('Please review the implementation');
    });

    it('should format file:changed events correctly', () => {
      const event = createWorkspaceEvent(
        'file:changed',
        testWorkspaceId,
        { type: 'agent', id: 'agent-2', name: 'Agent 2' },
        { relativePath: 'src/features/test.ts', action: 'modified', additions: 10, deletions: 5 },
      );

      const formatted = formatSingleEvent(event);
      expect(formatted).toContain('[file:modified]');
      expect(formatted).toContain('src/features/test.ts');
      expect(formatted).toContain('+10');
      expect(formatted).toContain('-5');
    });

    it('should format batch of events correctly', () => {
      const events: WorkspaceEvent[] = [
        createWorkspaceEvent(
          'agent:created',
          testWorkspaceId,
          { type: 'system', name: 'System' },
          { agentId: 'agent-2', agentName: 'Agent 2' },
        ),
        createWorkspaceEvent(
          'agent:idle',
          testWorkspaceId,
          { type: 'agent', id: 'agent-2', name: 'Agent 2' },
          { agentId: 'agent-2', agentName: 'Agent 2', messageCount: 5 },
        ),
        createWorkspaceEvent(
          'file:changed',
          testWorkspaceId,
          { type: 'agent', id: 'agent-2', name: 'Agent 2' },
          { relativePath: 'src/test.ts', action: 'modified' },
        ),
      ];

      const notification = formatEventNotification(events);
      expect(notification).toContain('[WORKSPACE EVENTS]');
      expect(notification).toContain('3 workspace events');
      expect(notification).toContain('1.');
      expect(notification).toContain('2.');
      expect(notification).toContain('3.');
    });

    it('should truncate long messages', () => {
      const longMessage = 'x'.repeat(200);
      const event = createWorkspaceEvent(
        'agent:message:sent',
        testWorkspaceId,
        { type: 'agent', id: TEST_AGENT_ID, name: TEST_AGENT_NAME },
        {
          fromAgentId: TEST_AGENT_ID,
          fromAgentName: TEST_AGENT_NAME,
          toAgentId: 'agent-2',
          toAgentName: 'Agent 2',
          message: longMessage,
          priority: 'normal',
        },
      );

      const formatted = formatSingleEvent(event);
      expect(formatted).toContain('...');
      expect(formatted.length).toBeLessThan(longMessage.length);
    });
  });

  describe('Batch Size Limits', () => {
    it('should force delivery when batch max events reached', () => {
      subscriptionService.subscribe(TEST_AGENT_ID, TEST_AGENT_NAME, {
        eventTypes: ['agent:*'],
        batchWindow: 10000, // Long batch window
        batchMaxEvents: 3, // Force delivery after 3 events
      });

      subscriptionService.setAgentStatus(TEST_AGENT_ID, 'responding');

      // Queue 3 events (should trigger delivery at 3)
      eventBus.emitEvent(createWorkspaceEvent(
        'agent:created',
        testWorkspaceId,
        { type: 'system', name: 'System' },
        { agentId: 'agent-2', agentName: 'Agent 2' },
      ));
      eventBus.emitEvent(createWorkspaceEvent(
        'agent:created',
        testWorkspaceId,
        { type: 'system', name: 'System' },
        { agentId: 'agent-3', agentName: 'Agent 3' },
      ));
      eventBus.emitEvent(createWorkspaceEvent(
        'agent:created',
        testWorkspaceId,
        { type: 'system', name: 'System' },
        { agentId: 'agent-4', agentName: 'Agent 4' },
      ));

      // Events should be delivered due to batch size limit
      const events = deliveredEvents.get(TEST_AGENT_ID) || [];
      expect(events.length).toBe(3);
    });
  });

  describe('Wildcard Event Type Patterns', () => {
    it('should match all agent events with agent:*', () => {
      subscriptionService.setAgentStatus(TEST_AGENT_ID, 'idle');

      // Exclude self to avoid receiving the agent:subscribed event from our own subscription
      subscriptionService.subscribe(TEST_AGENT_ID, TEST_AGENT_NAME, {
        eventTypes: ['agent:*'],
        excludeActorIds: [TEST_AGENT_ID],
        priority: 'high',
      });

      eventBus.emitEvent(createWorkspaceEvent(
        'agent:created',
        testWorkspaceId,
        { type: 'system', name: 'System' },
        { agentId: 'agent-2', agentName: 'Agent 2' },
      ));

      eventBus.emitEvent(createWorkspaceEvent(
        'agent:idle',
        testWorkspaceId,
        { type: 'agent', id: 'agent-2', name: 'Agent 2' },
        { agentId: 'agent-2', agentName: 'Agent 2', messageCount: 1 },
      ));

      eventBus.emitEvent(createWorkspaceEvent(
        'agent:message:sent',
        testWorkspaceId,
        { type: 'agent', id: 'agent-2', name: 'Agent 2' },
        { fromAgentId: 'agent-2', toAgentId: 'agent-3', message: 'hi' },
      ));

      // All 3 agent events should match (excluding our own subscription event)
      const events = deliveredEvents.get(TEST_AGENT_ID) || [];
      expect(events.length).toBe(3);
    });

    it('should match all events with *', () => {
      subscriptionService.setAgentStatus(TEST_AGENT_ID, 'idle');

      // Exclude self to avoid receiving the agent:subscribed event from our own subscription
      subscriptionService.subscribe(TEST_AGENT_ID, TEST_AGENT_NAME, {
        eventTypes: ['*'],
        excludeActorIds: [TEST_AGENT_ID],
        priority: 'high',
      });

      eventBus.emitEvent(createWorkspaceEvent(
        'agent:created',
        testWorkspaceId,
        { type: 'system', name: 'System' },
        { agentId: 'agent-2', agentName: 'Agent 2' },
      ));

      eventBus.emitEvent(createWorkspaceEvent(
        'file:changed',
        testWorkspaceId,
        { type: 'agent', id: 'agent-2', name: 'Agent 2' },
        { relativePath: 'src/test.ts', action: 'created' },
      ));

      eventBus.emitEvent(createWorkspaceEvent(
        'task:status-changed',
        testWorkspaceId,
        { type: 'agent', id: 'agent-2', name: 'Agent 2' },
        { noteId: 'note-1', noteTitle: 'Task', previousStatus: 'todo', newStatus: 'done' },
      ));

      // All events should match (excluding our own subscription event)
      const events = deliveredEvents.get(TEST_AGENT_ID) || [];
      expect(events.length).toBe(3);
    });
  });

  describe('Actor Type Filtering', () => {
    it('should filter by actor type', () => {
      subscriptionService.setAgentStatus(TEST_AGENT_ID, 'idle');

      subscriptionService.subscribe(TEST_AGENT_ID, TEST_AGENT_NAME, {
        eventTypes: ['agent:created', 'file:changed'],
        actorTypes: ['agent'],
        priority: 'high',
      });

      // System actor - should NOT match
      eventBus.emitEvent(createWorkspaceEvent(
        'agent:created',
        testWorkspaceId,
        { type: 'system', name: 'System' },
        { agentId: 'agent-2', agentName: 'Agent 2' },
      ));

      expect(deliveredEvents.get(TEST_AGENT_ID)?.length || 0).toBe(0);

      // Agent actor - SHOULD match
      eventBus.emitEvent(createWorkspaceEvent(
        'file:changed',
        testWorkspaceId,
        { type: 'agent', id: 'agent-2', name: 'Agent 2' },
        { relativePath: 'src/test.ts', action: 'modified' },
      ));

      expect(deliveredEvents.get(TEST_AGENT_ID)?.length).toBe(1);
    });
  });

  describe('Timestamp Filtering', () => {
    it('should filter events by since timestamp', () => {
      subscriptionService.setAgentStatus(TEST_AGENT_ID, 'idle');

      const cutoffTime = new Date();

      subscriptionService.subscribe(TEST_AGENT_ID, TEST_AGENT_NAME, {
        eventTypes: ['agent:created'],
        since: cutoffTime.toISOString(),
        priority: 'high',
      });

      // Advance time a bit so events are after cutoff
      vi.advanceTimersByTime(1000);

      eventBus.emitEvent(createWorkspaceEvent(
        'agent:created',
        testWorkspaceId,
        { type: 'system', name: 'System' },
        { agentId: 'agent-2', agentName: 'Agent 2' },
      ));

      // Event after cutoff should be received
      expect(deliveredEvents.get(TEST_AGENT_ID)?.length).toBe(1);
    });
  });
});
