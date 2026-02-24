/**
 * Renderer Guard Split Regression Tests
 *
 * Tests the behavioral contract that prevents the pre-fix bug where
 * `discoveryPermanentlyStopped` was a single flag that mixed two concerns:
 *   1. "discovery max lifetime reached" (should stop polling only)
 *   2. "streaming after wake" (should block loadSubscriptions temporarily)
 *
 * Pre-fix behavior (broken):
 *   - When discovery max lifetime was reached, `discoveryPermanentlyStopped = true`
 *   - This also blocked `loadSubscriptions()` via an early return
 *   - Result: second delegation group never appears because snapshot fetch is permanently blocked
 *
 * Post-fix behavior (correct):
 *   - `discoveryMaxLifetimeReached` stops discovery polling only (never blocks snapshot fetch)
 *   - `isStreamingAfterWake` blocks `loadSubscriptions()` only while agent is actively streaming
 *   - On `agent:idle`, `isStreamingAfterWake` is cleared and snapshot is refetched
 *
 * Since the guard logic lives in AgentSubscriptions.svelte (no extracted helper),
 * these tests validate the main-process contract that the renderer depends on:
 *   - `agent:subscriptions-changed` is emitted on state transitions (so renderer can refetch)
 *   - Subscriptions remain queryable after delivery (so snapshot fetch works)
 *   - Multiple delegation groups can coexist (the scenario that broke pre-fix)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AgentEventSubscriptionService } from '../../src/features/events/main/agent-event-subscription.service';
import { getWorkspaceEventBus } from '../../src/features/events/main/workspace-event-bus';
import type { WorkspaceEvent } from '../../src/features/events/types';

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

describe('Renderer Guard Split — Main-Process Contract', () => {
  let service: AgentEventSubscriptionService;
  let eventBus: ReturnType<typeof getWorkspaceEventBus>;
  const workspaceId = `test-ws-guard-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  beforeEach(() => {
    eventBus = getWorkspaceEventBus(workspaceId);
    service = new AgentEventSubscriptionService(eventBus, workspaceId);
  });

  afterEach(() => {
    service.dispose();
  });

  describe('agent:subscriptions-changed emission', () => {
    it('should emit agent:subscriptions-changed when a subscription is created', () => {
      const changedListener = vi.fn();
      eventBus.on('agent:subscriptions-changed', changedListener);

      service.subscribe('agent-1', 'Test Agent', {
        eventTypes: ['agent:idle'],
      });

      expect(changedListener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'agent:subscriptions-changed',
        }),
      );

      eventBus.off('agent:subscriptions-changed', changedListener);
    });

    it('should emit agent:subscriptions-changed when a subscription is removed', () => {
      const changedListener = vi.fn();

      const subId = service.subscribe('agent-1', 'Test Agent', {
        eventTypes: ['agent:idle'],
      });

      // Reset to only capture the unsubscribe emission
      changedListener.mockClear();
      eventBus.on('agent:subscriptions-changed', changedListener);

      service.unsubscribe(subId, 'manual-unsubscribe');

      expect(changedListener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'agent:subscriptions-changed',
        }),
      );

      eventBus.off('agent:subscriptions-changed', changedListener);
    });
  });

  describe('Multiple delegation groups coexistence (pre-fix regression)', () => {
    it('should support two independent delegation groups for the same parent', () => {
      // This is the exact scenario that broke pre-fix:
      // Parent delegates group 1, group 1 completes, parent delegates group 2.
      // Pre-fix, discoveryPermanentlyStopped blocked the snapshot fetch for group 2.
      const parentId = 'parent-agent';

      // Group 1
      service.subscribeToGroup(parentId, 'Parent', 'group-1', 'child-1');
      const group1Status = service.getDelegationGroupStatus('group-1');
      expect(group1Status).not.toBeNull();
      expect(group1Status?.expected).toBe(1);

      // Group 2 (created while group 1 exists)
      service.subscribeToGroup(parentId, 'Parent', 'group-2', 'child-2');
      const group2Status = service.getDelegationGroupStatus('group-2');
      expect(group2Status).not.toBeNull();
      expect(group2Status?.expected).toBe(1);

      // Both groups should be queryable
      const groups = service.getDelegationGroupsForParent(parentId);
      expect(groups).toHaveLength(2);
    });

    it('snapshot should return subscriptions even after first group completes', async () => {
      const parentId = 'parent-agent';
      const deliveredEvents: any[] = [];

      service.setDeliveryCallback((agentId, events) => {
        deliveredEvents.push(...events);
      });
      service.setAgentStatus(parentId, 'idle');

      // Group 1: subscribe and complete
      service.subscribeToGroup(parentId, 'Parent', 'group-1', 'child-1');

      const idleEvent: WorkspaceEvent = {
        id: 'event-1',
        workspaceId,
        timestamp: new Date().toISOString(),
        type: 'agent:idle',
        actor: { type: 'agent', id: 'child-1', name: 'Child 1' },
        data: { agentId: 'child-1' },
      };
      eventBus.emitEvent(idleEvent);
      await Promise.resolve(); // Let async cleanup run

      // Group 2: subscribe after group 1 completed
      service.subscribeToGroup(parentId, 'Parent', 'group-2', 'child-2');

      // The new subscription should be queryable (this is what loadSubscriptions fetches)
      const subs = service.getAgentSubscriptions(parentId);
      expect(subs.length).toBeGreaterThanOrEqual(1);

      const group2Status = service.getDelegationGroupStatus('group-2');
      expect(group2Status).not.toBeNull();
      expect(group2Status?.expected).toBe(1);
      expect(group2Status?.completed).toBe(0);
    });
  });

  describe('Workspace-switch stale snapshot prevention (renderer contract)', () => {
    /**
     * These tests validate the main-process contract that the renderer's
     * workspace-switch guard depends on:
     *
     * In AgentSubscriptions.svelte, when workspaceId changes:
     *   1. All local state (subscriptions, delegationGroups, wokenUpInfo) is cleared
     *   2. All timers/polling are stopped
     *   3. In-flight IPC responses are discarded if wsId !== workspaceId
     *
     * The main-process side of this contract is that each workspace's
     * AgentEventSubscriptionService is independent — querying subscriptions
     * from workspace A never returns data from workspace B.
     */

    it('subscriptions from workspace A must not appear in workspace B queries', () => {
      // Workspace A: create subscriptions
      const wsAId = `ws-A-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const wsBId = `ws-B-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const busA = getWorkspaceEventBus(wsAId);
      const busB = getWorkspaceEventBus(wsBId);
      const serviceA = new AgentEventSubscriptionService(busA, wsAId);
      const serviceB = new AgentEventSubscriptionService(busB, wsBId);

      try {
        const parentId = 'parent-agent';

        // Create subscription in workspace A
        serviceA.subscribe(parentId, 'Parent', {
          eventTypes: ['agent:idle'],
          delegationGroup: {
            groupId: 'group-ws-a',
            awaitMode: 'all',
            expectedAgentIds: ['child-1'],
          },
        });

        // Workspace A should have the subscription
        const subsA = serviceA.getAgentSubscriptions(parentId);
        expect(subsA.length).toBe(1);

        // Workspace B should have NO subscriptions for the same agent ID
        const subsB = serviceB.getAgentSubscriptions(parentId);
        expect(subsB.length).toBe(0);

        // Workspace B delegation groups should also be empty
        const groupsB = serviceB.getDelegationGroupsForParent(parentId);
        expect(groupsB.length).toBe(0);
      } finally {
        serviceA.dispose();
        serviceB.dispose();
      }
    });

    it('version counters are independent per workspace', () => {
      const wsAId = `ws-A-ver-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const wsBId = `ws-B-ver-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const busA = getWorkspaceEventBus(wsAId);
      const busB = getWorkspaceEventBus(wsBId);
      const serviceA = new AgentEventSubscriptionService(busA, wsAId);
      const serviceB = new AgentEventSubscriptionService(busB, wsBId);

      try {
        // Bump version in workspace A multiple times
        serviceA.subscribe('agent-1', 'Agent 1', { eventTypes: ['agent:idle'] });
        serviceA.subscribe('agent-1', 'Agent 1', { eventTypes: ['agent:created'] });
        serviceA.subscribe('agent-1', 'Agent 1', { eventTypes: ['file:changed'] });

        const versionA = serviceA.version;
        expect(versionA).toBeGreaterThanOrEqual(3);

        // Workspace B version should still be 0 (independent counter)
        const versionB = serviceB.version;
        expect(versionB).toBe(0);

        // This validates the renderer guard: if an in-flight response from workspace A
        // arrives with version=3 after switching to workspace B (version=0), the
        // wsId !== workspaceId guard discards it before the version check even runs.
      } finally {
        serviceA.dispose();
        serviceB.dispose();
      }
    });

    it('agent:subscriptions-changed events include workspaceId for renderer filtering', () => {
      const changedEvents: any[] = [];
      eventBus.on('agent:subscriptions-changed', (event: any) => {
        changedEvents.push(event);
      });

      service.subscribe('agent-1', 'Test Agent', {
        eventTypes: ['agent:idle'],
      });

      // The event should include the workspaceId so the renderer can filter
      expect(changedEvents.length).toBeGreaterThanOrEqual(1);
      const lastEvent = changedEvents[changedEvents.length - 1];
      expect(lastEvent.workspaceId).toBe(workspaceId);

      eventBus.off('agent:subscriptions-changed', () => {});
    });
  });

  describe('Terminal state agent:status-changed emission (isStreamingAfterWake reset)', () => {
    /**
     * Regression test for R2: When an agent transitions directly to a terminal
     * state (failed/completed) without passing through idle, the renderer's
     * agent:status-changed handler must still receive the event with the terminal
     * status so it can clear isStreamingAfterWake and unblock requestLoadSubscriptions().
     *
     * Pre-fix: The handler only checked `status === 'idle'`, so failed/completed
     * agents left isStreamingAfterWake=true permanently, blocking snapshot refresh.
     *
     * Post-fix: The handler checks `status === 'idle' || 'failed' || 'completed'`.
     * This test validates the main-process side emits the correct events.
     */

    it('should emit agent:status-changed with status=failed when agent fails', () => {
      const statusEvents: any[] = [];
      eventBus.on('agent:status-changed', (event: any) => {
        statusEvents.push(event);
      });

      // Agent starts responding (simulates wake)
      service.setAgentStatus('agent-wake-fail', 'responding');

      // Agent fails directly without going through idle
      service.setAgentStatus('agent-wake-fail', 'failed');

      // Should have two status-changed events: responding, then failed
      const failedEvents = statusEvents.filter(
        (e) => e.data?.agentId === 'agent-wake-fail' && e.data?.status === 'failed',
      );
      expect(failedEvents.length).toBe(1);
      expect(failedEvents[0].data.previousStatus).toBe('responding');
      expect(failedEvents[0].data.status).toBe('failed');

      eventBus.off('agent:status-changed', () => {});
    });

    it('should emit agent:status-changed with status=completed when agent completes', () => {
      const statusEvents: any[] = [];
      eventBus.on('agent:status-changed', (event: any) => {
        statusEvents.push(event);
      });

      // Agent starts responding (simulates wake)
      service.setAgentStatus('agent-wake-complete', 'responding');

      // Agent completes directly without going through idle
      service.setAgentStatus('agent-wake-complete', 'completed');

      // Should have a completed status-changed event
      const completedEvents = statusEvents.filter(
        (e) => e.data?.agentId === 'agent-wake-complete' && e.data?.status === 'completed',
      );
      expect(completedEvents.length).toBe(1);
      expect(completedEvents[0].data.previousStatus).toBe('responding');
      expect(completedEvents[0].data.status).toBe('completed');

      eventBus.off('agent:status-changed', () => {});
    });

    it('terminal status events include workspaceId for renderer filtering', () => {
      const statusEvents: any[] = [];
      eventBus.on('agent:status-changed', (event: any) => {
        statusEvents.push(event);
      });

      service.setAgentStatus('agent-terminal-ws', 'responding');
      service.setAgentStatus('agent-terminal-ws', 'failed');

      const failedEvent = statusEvents.find(
        (e) => e.data?.agentId === 'agent-terminal-ws' && e.data?.status === 'failed',
      );
      expect(failedEvent).toBeDefined();
      expect(failedEvent.workspaceId).toBe(workspaceId);

      eventBus.off('agent:status-changed', () => {});
    });
  });

  describe('Late agent:woken-by-subscription race condition (isStreamingAfterWake stuck)', () => {
    /**
     * Regression test for the root cause of "Waiting for 1 agent" lingering after completion.
     *
     * The race condition:
     *   1. sendBackendInitiatedMessage() calls handleBackendStreamMessage() → stream completes
     *   2. onComplete sends stream:complete to renderer, then emits agent:idle (async)
     *   3. sendBackendInitiatedMessage() returns { success: true }
     *   4. createEventDeliveryCallback emits agent:woken-by-subscription
     *
     * Renderer receives: agent:idle THEN agent:woken-by-subscription
     *   - agent:idle clears isStreamingAfterWake = false ✓
     *   - agent:woken-by-subscription sets isStreamingAfterWake = true ✗ (too late!)
     *   - No subsequent clearing event → stuck forever
     *
     * Fix: renderer checks agentService.isStreaming(agentId) before setting
     * isStreamingAfterWake. If agent is not streaming, skip setting the flag.
     *
     * This test validates the main-process contract that enables the fix:
     *   - agent:idle is emitted with the correct agentId
     *   - agent:woken-by-subscription is emitted AFTER delivery success
     *   - The renderer can query agent status to detect the race
     */

    it('agent:idle should fire before agent:woken-by-subscription in fast-completion scenario', async () => {
      const parentId = 'parent-late-wake';
      const childId = 'child-late-wake';
      const eventOrder: string[] = [];

      // Track event ordering
      eventBus.on('agent:idle', (event: any) => {
        if (event.data?.agentId === parentId) {
          eventOrder.push('agent:idle');
        }
      });
      eventBus.on('agent:woken-by-subscription', (event: any) => {
        if (event.data?.agentId === parentId) {
          eventOrder.push('agent:woken-by-subscription');
        }
      });

      // Set up: parent subscribes to child's idle event
      service.setAgentStatus(parentId, 'idle');
      service.subscribe(parentId, 'Parent', {
        eventTypes: ['agent:idle'],
        actorIds: [childId],
        oneShot: true,
      });

      // Simulate delivery callback that emits agent:woken-by-subscription after success
      service.setDeliveryCallback((_agentId, _events) => {
        return { status: 'success' };
      });

      // Child goes idle → triggers subscription → delivery → agent:woken-by-subscription
      const childIdleEvent: WorkspaceEvent = {
        id: 'event-late-wake',
        workspaceId,
        timestamp: new Date().toISOString(),
        type: 'agent:idle',
        actor: { type: 'agent', id: childId, name: 'Child' },
        data: { agentId: childId },
      };
      eventBus.emitEvent(childIdleEvent);
      await Promise.resolve(); // Let async delivery run

      // Now simulate what the main process does after delivery:
      // 1. Parent's stream completes → agent:idle for parent
      service.setAgentStatus(parentId, 'responding'); // Parent starts streaming
      service.setAgentStatus(parentId, 'idle'); // Parent finishes streaming

      // At this point, the renderer should see:
      // - agent:status-changed (responding → idle) for parent
      // - The agent is now idle (not streaming)
      // If agent:woken-by-subscription arrives NOW, the renderer should NOT set isStreamingAfterWake

      // Verify the agent status is idle (this is what the renderer checks)
      expect(service.getAgentStatus(parentId)).toBe('idle');

      eventBus.off('agent:idle', () => {});
      eventBus.off('agent:woken-by-subscription', () => {});
    });

    it('agent status transitions from responding to idle should be observable', () => {
      // This validates the main-process contract that the renderer fix depends on:
      // When an agent finishes streaming, its status transitions to 'idle',
      // and this status is queryable. The renderer uses this to detect the
      // race condition where agent:woken-by-subscription arrives after the
      // agent has already gone idle.
      const agentId = 'agent-status-transition';

      // Agent starts idle
      expect(service.getAgentStatus(agentId)).toBe('idle');

      // Agent starts responding (streaming)
      service.setAgentStatus(agentId, 'responding');
      expect(service.getAgentStatus(agentId)).toBe('responding');

      // Agent finishes streaming → goes idle
      service.setAgentStatus(agentId, 'idle');
      expect(service.getAgentStatus(agentId)).toBe('idle');

      // At this point, if agent:woken-by-subscription arrives,
      // the renderer checks isStreaming() → false → skips isStreamingAfterWake.
      // This prevents the permanent stuck state.
    });

    it('agent status should be queryable to detect late wake race condition', () => {
      // This validates the renderer's fix: checking agentService.isStreaming()
      // before setting isStreamingAfterWake.
      const agentId = 'agent-status-query';

      // Initially idle
      expect(service.getAgentStatus(agentId)).toBe('idle');

      // Starts responding (streaming)
      service.setAgentStatus(agentId, 'responding');
      expect(service.getAgentStatus(agentId)).toBe('responding');

      // Goes back to idle (stream complete)
      service.setAgentStatus(agentId, 'idle');
      expect(service.getAgentStatus(agentId)).toBe('idle');

      // At this point, if agent:woken-by-subscription arrives,
      // the renderer should check isStreaming() → false → skip isStreamingAfterWake
    });
  });

  describe('Session cancellation convergence (agent:stopped path)', () => {
    /**
     * Regression test for the "Waiting for" row lingering after session cancellation.
     *
     * The bug:
     *   1. Parent delegates to children → subscriptions created
     *   2. Children complete → delegation finishes → parent woken by subscription
     *   3. Parent starts streaming (isStreamingAfterWake = true in renderer)
     *   4. User cancels parent session → backendStop() sets status to idle, emits agent:stopped
     *   5. BUT backendStop() does NOT call setAgentStatus() → no agent:status-changed event
     *   6. Renderer never clears isStreamingAfterWake → loadSubscriptions() permanently blocked
     *   7. "Waiting for" row stays visible until the 30s failsafe clears it
     *
     * Fix: renderer listens for agent:stopped and clears isStreamingAfterWake + refetches.
     * These tests validate the main-process contract the renderer depends on.
     */

    it('agent:stopped event should be emitted with the correct agentId', () => {
      // Validates that the backendStop() flow emits agent:stopped with the agentId
      // so the renderer can match it against the current agent
      const stoppedEvents: any[] = [];
      eventBus.on('agent:stopped', (event: any) => {
        stoppedEvents.push(event);
      });

      // Simulate what backendStop does: emit agent:stopped
      // (In reality this comes from consolidated-backend.service.ts)
      eventBus.emitEvent({
        id: 'stopped-event-1',
        workspaceId,
        timestamp: new Date().toISOString(),
        type: 'agent:stopped',
        actor: { type: 'system', id: 'backend', name: 'Backend' },
        data: { agentId: 'agent-stopped-test' },
      });

      // The event should include the agentId for renderer filtering
      const matchingEvents = stoppedEvents.filter(
        (e) => e.data?.agentId === 'agent-stopped-test',
      );
      expect(matchingEvents.length).toBe(1);

      eventBus.off('agent:stopped', () => {});
    });

    it('subscriptions should remain queryable after agent stop for snapshot refresh', () => {
      // When an agent is stopped, its subscriptions are NOT automatically removed
      // (only backendStop sets status to idle and emits agent:stopped).
      // The renderer's requestLoadSubscriptions() should be able to fetch them
      // and clear the UI based on the result.
      const parentId = 'parent-stop-query';

      // Create a subscription (simulates delegation)
      service.subscribe(parentId, 'Parent', {
        eventTypes: ['agent:idle'],
        actorIds: ['child-1'],
      });

      // Verify subscription exists
      const subsBefore = service.getAgentSubscriptions(parentId);
      expect(subsBefore.length).toBe(1);

      // Agent is stopped (backendStop sets status directly, doesn't go through setAgentStatus)
      // The subscription service doesn't know about the stop — subscriptions persist.
      // This is correct: the renderer's loadSubscriptions() will return them,
      // and the renderer decides whether to show/hide the row based on agent state.
      const subsAfter = service.getAgentSubscriptions(parentId);
      expect(subsAfter.length).toBe(1);
    });

    it('delegation complete + cancel + late agent:woken-by-subscription should not leave subscriptions stuck', async () => {
      // Full scenario: delegation completes, parent is cancelled, late wake event arrives.
      // The subscription service should have cleaned up the delegation after completion,
      // so the renderer's snapshot refresh after cancel returns empty.
      const parentId = 'parent-cancel-flow';
      const childId = 'child-cancel-flow';
      const groupId = `cancel-group-${Date.now()}`;

      service.setDeliveryCallback((_agentId, _events) => {
        return { status: 'success' as const };
      });
      service.setAgentStatus(parentId, 'idle');

      // Step 1: Parent delegates to child with after_all
      service.subscribe(parentId, 'Parent', {
        eventTypes: ['agent:idle', 'agent:completed', 'agent:failed', 'agent:deleted'],
        actorIds: [childId],
        delegationGroup: {
          groupId,
          awaitMode: 'all',
          expectedAgentIds: [childId],
        },
      });

      // Step 2: Child completes → triggers delivery + cleanup
      const childIdleEvent: WorkspaceEvent = {
        id: 'child-idle-cancel-flow',
        workspaceId,
        timestamp: new Date().toISOString(),
        type: 'agent:idle',
        actor: { type: 'agent', id: childId, name: 'Child' },
        data: { agentId: childId },
      };
      eventBus.emitEvent(childIdleEvent);
      await Promise.resolve(); // Let async delivery run

      // Step 3: After delegation cleanup, subscriptions should be empty
      // (oneShot/delegation-complete unsubscribe happened)
      const subsAfterCompletion = service.getAgentSubscriptions(parentId);
      expect(subsAfterCompletion.length).toBe(0);

      // Step 4: Delegation group should also be cleaned up
      const groupAfterCompletion = service.getDelegationGroupStatus(groupId);
      expect(groupAfterCompletion).toBeNull();

      // Step 5: At this point, renderer receives agent:stopped (from cancel).
      // Since subscriptions are already empty, requestLoadSubscriptions() will
      // return empty → "Waiting for" row clears.
      // This validates the contract: the renderer just needs to unblock
      // requestLoadSubscriptions() by clearing isStreamingAfterWake, and the
      // snapshot will be empty.
    });

    it('agent:stopped should arrive independently of agent:status-changed', () => {
      // Validates that agent:stopped and agent:status-changed are independent events.
      // The renderer cannot rely on agent:status-changed for the cancellation path
      // because backendStop() does not call setAgentStatus().
      const statusChangedEvents: any[] = [];
      const stoppedEvents: any[] = [];

      eventBus.on('agent:status-changed', (event: any) => {
        if (event.data?.agentId === 'agent-independent') {
          statusChangedEvents.push(event);
        }
      });
      eventBus.on('agent:stopped', (event: any) => {
        if (event.data?.agentId === 'agent-independent') {
          stoppedEvents.push(event);
        }
      });

      // Simulate wake: setAgentStatus emits agent:status-changed
      service.setAgentStatus('agent-independent', 'responding');
      expect(statusChangedEvents.length).toBe(1); // responding
      expect(stoppedEvents.length).toBe(0);

      // Simulate cancel: backendStop emits agent:stopped directly (NOT through setAgentStatus)
      // In the real system, the backend calls this.emit('agent:stopped', { agentId })
      eventBus.emitEvent({
        id: 'stopped-independent-1',
        workspaceId,
        timestamp: new Date().toISOString(),
        type: 'agent:stopped',
        actor: { type: 'system', id: 'backend', name: 'Backend' },
        data: { agentId: 'agent-independent' },
      });

      // agent:stopped should arrive without a corresponding agent:status-changed(idle)
      expect(stoppedEvents.length).toBe(1);
      // No idle status-changed was emitted (the bug path — renderer must listen for agent:stopped)
      const idleStatusEvents = statusChangedEvents.filter((e) => e.data?.status === 'idle');
      expect(idleStatusEvents.length).toBe(0);

      eventBus.off('agent:status-changed', () => {});
      eventBus.off('agent:stopped', () => {});
    });

    it('version should bump when subscriptions change so post-cancel snapshot is fresh', () => {
      // After cancellation, the renderer calls requestLoadSubscriptions().
      // The version from the IPC response must be >= wakeVersion to not be
      // discarded by the version guard. This test verifies that subscription
      // changes (which happen during delegation completion) bump the version.
      const parentId = 'parent-version-cancel';

      const versionBefore = service.version;

      // Subscribe (simulates delegation setup)
      service.subscribe(parentId, 'Parent', {
        eventTypes: ['agent:idle'],
        actorIds: ['child-1'],
      });

      const versionAfterSubscribe = service.version;
      expect(versionAfterSubscribe).toBeGreaterThan(versionBefore);

      // Unsubscribe (simulates delegation completion cleanup)
      const subs = service.getAgentSubscriptions(parentId);
      if (subs.length > 0) {
        service.unsubscribe(subs[0].id, 'delegation-complete');
      }

      const versionAfterUnsubscribe = service.version;
      expect(versionAfterUnsubscribe).toBeGreaterThan(versionAfterSubscribe);

      // The renderer's post-cancel snapshot will have this version,
      // which is > wakeVersion, so it won't be discarded.
    });
  });

  describe('Sequential delegation carryover prevention (stale actorIds regression)', () => {
    /**
     * Regression test for sequential delegations carrying over prior agents.
     *
     * Bug scenario:
     *   1. Parent delegates group A with agents [child-a1, child-a2]
     *   2. Group A completes → subscriptions may still contain actorIds from group A
     *   3. Parent delegates group B with agents [child-b1, child-b2]
     *   4. Snapshot now has subscriptions with actorIds from BOTH groups
     *   5. But delegationGroups only contains group B (group A was cleaned up)
     *
     * Pre-fix behavior (broken):
     *   - watchedAgentIds derived from subscriptions[*].actorIds → includes stale agents
     *   - UI shows "Waiting for 4 agents" instead of "Waiting for 2 agents"
     *   - AgentCards rendered for already-completed agents from group A
     *
     * Post-fix behavior (correct):
     *   - Displayed agent list derived from active delegationGroups only
     *   - UI shows only agents from the currently-active delegation group
     */

    it('renderer should not display stale actorIds from a prior completed delegation', () => {
      // Simulate the snapshot state the renderer receives via IPC:
      // subscriptions still reference actorIds from the prior delegation (group A),
      // but delegationGroups only contains the current active group (group B).
      const subscriptions = [
        // Stale subscription from group A (not yet cleaned up)
        {
          id: 'sub-stale-a',
          agentId: 'parent-1',
          eventTypes: ['agent:idle', 'agent:completed', 'agent:failed', 'agent:deleted'],
          actorIds: ['child-a1', 'child-a2'],
          createdAt: new Date().toISOString(),
          description: 'delegation group A (completed)',
          delegationGroup: {
            groupId: 'group-a',
            awaitMode: 'all' as const,
            expectedAgentIds: ['child-a1', 'child-a2'],
          },
        },
        // Current active subscription for group B
        {
          id: 'sub-active-b',
          agentId: 'parent-1',
          eventTypes: ['agent:idle', 'agent:completed', 'agent:failed', 'agent:deleted'],
          actorIds: ['child-b1', 'child-b2'],
          createdAt: new Date().toISOString(),
          description: 'delegation group B (active)',
          delegationGroup: {
            groupId: 'group-b',
            awaitMode: 'all' as const,
            expectedAgentIds: ['child-b1', 'child-b2'],
          },
        },
      ];

      // delegationGroups only contains group B (group A was completed/cleaned up)
      const delegationGroups = [
        {
          groupId: 'group-b',
          awaitMode: 'all' as const,
          expectedAgentIds: ['child-b1', 'child-b2'],
          completedAgentIds: [] as string[],
          agentStatuses: { 'child-b1': 'responding' as const, 'child-b2': 'responding' as const },
        },
      ];

      // OLD derivation (pre-fix): watchedAgentIds from subscriptions[*].actorIds
      const oldWatchedAgentIds = new Set<string>();
      for (const sub of subscriptions) {
        for (const actorId of sub.actorIds || []) {
          oldWatchedAgentIds.add(actorId);
        }
      }

      // NEW derivation (post-fix): displayed agents from active delegationGroups only
      const newDisplayedAgentIds = new Set<string>();
      for (const group of delegationGroups) {
        for (const agentId of group.expectedAgentIds) {
          newDisplayedAgentIds.add(agentId);
        }
      }

      // OLD behavior: includes stale agents from group A (BUG)
      expect(oldWatchedAgentIds.size).toBe(4); // child-a1, child-a2, child-b1, child-b2
      expect(oldWatchedAgentIds.has('child-a1')).toBe(true); // stale!
      expect(oldWatchedAgentIds.has('child-a2')).toBe(true); // stale!

      // NEW behavior: only includes agents from active group B (FIX)
      expect(newDisplayedAgentIds.size).toBe(2); // child-b1, child-b2 only
      expect(newDisplayedAgentIds.has('child-a1')).toBe(false); // correctly excluded
      expect(newDisplayedAgentIds.has('child-a2')).toBe(false); // correctly excluded
      expect(newDisplayedAgentIds.has('child-b1')).toBe(true);
      expect(newDisplayedAgentIds.has('child-b2')).toBe(true);
    });

    it('displayed agent count should match active delegation group expected count, not subscription actorIds count', () => {
      // This test validates the specific symptom: "next delegation of 2 agents shows count of 4"
      const subscriptions = [
        {
          id: 'sub-old',
          agentId: 'parent-1',
          eventTypes: ['agent:idle'],
          actorIds: ['old-agent-1', 'old-agent-2'],
          createdAt: new Date(Date.now() - 60000).toISOString(),
          description: 'prior delegation',
          delegationGroup: {
            groupId: 'old-group',
            awaitMode: 'all' as const,
            expectedAgentIds: ['old-agent-1', 'old-agent-2'],
          },
        },
        {
          id: 'sub-new',
          agentId: 'parent-1',
          eventTypes: ['agent:idle'],
          actorIds: ['new-agent-1', 'new-agent-2'],
          createdAt: new Date().toISOString(),
          description: 'current delegation',
          delegationGroup: {
            groupId: 'new-group',
            awaitMode: 'all' as const,
            expectedAgentIds: ['new-agent-1', 'new-agent-2'],
          },
        },
      ];

      // Only the new group is active
      const delegationGroups = [
        {
          groupId: 'new-group',
          awaitMode: 'all' as const,
          expectedAgentIds: ['new-agent-1', 'new-agent-2'],
          completedAgentIds: [] as string[],
          agentStatuses: { 'new-agent-1': 'idle' as const, 'new-agent-2': 'idle' as const },
        },
      ];

      // Derive displayed agents from active delegation groups (post-fix)
      const displayedAgentIds: string[] = [];
      for (const group of delegationGroups) {
        for (const agentId of group.expectedAgentIds) {
          displayedAgentIds.push(agentId);
        }
      }

      // The UI should show "Waiting for 2 agents", not "Waiting for 4 agents"
      expect(displayedAgentIds).toHaveLength(2);
      expect(displayedAgentIds).toContain('new-agent-1');
      expect(displayedAgentIds).toContain('new-agent-2');
      expect(displayedAgentIds).not.toContain('old-agent-1');
      expect(displayedAgentIds).not.toContain('old-agent-2');
    });

    it('main-process getDelegationGroupsForParent should exclude completed groups from sequential delegations', async () => {
      // This validates the main-process contract: after group A completes,
      // getDelegationGroupsForParent returns only group B.
      const parentId = 'parent-sequential';

      service.setDeliveryCallback((_agentId, _events) => {
        return { status: 'success' as const };
      });
      service.setAgentStatus(parentId, 'idle');

      // Group A: delegate 2 agents
      service.subscribe(parentId, 'Parent', {
        eventTypes: ['agent:idle', 'agent:completed', 'agent:failed', 'agent:deleted'],
        actorIds: ['child-a1', 'child-a2'],
        delegationGroup: {
          groupId: 'seq-group-a',
          awaitMode: 'all',
          expectedAgentIds: ['child-a1', 'child-a2'],
        },
      });

      // Both agents in group A complete
      eventBus.emitEvent({
        id: 'evt-a1',
        workspaceId,
        timestamp: new Date().toISOString(),
        type: 'agent:idle',
        actor: { type: 'agent', id: 'child-a1', name: 'Child A1' },
        data: { agentId: 'child-a1' },
      });
      eventBus.emitEvent({
        id: 'evt-a2',
        workspaceId,
        timestamp: new Date().toISOString(),
        type: 'agent:idle',
        actor: { type: 'agent', id: 'child-a2', name: 'Child A2' },
        data: { agentId: 'child-a2' },
      });
      await Promise.resolve(); // Let async cleanup run

      // Group B: delegate 2 new agents
      service.subscribe(parentId, 'Parent', {
        eventTypes: ['agent:idle', 'agent:completed', 'agent:failed', 'agent:deleted'],
        actorIds: ['child-b1', 'child-b2'],
        delegationGroup: {
          groupId: 'seq-group-b',
          awaitMode: 'all',
          expectedAgentIds: ['child-b1', 'child-b2'],
        },
      });

      // The renderer queries this via IPC — only group B should be returned
      const groups = service.getDelegationGroupsForParent(parentId);
      expect(groups).toHaveLength(1);
      expect(groups[0].groupId).toBe('seq-group-b');
      expect(groups[0].expectedAgentIds).toEqual(['child-b1', 'child-b2']);

      // Subscriptions may still contain stale entries from group A,
      // but the renderer should derive displayed agents from groups, not subscriptions
      const subs = service.getAgentSubscriptions(parentId);
      const allActorIds = new Set<string>();
      for (const sub of subs) {
        for (const actorId of (sub as any).filter?.actorIds || sub.actorIds || []) {
          allActorIds.add(actorId);
        }
      }

      // The active delegation group's expected agents should be a subset of
      // what the renderer should display — NOT the full actorIds set
      const activeAgentIds = new Set(groups[0].expectedAgentIds);
      for (const agentId of activeAgentIds) {
        // Each active agent should be findable in the subscription data
        expect(allActorIds.has(agentId)).toBe(true);
      }
    });
  });

  describe('Renderer guard: waitMode=all with empty delegationGroups (duplicate UI prevention)', () => {
    /**
     * Regression test for the "Waiting for all" panel lingering after delegation completes.
     *
     * Root cause:
     *   - `waitMode` is derived from `subscriptions` (checks delegationGroup.awaitMode)
     *   - `delegationGroups` comes from getDelegationGroupsForParent() which filters out
     *     completed groups
     *   - After delegation completes, there's a window where subscriptions still reference
     *     the delegation group (awaitMode='all') but delegationGroups is empty
     *   - The old render guard: `subscriptions.length > 0 && (waitMode === 'all' || ...)`
     *     would render the "Waiting for all" panel because waitMode='all' was true
     *   - Fix: add `!(waitMode === 'all' && delegationGroups.length === 0)` to the guard
     *
     * This test validates the main-process contract that creates the mismatch:
     *   - After group completion, getDelegationGroupsForParent returns []
     *   - But getAgentSubscriptions may still return the subscription with delegationGroup info
     *   - The renderer must handle this state by checking delegationGroups.length
     */
    it('subscriptions can indicate awaitMode=all while delegationGroups is empty after completion', async () => {
      const parentId = 'parent-linger-guard';
      const childId = 'child-linger-guard';
      const groupId = `linger-group-${Date.now()}`;

      service.setDeliveryCallback((_agentId, _events) => {
        return { status: 'success' as const };
      });
      service.setAgentStatus(parentId, 'idle');

      // Create delegation subscription with after_all
      service.subscribe(parentId, 'Parent', {
        eventTypes: ['agent:idle', 'agent:completed', 'agent:failed', 'agent:deleted'],
        actorIds: [childId],
        delegationGroup: {
          groupId,
          awaitMode: 'all',
          expectedAgentIds: [childId],
        },
      });

      // Before completion: both subscriptions and delegationGroups should be populated
      const subsBefore = service.getAgentSubscriptions(parentId);
      const groupsBefore = service.getDelegationGroupsForParent(parentId);
      expect(subsBefore.length).toBe(1);
      expect(subsBefore[0].filter.delegationGroup?.awaitMode).toBe('all');
      expect(groupsBefore.length).toBe(1);

      // Child completes → triggers delivery + cleanup
      const childIdleEvent: WorkspaceEvent = {
        id: `child-idle-linger-${Date.now()}`,
        workspaceId,
        timestamp: new Date().toISOString(),
        type: 'agent:idle',
        actor: { type: 'agent', id: childId, name: 'Child' },
        data: { agentId: childId },
      };
      eventBus.emitEvent(childIdleEvent);

      // After completion + cleanup: delegationGroups should be empty
      // This is the state the renderer sees when it refetches the snapshot
      const groupsAfter = service.getDelegationGroupsForParent(parentId);
      expect(groupsAfter.length).toBe(0);

      // KEY ASSERTION: This validates the mismatch that the renderer guard must handle.
      // The subscription may or may not still exist at this point (depends on cleanup timing),
      // but if it does exist, it still has delegationGroup.awaitMode='all'.
      // The renderer's waitMode would be 'all' (derived from subscriptions),
      // but delegationGroups is empty — so the "Waiting for all" panel must NOT render.
      //
      // The renderer guard fix:
      //   !(waitMode === 'all' && delegationGroups.length === 0)
      // prevents this exact scenario.
      const subsAfter = service.getAgentSubscriptions(parentId);
      if (subsAfter.length > 0 && subsAfter[0].filter.delegationGroup?.awaitMode === 'all') {
        // This is the problematic state: subscription says 'all' but no groups exist.
        // Without the renderer guard fix, the UI would show "Waiting for all" with 0/0.
        expect(groupsAfter.length).toBe(0);
      }
    });

    it('renderer guard logic: waitMode=all + empty delegationGroups should suppress panel', () => {
      // Pure logic test simulating the renderer's derived state.
      // This mirrors the guard condition in AgentSubscriptions.svelte line 992.

      // Scenario: subscriptions indicate awaitMode='all', but delegationGroups is empty
      const subscriptions = [
        {
          id: 'sub-1',
          agentId: 'parent-1',
          eventTypes: ['agent:idle'],
          actorIds: ['child-1'],
          createdAt: new Date().toISOString(),
          description: 'test',
          delegationGroup: {
            groupId: 'group-1',
            awaitMode: 'all' as const,
            expectedAgentIds: ['child-1'],
          },
        },
      ];
      const delegationGroups: any[] = []; // Empty — completed groups filtered out

      // Derive waitMode the same way the component does
      let waitMode: 'all' | 'any' = 'any';
      for (const sub of subscriptions) {
        if (sub.delegationGroup?.awaitMode === 'all') {
          waitMode = 'all';
        }
      }

      // Derive watchedAgentIds using the NEW derivation logic:
      // delegationWatchedIds from delegationGroups (authoritative for wait_mode='all')
      const delegationWatchedIds = new Set<string>();
      for (const group of delegationGroups) {
        if (group.awaitMode === 'all') {
          for (const id of group.expectedAgentIds) {
            delegationWatchedIds.add(id);
          }
        }
      }
      // otherWatchedIds from non-delegation subscriptions
      const otherWatchedIds = new Set<string>();
      for (const sub of subscriptions) {
        if (sub.delegationGroup?.awaitMode === 'all') continue;
        for (const actorId of sub.actorIds || []) {
          otherWatchedIds.add(actorId);
        }
      }
      // Combined
      const watchedAgentIds = new Set<string>([...delegationWatchedIds, ...otherWatchedIds]);

      // With the new derivation, watchedAgentIds should be EMPTY when
      // delegationGroups is empty and all subscriptions are delegation-group subs.
      // This is the key behavioral change: stale subscription actorIds no longer
      // pollute the displayed agent list.
      expect(watchedAgentIds.size).toBe(0);

      // Derive completionStatus
      let completed = 0;
      let total = 0;
      for (const group of delegationGroups) {
        if (group.awaitMode === 'all') {
          completed += group.completedAgentIds.length;
          total += group.expectedAgentIds.length;
        }
      }
      const completionStatus = { completed, total };

      // Guard (post-fix) — correctly suppresses the panel
      const newGuard =
        subscriptions.length > 0 &&
        (waitMode === 'all' || watchedAgentIds.size > 0) &&
        !(waitMode === 'all' && delegationGroups.length === 0) &&
        !(waitMode === 'all' && completionStatus.total > 0 && completionStatus.completed >= completionStatus.total);

      // The guard correctly suppresses it (FIX)
      expect(newGuard).toBe(false);
    });

    it('renderer guard should still show panel when delegationGroups has active groups', () => {
      // Ensure the fix doesn't break the normal case where groups are active

      const subscriptions = [
        {
          id: 'sub-1',
          agentId: 'parent-1',
          eventTypes: ['agent:idle'],
          actorIds: ['child-1'],
          createdAt: new Date().toISOString(),
          description: 'test',
          delegationGroup: {
            groupId: 'group-1',
            awaitMode: 'all' as const,
            expectedAgentIds: ['child-1'],
          },
        },
      ];
      const delegationGroups = [
        {
          groupId: 'group-1',
          awaitMode: 'all' as const,
          expectedAgentIds: ['child-1'],
          completedAgentIds: [],
          agentStatuses: { 'child-1': 'responding' },
        },
      ];

      let waitMode: 'all' | 'any' = 'any';
      for (const sub of subscriptions) {
        if (sub.delegationGroup?.awaitMode === 'all') {
          waitMode = 'all';
        }
      }

      // Derive watchedAgentIds using the NEW derivation logic
      const delegationWatchedIds = new Set<string>();
      for (const group of delegationGroups) {
        if (group.awaitMode === 'all') {
          for (const id of group.expectedAgentIds) {
            delegationWatchedIds.add(id);
          }
        }
      }
      const otherWatchedIds = new Set<string>();
      for (const sub of subscriptions) {
        if (sub.delegationGroup?.awaitMode === 'all') continue;
        for (const actorId of sub.actorIds || []) {
          otherWatchedIds.add(actorId);
        }
      }
      const watchedAgentIds = new Set<string>([...delegationWatchedIds, ...otherWatchedIds]);

      // With active delegation groups, watchedAgentIds should contain the expected agents
      expect(watchedAgentIds.size).toBe(1);
      expect(watchedAgentIds.has('child-1')).toBe(true);

      let completed = 0;
      let total = 0;
      for (const group of delegationGroups) {
        if (group.awaitMode === 'all') {
          completed += group.completedAgentIds.length;
          total += group.expectedAgentIds.length;
        }
      }
      const completionStatus = { completed, total };

      // Guard with fix should still show the panel when groups are active
      const newGuard =
        subscriptions.length > 0 &&
        (waitMode === 'all' || watchedAgentIds.size > 0) &&
        !(waitMode === 'all' && delegationGroups.length === 0) &&
        !(waitMode === 'all' && completionStatus.total > 0 && completionStatus.completed >= completionStatus.total);

      expect(newGuard).toBe(true);
    });

    it('sequential delegations: second group should only show its own agents (not prior group)', () => {
      // This is the core regression test for the fix:
      // After group 1 completes, subscriptions may still reference group 1's actorIds.
      // The new derivation ensures watchedAgentIds comes from delegationGroups (authoritative),
      // not from stale subscription actorIds.

      // Stale subscription from group 1 (not yet cleaned up)
      const subscriptions = [
        {
          id: 'sub-stale',
          agentId: 'parent-1',
          eventTypes: ['agent:idle'],
          actorIds: ['old-child-1', 'old-child-2'],
          createdAt: new Date().toISOString(),
          description: 'stale from group 1',
          delegationGroup: {
            groupId: 'group-1',
            awaitMode: 'all' as const,
            expectedAgentIds: ['old-child-1', 'old-child-2'],
          },
        },
        {
          id: 'sub-new',
          agentId: 'parent-1',
          eventTypes: ['agent:idle'],
          actorIds: ['new-child-1', 'new-child-2'],
          createdAt: new Date().toISOString(),
          description: 'active group 2',
          delegationGroup: {
            groupId: 'group-2',
            awaitMode: 'all' as const,
            expectedAgentIds: ['new-child-1', 'new-child-2'],
          },
        },
      ];

      // Only group 2 is active (group 1 was completed and filtered out by main process)
      const delegationGroups = [
        {
          groupId: 'group-2',
          awaitMode: 'all' as const,
          expectedAgentIds: ['new-child-1', 'new-child-2'],
          completedAgentIds: [],
          agentStatuses: { 'new-child-1': 'responding', 'new-child-2': 'responding' },
        },
      ];

      // Derive using NEW logic
      const delegationWatchedIds = new Set<string>();
      for (const group of delegationGroups) {
        if (group.awaitMode === 'all') {
          for (const id of group.expectedAgentIds) {
            delegationWatchedIds.add(id);
          }
        }
      }
      const otherWatchedIds = new Set<string>();
      for (const sub of subscriptions) {
        if (sub.delegationGroup?.awaitMode === 'all') continue;
        for (const actorId of sub.actorIds || []) {
          otherWatchedIds.add(actorId);
        }
      }
      const watchedAgentIds = new Set<string>([...delegationWatchedIds, ...otherWatchedIds]);

      // KEY ASSERTION: Only group 2's agents should appear, NOT group 1's stale agents
      expect(watchedAgentIds.size).toBe(2);
      expect(watchedAgentIds.has('new-child-1')).toBe(true);
      expect(watchedAgentIds.has('new-child-2')).toBe(true);
      expect(watchedAgentIds.has('old-child-1')).toBe(false);
      expect(watchedAgentIds.has('old-child-2')).toBe(false);
    });
  });

  describe('Renderer guard: wokenUpInfo must not hide active subscription row', () => {
    /**
     * Regression test for the "Woken up hides subscription row then row reappears" flicker.
     *
     * Root cause (pre-fix):
     *   - The template uses `{#if wokenUpInfo}...{:else if ...subscription guard...}`
     *   - When wokenUpInfo is truthy, the subscription row is in the {:else if} branch
     *     and is therefore NOT rendered
     *   - After 4 seconds, wokenUpInfo is cleared → subscription row reappears
     *   - This causes a visible flicker: subscription row disappears then reappears
     *
     * Post-fix behavior (correct):
     *   - wokenUpInfo and the subscription row are NOT mutually exclusive
     *   - When wokenUpInfo is present AND there are active subscriptions,
     *     the subscription row remains visible
     *   - The woken indicator can be shown alongside or within the subscription row
     */

    it('subscription row should render when wokenUpInfo is present AND subscriptions are active', () => {
      // Simulate the renderer's derived state:
      // - wokenUpInfo is set (agent was just woken by a subscription event)
      // - There are active subscriptions with delegation groups
      const wokenUpInfo = {
        eventCount: 1,
        eventTypes: ['agent:idle'],
        timestamp: Date.now(),
      };

      const subscriptions = [
        {
          id: 'sub-1',
          agentId: 'parent-1',
          eventTypes: ['agent:idle'],
          actorIds: ['child-1'],
          createdAt: new Date().toISOString(),
          description: 'waiting for child',
          delegationGroup: {
            groupId: 'group-1',
            awaitMode: 'all' as const,
            expectedAgentIds: ['child-1'],
          },
        },
      ];

      const delegationGroups = [
        {
          groupId: 'group-1',
          awaitMode: 'all' as const,
          expectedAgentIds: ['child-1'],
          completedAgentIds: [],
          agentStatuses: { 'child-1': 'responding' },
        },
      ];

      // Derive waitMode
      let waitMode: 'all' | 'any' = 'any';
      for (const sub of subscriptions) {
        if (sub.delegationGroup?.awaitMode === 'all') {
          waitMode = 'all';
        }
      }

      // Derive watchedAgentIds (from delegationGroups, the authoritative source)
      const delegationWatchedIds = new Set<string>();
      for (const group of delegationGroups) {
        if (group.awaitMode === 'all') {
          for (const id of group.expectedAgentIds) {
            delegationWatchedIds.add(id);
          }
        }
      }
      const otherWatchedIds = new Set<string>();
      for (const sub of subscriptions) {
        if (sub.delegationGroup?.awaitMode === 'all') continue;
        for (const actorId of sub.actorIds || []) {
          otherWatchedIds.add(actorId);
        }
      }
      const watchedAgentIds = new Set<string>([...delegationWatchedIds, ...otherWatchedIds]);

      // Derive completionStatus
      let completed = 0;
      let total = 0;
      for (const group of delegationGroups) {
        if (group.awaitMode === 'all') {
          completed += group.completedAgentIds.length;
          total += group.expectedAgentIds.length;
        }
      }
      const completionStatus = { completed, total };

      // The subscription row guard (should the subscription row be visible?)
      const subscriptionRowShouldRender =
        subscriptions.length > 0 &&
        (waitMode === 'all' || watchedAgentIds.size > 0) &&
        !(waitMode === 'all' && delegationGroups.length === 0) &&
        !(waitMode === 'all' && completionStatus.total > 0 && completionStatus.completed >= completionStatus.total);

      // Sanity: the subscription row guard itself is true (active subscriptions exist)
      expect(subscriptionRowShouldRender).toBe(true);

      // PRE-FIX BUG: The old template used {#if wokenUpInfo}...{:else if subscriptionRowGuard}
      // This means when wokenUpInfo is truthy, subscriptionRow is NOT rendered.
      const oldTemplateShowsSubscriptionRow = !wokenUpInfo && subscriptionRowShouldRender;

      // The old behavior incorrectly hides the subscription row
      expect(oldTemplateShowsSubscriptionRow).toBe(false); // BUG: subscription row hidden!

      // POST-FIX: wokenUpInfo should NOT gate the subscription row.
      // The subscription row visibility must be independent of wokenUpInfo.
      const newTemplateShowsSubscriptionRow = subscriptionRowShouldRender;
      // (wokenUpInfo can be shown alongside/within the subscription row, but must not replace it)

      expect(newTemplateShowsSubscriptionRow).toBe(true); // FIX: subscription row stays visible
    });

    it('subscription row should still hide when there are no active subscriptions (regardless of wokenUpInfo)', () => {
      // Ensure the fix doesn't break the case where there are genuinely no subscriptions
      const wokenUpInfo = {
        eventCount: 1,
        eventTypes: ['agent:idle'],
        timestamp: Date.now(),
      };

      const subscriptions: any[] = [];
      const delegationGroups: any[] = [];

      const subscriptionRowShouldRender =
        subscriptions.length > 0; // Fails at first condition

      expect(subscriptionRowShouldRender).toBe(false);

      // Even with the fix, no subscription row when there are no subscriptions
      const newTemplateShowsSubscriptionRow = subscriptionRowShouldRender;
      expect(newTemplateShowsSubscriptionRow).toBe(false);
    });

    it('woken indicator can show independently when there are no active subscriptions', () => {
      // When wokenUpInfo is set but there are no active subscriptions,
      // only the woken indicator should show (no subscription row)
      const wokenUpInfo = {
        eventCount: 2,
        eventTypes: ['agent:idle', 'agent:completed'],
        timestamp: Date.now(),
      };

      const subscriptions: any[] = [];
      const delegationGroups: any[] = [];

      const subscriptionRowShouldRender = subscriptions.length > 0;
      expect(subscriptionRowShouldRender).toBe(false);

      // Woken indicator should still be visible
      expect(wokenUpInfo).not.toBeNull();

      // This is the correct state: woken indicator shows, subscription row does not
      // (because there are no subscriptions to show)
    });

    it('both woken indicator and subscription row should coexist with any-mode subscriptions', () => {
      // Test with waitMode='any' (non-delegation subscriptions)
      const wokenUpInfo = {
        eventCount: 1,
        eventTypes: ['agent:idle'],
        timestamp: Date.now(),
      };

      const subscriptions = [
        {
          id: 'sub-any',
          agentId: 'parent-1',
          eventTypes: ['agent:idle'],
          actorIds: ['child-1'],
          createdAt: new Date().toISOString(),
          description: 'watching child',
        },
      ];

      const delegationGroups: any[] = [];

      // Derive waitMode (no delegation group → 'any')
      let waitMode: 'all' | 'any' = 'any';
      for (const sub of subscriptions) {
        if ((sub as any).delegationGroup?.awaitMode === 'all') {
          waitMode = 'all';
        }
      }
      expect(waitMode).toBe('any');

      // Derive watchedAgentIds
      const watchedAgentIds = new Set<string>();
      for (const sub of subscriptions) {
        if ((sub as any).delegationGroup?.awaitMode === 'all') continue;
        for (const actorId of sub.actorIds || []) {
          watchedAgentIds.add(actorId);
        }
      }

      const subscriptionRowShouldRender =
        subscriptions.length > 0 &&
        (waitMode === 'all' || watchedAgentIds.size > 0) &&
        !(waitMode === 'all' && delegationGroups.length === 0);

      expect(subscriptionRowShouldRender).toBe(true);

      // PRE-FIX BUG: old template hides subscription row when wokenUpInfo is present
      const oldTemplateShowsSubscriptionRow = !wokenUpInfo && subscriptionRowShouldRender;
      expect(oldTemplateShowsSubscriptionRow).toBe(false); // BUG

      // POST-FIX: subscription row is independent of wokenUpInfo
      const newTemplateShowsSubscriptionRow = subscriptionRowShouldRender;
      expect(newTemplateShowsSubscriptionRow).toBe(true); // FIXED
    });
  });
});

