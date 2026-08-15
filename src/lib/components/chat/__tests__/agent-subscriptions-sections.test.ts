/** Rendered contracts for the unified waiting-agent subscription disclosure. */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { tick } from 'svelte';

const { backendRequestSpy, navigateToRouteSpy, sessionState } = vi.hoisted(() => ({
  backendRequestSpy: vi.fn(),
  navigateToRouteSpy: vi.fn().mockResolvedValue(undefined),
  sessionState: { byId: new Map<string, Record<string, unknown>>() },
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
const makeDerivedReadable = <S, T>(
  source: { subscribe: (run: (value: S) => void) => () => void },
  project: (value: S) => T,
) => ({
  subscribe: (run: (value: T) => void) => source.subscribe((value) => run(project(value))),
});
vi.mock('$lib/utils/navigation.client', () => ({ navigateToRoute: navigateToRouteSpy }));
vi.mock('$store/renderer/slices/agent-session/agent-session-selectors', () => ({
  selectAgentSession: Object.assign(
    (agentId: { subscribe: (run: (value: string) => void) => () => void }) =>
      makeDerivedReadable(agentId, (id) => sessionState.byId.get(id) ?? null),
    {
      effect: function* (agentId: string) {
        return sessionState.byId.get(agentId) ?? null;
      },
    },
  ),
  selectAgentSessionsByIds: (agentIds: {
    subscribe: (run: (value: string[]) => void) => () => void;
  }) =>
    makeDerivedReadable(agentIds, (ids) =>
      ids.flatMap((id) => {
        const session = sessionState.byId.get(id);
        return session ? [session] : [];
      }),
    ),
  selectAgentIsResponding: () => makeReadable(false),
  selectAgentIsWaiting: () => makeReadable(false),
  selectAgentIsBlockedWaiting: () => makeReadable(false),
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
vi.mock('$features/agent/components/auggie-avatar/AugieAvatarWithState.svelte', async () => ({
  default: (await import('./mocks/MockAvatarWithState.svelte')).default,
}));
vi.mock('$lib/components/ui/tooltip', async () => {
  const SlotOnly = (await import('./mocks/SlotOnly.svelte')).default;
  return { Provider: SlotOnly, Root: SlotOnly, Trigger: SlotOnly, Content: SlotOnly };
});

import { store as appStore } from '$store/renderer/store';
import { workspaceDeleted } from '$store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';
import { setWorkspaceEntity } from '$store/renderer/slices/workspace/workspace-slice';
import { requestSubscriptionFetch } from '$store/renderer/slices/agent-subscription-ui/agent-subscription-ui-slice';
import { agentSubscriptionReadSaga } from '$store/renderer/slices/agent-subscription-ui/sagas/agent-subscription-read-saga';
import { agentMutationSaga } from '$store/renderer/slices/agent-session/sagas/agent-mutation-saga';
import { appLayoutNavigationSaga } from '$store/renderer/slices/app-layout/sagas/app-layout-navigation-saga';
import {
  clearPanelLayout,
  initializeLayout,
} from '$store/renderer/slices/panel-layout/panel-layout-slice';
import { openWorkspaceTab } from '$store/renderer/slices/tab-state/tab-state-slice';
import AgentSubscriptions from '../AgentSubscriptions.svelte';
import {
  SUBSCRIPTION_CARD_CONTAINMENT_CLASS,
  SUBSCRIPTION_CARD_SURFACE_CLASS,
} from '../subscription-disclosure';
import { resetAgentSubscriptionsViewStateForTests } from '../agent-subscriptions-view-state';

const PARENT = 'agent-parent-1';
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const stopSagas: Array<() => void> = [];
const originalInnerWidth = window.innerWidth;

function oneShotSubscription(
  id: string,
  wsId: string,
  actorIds: string[],
  createdAt = '2026-01-01T00:00:00.000Z',
) {
  return {
    id,
    agentId: PARENT,
    workspaceId: wsId,
    createdAt,
    actorIds,
    eventTypes: ['agent:idle', 'agent:failed', 'agent:deleted'],
    description: 'Waiting for agent completion',
  };
}

function groupSubscription(groupId: string, wsId: string, expectedAgentIds: string[]) {
  return {
    ...oneShotSubscription(`watch-${groupId}`, wsId, expectedAgentIds),
    delegationGroup: { groupId, awaitMode: 'all' as const, expectedAgentIds },
  };
}

function delegationGroup(
  groupId: string,
  expectedAgentIds: string[],
  completedAgentIds: string[] = [],
) {
  return {
    groupId,
    parentAgentId: PARENT,
    awaitMode: 'all' as const,
    expectedAgentIds,
    completedAgentIds,
    deletedAgentIds: [],
    delivered: false,
  };
}

function snapshot(
  subscriptions: unknown[] = [],
  delegationGroups: unknown[] = [],
  agentStatuses: Record<string, string> = {},
) {
  return { subscriptions, delegationGroups, agentStatuses };
}

function resetWorkspace(wsId: string) {
  appStore.dispatch(workspaceDeleted(wsId, []));
  appStore.dispatch(clearPanelLayout(wsId));
}

function seedWorkspace(wsId: string) {
  appStore.dispatch(
    setWorkspaceEntity({ id: wsId, name: 'Workspace', path: '/workspace' } as never),
  );
  appStore.dispatch(openWorkspaceTab(wsId));
}

function seedPanelLayout(
  wsId: string,
  panels: Record<string, { id: string; tabs: any[]; activeTabId: string | null }>,
  focusedPanelId: string,
) {
  const panelIds = Object.keys(panels);
  appStore.dispatch(
    initializeLayout(wsId, {
      root:
        panelIds.length === 1
          ? { type: 'panel', panelId: panelIds[0] }
          : {
              type: 'split',
              direction: 'horizontal',
              children: panelIds.map((panelId) => ({ type: 'panel', panelId })),
              sizes: panelIds.map(() => 100 / panelIds.length),
            },
      panels,
      focusedPanelId,
    }),
  );
}

function seedSession(
  id: string,
  updatedAt: string,
  status: 'idle' | 'responding' | 'waiting' | 'completed' | 'failed' = 'completed',
  workspaceId = 'workspace-session',
) {
  sessionState.byId.set(id, {
    id,
    workspaceId,
    name: `Named ${id}`,
    status,
    messages: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt,
  });
}

async function renderWithSnapshot(wsId: string, wire: unknown, compact = false) {
  resetWorkspace(wsId);
  backendRequestSpy.mockResolvedValue(wire);
  const utils = render(AgentSubscriptions, {
    props: { workspaceId: wsId, agentId: PARENT, compact },
  });
  await flush();
  await flush();
  const value = wire as { subscriptions?: unknown[]; delegationGroups?: unknown[] };
  if ((value.subscriptions?.length ?? 0) > 0 || (value.delegationGroups?.length ?? 0) > 0) {
    await waitFor(() => expect(screen.getByTestId('one-shot-watches')).toBeTruthy());
  }
  return utils;
}

async function refetch(wsId: string, wire: unknown) {
  backendRequestSpy.mockResolvedValue(wire);
  appStore.dispatch(requestSubscriptionFetch(wsId, PARENT));
  await flush();
  await flush();
}

async function expandWaitingAgents() {
  const toggle = screen.getByTestId('one-shot-collapse-toggle');
  if (toggle.getAttribute('aria-expanded') === 'false') await fireEvent.click(toggle);
  return screen.getByTestId('one-shot-agent-list');
}

function visibleAgentIds(): string[] {
  return screen
    .getAllByTestId('agent-list-item')
    .map((row) => row.getAttribute('data-agent-id') ?? '');
}

function agentRow(agentId: string): HTMLElement {
  const row = screen
    .getAllByTestId('agent-list-item')
    .find((candidate) => candidate.getAttribute('data-agent-id') === agentId);
  if (!row) throw new Error(`Missing rendered row for ${agentId}`);
  return row;
}

describe('AgentSubscriptions unified waiting disclosure', () => {
  beforeAll(() => {
    appStore.init();
    stopSagas.push(appStore.runSaga(agentSubscriptionReadSaga));
    stopSagas.push(appStore.runSaga(agentMutationSaga));
    stopSagas.push(appStore.runSaga(appLayoutNavigationSaga));
  });

  afterAll(() => {
    while (stopSagas.length > 0) stopSagas.pop()?.();
  });

  beforeEach(() => {
    backendRequestSpy.mockReset();
    backendRequestSpy.mockResolvedValue(snapshot());
    navigateToRouteSpy.mockClear();
    sessionState.byId.clear();
    resetAgentSubscriptionsViewStateForTests();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    document.documentElement.classList.remove('light', 'dark');
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalInnerWidth });
    vi.clearAllMocks();
  });

  it('requests the §5.5 snapshot and renders no disclosure for zero agents', async () => {
    const wsId = 'ws-waiting-zero';
    await renderWithSnapshot(wsId, snapshot());
    expect(backendRequestSpy.mock.calls).toContainEqual([
      'agent.getSubscriptions',
      { workspaceId: wsId, agentId: PARENT },
    ]);
    expect(screen.queryByTestId('one-shot-watches')).toBeNull();
    expect(screen.queryByTestId('agent-subscriptions-card')).toBeNull();
  });

  it('renders one group agent under one singular top-level toggle', async () => {
    const wsId = 'ws-waiting-one';
    await renderWithSnapshot(
      wsId,
      snapshot(
        [groupSubscription('group-a', wsId, ['agent-a'])],
        [delegationGroup('group-a', ['agent-a'])],
      ),
    );
    expect(screen.getAllByTestId('one-shot-watches')).toHaveLength(1);
    expect(screen.queryByTestId('delegation-group-section')).toBeNull();
    expect(screen.getByTestId('one-shot-summary-title').textContent?.trim()).toBe(
      'Waiting for 1 agent',
    );
    await expandWaitingAgents();
    expect(visibleAgentIds()).toEqual(['agent-a']);
  });

  it('starts collapsed and supports summary and chevron expand/collapse transitions', async () => {
    const wsId = 'ws-waiting-collapsed';
    await renderWithSnapshot(wsId, snapshot([oneShotSubscription('watch-a', wsId, ['agent-a'])]));
    const summary = screen.getByTestId('one-shot-summary-toggle');
    const chevron = screen.getByTestId('one-shot-collapse-toggle');

    expect(summary.getAttribute('aria-expanded')).toBe('false');
    expect(chevron.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('one-shot-agent-list')).toBeNull();
    await fireEvent.click(summary);
    expect(summary.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByTestId('one-shot-agent-list')).toBeTruthy();
    await fireEvent.click(chevron);
    expect(summary.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('one-shot-agent-list')).toBeNull();
  });

  it('persists the watched-agent expanded state across remounts in the session', async () => {
    const wsId = 'ws-waiting-persistence';
    const wire = snapshot([oneShotSubscription('watch-a', wsId, ['agent-a'])]);
    const first = await renderWithSnapshot(wsId, wire);
    await fireEvent.click(screen.getByTestId('one-shot-summary-toggle'));
    expect(screen.getByTestId('one-shot-agent-list')).toBeTruthy();
    first.unmount();

    await renderWithSnapshot(wsId, wire);
    expect(screen.getByTestId('one-shot-summary-toggle').getAttribute('aria-expanded')).toBe(
      'true',
    );
    expect(screen.getByTestId('one-shot-agent-list')).toBeTruthy();
  });

  it('combines many sources into one full deterministic deduplicated list', async () => {
    const wsId = 'ws-waiting-many';
    await renderWithSnapshot(
      wsId,
      snapshot(
        [
          oneShotSubscription('later', wsId, ['agent-b'], '2026-01-02T00:00:00.000Z'),
          oneShotSubscription('earlier', wsId, ['agent-z'], '2026-01-01T00:00:00.000Z'),
          groupSubscription('group-a', wsId, ['agent-b', 'agent-a']),
          groupSubscription('group-b', wsId, ['agent-c', 'agent-a', 'agent-d']),
        ],
        [
          delegationGroup('group-a', ['agent-b', 'agent-a'], ['agent-a']),
          delegationGroup('group-b', ['agent-c', 'agent-a', 'agent-d']),
        ],
        { 'agent-a': 'completed', 'agent-b': 'responding' },
      ),
    );
    expect(screen.getAllByTestId('one-shot-watches')).toHaveLength(1);
    expect(screen.getByTestId('one-shot-summary-title').textContent?.trim()).toBe(
      'Waiting for 5 agents',
    );
    expect(screen.getByTestId('one-shot-header').textContent).not.toContain('+');
    await expandWaitingAgents();
    expect(visibleAgentIds()).toEqual(['agent-z', 'agent-b', 'agent-c', 'agent-d', 'agent-a']);
    expect(within(agentRow('agent-a')).getByTestId('mock-avatar-with-state').dataset.state).toBe(
      'completed',
    );
  });

  it('keeps active, waiting, idle, and failed agents visible while grouping finished agents', async () => {
    const wsId = 'ws-finished-statuses';
    seedSession('agent-finished-old', '2026-01-02T00:00:00.000Z');
    seedSession('agent-finished-new', '2026-01-04T00:00:00.000Z');
    for (const [id, status] of [
      ['agent-active', 'responding'],
      ['agent-waiting', 'waiting'],
      ['agent-idle', 'idle'],
      ['agent-failed', 'failed'],
    ] as const) {
      seedSession(id, '2026-01-03T00:00:00.000Z', status);
    }
    const agentIds = [
      'agent-finished-old',
      'agent-active',
      'agent-waiting',
      'agent-idle',
      'agent-failed',
      'agent-finished-new',
    ];
    await renderWithSnapshot(
      wsId,
      snapshot([oneShotSubscription('watch-mixed', wsId, agentIds)], [], {
        'agent-finished-old': 'completed',
        'agent-active': 'responding',
        'agent-waiting': 'waiting',
        'agent-idle': 'idle',
        'agent-failed': 'failed',
        'agent-finished-new': 'completed',
      }),
    );

    await expandWaitingAgents();
    expect(visibleAgentIds()).toEqual([
      'agent-active',
      'agent-waiting',
      'agent-idle',
      'agent-failed',
    ]);
    const summary = screen.getByTestId('finished-agent-summary');
    expect(summary.textContent).toContain('2 agents finished');
    expect(summary.getAttribute('aria-expanded')).toBe('false');
    expect(
      screen.getByTestId('finished-agent-chevron').querySelector('svg')?.getAttribute('class'),
    ).toContain('-rotate-90');
    expect(screen.getByTestId('finished-agent-group').dataset.finishedAt).toBe(
      '2026-01-04T00:00:00.000Z',
    );

    await fireEvent.click(summary);
    expect(
      screen.getByTestId('finished-agent-chevron').querySelector('svg')?.getAttribute('class'),
    ).not.toContain('-rotate-90');
    expect(visibleAgentIds()).toEqual([
      'agent-active',
      'agent-waiting',
      'agent-idle',
      'agent-failed',
      'agent-finished-new',
      'agent-finished-old',
    ]);
    expect(
      within(screen.getByTestId('finished-agent-list')).getByText('Named agent-finished-new'),
    ).toBeTruthy();
  });

  it.each([
    ['light', 1024],
    ['dark', 320],
  ])(
    'renders the collapsed finished summary flush and transparent in %s at %ipx',
    async (theme, width) => {
      document.documentElement.classList.add(theme);
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
      const wsId = `ws-finished-summary-${theme}-${width}`;
      seedSession('agent-a', '2026-01-02T00:00:00.000Z');
      seedSession('agent-b', '2026-01-03T00:00:00.000Z');
      await renderWithSnapshot(
        wsId,
        snapshot([oneShotSubscription('watch-finished', wsId, ['agent-a', 'agent-b'])], [], {
          'agent-a': 'completed',
          'agent-b': 'completed',
        }),
      );

      await expandWaitingAgents();
      const group = screen.getByTestId('finished-agent-group');
      const summary = screen.getByTestId('finished-agent-summary');
      const horizontalInsetClass = /^(?:-?m(?:[lrxse])?|-?inset(?:[lrxse])?|p(?:[lrxse])?)-/;
      const distinctSurfaceClass = /^(?:bg-|rounded(?:-|$)|shadow(?:-|$))/;

      expect(summary.getAttribute('aria-expanded')).toBe('false');
      for (const token of [...group.classList, ...summary.classList]) {
        expect(token).not.toMatch(horizontalInsetClass);
        expect(token).not.toMatch(distinctSurfaceClass);
      }
    },
  );

  it.each(['light', 'dark'])('uses an aligned neutral checkmark in %s', async (theme) => {
    document.documentElement.classList.add(theme);
    const wsId = `ws-finished-icon-${theme}`;
    seedSession('agent-a', '2026-01-02T00:00:00.000Z');
    seedSession('agent-b', '2026-01-03T00:00:00.000Z');
    await renderWithSnapshot(
      wsId,
      snapshot([oneShotSubscription('watch-finished', wsId, ['agent-a', 'agent-b'])], [], {
        'agent-a': 'completed',
        'agent-b': 'completed',
      }),
    );

    const waitingSummary = screen.getByTestId('one-shot-summary-toggle');
    await expandWaitingAgents();
    const finishedSummary = screen.getByTestId('finished-agent-summary');
    const finishedIconOffset = screen.getByTestId('finished-agent-icon-offset');
    const waitingIcon = waitingSummary.querySelector('[data-icon="hourglass"]');
    const finishedIcon = finishedSummary.querySelector('[data-icon="check"]');

    expect(finishedSummary.classList).toContain('items-center');
    expect(finishedSummary.classList).toContain('gap-1.5');
    expect(finishedSummary.classList).not.toContain('px-2');
    expect(finishedIconOffset.classList).toContain('ml-2');
    expect(finishedIconOffset.classList).toContain('items-center');
    expect(screen.getByTestId('one-shot-agent-list').classList).toContain('px-1');
    expect(screen.getByTestId('one-shot-header').classList).toContain('px-3');
    expect(finishedIcon).toBeTruthy();
    expect(finishedSummary.querySelector('[data-icon="circle-check"]')).toBeNull();
    expect(finishedIcon?.classList).toContain('text-ghost');
    expect(finishedIcon?.classList).toContain('opacity-60');
    expect(finishedIcon?.className.baseVal).not.toMatch(/green/);
    for (const token of ['h-3.5!', 'w-3.5!', 'shrink-0']) {
      expect(finishedIcon?.classList).toContain(token);
      expect(waitingIcon?.classList).toContain(token);
    }
  });

  it('supports keyboard disclosure plus navigation and removal inside the finished group', async () => {
    const wsId = 'ws-finished-actions';
    seedSession('agent-a', '2026-01-02T00:00:00.000Z', 'completed', wsId);
    seedSession('agent-b', '2026-01-03T00:00:00.000Z', 'completed', wsId);
    await renderWithSnapshot(
      wsId,
      snapshot([oneShotSubscription('watch-finished', wsId, ['agent-a', 'agent-b'])], [], {
        'agent-a': 'completed',
        'agent-b': 'completed',
      }),
    );
    appStore.dispatch(
      setWorkspaceEntity({ id: wsId, name: 'Workspace', path: '/workspace' } as never),
    );
    await expandWaitingAgents();
    const summary = screen.getByTestId('finished-agent-summary');
    summary.focus();
    await fireEvent.keyDown(summary, { key: ' ' });
    expect(summary.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(summary);

    const dispatchSpy = vi.spyOn(appStore, 'dispatch');
    await fireEvent.click(within(agentRow('agent-b')).getAllByRole('button')[0]);
    expect(
      dispatchSpy.mock.calls.some(
        ([action]) =>
          action.type === 'appLayout/openAgentTabRequested' &&
          action.payload?.[0] === wsId &&
          action.payload?.[1]?.agentId === 'agent-b',
      ),
    ).toBe(true);
    dispatchSpy.mockRestore();

    backendRequestSpy.mockClear();
    await fireEvent.click(within(agentRow('agent-b')).getByTestId('one-shot-cancel'));
    await flush();
    expect(backendRequestSpy.mock.calls).toContainEqual([
      'agent.cancelSubscriptions',
      { workspaceId: wsId, agentId: PARENT, subscriptionId: 'watch-finished' },
    ]);
  });

  it('reuses, reveals, and focuses an existing watched-agent panel without duplicating it', async () => {
    const wsId = 'ws-agent-panel-reuse';
    seedSession('agent-target', '2026-01-03T00:00:00.000Z', 'responding', wsId);
    await renderWithSnapshot(
      wsId,
      snapshot([oneShotSubscription('watch-target', wsId, ['agent-target'])]),
    );
    seedWorkspace(wsId);
    seedPanelLayout(
      wsId,
      {
        parent: {
          id: 'parent',
          tabs: [{ id: 'parent-tab', type: 'agent', title: 'Parent', agentId: PARENT }],
          activeTabId: 'parent-tab',
        },
        target: {
          id: 'target',
          tabs: [
            { id: 'other-tab', type: 'note', title: 'Other', noteId: 'note-1' },
            { id: 'target-tab', type: 'agent', title: 'Target', agentId: 'agent-target' },
          ],
          activeTabId: 'other-tab',
        },
      },
      'parent',
    );
    await expandWaitingAgents();
    const focusEvents: CustomEvent[] = [];
    const onFocus = (event: Event) => focusEvents.push(event as CustomEvent);
    window.addEventListener('panel:focus-content', onFocus);
    vi.useFakeTimers();
    try {
      await fireEvent.click(within(agentRow('agent-target')).getAllByRole('button')[0]);
      await vi.advanceTimersByTimeAsync(600);

      const layout = appStore.state.panelLayout.byWorkspaceId[wsId];
      expect(Object.values(layout.panels).flatMap((panel) => panel.tabs)).toHaveLength(3);
      expect(layout.focusedPanelId).toBe('target');
      expect(layout.panels.target.activeTabId).toBe('target-tab');
      expect(focusEvents.some((event) => event.detail.agentId === 'agent-target')).toBe(true);
    } finally {
      window.removeEventListener('panel:focus-content', onFocus);
      vi.runOnlyPendingTimers();
      vi.useRealTimers();
    }
  });

  it.each(['Enter', ' '])('uses the same panel reuse path for the %s key', async (key) => {
    const wsId = `ws-agent-panel-key-${key === ' ' ? 'space' : 'enter'}`;
    seedSession('agent-target', '2026-01-03T00:00:00.000Z', 'responding', wsId);
    await renderWithSnapshot(
      wsId,
      snapshot([oneShotSubscription('watch-target', wsId, ['agent-target'])]),
    );
    seedWorkspace(wsId);
    seedPanelLayout(
      wsId,
      {
        parent: { id: 'parent', tabs: [], activeTabId: null },
        target: {
          id: 'target',
          tabs: [{ id: 'target-tab', type: 'agent', title: 'Target', agentId: 'agent-target' }],
          activeTabId: 'target-tab',
        },
      },
      'parent',
    );
    await expandWaitingAgents();
    const button = within(agentRow('agent-target')).getAllByRole('button')[0];

    await fireEvent.keyDown(button, { key });
    await flush();
    await flush();

    const layout = appStore.state.panelLayout.byWorkspaceId[wsId];
    expect(Object.values(layout.panels).flatMap((panel) => panel.tabs)).toHaveLength(1);
    expect(layout.focusedPanelId).toBe('target');
    expect(agentRow('agent-target').querySelector('input')).toBeNull();
  });

  it('creates one adjacent agent panel when no matching panel exists', async () => {
    const wsId = 'ws-agent-panel-create';
    seedSession('agent-new', '2026-01-03T00:00:00.000Z', 'responding', wsId);
    await renderWithSnapshot(
      wsId,
      snapshot([oneShotSubscription('watch-new', wsId, ['agent-new'])]),
    );
    seedWorkspace(wsId);
    seedPanelLayout(
      wsId,
      {
        parent: {
          id: 'parent',
          tabs: [{ id: 'parent-tab', type: 'agent', title: 'Parent', agentId: PARENT }],
          activeTabId: 'parent-tab',
        },
      },
      'parent',
    );
    await expandWaitingAgents();

    await fireEvent.click(within(agentRow('agent-new')).getAllByRole('button')[0]);
    await flush();
    await flush();

    const layout = appStore.state.panelLayout.byWorkspaceId[wsId];
    const agentTabs = Object.values(layout.panels)
      .flatMap((panel) => panel.tabs)
      .filter((tab) => tab.type === 'agent' && tab.agentId === 'agent-new');
    expect(Object.keys(layout.panels)).toHaveLength(2);
    expect(agentTabs).toHaveLength(1);
  });

  it('switches to the watched agent workspace before panel navigation', async () => {
    const wsId = 'ws-agent-panel-switch';
    seedSession('agent-target', '2026-01-03T00:00:00.000Z', 'responding', wsId);
    await renderWithSnapshot(
      wsId,
      snapshot([oneShotSubscription('watch-target', wsId, ['agent-target'])]),
    );
    seedWorkspace(wsId);
    appStore.dispatch(openWorkspaceTab('ws-other'));
    seedPanelLayout(wsId, { parent: { id: 'parent', tabs: [], activeTabId: null } }, 'parent');
    await expandWaitingAgents();

    await fireEvent.keyDown(within(agentRow('agent-target')).getAllByRole('button')[0], {
      key: 'Enter',
    });

    expect(appStore.state.tabState.currentTabId).toBe(wsId);
    expect(navigateToRouteSpy).toHaveBeenCalledWith(`/workspace/${wsId}`);
  });

  it('cancels delayed focus when navigation makes the watched workspace stale', async () => {
    const wsId = 'ws-agent-panel-stale-focus';
    seedSession('agent-target', '2026-01-03T00:00:00.000Z', 'responding', wsId);
    await renderWithSnapshot(
      wsId,
      snapshot([oneShotSubscription('watch-target', wsId, ['agent-target'])]),
    );
    seedWorkspace(wsId);
    seedPanelLayout(wsId, { parent: { id: 'parent', tabs: [], activeTabId: null } }, 'parent');
    await expandWaitingAgents();
    const focusEvents: CustomEvent[] = [];
    const onFocus = (event: Event) => focusEvents.push(event as CustomEvent);
    window.addEventListener('panel:focus-content', onFocus);
    vi.useFakeTimers();
    try {
      await fireEvent.click(within(agentRow('agent-target')).getAllByRole('button')[0]);
      appStore.dispatch(openWorkspaceTab('ws-other'));
      await tick();
      vi.advanceTimersByTime(600);

      expect(focusEvents).toEqual([]);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
      window.removeEventListener('panel:focus-content', onFocus);
    }
  });

  it('persists finished disclosure state across component remounts in the session', async () => {
    const wsId = 'ws-finished-persistence';
    seedSession('agent-a', '2026-01-02T00:00:00.000Z');
    seedSession('agent-b', '2026-01-03T00:00:00.000Z');
    const wire = snapshot(
      [oneShotSubscription('watch-finished', wsId, ['agent-a', 'agent-b'])],
      [],
      { 'agent-a': 'completed', 'agent-b': 'completed' },
    );
    const first = await renderWithSnapshot(wsId, wire);
    await expandWaitingAgents();
    await fireEvent.click(screen.getByTestId('finished-agent-summary'));
    expect(screen.getByTestId('finished-agent-list')).toBeTruthy();
    first.unmount();

    await renderWithSnapshot(wsId, wire);
    expect(screen.getByTestId('finished-agent-summary').getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByTestId('finished-agent-list')).toBeTruthy();
  });

  it('leaves a single finished agent ungrouped beside failed agents', async () => {
    const wsId = 'ws-single-finished';
    await renderWithSnapshot(
      wsId,
      snapshot([oneShotSubscription('watch-mixed', wsId, ['agent-done', 'agent-failed'])], [], {
        'agent-done': 'completed',
        'agent-failed': 'failed',
      }),
    );
    expect(screen.queryByTestId('finished-agent-summary')).toBeNull();
    await expandWaitingAgents();
    expect(visibleAgentIds()).toEqual(['agent-failed', 'agent-done']);
  });

  it('renders every agent instead of truncating the list to +n', async () => {
    const wsId = 'ws-waiting-full-list';
    const agents = Array.from({ length: 8 }, (_, index) => `agent-${index + 1}`);
    await renderWithSnapshot(
      wsId,
      snapshot(
        [groupSubscription('group-many', wsId, agents)],
        [delegationGroup('group-many', agents)],
      ),
    );
    expect(screen.getByTestId('one-shot-summary-title').textContent?.trim()).toBe(
      'Waiting for 8 agents',
    );
    await expandWaitingAgents();
    expect(visibleAgentIds()).toEqual(agents);
    expect(screen.queryByText(/more agents/i)).toBeNull();
  });

  it('deduplicates repeated actors, groups, and cross-source references exactly once', async () => {
    const wsId = 'ws-waiting-duplicates';
    await renderWithSnapshot(
      wsId,
      snapshot(
        [
          oneShotSubscription('watch-a', wsId, ['agent-a', 'agent-a']),
          groupSubscription('group-a', wsId, ['agent-a', 'agent-b', 'agent-b']),
        ],
        [
          delegationGroup('group-a', ['agent-a', 'agent-b', 'agent-b']),
          delegationGroup('group-a', ['agent-a', 'agent-b']),
        ],
      ),
    );
    expect(screen.getByTestId('one-shot-summary-title').textContent?.trim()).toBe(
      'Waiting for 2 agents',
    );
    await expandWaitingAgents();
    expect(visibleAgentIds()).toEqual(['agent-a', 'agent-b']);
  });

  it('reactively updates N and rows while preserving the expanded state', async () => {
    const wsId = 'ws-waiting-reactive';
    await renderWithSnapshot(
      wsId,
      snapshot(
        [groupSubscription('group-a', wsId, ['agent-a'])],
        [delegationGroup('group-a', ['agent-a'])],
      ),
    );
    const toggle = screen.getByTestId('one-shot-collapse-toggle');
    await expandWaitingAgents();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    await refetch(
      wsId,
      snapshot(
        [groupSubscription('group-a', wsId, ['agent-a', 'agent-b', 'agent-c'])],
        [delegationGroup('group-a', ['agent-a', 'agent-b', 'agent-c'], ['agent-a'])],
      ),
    );
    await waitFor(() =>
      expect(screen.getByTestId('one-shot-summary-title').textContent?.trim()).toBe(
        'Waiting for 3 agents',
      ),
    );
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(visibleAgentIds()).toEqual(['agent-b', 'agent-c', 'agent-a']);
    await refetch(wsId, snapshot());
    await waitFor(() => expect(screen.queryByTestId('one-shot-watches')).toBeNull());
  });

  it('keeps per-agent stop and subscription-scoped cancel actions', async () => {
    const wsId = 'ws-waiting-actions-shot';
    await renderWithSnapshot(wsId, snapshot([oneShotSubscription('watch-a', wsId, ['agent-a'])]));
    await expandWaitingAgents();
    const row = agentRow('agent-a');
    const rowButton = within(row).getAllByRole('button')[0];
    const stopButton = within(row).getByTestId('one-shot-stop');
    const cancelButton = within(row).getByTestId('one-shot-cancel');
    expect(stopButton.tagName).toBe('BUTTON');
    expect(cancelButton.tagName).toBe('BUTTON');
    expect(rowButton.contains(stopButton)).toBe(false);
    expect(rowButton.contains(cancelButton)).toBe(false);
    expect(row.querySelector('span[role="button"]')).toBeNull();
    backendRequestSpy.mockClear();
    await fireEvent.click(within(agentRow('agent-a')).getByTestId('one-shot-stop'));
    await flush();
    expect(backendRequestSpy.mock.calls).toContainEqual(['agent.stop', { agentId: 'agent-a' }]);
    await fireEvent.click(within(agentRow('agent-a')).getByTestId('one-shot-cancel'));
    await flush();
    expect(backendRequestSpy.mock.calls).toContainEqual([
      'agent.cancelSubscriptions',
      { workspaceId: wsId, agentId: PARENT, subscriptionId: 'watch-a' },
    ]);
  });

  it('keeps grouped rows individually stoppable with group-scoped cancel routing', async () => {
    const wsId = 'ws-waiting-actions-group';
    await renderWithSnapshot(
      wsId,
      snapshot(
        [groupSubscription('group-a', wsId, ['agent-a', 'agent-b'])],
        [delegationGroup('group-a', ['agent-a', 'agent-b'])],
      ),
    );
    await expandWaitingAgents();
    backendRequestSpy.mockClear();
    await fireEvent.click(within(agentRow('agent-b')).getByTestId('one-shot-stop'));
    await flush();
    expect(backendRequestSpy.mock.calls).toContainEqual(['agent.stop', { agentId: 'agent-b' }]);
    await fireEvent.click(within(agentRow('agent-b')).getByTestId('one-shot-cancel'));
    await flush();
    expect(backendRequestSpy.mock.calls).toContainEqual([
      'agent.cancelSubscriptions',
      { workspaceId: wsId, agentId: PARENT, groupId: 'group-a' },
    ]);
  });

  it('preserves disclosure accessibility, containment, and external spacing ownership', async () => {
    const wsId = 'ws-waiting-contract';
    await renderWithSnapshot(
      wsId,
      snapshot(
        [groupSubscription('group-a', wsId, ['agent-a', 'agent-b'])],
        [delegationGroup('group-a', ['agent-a', 'agent-b'])],
      ),
      true,
    );
    const card = screen.getByTestId('agent-subscriptions-card');
    for (const token of [
      ...SUBSCRIPTION_CARD_CONTAINMENT_CLASS.split(' '),
      ...SUBSCRIPTION_CARD_SURFACE_CLASS.split(' '),
    ]) {
      expect(card.classList.contains(token)).toBe(true);
    }
    expect(card.className).not.toMatch(/mb-(3|4|8|12)/);
    const summary = screen.getByTestId('one-shot-summary-toggle');
    const chevron = screen.getByTestId('one-shot-collapse-toggle');
    expect(summary.getAttribute('aria-controls')).toMatch(/^waiting-agent-list-/);
    expect(chevron.getAttribute('aria-controls')).toBe(summary.getAttribute('aria-controls'));
    summary.focus();
    await fireEvent.keyDown(summary, { key: 'Enter' });
    expect(summary.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(summary);
  });
});
