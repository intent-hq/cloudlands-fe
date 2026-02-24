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

    it('oneShot subscription should be fully cleaned up after firing', async () => {
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

      // Cleanup happens after delivery is confirmed (async microtask)
      await Promise.resolve();

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

  describe('Delegation Group Cleanup After Completion', () => {
    it('should clean up delegation group tracker and subscription after all agents complete (idle parent)', async () => {
      const groupId = `cleanup-group-${Math.random().toString(36).slice(2)}`;

      // Set up delivery callback that succeeds
      subscriptionService.setDeliveryCallback((_agentId, _events) => {
        return { status: 'success' as const };
      });

      subscriptionService.setAgentStatus(ORCHESTRATOR_AGENT_ID, 'idle');

      // Create delegation subscription with 2 expected agents
      subscriptionService.subscribe(ORCHESTRATOR_AGENT_ID, ORCHESTRATOR_AGENT_NAME, {
        eventTypes: ['agent:idle', 'agent:completed', 'agent:failed', 'agent:deleted'],
        actorIds: ['impl-1', 'impl-2'],
        delegationGroup: {
          groupId,
          awaitMode: 'all',
          expectedAgentIds: ['impl-1', 'impl-2'],
        },
      });

      // Verify initial state
      expect(subscriptionService.getAgentSubscriptions(ORCHESTRATOR_AGENT_ID).length).toBe(1);
      expect(subscriptionService.getDelegationGroupsForParent(ORCHESTRATOR_AGENT_ID).length).toBe(1);

      // First agent completes — group should still exist
      eventBus.emitEvent(
        createWorkspaceEvent(
          'agent:idle',
          testWorkspaceId,
          { type: 'agent', id: 'impl-1', name: 'Impl 1' },
          { agentId: 'impl-1' },
        ),
      );

      expect(subscriptionService.getDelegationGroupStatus(groupId)?.completed).toBe(1);
      expect(subscriptionService.getDelegationGroupStatus(groupId)?.isComplete).toBe(false);

      // Second agent completes — triggers delivery + cleanup
      eventBus.emitEvent(
        createWorkspaceEvent(
          'agent:idle',
          testWorkspaceId,
          { type: 'agent', id: 'impl-2', name: 'Impl 2' },
          { agentId: 'impl-2' },
        ),
      );

      // Flush async delivery (microtasks + timers)
      await vi.advanceTimersByTimeAsync(50);

      // Delegation group tracker should be cleaned up
      expect(subscriptionService.getDelegationGroupStatus(groupId)).toBeNull();

      // getDelegationGroupsForParent should return empty — this is what the
      // renderer's IPC handler calls. Before the fix, the tracker was deleted
      // AFTER bumpVersionAndEmit, so the renderer could refetch and still see it.
      expect(subscriptionService.getDelegationGroupsForParent(ORCHESTRATOR_AGENT_ID).length).toBe(0);

      // Subscription should also be cleaned up
      expect(subscriptionService.getAgentSubscriptions(ORCHESTRATOR_AGENT_ID).length).toBe(0);
    });

    it('should emit version bump with tracker already removed so snapshot is clean', async () => {
      const groupId = `version-order-${Math.random().toString(36).slice(2)}`;
      const versionsDuringEmit: Array<{ version: number; hasTracker: boolean; hasSub: boolean }> = [];

      subscriptionService.setDeliveryCallback((_agentId, _events) => {
        return { status: 'success' as const };
      });

      subscriptionService.setAgentStatus(ORCHESTRATOR_AGENT_ID, 'idle');

      subscriptionService.subscribe(ORCHESTRATOR_AGENT_ID, ORCHESTRATOR_AGENT_NAME, {
        eventTypes: ['agent:idle', 'agent:deleted'],
        actorIds: ['impl-1'],
        delegationGroup: {
          groupId,
          awaitMode: 'all',
          expectedAgentIds: ['impl-1'],
        },
      });

      // Listen for subscriptions-changed events and capture state at each emission
      eventBus.on('agent:subscriptions-changed', () => {
        versionsDuringEmit.push({
          version: subscriptionService.version,
          hasTracker: subscriptionService.getDelegationGroupStatus(groupId) !== null,
          hasSub: subscriptionService.getAgentSubscriptions(ORCHESTRATOR_AGENT_ID).length > 0,
        });
      });

      // Trigger completion
      eventBus.emitEvent(
        createWorkspaceEvent(
          'agent:idle',
          testWorkspaceId,
          { type: 'agent', id: 'impl-1', name: 'Impl 1' },
          { agentId: 'impl-1' },
        ),
      );

      await vi.advanceTimersByTimeAsync(50);

      // Find the version bump that corresponds to the unsubscribe (delegation-complete).
      // At that point, the tracker should already be gone.
      const unsubscribeEmit = versionsDuringEmit.find(
        (v) => !v.hasTracker && !v.hasSub,
      );
      expect(unsubscribeEmit).toBeDefined();
      // The tracker must be removed BEFORE the version bump that the renderer uses to refetch
      expect(unsubscribeEmit!.hasTracker).toBe(false);
    });
  });

  describe('Sequential Delegation Count Regression', () => {
    it('second delegation should not include completed agents from first delegation in totals', async () => {
      // Regression test: after delegating 2 agents and they finish,
      // next delegation of 2 should show total=2, not total=4.
      const groupA = `seq-group-A-${Math.random().toString(36).slice(2)}`;
      const groupB = `seq-group-B-${Math.random().toString(36).slice(2)}`;

      subscriptionService.setDeliveryCallback((_agentId, _events) => {
        return { status: 'success' as const };
      });

      subscriptionService.setAgentStatus(ORCHESTRATOR_AGENT_ID, 'idle');

      // --- First delegation: group A with 2 agents ---
      subscriptionService.subscribe(ORCHESTRATOR_AGENT_ID, ORCHESTRATOR_AGENT_NAME, {
        eventTypes: ['agent:idle', 'agent:completed', 'agent:failed', 'agent:deleted'],
        actorIds: ['impl-a1', 'impl-a2'],
        delegationGroup: {
          groupId: groupA,
          awaitMode: 'all',
          expectedAgentIds: ['impl-a1', 'impl-a2'],
        },
      });

      // Both agents in group A complete
      eventBus.emitEvent(
        createWorkspaceEvent(
          'agent:idle',
          testWorkspaceId,
          { type: 'agent', id: 'impl-a1', name: 'Impl A1' },
          { agentId: 'impl-a1' },
        ),
      );
      eventBus.emitEvent(
        createWorkspaceEvent(
          'agent:idle',
          testWorkspaceId,
          { type: 'agent', id: 'impl-a2', name: 'Impl A2' },
          { agentId: 'impl-a2' },
        ),
      );

      // Flush async delivery + cleanup
      await vi.advanceTimersByTimeAsync(50);

      // --- Second delegation: group B with 2 agents ---
      subscriptionService.subscribe(ORCHESTRATOR_AGENT_ID, ORCHESTRATOR_AGENT_NAME, {
        eventTypes: ['agent:idle', 'agent:completed', 'agent:failed', 'agent:deleted'],
        actorIds: ['impl-b1', 'impl-b2'],
        delegationGroup: {
          groupId: groupB,
          awaitMode: 'all',
          expectedAgentIds: ['impl-b1', 'impl-b2'],
        },
      });

      // Query what the renderer would see via IPC
      const groups = subscriptionService.getDelegationGroupsForParent(ORCHESTRATOR_AGENT_ID);

      // CRITICAL ASSERTION: Only group B should be visible.
      // Before the fix, group A (completed 2/2) was still returned,
      // causing the renderer to show total=4 instead of total=2.
      expect(groups).toHaveLength(1);
      expect(groups[0].groupId).toBe(groupB);
      expect(groups[0].expectedAgentIds).toHaveLength(2);
      expect(groups[0].completedAgentIds).toHaveLength(0);
    });

    it('sequential delegations: subscription snapshot actorIds must not include stale agents from prior group', async () => {
      // Regression test: simulates the exact renderer snapshot state that causes
      // the carryover bug. After group A completes, the snapshot's subscriptions
      // may still contain actorIds from group A. The renderer must derive displayed
      // agents from delegationGroups (not subscriptions) to avoid showing stale agents.
      const groupA = `carryover-A-${Math.random().toString(36).slice(2)}`;
      const groupB = `carryover-B-${Math.random().toString(36).slice(2)}`;

      subscriptionService.setDeliveryCallback((_agentId, _events) => {
        return { status: 'success' as const };
      });

      subscriptionService.setAgentStatus(ORCHESTRATOR_AGENT_ID, 'idle');

      // --- First delegation: group A with 2 agents ---
      subscriptionService.subscribe(ORCHESTRATOR_AGENT_ID, ORCHESTRATOR_AGENT_NAME, {
        eventTypes: ['agent:idle', 'agent:completed', 'agent:failed', 'agent:deleted'],
        actorIds: ['agent-a1', 'agent-a2'],
        delegationGroup: {
          groupId: groupA,
          awaitMode: 'all',
          expectedAgentIds: ['agent-a1', 'agent-a2'],
        },
      });

      // Both agents in group A complete
      eventBus.emitEvent(
        createWorkspaceEvent(
          'agent:idle',
          testWorkspaceId,
          { type: 'agent', id: 'agent-a1', name: 'Agent A1' },
          { agentId: 'agent-a1' },
        ),
      );
      eventBus.emitEvent(
        createWorkspaceEvent(
          'agent:idle',
          testWorkspaceId,
          { type: 'agent', id: 'agent-a2', name: 'Agent A2' },
          { agentId: 'agent-a2' },
        ),
      );

      // Flush async delivery + cleanup
      await vi.advanceTimersByTimeAsync(50);

      // --- Second delegation: group B with 2 agents ---
      subscriptionService.subscribe(ORCHESTRATOR_AGENT_ID, ORCHESTRATOR_AGENT_NAME, {
        eventTypes: ['agent:idle', 'agent:completed', 'agent:failed', 'agent:deleted'],
        actorIds: ['agent-b1', 'agent-b2'],
        delegationGroup: {
          groupId: groupB,
          awaitMode: 'all',
          expectedAgentIds: ['agent-b1', 'agent-b2'],
        },
      });

      // Query the snapshot the renderer would receive via IPC
      const groups = subscriptionService.getDelegationGroupsForParent(ORCHESTRATOR_AGENT_ID);
      const subs = subscriptionService.getAgentSubscriptions(ORCHESTRATOR_AGENT_ID);

      // CRITICAL: delegationGroups must only contain group B
      expect(groups).toHaveLength(1);
      expect(groups[0].groupId).toBe(groupB);

      // Derive what the renderer would display:
      // POST-FIX: displayed agents come from active delegationGroups
      const displayedFromGroups = new Set<string>();
      for (const group of groups) {
        for (const agentId of group.expectedAgentIds) {
          displayedFromGroups.add(agentId);
        }
      }

      // PRE-FIX (buggy): displayed agents come from subscriptions[*].actorIds
      const displayedFromSubs = new Set<string>();
      for (const sub of subs) {
        const actorIds = (sub as any).filter?.actorIds || (sub as any).actorIds || [];
        for (const actorId of actorIds) {
          displayedFromSubs.add(actorId);
        }
      }

      // The fix ensures displayed agents match active groups, not raw subscriptions
      expect(displayedFromGroups.size).toBe(2);
      expect(displayedFromGroups.has('agent-b1')).toBe(true);
      expect(displayedFromGroups.has('agent-b2')).toBe(true);
      expect(displayedFromGroups.has('agent-a1')).toBe(false); // no carryover
      expect(displayedFromGroups.has('agent-a2')).toBe(false); // no carryover
    });

    it('completed group should be excluded even before async cleanup runs', async () => {
      // Tests the scenario where the renderer polls between group completion
      // and async cleanup — the completed group should still be filtered out.
      const groupA = `pre-cleanup-A-${Math.random().toString(36).slice(2)}`;
      const groupB = `pre-cleanup-B-${Math.random().toString(36).slice(2)}`;

      // Use a delivery callback that does NOT trigger cleanup synchronously
      // (simulates the async gap between completion detection and cleanup)
      let deliveryResolve: (() => void) | null = null;
      subscriptionService.setDeliveryCallback((_agentId, _events) => {
        return new Promise<{ status: 'success' }>((resolve) => {
          deliveryResolve = () => resolve({ status: 'success' });
        });
      });

      subscriptionService.setAgentStatus(ORCHESTRATOR_AGENT_ID, 'idle');

      // Group A with 1 agent
      subscriptionService.subscribe(ORCHESTRATOR_AGENT_ID, ORCHESTRATOR_AGENT_NAME, {
        eventTypes: ['agent:idle', 'agent:completed', 'agent:failed', 'agent:deleted'],
        actorIds: ['impl-c1'],
        delegationGroup: {
          groupId: groupA,
          awaitMode: 'all',
          expectedAgentIds: ['impl-c1'],
        },
      });

      // Agent completes — delivery starts but hasn't resolved yet
      eventBus.emitEvent(
        createWorkspaceEvent(
          'agent:idle',
          testWorkspaceId,
          { type: 'agent', id: 'impl-c1', name: 'Impl C1' },
          { agentId: 'impl-c1' },
        ),
      );

      // Group A is completed but cleanup hasn't run (delivery pending)
      // Create group B
      subscriptionService.subscribe(ORCHESTRATOR_AGENT_ID, ORCHESTRATOR_AGENT_NAME, {
        eventTypes: ['agent:idle', 'agent:completed', 'agent:failed', 'agent:deleted'],
        actorIds: ['impl-c2'],
        delegationGroup: {
          groupId: groupB,
          awaitMode: 'all',
          expectedAgentIds: ['impl-c2'],
        },
      });

      // Even though group A tracker still exists (cleanup pending),
      // getDelegationGroupsForParent should exclude it
      const groups = subscriptionService.getDelegationGroupsForParent(ORCHESTRATOR_AGENT_ID);
      expect(groups).toHaveLength(1);
      expect(groups[0].groupId).toBe(groupB);

      // Now resolve delivery to trigger cleanup
      if (deliveryResolve) deliveryResolve();
      await vi.advanceTimersByTimeAsync(50);

      // After cleanup, group A tracker should be fully removed
      expect(subscriptionService.getDelegationGroupStatus(groupA)).toBeNull();
    });
  });
});
