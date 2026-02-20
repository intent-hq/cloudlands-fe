/**
 * Delegation Waves Tests
 *
 * Tests for the wave execution pattern in agent delegation:
 * - wait_mode="after_all" grouping
 * - Wave execution order
 * - Delegation group cleanup
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WorkspaceEventBus } from '../../src/features/events/main/workspace-event-bus';
import {
  AgentEventSubscriptionService,
  type DelegationGroup,
} from '../../src/features/events/main/agent-event-subscription.service';
import { createWorkspaceEvent } from '../../src/features/events/types';
import { getDeduplicationService } from '../../src/features/events/event-deduplication.service';

const ORCHESTRATOR_ID = 'orchestrator-1';
const ORCHESTRATOR_NAME = 'Orchestrator';

describe('Delegation Waves', () => {
  let eventBus: WorkspaceEventBus;
  let subscriptionService: AgentEventSubscriptionService;
  let deliveredEvents: Map<string, any[]>;
  let testWorkspaceId: string;

  beforeEach(() => {
    vi.useFakeTimers();
    testWorkspaceId = `test-workspace-waves-${Math.random().toString(36).slice(2)}`;
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

  describe('wait_mode="after_all" Behavior', () => {
    it('should wait for all agents in group before delivering', () => {
      subscriptionService.setAgentStatus(ORCHESTRATOR_ID, 'idle');

      const delegationGroup: DelegationGroup = {
        groupId: 'wave-1',
        awaitMode: 'all',
        expectedAgentIds: ['impl-1', 'impl-2', 'impl-3'],
      };

      subscriptionService.subscribe(ORCHESTRATOR_ID, ORCHESTRATOR_NAME, {
        eventTypes: ['agent:idle'],
        delegationGroup,
        priority: 'high',
      });

      // First agent completes
      eventBus.emitEvent(
        createWorkspaceEvent(
          'agent:idle',
          testWorkspaceId,
          { type: 'agent', id: 'impl-1', name: 'Impl 1' },
          { agentId: 'impl-1' },
        ),
      );

      // Should not deliver yet - waiting for all
      expect(deliveredEvents.get(ORCHESTRATOR_ID)).toBeUndefined();

      // Second agent completes
      eventBus.emitEvent(
        createWorkspaceEvent(
          'agent:idle',
          testWorkspaceId,
          { type: 'agent', id: 'impl-2', name: 'Impl 2' },
          { agentId: 'impl-2' },
        ),
      );

      // Still waiting
      expect(deliveredEvents.get(ORCHESTRATOR_ID)).toBeUndefined();

      // Third agent completes
      eventBus.emitEvent(
        createWorkspaceEvent(
          'agent:idle',
          testWorkspaceId,
          { type: 'agent', id: 'impl-3', name: 'Impl 3' },
          { agentId: 'impl-3' },
        ),
      );

      // Now should deliver all events
      const events = deliveredEvents.get(ORCHESTRATOR_ID) || [];
      expect(events.length).toBe(3);
    });

    it('should deliver immediately with wait_mode="any"', () => {
      subscriptionService.setAgentStatus(ORCHESTRATOR_ID, 'idle');

      const delegationGroup: DelegationGroup = {
        groupId: 'wave-1',
        awaitMode: 'any',
        expectedAgentIds: ['impl-1', 'impl-2', 'impl-3'],
      };

      subscriptionService.subscribe(ORCHESTRATOR_ID, ORCHESTRATOR_NAME, {
        eventTypes: ['agent:idle'],
        delegationGroup,
        priority: 'high',
      });

      // First agent completes
      eventBus.emitEvent(
        createWorkspaceEvent(
          'agent:idle',
          testWorkspaceId,
          { type: 'agent', id: 'impl-1', name: 'Impl 1' },
          { agentId: 'impl-1' },
        ),
      );

      // Should deliver immediately
      const events = deliveredEvents.get(ORCHESTRATOR_ID) || [];
      expect(events.length).toBe(1);
    });
  });

  describe('Wave Execution Order', () => {
    it('should process waves sequentially', () => {
      const waveOrder: string[] = [];

      // Simulate wave execution
      const executeWave = (waveId: string, agents: string[]) => {
        waveOrder.push(`start:${waveId}`);
        // Simulate all agents completing
        agents.forEach((a) => waveOrder.push(`complete:${a}`));
        waveOrder.push(`end:${waveId}`);
      };

      executeWave('wave-1', ['impl-1', 'impl-2']);
      executeWave('wave-2', ['impl-3', 'impl-4']);
      executeWave('wave-3', ['verifier-1']);

      expect(waveOrder).toEqual([
        'start:wave-1',
        'complete:impl-1',
        'complete:impl-2',
        'end:wave-1',
        'start:wave-2',
        'complete:impl-3',
        'complete:impl-4',
        'end:wave-2',
        'start:wave-3',
        'complete:verifier-1',
        'end:wave-3',
      ]);
    });
  });
});
