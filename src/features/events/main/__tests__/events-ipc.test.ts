import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const electronMocks = vi.hoisted(() => {
  const handlers = new Map<string, Function>();
  const removeHandler = vi.fn((channel: string) => {
    handlers.delete(channel);
  });

  return {
    handlers,
    removeHandler,
  };
});

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: Function) => {
      electronMocks.handlers.set(channel, handler);
    }),
    removeHandler: electronMocks.removeHandler,
  },
}));

import { EVENTS_CHANNELS } from '../../../../shared/ipc/channels';
import { cleanupEventsIPC, setupEventsIPC } from '../events.ipc';
import type { WorkspaceEvent } from '../../types';
import {
  agentSubscriptionState,
  resetAgentSubscriptionState,
} from '../agent-subscription-state.service';
import type { AgentSubscriptionRecord } from '../../../../store/main/slices/agent-subscriptions/types';

function makeEvent(): WorkspaceEvent {
  return {
    id: 'evt-1',
    workspaceId: 'ws-1',
    timestamp: '2026-01-01T00:00:00Z',
    type: 'file:changed',
    actor: { type: 'system', id: 'system' },
    data: { path: '/tmp/file.ts' },
    metadata: {},
  } as WorkspaceEvent;
}

describe('events IPC handlers', () => {
  beforeEach(() => {
    electronMocks.handlers.clear();
    electronMocks.removeHandler.mockClear();
    resetAgentSubscriptionState();
  });

  afterEach(() => {
    cleanupEventsIPC();
    vi.clearAllMocks();
  });

  it.each(['hub:checkpoint', 'file:changed'])(
    'accepts the registered %s event through the validated emit handler',
    async (type) => {
      setupEventsIPC();
      const emit = electronMocks.handlers.get(EVENTS_CHANNELS.EMIT);
      expect(emit).toBeDefined();
      const result = await emit?.(
        { sender: { id: 42 } },
        {
          event: {
            ...makeEvent(),
            type,
            workspaceId: 'test-workspace',
            actor: { type: 'system', name: 'Checkpoint hub' },
          },
        },
      );
      expect(result).toEqual({ success: true });
    },
  );

  it('still rejects undeclared hub events through the validated emit handler', async () => {
    setupEventsIPC();
    const emit = electronMocks.handlers.get(EVENTS_CHANNELS.EMIT);
    expect(emit).toBeDefined();
    const result = await emit?.(
      { sender: { id: 42 } },
      {
        event: {
          ...makeEvent(),
          type: 'hub:not-registered',
          workspaceId: 'test-workspace',
          actor: { type: 'system', name: 'Checkpoint hub' },
        },
      },
    );
    expect(result).toMatchObject({ success: false });
  });

  it('reads agent subscriptions from the same canonical state written by production operations', async () => {
    const subscriptionId = 'subscription-1';
    agentSubscriptionState.add('ws-agent-subscriptions', {
      id: subscriptionId,
      agentId: 'agent-parent',
      agentName: 'Parent',
      workspaceId: 'ws-agent-subscriptions',
      filter: {
        eventTypes: ['agent:idle'],
        actorIds: ['agent-child'],
        delegationGroup: {
          groupId: 'group-1',
          awaitMode: 'all',
          expectedAgentIds: ['agent-child'],
        },
      },
      createdAt: new Date().toISOString(),
    } satisfies AgentSubscriptionRecord);
    agentSubscriptionState.setDelegationGroup('ws-agent-subscriptions', {
      groupId: 'group-1',
      parentAgentId: 'agent-parent',
      parentAgentName: 'Parent',
      awaitMode: 'all',
      expectedAgentIds: ['agent-child'],
      completedAgentIds: [],
      deletedAgentIds: [],
      events: [],
      subscriptionId,
      delivered: false,
    });
    agentSubscriptionState.setStatus('ws-agent-subscriptions', 'agent-child', 'responding');
    setupEventsIPC();

    const readSubscriptions = electronMocks.handlers.get(EVENTS_CHANNELS.GET_AGENT_SUBSCRIPTIONS);
    const result = await readSubscriptions?.(
      {},
      { workspaceId: 'ws-agent-subscriptions', agentId: 'agent-parent' },
    );

    expect(result).toEqual({
      success: true,
      data: [
        expect.objectContaining({
          id: subscriptionId,
          agentId: 'agent-parent',
          eventTypes: ['agent:idle'],
          actorIds: ['agent-child'],
          delegationGroup: {
            groupId: 'group-1',
            awaitMode: 'all',
            expectedAgentIds: ['agent-child'],
          },
        }),
      ],
      delegationGroups: [
        {
          groupId: 'group-1',
          awaitMode: 'all',
          expectedAgentIds: ['agent-child'],
          completedAgentIds: [],
          deletedAgentIds: [],
          agentStatuses: { 'agent-child': 'responding' },
          delivered: false,
        },
      ],
      agentStatuses: { 'agent-child': 'responding' },
    });
  });
});
