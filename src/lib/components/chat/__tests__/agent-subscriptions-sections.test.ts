/**
 * Component tests for the reworked AgentSubscriptions footer: one-shot watch
 * rows on top, one collapsible DelegationGroupSection per after_all group.
 *
 * FAKE seam: `backendRequest` is stubbed (no daemon). The read middleware is
 * registered in the REAL configured store, so rendering the component
 * dispatches `requestSubscriptionFetch`, we assert the exact
 * `agent.getSubscriptions` request shape (PROTOCOL §5.5 extensions), feed a
 * PROTOCOL-shaped mock response back, and assert the rendered sections.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';

const { backendRequestSpy } = vi.hoisted(() => ({
  backendRequestSpy: vi.fn(),
}));
vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: (method: string, params?: unknown) => backendRequestSpy(method, params),
  onBackendNotification: () => () => {},
  onBackendReconnected: () => () => {},
}));

const makeReadable = <T>(value: T) => ({
  subscribe: (run: (value: T) => void) => {
    run(value);
    return () => {};
  },
});

vi.mock('$store/renderer/slices/agent-session/agent-session-selectors', () => ({
  selectAgentSession: () => makeReadable(null),
  selectAgentIsResponding: () => makeReadable(false),
  selectAgentIsWaiting: () => makeReadable(false),
  selectAgentSessionStreamingContent: () => makeReadable(''),
  selectAgentSessionHasStreamOwnedMessage: () => makeReadable(false),
  selectAgentProvider: () => makeReadable(undefined),
}));

vi.mock('$store/renderer/slices/permission/permission-selectors', () => ({
  selectPendingCount: () => makeReadable(0),
}));

vi.mock('$store/renderer/slices/changes/changes-selectors', () => ({
  selectAgentLineStats: () => makeReadable(null),
}));

vi.mock('../../ui/auggie-avatar/AugieAvatarWithState.svelte', async () => ({
  default: (await import('./mocks/MockAvatarWithState.svelte')).default,
}));

vi.mock('$lib/components/ui/tooltip', async () => {
  const SlotOnly = (await import('./mocks/SlotOnly.svelte')).default;
  return {
    Provider: SlotOnly,
    Root: SlotOnly,
    Trigger: SlotOnly,
    Content: SlotOnly,
  };
});

import { store as appStore } from '$store/renderer/store';
import { __resetAgentSubscriptionReadServiceForTests } from '$features/agent/agent-subscription-read-service';
import { workspaceDeleted } from '$store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';
import AgentSubscriptions from '../AgentSubscriptions.svelte';

const PARENT = 'agent-parent-1';
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** PROTOCOL §5.5 subscription entry belonging to an after_all group. */
function groupSubscription(groupId: string, wsId: string, expectedAgentIds: string[]) {
  return {
    id: `watch-${groupId}`,
    agentId: PARENT,
    agentName: 'Coordinator',
    workspaceId: wsId,
    createdAt: '2026-01-01T00:00:00.000Z',
    oneShot: true,
    actorIds: expectedAgentIds,
    eventTypes: ['agent:idle', 'agent:failed', 'agent:deleted'],
    delegationGroup: { groupId, awaitMode: 'all' as const, expectedAgentIds },
    description: 'Waiting for agent completion',
  };
}

/** PROTOCOL §5.5 one-shot watch entry (no delegation group). */
function oneShotSubscription(id: string, wsId: string, actorId: string) {
  return {
    id,
    agentId: PARENT,
    agentName: 'Coordinator',
    workspaceId: wsId,
    createdAt: '2026-01-01T00:00:00.000Z',
    oneShot: true,
    actorIds: [actorId],
    eventTypes: ['agent:idle', 'agent:failed', 'agent:deleted'],
    description: 'Waiting for agent completion',
  };
}

function delegationGroup(
  groupId: string,
  expectedAgentIds: string[],
  completedAgentIds: string[] = [],
  delivered = false,
) {
  return {
    groupId,
    parentAgentId: PARENT,
    awaitMode: 'all' as const,
    expectedAgentIds,
    completedAgentIds,
    deletedAgentIds: [],
    delivered,
  };
}

