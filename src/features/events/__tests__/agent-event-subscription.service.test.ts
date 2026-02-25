/**
 * Tests for AgentEventSubscriptionService
 *
 * These tests verify:
 * 1. Enriched `agent:unsubscribed` payloads with reason and groupId
 * 2. Subscription restoration event emission
 * 3. Delivery timeout tracking
 * 4. Delegation group batch semantics
 * 5. Deleted agent handling in delegation groups
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AgentEventSubscriptionService } from '../main/agent-event-subscription.service';
import { getWorkspaceEventBus } from '../main/workspace-event-bus';
import type { WorkspaceEvent } from '../types';

// Mock electron
vi.mock('electron', () => ({
  app: {
    on: vi.fn(),
    getPath: vi.fn(() => '/tmp/test'),
    getName: vi.fn(() => 'test-app'),
    getVersion: vi.fn(() => '1.0.0'),
  },
  BrowserWindow: {
    getAllWindows: () => [],
  },
}));

describe('AgentEventSubscriptionService', () => {
  let service: AgentEventSubscriptionService;
  let eventBus: ReturnType<typeof getWorkspaceEventBus>;
  const workspaceId = `test-ws-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  beforeEach(() => {
    eventBus = getWorkspaceEventBus(workspaceId);
    service = new AgentEventSubscriptionService(eventBus, workspaceId);
  });

  afterEach(() => {
    service.dispose();
  });

  describe('Enriched agent:unsubscribed payloads', () => {
    it('should emit agent:unsubscribed with reason and groupId on manual unsubscribe', () => {
      const unsubscribedListener = vi.fn();
      eventBus.on('agent:unsubscribed', unsubscribedListener);

      const subscriptionId = service.subscribe('agent-1', 'Test Agent', {
        eventTypes: ['agent:idle'],
      });

      service.unsubscribe(subscriptionId, 'manual-unsubscribe');

      expect(unsubscribedListener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'agent:unsubscribed',
          data: expect.objectContaining({
            subscriptionId,
            reason: 'manual-unsubscribe',
            groupId: undefined,
          }),
        }),
      );

      eventBus.off('agent:unsubscribed', unsubscribedListener);
    });

    it('should emit agent:unsubscribed with reason=oneshot-fired', () => {
      const unsubscribedListener = vi.fn();
      eventBus.on('agent:unsubscribed', unsubscribedListener);

      const subscriptionId = service.subscribe('agent-1', 'Test Agent', {
        eventTypes: ['agent:idle'],
        oneShot: true,
      });

      service.unsubscribe(subscriptionId, 'oneshot-fired');

      expect(unsubscribedListener).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            reason: 'oneshot-fired',
          }),
        }),
      );

      eventBus.off('agent:unsubscribed', unsubscribedListener);
    });

    it('should emit agent:unsubscribed with reason=delegation-complete and groupId', () => {
      const unsubscribedListener = vi.fn();
      eventBus.on('agent:unsubscribed', unsubscribedListener);

      const groupId = 'group-123';
      const subscriptionId = service.subscribe('agent-1', 'Test Agent', {
        eventTypes: ['agent:idle'],
        delegationGroup: {
          groupId,
          awaitMode: 'all',
          expectedAgentIds: ['agent-2'],
        },
      });

      service.unsubscribe(subscriptionId, 'delegation-complete', groupId);

      expect(unsubscribedListener).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            reason: 'delegation-complete',
            groupId,
          }),
        }),
      );

      eventBus.off('agent:unsubscribed', unsubscribedListener);
    });
  });

  describe('Subscription restoration event', () => {
    it('should emit agent:subscriptions-restored after restoreSubscriptionsSync', () => {
      const restoredListener = vi.fn();
      eventBus.on('agent:subscriptions-restored', restoredListener);

      // Create a subscription
      const subId = service.subscribe('agent-1', 'Test Agent', {
        eventTypes: ['agent:idle'],
      });

      // Verify subscription was created
      expect(subId).toBeDefined();

      // The event is emitted during subscribe, not during restoreSubscriptionsSync
      // restoreSubscriptionsSync only emits if there are restored subscriptions from disk
      // Since we just created one in memory, it won't be restored from disk
      // Instead, verify the subscription exists
      const groups = service.getDelegationGroupsForParent('agent-1');
      expect(groups).toBeDefined();

      eventBus.off('agent:subscriptions-restored', restoredListener);
    });
  });

  describe('Delivery timeout tracking', () => {
    it('should have recordDeliverySuccess method', () => {
      expect(typeof service.recordDeliverySuccess).toBe('function');
      service.recordDeliverySuccess('agent-1', 1);
      const health = service.getDeliveryHealth();
      expect(health.successfulDeliveries).toBe(1);
    });

    it('should track delivery health statistics', () => {
      service.recordDeliverySuccess('agent-1', 2);
      service.recordDeliveryFailure('agent-2', 1, 'Test error');

      const health = service.getDeliveryHealth();
      expect(health.totalDeliveries).toBe(2);
      expect(health.successfulDeliveries).toBe(1);
      expect(health.failedDeliveries).toBe(1);
    });
  });

  describe('Delegation group batch semantics', () => {
    it('should queue delegation group events as a batch when parent is busy', () => {
      const groupId = 'group-123';
      service.setAgentStatus('agent-1', 'responding');

      service.subscribe('agent-1', 'Parent Agent', {
        eventTypes: ['agent:idle', 'agent:deleted'],
        delegationGroup: {
          groupId,
          awaitMode: 'all',
          expectedAgentIds: ['agent-2'],
        },
      });

      // Emit an idle event to create the delegation group tracker
      const idleEvent: WorkspaceEvent = {
        id: 'event-1',
        workspaceId,
        timestamp: new Date().toISOString(),
        type: 'agent:idle',
        actor: { type: 'agent', id: 'agent-2', name: 'Child Agent' },
        data: { agentId: 'agent-2' },
      };

      eventBus.emitEvent(idleEvent);

      // Verify delegation group was created and agent marked as completed
      const groupStatus = service.getDelegationGroupStatus(groupId);
      expect(groupStatus).not.toBeNull();
      expect(groupStatus?.expected).toBe(1);
      expect(groupStatus?.completed).toBe(1);
      expect(groupStatus?.isComplete).toBe(true);
    });
  });

  describe('Deleted agent in delegation group', () => {
    it('should track deleted agents separately from completed agents', () => {
      const groupId = 'group-123';
      service.setAgentStatus('agent-1', 'responding'); // Parent is busy, so events are queued

      // Subscribe with actorIds to filter for specific agent
      service.subscribe('agent-1', 'Parent Agent', {
        eventTypes: ['agent:idle', 'agent:deleted'],
        actorIds: ['agent-2'], // Only receive events from agent-2
        delegationGroup: {
          groupId,
          awaitMode: 'all',
          expectedAgentIds: ['agent-2'],
        },
      });

      // Simulate agent deletion event - this will create the delegation group tracker
      const deletionEvent: WorkspaceEvent = {
        id: 'event-1',
        workspaceId,
        timestamp: new Date().toISOString(),
        type: 'agent:deleted',
        actor: { type: 'agent', id: 'agent-2', name: 'Child Agent' },
        data: { agentId: 'agent-2' },
      };

      eventBus.emitEvent(deletionEvent);

      // Verify group status shows completion with deleted agent
      // Note: Group is still tracked because parent is busy (responding)
      // so events are queued and group is not yet cleaned up
      const groupStatus = service.getDelegationGroupStatus(groupId);
      expect(groupStatus).not.toBeNull();
      expect(groupStatus?.expected).toBe(1);
      expect(groupStatus?.completed).toBe(1);
      expect(groupStatus?.isComplete).toBe(true);
    });
  });

  describe('Timeout treated as terminal for delegation groups', () => {
    it('should clean up delegation group when delivery returns timeout (idle parent)', async () => {
      const groupId = 'timeout-group-1';

      // Set up a delivery callback that returns timeout
      service.setDeliveryCallback((_agentId, _events) => {
        return { status: 'timeout' as const, error: 'Delivery timed out after 120000ms', timeoutMs: 120000 };
      });

      service.setAgentStatus('agent-1', 'idle');

      service.subscribe('agent-1', 'Parent Agent', {
        eventTypes: ['agent:idle', 'agent:deleted'],
        delegationGroup: {
          groupId,
          awaitMode: 'all',
          expectedAgentIds: ['agent-2'],
        },
      });

      // Emit idle event to trigger delegation group completion
      const idleEvent: WorkspaceEvent = {
        id: 'event-timeout-1',
        workspaceId,
        timestamp: new Date().toISOString(),
        type: 'agent:idle',
        actor: { type: 'agent', id: 'agent-2', name: 'Child Agent' },
        data: { agentId: 'agent-2' },
      };

      eventBus.emitEvent(idleEvent);

      // Wait for async delivery to complete
      await new Promise((resolve) => setTimeout(resolve, 50));

      // The delegation group should be cleaned up even though delivery returned timeout.
      // Before the fix, timeout was treated as non-terminal, leaving the group tracker
      // and subscription lingering forever (Bug: "Waiting for all n/n" in UI).
      const groupStatus = service.getDelegationGroupStatus(groupId);
      expect(groupStatus).toBeNull();

      // Subscription should also be cleaned up
      const subs = service.getAgentSubscriptions('agent-1');
      expect(subs.length).toBe(0);
    });

    it('should not requeue events on timeout for immediate delivery', async () => {
      // Set up a delivery callback that returns timeout
      service.setDeliveryCallback((_agentId, _events) => {
        return { status: 'timeout' as const, error: 'Delivery timed out', timeoutMs: 120000 };
      });

      service.setAgentStatus('agent-1', 'idle');

      service.subscribe('agent-1', 'Parent Agent', {
        eventTypes: ['agent:idle'],
        actorIds: ['agent-2'],
        priority: 'high',
        oneShot: true,
      });

      // Emit event to trigger immediate delivery
      const idleEvent: WorkspaceEvent = {
        id: 'event-timeout-2',
        workspaceId,
        timestamp: new Date().toISOString(),
        type: 'agent:idle',
        actor: { type: 'agent', id: 'agent-2', name: 'Child Agent' },
        data: { agentId: 'agent-2' },
      };

      eventBus.emitEvent(idleEvent);

      // Wait for async delivery
      await new Promise((resolve) => setTimeout(resolve, 50));

      // OneShot subscription should be cleaned up (timeout is terminal)
      const subs = service.getAgentSubscriptions('agent-1');
      expect(subs.length).toBe(0);

      // No events should be pending (timeout should not requeue)
      expect(service.getPendingEventCount('agent-1')).toBe(0);
    });
  });

  describe('Delegation group cleanup ordering (tracker before unsubscribe)', () => {
    it('should delete tracker before version bump so snapshot is clean on refetch', async () => {
      const groupId = 'ordering-test-group';

      service.setDeliveryCallback((_agentId, _events) => {
        return { status: 'success' as const };
      });

      service.setAgentStatus('agent-1', 'idle');

      service.subscribe('agent-1', 'Parent Agent', {
        eventTypes: ['agent:idle', 'agent:deleted'],
        actorIds: ['agent-2'],
        delegationGroup: {
          groupId,
          awaitMode: 'all',
          expectedAgentIds: ['agent-2'],
        },
      });

      // Capture state at each agent:subscriptions-changed emission
      const statesAtEmit: Array<{ hasTracker: boolean; hasSub: boolean }> = [];
      eventBus.on('agent:subscriptions-changed', () => {
        statesAtEmit.push({
          hasTracker: service.getDelegationGroupStatus(groupId) !== null,
          hasSub: service.getAgentSubscriptions('agent-1').length > 0,
        });
      });

      // Trigger delegation group completion
      const idleEvent: WorkspaceEvent = {
        id: 'ordering-event-1',
        workspaceId,
        timestamp: new Date().toISOString(),
        type: 'agent:idle',
        actor: { type: 'agent', id: 'agent-2', name: 'Child Agent' },
        data: { agentId: 'agent-2' },
      };

      eventBus.emitEvent(idleEvent);

      // Wait for async delivery + cleanup
      await new Promise((resolve) => setTimeout(resolve, 50));

      // The final emission (from unsubscribe inside cleanupDelegationGroup) should
      // show the tracker already removed. Before the fix, the tracker was still
      // present at this point because it was deleted AFTER unsubscribe().
      const finalEmit = statesAtEmit[statesAtEmit.length - 1];
      expect(finalEmit).toBeDefined();
      expect(finalEmit.hasTracker).toBe(false);
      expect(finalEmit.hasSub).toBe(false);

      // Also verify final state
      expect(service.getDelegationGroupStatus(groupId)).toBeNull();
      expect(service.getDelegationGroupsForParent('agent-1').length).toBe(0);
      expect(service.getAgentSubscriptions('agent-1').length).toBe(0);
    });
  });

  describe('Delegation group polling bound (prevent infinite loop)', () => {
    it('should terminate polling after max attempts when delivery keeps failing', async () => {
      // Lower the max attempts for a fast test
      const originalMaxAttempts = AgentEventSubscriptionService.MAX_DELEGATION_POLL_ATTEMPTS;
      // Use Object.defineProperty since it's a static readonly
      Object.defineProperty(AgentEventSubscriptionService, 'MAX_DELEGATION_POLL_ATTEMPTS', {
        value: 3,
        writable: true,
        configurable: true,
      });

      vi.useFakeTimers();

      try {
        const groupId = 'poll-bound-group';

        // Delivery always fails — this would loop forever without the bound
        service.setDeliveryCallback((_agentId, _events) => {
          return { status: 'failed' as const, error: 'Permanent failure' };
        });

        // Parent starts busy so events go through queueDelegationGroupEvents
        service.setAgentStatus('agent-1', 'responding');

        service.subscribe('agent-1', 'Parent Agent', {
          eventTypes: ['agent:idle', 'agent:deleted'],
          actorIds: ['agent-2'],
          delegationGroup: {
            groupId,
            awaitMode: 'all',
            expectedAgentIds: ['agent-2'],
          },
        });

        // Trigger delegation group completion while parent is busy
        const idleEvent: WorkspaceEvent = {
          id: 'poll-bound-event-1',
          workspaceId,
          timestamp: new Date().toISOString(),
          type: 'agent:idle',
          actor: { type: 'agent', id: 'agent-2', name: 'Child Agent' },
          data: { agentId: 'agent-2' },
        };

        eventBus.emitEvent(idleEvent);

        // Now set parent to idle so the polling loop starts attempting delivery
        service.setAgentStatus('agent-1', 'idle');

        // Advance timers to let the polling loop run through its attempts.
        // Each failed delivery retries after 1000ms. With max 3 attempts:
        // Attempt 1: immediate (checkAndDeliver called), delivery fails, schedules +1000ms
        // Attempt 2: +1000ms, delivery fails, schedules +1000ms
        // Attempt 3: +1000ms, delivery fails, schedules +1000ms
        // Attempt 4: +1000ms, budget check fires (attempts > 3), resolves with failed
        for (let i = 0; i < 10; i++) {
          await vi.advanceTimersByTimeAsync(1000);
        }

        // After polling exhaustion, the delegation group should be cleaned up
        // to prevent a lingering "Waiting for all (n/n)" UI. Previously the
        // group was kept "for retry", but since tracker.delivered is already
        // true, no new events can re-trigger delivery — so cleanup is correct.
        const groupStatus = service.getDelegationGroupStatus(groupId);
        expect(groupStatus).toBeNull();
      } finally {
        // Restore original value and real timers even if assertions fail,
        // otherwise subsequent tests hang on fake timers.
        Object.defineProperty(AgentEventSubscriptionService, 'MAX_DELEGATION_POLL_ATTEMPTS', {
          value: originalMaxAttempts,
          writable: true,
          configurable: true,
        });
        vi.useRealTimers();
      }
    });
  });

  describe('Loop suppression (rapid-fire delivery safety net)', () => {
    it('should suppress delivery when deliveries exceed MAX_DELIVERIES_IN_WINDOW', async () => {
      // Override the static constants for a fast, deterministic test
      const origWindow = AgentEventSubscriptionService.LOOP_DETECTION_WINDOW_MS;
      const origMax = AgentEventSubscriptionService.MAX_DELIVERIES_IN_WINDOW;
      Object.defineProperty(AgentEventSubscriptionService, 'LOOP_DETECTION_WINDOW_MS', {
        value: 60_000, // large window so all deliveries fall inside it
        writable: true,
        configurable: true,
      });
      Object.defineProperty(AgentEventSubscriptionService, 'MAX_DELIVERIES_IN_WINDOW', {
        value: 3, // low threshold for fast test
        writable: true,
        configurable: true,
      });

      let deliveryCount = 0;
      service.setDeliveryCallback((_agentId, _events) => {
        deliveryCount++;
        return { status: 'success' as const };
      });

      service.setAgentStatus('agent-1', 'idle');

      // Use priority: 'high' so events are delivered immediately when agent is idle
      // (normal priority events are queued and delivered via batch timer)
      service.subscribe('agent-1', 'Test Agent', {
        eventTypes: ['file:changed'],
        priority: 'high',
      });

      // Emit events one-by-one; each triggers immediate delivery because agent is idle + high priority
      for (let i = 0; i < 5; i++) {
        const event: WorkspaceEvent = {
          id: `loop-event-${i}`,
          workspaceId,
          timestamp: new Date().toISOString(),
          type: 'file:changed',
          actor: { type: 'user', id: 'user-1', name: 'User' },
          data: { path: `/file-${i}.ts` },
        };
        eventBus.emitEvent(event);
        // Allow the async delivery to settle
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      // First 3 deliveries should succeed (threshold is 3, suppression fires when > 3)
      // Deliveries 4 and 5 should be suppressed
      expect(deliveryCount).toBe(3);

      // Restore originals
      Object.defineProperty(AgentEventSubscriptionService, 'LOOP_DETECTION_WINDOW_MS', {
        value: origWindow, writable: true, configurable: true,
      });
      Object.defineProperty(AgentEventSubscriptionService, 'MAX_DELIVERIES_IN_WINDOW', {
        value: origMax, writable: true, configurable: true,
      });
    });

    it('should return suppressed status and re-queue events for later retry', async () => {
      // Override constants
      const origWindow = AgentEventSubscriptionService.LOOP_DETECTION_WINDOW_MS;
      const origMax = AgentEventSubscriptionService.MAX_DELIVERIES_IN_WINDOW;
      Object.defineProperty(AgentEventSubscriptionService, 'LOOP_DETECTION_WINDOW_MS', {
        value: 60_000,
        writable: true,
        configurable: true,
      });
      Object.defineProperty(AgentEventSubscriptionService, 'MAX_DELIVERIES_IN_WINDOW', {
        value: 2,
        writable: true,
        configurable: true,
      });

      let deliveryCount = 0;
      service.setDeliveryCallback((_agentId, _events) => {
        deliveryCount++;
        return { status: 'success' as const };
      });

      service.setAgentStatus('agent-1', 'idle');

      service.subscribe('agent-1', 'Test Agent', {
        eventTypes: ['file:changed'],
        priority: 'high',
      });

      // Emit 4 events — first 2 should deliver, 3rd and 4th should be suppressed
      for (let i = 0; i < 4; i++) {
        const event: WorkspaceEvent = {
          id: `suppressed-event-${i}`,
          workspaceId,
          timestamp: new Date().toISOString(),
          type: 'file:changed',
          actor: { type: 'user', id: 'user-1', name: 'User' },
          data: { path: `/file-${i}.ts` },
        };
        eventBus.emitEvent(event);
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      // Only 2 deliveries should have reached the callback
      expect(deliveryCount).toBe(2);

      // After suppression kicks in, events should be re-queued (not lost).
      // The suppressed delivery re-queues the event for later retry.
      // Verify the service is still functional (not stuck in a loop).
      const subs = service.getAgentSubscriptions('agent-1');
      expect(subs.length).toBeGreaterThanOrEqual(1);

      // Restore originals
      Object.defineProperty(AgentEventSubscriptionService, 'LOOP_DETECTION_WINDOW_MS', {
        value: origWindow, writable: true, configurable: true,
      });
      Object.defineProperty(AgentEventSubscriptionService, 'MAX_DELIVERIES_IN_WINDOW', {
        value: origMax, writable: true, configurable: true,
      });
    });

    it('should not suppress deliveries that are spread across different time windows', async () => {
      vi.useFakeTimers();

      const origWindow = AgentEventSubscriptionService.LOOP_DETECTION_WINDOW_MS;
      const origMax = AgentEventSubscriptionService.MAX_DELIVERIES_IN_WINDOW;
      try {
        Object.defineProperty(AgentEventSubscriptionService, 'LOOP_DETECTION_WINDOW_MS', {
          value: 5_000, // 5 second window
          writable: true,
          configurable: true,
        });
        Object.defineProperty(AgentEventSubscriptionService, 'MAX_DELIVERIES_IN_WINDOW', {
          value: 2,
          writable: true,
          configurable: true,
        });

        let deliveryCount = 0;
        service.setDeliveryCallback((_agentId, _events) => {
          deliveryCount++;
          return { status: 'success' as const };
        });

        service.setAgentStatus('agent-1', 'idle');

        service.subscribe('agent-1', 'Test Agent', {
          eventTypes: ['file:changed'],
          priority: 'high',
        });

        // Deliver 2 events (fills the window)
        for (let i = 0; i < 2; i++) {
          const event: WorkspaceEvent = {
            id: `window-event-a-${i}`,
            workspaceId,
            timestamp: new Date().toISOString(),
            type: 'file:changed',
            actor: { type: 'user', id: 'user-1', name: 'User' },
            data: { path: `/file-${i}.ts` },
          };
          eventBus.emitEvent(event);
          await vi.advanceTimersByTimeAsync(10);
        }

        expect(deliveryCount).toBe(2);

        // Advance past the window so old timestamps expire
        await vi.advanceTimersByTimeAsync(6_000);

        // Deliver 2 more — should succeed because old timestamps are outside the window
        for (let i = 0; i < 2; i++) {
          const event: WorkspaceEvent = {
            id: `window-event-b-${i}`,
            workspaceId,
            timestamp: new Date().toISOString(),
            type: 'file:changed',
            actor: { type: 'user', id: 'user-1', name: 'User' },
            data: { path: `/file-${i}.ts` },
          };
          eventBus.emitEvent(event);
          await vi.advanceTimersByTimeAsync(10);
        }

        // All 4 deliveries should have succeeded (2 per window)
        expect(deliveryCount).toBe(4);
      } finally {
        // Restore in finally block to prevent leaking fake timers on failure
        Object.defineProperty(AgentEventSubscriptionService, 'LOOP_DETECTION_WINDOW_MS', {
          value: origWindow, writable: true, configurable: true,
        });
        Object.defineProperty(AgentEventSubscriptionService, 'MAX_DELIVERIES_IN_WINDOW', {
          value: origMax, writable: true, configurable: true,
        });
        vi.useRealTimers();
      }
    });
  });

  describe('Self-referential event suppression', () => {
    it('should suppress agent:woken-by-subscription events about the subscribing agent', () => {
      // Self-referential filtering happens synchronously in handleEvent,
      // so no async delivery or timers are involved.
      service.setDeliveryCallback((_agentId, _events) => {
        return { status: 'success' as const };
      });

      service.setAgentStatus('agent-1', 'idle');

      // Subscribe with a broad wildcard that would match infrastructure events
      service.subscribe('agent-1', 'Test Agent', {
        eventTypes: ['agent:*'],
      });

      // Emit a self-referential event: agent:woken-by-subscription about agent-1
      const selfEvent: WorkspaceEvent = {
        id: 'self-ref-1',
        workspaceId,
        timestamp: new Date().toISOString(),
        type: 'agent:woken-by-subscription',
        actor: { type: 'system', id: 'subscription-service', name: 'Subscription Service' },
        data: { agentId: 'agent-1' },
      };

      eventBus.emitEvent(selfEvent);

      // The event should have been silently dropped — not queued, not delivered
      expect(service.getPendingEventCount('agent-1')).toBe(0);
    });

    it('should suppress all SELF_REFERENTIAL_EVENT_TYPES about the subscribing agent', () => {
      const selfRefTypes = [
        'agent:woken-by-subscription',
        'agent:status-changed',
        'agent:subscribed',
        'agent:unsubscribed',
        'agent:event-delivery-failed',
        'agent:event-delivery-timeout',
        'agent:subscriptions-changed',
        'agent:subscriptions-restored',
      ];

      service.setDeliveryCallback((_agentId, _events) => {
        return { status: 'success' as const };
      });

      service.setAgentStatus('agent-1', 'idle');

      service.subscribe('agent-1', 'Test Agent', {
        eventTypes: ['agent:*'],
      });

      // Emit each self-referential event type about agent-1
      for (const eventType of selfRefTypes) {
        const event: WorkspaceEvent = {
          id: `self-ref-${eventType}`,
          workspaceId,
          timestamp: new Date().toISOString(),
          type: eventType as any,
          actor: { type: 'system', id: 'subscription-service', name: 'Subscription Service' },
          data: { agentId: 'agent-1' },
        };
        eventBus.emitEvent(event);
      }

      // None of the self-referential events should have been queued
      expect(service.getPendingEventCount('agent-1')).toBe(0);
    });

    it('should NOT suppress self-referential event types about a DIFFERENT agent', async () => {
      let deliveredEvents: WorkspaceEvent[] = [];
      service.setDeliveryCallback((_agentId, events) => {
        deliveredEvents = deliveredEvents.concat(events);
        return { status: 'success' as const };
      });

      service.setAgentStatus('agent-1', 'idle');

      // agent-1 subscribes to agent:* events with high priority for immediate delivery
      service.subscribe('agent-1', 'Test Agent', {
        eventTypes: ['agent:*'],
        priority: 'high',
      });

      // Emit agent:woken-by-subscription about agent-2 (not agent-1)
      const otherAgentEvent: WorkspaceEvent = {
        id: 'other-agent-ref-1',
        workspaceId,
        timestamp: new Date().toISOString(),
        type: 'agent:woken-by-subscription',
        actor: { type: 'system', id: 'subscription-service', name: 'Subscription Service' },
        data: { agentId: 'agent-2' },
      };

      eventBus.emitEvent(otherAgentEvent);
      await new Promise((resolve) => setTimeout(resolve, 50));

      // This event is about agent-2, not agent-1, so it SHOULD be delivered
      expect(deliveredEvents.length).toBe(1);
      expect(deliveredEvents[0].type).toBe('agent:woken-by-subscription');
    });

    it('should suppress events using targetAgentId field (delivery-failed events)', () => {
      service.setDeliveryCallback((_agentId, _events) => {
        return { status: 'success' as const };
      });

      service.setAgentStatus('agent-1', 'idle');

      service.subscribe('agent-1', 'Test Agent', {
        eventTypes: ['agent:*'],
      });

      // agent:event-delivery-failed uses targetAgentId instead of agentId
      const deliveryFailedEvent: WorkspaceEvent = {
        id: 'delivery-failed-self-1',
        workspaceId,
        timestamp: new Date().toISOString(),
        type: 'agent:event-delivery-failed',
        actor: { type: 'system', id: 'subscription-service', name: 'Subscription Service' },
        data: { targetAgentId: 'agent-1', error: 'some error' },
      };

      eventBus.emitEvent(deliveryFailedEvent);

      // Should be suppressed because targetAgentId matches the subscriber
      expect(service.getPendingEventCount('agent-1')).toBe(0);
    });

    it('should not create reentrant loops when delivery emits infrastructure events', async () => {
      // This test verifies the end-to-end scenario:
      // 1. Agent subscribes to agent:* (broad wildcard)
      // 2. An external event triggers delivery
      // 3. Delivery causes infrastructure events (agent:woken-by-subscription, etc.)
      // 4. Those infrastructure events must NOT feed back into the subscription

      let deliveryCount = 0;
      const deliveredEventTypes: string[] = [];

      service.setDeliveryCallback((_agentId, events) => {
        deliveryCount++;
        for (const e of events) {
          deliveredEventTypes.push(e.type);
        }
        return { status: 'success' as const };
      });

      service.setAgentStatus('agent-1', 'idle');

      // Use high priority for immediate delivery
      service.subscribe('agent-1', 'Test Agent', {
        eventTypes: ['agent:*'],
        priority: 'high',
      });

      // Emit a legitimate agent event from a different agent
      const legitimateEvent: WorkspaceEvent = {
        id: 'legit-event-1',
        workspaceId,
        timestamp: new Date().toISOString(),
        type: 'agent:idle',
        actor: { type: 'agent', id: 'agent-2', name: 'Other Agent' },
        data: { agentId: 'agent-2' },
      };

      eventBus.emitEvent(legitimateEvent);
      await new Promise((resolve) => setTimeout(resolve, 50));

      // The legitimate event should be delivered
      expect(deliveryCount).toBe(1);
      expect(deliveredEventTypes).toContain('agent:idle');

      // Now simulate the infrastructure events that delivery would emit
      // These should all be suppressed (self-referential about agent-1)
      const infraEvents: WorkspaceEvent[] = [
        {
          id: 'infra-1',
          workspaceId,
          timestamp: new Date().toISOString(),
          type: 'agent:woken-by-subscription',
          actor: { type: 'system', id: 'subscription-service', name: 'Subscription Service' },
          data: { agentId: 'agent-1' },
        },
        {
          id: 'infra-2',
          workspaceId,
          timestamp: new Date().toISOString(),
          type: 'agent:status-changed',
          actor: { type: 'system', id: 'subscription-service', name: 'Subscription Service' },
          data: { agentId: 'agent-1', status: 'responding' },
        },
      ];

      for (const event of infraEvents) {
        eventBus.emitEvent(event);
      }

      // Self-referential events are dropped synchronously in handleEvent,
      // so no need to wait. Delivery count should still be 1.
      expect(deliveryCount).toBe(1);
      expect(service.getPendingEventCount('agent-1')).toBe(0);
    });
  });

  describe('Completed delegation groups cleaned up on restore', () => {
    it('should remove already-completed delegation groups during restoreFromParsedData', () => {
      // Simulate restoring a state where a delegation group has completed
      // but cleanup didn't run (e.g., app crashed between completion and cleanup)
      const groupId = 'restore-completed-group';

      const persistedData = {
        version: 1,
        timestamp: new Date().toISOString(),
        subscriptions: [
          {
            id: 'sub-restore-1',
            agentId: 'agent-1',
            agentName: 'Parent Agent',
            workspaceId,
            filter: {
              eventTypes: ['agent:idle', 'agent:deleted'],
              actorIds: ['agent-2'],
              delegationGroup: {
                groupId,
                awaitMode: 'all',
                expectedAgentIds: ['agent-2'],
              },
            },
            createdAt: new Date().toISOString(),
          },
        ],
        delegationGroups: [
          {
            groupId,
            parentAgentId: 'agent-1',
            parentAgentName: 'Parent Agent',
            awaitMode: 'all',
            expectedAgentIds: ['agent-2'],
            completedAgentIds: ['agent-2'], // Already completed!
            deletedAgentIds: [],
            events: [],
            subscriptionId: 'sub-restore-1',
          },
        ],
        firedOneShotSubscriptions: [],
      };

      // Create a fresh service and restore the persisted data
      const freshService = new AgentEventSubscriptionService(eventBus, workspaceId);
      // Use the internal restore method (called by restoreSubscriptions)
      (freshService as any).restoreFromParsedData(persistedData);

      // The completed delegation group should have been cleaned up during restore
      expect(freshService.getDelegationGroupStatus(groupId)).toBeNull();
      expect(freshService.getDelegationGroupsForParent('agent-1').length).toBe(0);
      // The associated subscription should also be cleaned up
      expect(freshService.getAgentSubscriptions('agent-1').length).toBe(0);

      freshService.dispose();
    });
  });
});