describe('AgentSubscriptions sections', () => {
  beforeAll(() => {
    appStore.init();
  });

  beforeEach(() => {
    backendRequestSpy.mockReset();
    backendRequestSpy.mockResolvedValue({
      subscriptions: [],
      delegationGroups: [],
      agentStatuses: {},
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  async function renderWithSnapshot(wsId: string, wire: unknown) {
    resetWorkspace(wsId);
    backendRequestSpy.mockResolvedValue(wire);
    const utils = render(AgentSubscriptions, {
      props: { workspaceId: wsId, agentId: PARENT },
    });
    await flush();
    await flush();
    return utils;
  }

  function resetWorkspace(wsId: string) {
    __resetAgentSubscriptionReadServiceForTests();
    appStore.dispatch(workspaceDeleted(wsId, []));
    __resetAgentSubscriptionReadServiceForTests();
  }

  it('sends the §5.5 agent.getSubscriptions request shape on mount', async () => {
    const WS = 'ws-sections-req';
    await renderWithSnapshot(WS, {
      subscriptions: [],
      delegationGroups: [],
      agentStatuses: {},
    });

    expect(backendRequestSpy.mock.calls).toContainEqual([
      'agent.getSubscriptions',
      { workspaceId: WS, agentId: PARENT },
    ]);
  });

  it('renders one section per after_all group with per-group (done/total) counters', async () => {
    const WS = 'ws-sections-two-groups';
    await renderWithSnapshot(WS, {
      subscriptions: [
        groupSubscription('grp-1', WS, ['child-a', 'child-b']),
        groupSubscription('grp-2', WS, ['child-c', 'child-d', 'child-e']),
      ],
      delegationGroups: [
        delegationGroup('grp-1', ['child-a', 'child-b'], ['child-a']),
        delegationGroup('grp-2', ['child-c', 'child-d', 'child-e']),
      ],
      agentStatuses: {
        [PARENT]: 'waiting',
        'child-a': 'completed',
        'child-b': 'responding',
        'child-c': 'responding',
        'child-d': 'responding',
        'child-e': 'responding',
      },
    });

    const sections = screen.getAllByTestId('delegation-group-section');
    expect(sections).toHaveLength(2);
    expect(within(sections[0]).getByTestId('group-counter').textContent).toContain('1/2');
    expect(within(sections[1]).getByTestId('group-counter').textContent).toContain('0/3');
    // No group has finished, so no delivery-pending warning anywhere
    expect(screen.queryByTestId('group-delivery-pending')).toBeNull();
    // No one-shot rows in this snapshot
    expect(screen.queryByTestId('one-shot-watches')).toBeNull();
  });

  it('renders one-shot watch rows above group sections with per-row actions', async () => {
    const WS = 'ws-sections-mixed';
    await renderWithSnapshot(WS, {
      subscriptions: [
        oneShotSubscription('watch-solo', WS, 'child-solo'),
        groupSubscription('grp-1', WS, ['child-a', 'child-b']),
      ],
      delegationGroups: [delegationGroup('grp-1', ['child-a', 'child-b'])],
      agentStatuses: {
        [PARENT]: 'waiting',
        'child-solo': 'responding',
        'child-a': 'responding',
        'child-b': 'responding',
      },
    });

    const oneShots = screen.getByTestId('one-shot-watches');
    expect(within(oneShots).getAllByTestId('agent-list-item')).toHaveLength(1);
    expect(within(oneShots).getByTestId('one-shot-stop')).toBeTruthy();
    expect(within(oneShots).getByTestId('one-shot-cancel')).toBeTruthy();

    const sections = screen.getAllByTestId('delegation-group-section');
    expect(sections).toHaveLength(1);
    // One-shot container precedes the group section in the DOM
    expect(
      oneShots.compareDocumentPosition(sections[0]) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('one-shot row stop sends agent.stop for the watched agent (§5.5)', async () => {
    const WS = 'ws-sections-row-stop';
    await renderWithSnapshot(WS, {
      subscriptions: [oneShotSubscription('watch-solo', WS, 'child-solo')],
      delegationGroups: [],
      agentStatuses: { [PARENT]: 'waiting', 'child-solo': 'responding' },
    });

    await fireEvent.click(screen.getByTestId('one-shot-stop'));
    await flush();

    expect(backendRequestSpy.mock.calls).toContainEqual([
      'agent.stop',
      { agentId: 'child-solo' },
    ]);
  });

  it('one-shot row cancel sends the scoped agent.cancelSubscriptions { subscriptionId } (§5.5)', async () => {
    const WS = 'ws-sections-row-cancel';
    await renderWithSnapshot(WS, {
      subscriptions: [oneShotSubscription('watch-solo', WS, 'child-solo')],
      delegationGroups: [],
      agentStatuses: { [PARENT]: 'waiting', 'child-solo': 'responding' },
    });

    await fireEvent.click(screen.getByTestId('one-shot-cancel'));
    await flush();

    expect(backendRequestSpy.mock.calls).toContainEqual([
      'agent.cancelSubscriptions',
      { agentId: PARENT, workspaceId: WS, subscriptionId: 'watch-solo' },
    ]);
  });

  it('group header stop sends agent.stop only for still-active agents in that group', async () => {
    const WS = 'ws-sections-group-stop';
    await renderWithSnapshot(WS, {
      subscriptions: [
        groupSubscription('grp-1', WS, ['child-a', 'child-b', 'child-done']),
        groupSubscription('grp-2', WS, ['child-c']),
      ],
      delegationGroups: [
        delegationGroup('grp-1', ['child-a', 'child-b', 'child-done'], ['child-done']),
        delegationGroup('grp-2', ['child-c']),
      ],
      agentStatuses: {
        [PARENT]: 'waiting',
        'child-a': 'responding',
        'child-b': 'responding',
        'child-done': 'completed',
        'child-c': 'responding',
      },
    });

    const sections = screen.getAllByTestId('delegation-group-section');
    await fireEvent.click(within(sections[0]).getByTestId('group-stop'));
    await flush();

    const stopCalls = backendRequestSpy.mock.calls.filter(([method]) => method === 'agent.stop');
    expect(stopCalls).toContainEqual(['agent.stop', { agentId: 'child-a' }]);
    expect(stopCalls).toContainEqual(['agent.stop', { agentId: 'child-b' }]);
    // Already-completed members and other groups' agents are not stopped.
    expect(stopCalls).not.toContainEqual(['agent.stop', { agentId: 'child-done' }]);
    expect(stopCalls).not.toContainEqual(['agent.stop', { agentId: 'child-c' }]);
  });

  it('group cancel sends the scoped agent.cancelSubscriptions { groupId } (§5.5)', async () => {
    const WS = 'ws-sections-group-cancel';
    await renderWithSnapshot(WS, {
      subscriptions: [groupSubscription('grp-1', WS, ['child-a', 'child-b'])],
      delegationGroups: [delegationGroup('grp-1', ['child-a', 'child-b'])],
      agentStatuses: { [PARENT]: 'waiting', 'child-a': 'responding', 'child-b': 'responding' },
    });

    await fireEvent.click(screen.getByTestId('group-cancel'));
    await flush();

    expect(backendRequestSpy.mock.calls).toContainEqual([
      'agent.cancelSubscriptions',
      { agentId: PARENT, workspaceId: WS, groupId: 'grp-1' },
    ]);
  });

  it('shows the delivery-pending warning only in the finished-but-undelivered group', async () => {
    const WS = 'ws-sections-delivery';
    await renderWithSnapshot(WS, {
      subscriptions: [
        groupSubscription('grp-done', WS, ['child-a']),
        groupSubscription('grp-live', WS, ['child-b']),
      ],
      delegationGroups: [
        delegationGroup('grp-done', ['child-a'], ['child-a'], false),
        delegationGroup('grp-live', ['child-b']),
      ],
      agentStatuses: { [PARENT]: 'waiting', 'child-a': 'completed', 'child-b': 'responding' },
    });

    const sections = screen.getAllByTestId('delegation-group-section');
    expect(sections).toHaveLength(2);
    expect(within(sections[0]).getByTestId('group-delivery-pending')).toBeTruthy();
    expect(within(sections[0]).getByTestId('group-counter').textContent).toContain('1/1');
    expect(within(sections[1]).queryByTestId('group-delivery-pending')).toBeNull();
  });
});
