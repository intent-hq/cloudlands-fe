/** Rendered contracts for the unified waiting-agent subscription disclosure. */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { tick } from 'svelte';

const { backendRequestSpy, navigateToRouteSpy, sessionState } = vi.hoisted(() => ({
  backendRequestSpy: vi.fn(),
  navigateToRouteSpy: vi.fn().mockResolvedValue(undefined),
  sessionState: {
    byId: new Map<string, Record<string, unknown>>(),
    historyById: new Map<string, Record<string, unknown>[]>(),
  },
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
const mockStreamingContent = new Map<string, string>();
const mockIsResponding = new Map<string, boolean>();
const mockHasStreamOwnedMessage = new Map<string, boolean>();

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
  selectAgentSessionsById: Object.assign(
    () => makeReadable(Object.fromEntries(sessionState.byId)),
    { select: () => Object.fromEntries(sessionState.byId) },
  ),
  selectAgentHistoryMessages: Object.assign(() => makeReadable([]), {
    select: (_state: unknown, agentId: string) => sessionState.historyById.get(agentId) ?? [],
  }),
  selectAgentIsResponding: (agentId: { subscribe: (run: (value: string) => void) => () => void }) =>
    makeDerivedReadable(agentId, (id) => mockIsResponding.get(id) ?? false),
  selectAgentPreview: Object.assign(
    (agentId: { subscribe: (run: (value: string) => void) => () => void }) =>
      makeDerivedReadable(agentId, (id) => {
        const session = sessionState.byId.get(id);
        const text =
          typeof session?.lastAgentResponse === 'string' ? session.lastAgentResponse : '';
        return text
          ? { kind: 'last-response', text, isLive: mockIsResponding.get(id) ?? false }
          : null;
      }),
    { select: () => null },
  ),
  selectAgentIsWaiting: () => makeReadable(false),
  selectAgentIsBlockedWaiting: () => makeReadable(false),
  selectAgentSessionStreamingContent: (agentId: {
    subscribe: (run: (value: string) => void) => () => void;
  }) => makeDerivedReadable(agentId, (id) => mockStreamingContent.get(id) ?? ''),
  selectAgentSessionHasStreamOwnedMessage: (agentId: {
    subscribe: (run: (value: string) => void) => () => void;
  }) => makeDerivedReadable(agentId, (id) => mockHasStreamOwnedMessage.get(id) ?? false),
  selectAgentProvider: () => makeReadable(undefined),
}));
vi.mock('$store/renderer/slices/permission/permission-selectors', () => ({
  selectPendingCount: () => makeReadable(0),
}));
vi.mock('$store/renderer/slices/changes/changes-selectors', () => ({
  selectAgentLineStats: () => makeReadable(null),
}));
vi.mock('$features/agent/components/agent-avatar/AgentAvatarWithState.svelte', async () => ({
  default: (await import('./mocks/MockAvatarWithState.svelte')).default,
}));
vi.mock('$lib/components/ui/tooltip', async () => {
  const SlotOnly = (await import('./mocks/SlotOnly.svelte')).default;
  return {
    Provider: SlotOnly,
    Root: SlotOnly,
    Trigger: SlotOnly,
    Content: SlotOnly,
    TooltipShortcut: SlotOnly,
  };
});

import { store as appStore } from '$store/renderer/store';
import { workspaceDeleted } from '$store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';
import { setWorkspaceEntity } from '$store/renderer/slices/workspace/workspace-slice';
import { requestSubscriptionFetch } from '$store/renderer/slices/agent-subscription-ui/agent-subscription-ui-slice';
import { chatTranscriptSnapshotApplied } from '$store/renderer/slices/chat-state/chat-state-slice';
import { agentSubscriptionReadSaga } from '$store/renderer/slices/agent-subscription-ui/sagas/agent-subscription-read-saga';
import { agentMutationSaga } from '$store/renderer/slices/agent-session/sagas/agent-mutation-saga';
import { appLayoutNavigationSaga } from '$store/renderer/slices/app-layout/sagas/app-layout-navigation-saga';
import { panelLayoutSaga } from '$store/renderer/slices/panel-layout/sagas/panel-layout-saga';
import {
  clearPanelLayout,
  initializeLayout,
  setPanelColumnCount,
} from '$store/renderer/slices/panel-layout/panel-layout-slice';
import { openWorkspaceTab } from '$store/renderer/slices/tab-state/tab-state-slice';
import AgentSubscriptions from '../AgentSubscriptions.svelte';
import {
  SUBSCRIPTION_CARD_CONTAINMENT_CLASS,
  SUBSCRIPTION_CARD_SURFACE_CLASS,
  SUBSCRIPTION_INSET_ROW_DIVIDER_CLASS,
  SUBSCRIPTION_INSET_TOP_DIVIDER_CLASS,
} from '../subscription-disclosure';
import { resetAgentSubscriptionsViewStateForTests } from '../agent-subscriptions-view-state';
import {
  applyTaskStatusChanged,
  loadWorkspaceTasksSucceeded,
} from '$store/renderer/slices/workspace-tasks/workspace-tasks-slice';
import type { TaskProgressItem } from '../workspace-task-fallback';

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
  extra?: Record<string, unknown>,
) {
  sessionState.byId.set(id, {
    id,
    workspaceId,
    name: `Named ${id}`,
    status,
    messages: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt,
    ...extra,
  });
}

function markTranscriptAuthoritative(agentId: string, totalMessages = 0) {
  appStore.dispatch(
    chatTranscriptSnapshotApplied(agentId, {
      truncated: false,
      totalMessages,
      ...(totalMessages > 0 ? { oldestMessageId: `${agentId}:oldest` } : {}),
    }),
  );
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
    await waitFor(() => expect(screen.getByTestId('one-shot-watches')).toBeTruthy(), {
      timeout: 5000,
    });
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
  const toggle = screen.queryByTestId('one-shot-summary-toggle');
  if (toggle?.getAttribute('aria-expanded') === 'false') await fireEvent.click(toggle);
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
    stopSagas.push(appStore.runSaga(panelLayoutSaga));
  });

  afterAll(() => {
    while (stopSagas.length > 0) stopSagas.pop()?.();
  });

  beforeEach(() => {
    backendRequestSpy.mockReset();
    backendRequestSpy.mockResolvedValue(snapshot());
    navigateToRouteSpy.mockClear();
    sessionState.byId.clear();
    sessionState.historyById.clear();
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

  it('renders one agent directly without a waiting disclosure', async () => {
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
    expect(screen.queryByTestId('one-shot-header')).toBeNull();
    expect(screen.queryByTestId('one-shot-summary-toggle')).toBeNull();
    expect(screen.getByTestId('one-shot-agent-list').dataset.agentListMode).toBe('direct');
    expect(visibleAgentIds()).toEqual(['agent-a']);
  });

  it('renders six agents directly at the disclosure boundary', async () => {
    const wsId = 'ws-waiting-six';
    const agents = Array.from({ length: 6 }, (_, index) => `agent-${index + 1}`);
    await renderWithSnapshot(wsId, snapshot([oneShotSubscription('watch-six', wsId, agents)]));

    expect(screen.queryByTestId('one-shot-header')).toBeNull();
    expect(screen.getByTestId('one-shot-agent-list').dataset.agentListMode).toBe('direct');
    expect(visibleAgentIds()).toEqual(agents);
  });

  it('groups seven agents and supports summary and chevron expand/collapse transitions', async () => {
    const wsId = 'ws-waiting-collapsed';
    const agents = Array.from({ length: 7 }, (_, index) => `agent-${index + 1}`);
    await renderWithSnapshot(wsId, snapshot([oneShotSubscription('watch-many', wsId, agents)]));
    const summary = screen.getByTestId('one-shot-summary-toggle');
    const chevron = screen.getByTestId('one-shot-collapse-toggle');

    expect(screen.getByTestId('one-shot-summary-title').textContent?.trim()).toBe(
      'Waiting for 7 agents',
    );
    expect(screen.getByRole('button', { name: 'Waiting for 7 agents' })).toBe(summary);
    const title = screen.getByTestId('one-shot-summary-title');
    expect(title.classList.contains('truncate')).toBe(false);
    expect(title.parentElement?.classList.contains('shrink-0')).toBe(true);
    expect(summary.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('one-shot-agent-list')).toBeNull();
    const stack = screen.getByTestId('one-shot-header').querySelector('[data-agent-avatar-stack]');
    expect(stack).toBeTruthy();
    expect(stack?.querySelectorAll('[data-icon]')).toHaveLength(0);
    expect(stack?.querySelectorAll('[data-agent-avatar-stack-item]')).toHaveLength(3);
    expect(stack?.querySelector('[data-agent-avatar-overflow]')?.textContent?.trim()).toBe('+4');
    await fireEvent.click(summary);
    expect(summary.getAttribute('aria-expanded')).toBe('true');
    expect(
      screen.getByTestId('one-shot-header').querySelector('[data-agent-avatar-stack]'),
    ).toBeNull();
    expect(summary.querySelector('[data-icon="hourglass"]')).toBeTruthy();
    expect(screen.getByTestId('one-shot-agent-list')).toBeTruthy();
    await fireEvent.click(chevron);
    expect(summary.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('one-shot-agent-list')).toBeNull();
  });

  it('labels a retained all-finished cohort as finished instead of waiting', async () => {
    const wsId = 'ws-all-finished-summary';
    const agents = ['agent-a', 'agent-b', 'agent-c'];
    resetWorkspace(wsId);
    backendRequestSpy.mockResolvedValue(
      snapshot([oneShotSubscription('watch-finished', wsId, agents)], [], {
        'agent-a': 'completed',
        'agent-b': 'completed',
        'agent-c': 'completed',
      }),
    );
    render(AgentSubscriptions, {
      props: { workspaceId: wsId, agentId: PARENT, forceWaitingHeader: true },
    });
    await flush();
    await flush();

    const summary = await screen.findByTestId('one-shot-summary-toggle');
    expect(summary.getAttribute('aria-label')).toBe('3 agents finished');
    expect(screen.getByTestId('one-shot-summary-title').textContent?.trim()).toBe(
      '3 agents finished',
    );
    expect(summary.querySelector('[data-icon="circle-check"]')).toBeTruthy();
    expect(summary.querySelector('[data-icon="hourglass"]')).toBeNull();
    await fireEvent.click(summary);
    expect(visibleAgentIds()).toEqual(agents);
    expect(screen.queryByTestId('finished-agent-summary')).toBeNull();
  });

  it('persists the watched-agent expanded state across remounts in the session', async () => {
    const wsId = 'ws-waiting-persistence';
    const agents = Array.from({ length: 7 }, (_, index) => `agent-${index + 1}`);
    const wire = snapshot([oneShotSubscription('watch-many', wsId, agents)]);
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
    expect(screen.queryByTestId('one-shot-header')).toBeNull();
    expect(screen.getByTestId('one-shot-agent-list').dataset.agentListMode).toBe('direct');
    expect(visibleAgentIds()).toEqual(['agent-z', 'agent-b', 'agent-c', 'agent-d', 'agent-a']);
    expect(within(agentRow('agent-a')).getByTestId('mock-avatar-with-state').dataset.state).toBe(
      'completed',
    );
  });

  it('renders active and finished agents directly when the total is six', async () => {
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
      'agent-finished-new',
      'agent-finished-old',
    ]);
    expect(screen.queryByTestId('finished-agent-summary')).toBeNull();
    expect(screen.queryByTestId('one-shot-header')).toBeNull();

    const trailingSlot = within(agentRow('agent-active')).getByTestId('agent-card-trailing-slot');
    expect(trailingSlot.className).toContain('w-14');
    const timestamp = trailingSlot.querySelector('[title]');
    expect(timestamp?.className).toContain('type-caption');
    expect(timestamp?.className).toContain('text-right');
    expect(timestamp?.className).toContain('group-hover/watch:opacity-0');
    expect(timestamp?.className).toContain('group-focus-within/watch:opacity-0');
    expect(within(trailingSlot).getByTestId('one-shot-stop').className).toContain(
      'focus-visible:opacity-100',
    );
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
        snapshot(
          [
            oneShotSubscription('watch-finished', wsId, [
              'agent-a',
              'agent-b',
              'agent-c',
              'agent-d',
              'agent-e',
              'agent-f',
              'agent-g',
            ]),
          ],
          [],
          { 'agent-a': 'completed', 'agent-b': 'completed' },
        ),
      );

      await expandWaitingAgents();
      const group = screen.getByTestId('finished-agent-group');
      const summary = screen.getByTestId('finished-agent-summary');
      const negativeInsetClass = /^-(?:m(?:[lrxse])?|inset(?:[lrxse])?)-/;
      const distinctSurfaceClass = /^(?:bg-|rounded(?:-|$)|shadow(?:-|$))/;

      expect(summary.getAttribute('aria-expanded')).toBe('false');
      expect(summary.classList).toContain('px-3!');
      expect(summary.classList).toContain('py-2!');
      expect(summary.textContent?.trim()).toBe('2 agents finished');
      expect(
        summary.querySelector('time, [title], [data-finished-at], [role="tooltip"]'),
      ).toBeNull();
      expect(group.hasAttribute('data-finished-at')).toBe(false);
      for (const token of [...group.classList, ...summary.classList]) {
        expect(token).not.toMatch(negativeInsetClass);
        expect(token).not.toMatch(distinctSurfaceClass);
      }
    },
  );

  it.each(['light', 'dark'])(
    'uses compact semantic icons with the same tone as their header text in %s',
    async (theme) => {
      document.documentElement.classList.add(theme);
      const wsId = `ws-finished-icon-${theme}`;
      seedSession('agent-a', '2026-01-02T00:00:00.000Z');
      seedSession('agent-b', '2026-01-03T00:00:00.000Z');
      await renderWithSnapshot(
        wsId,
        snapshot(
          [
            oneShotSubscription('watch-finished', wsId, [
              'agent-a',
              'agent-b',
              'agent-c',
              'agent-d',
              'agent-e',
              'agent-f',
              'agent-g',
            ]),
          ],
          [],
          {
            'agent-a': 'completed',
            'agent-b': 'completed',
          },
        ),
      );

      const waitingSummary = screen.getByTestId('one-shot-summary-toggle');
      await expandWaitingAgents();
      const finishedSummary = screen.getByTestId('finished-agent-summary');
      const waitingLeadingColumn = screen.getByTestId('one-shot-leading-column');
      const finishedLeadingColumn = screen.getByTestId('finished-agent-leading-column');
      const waitingIcon = waitingSummary.querySelector('[data-icon="hourglass"]');
      const finishedIcon = finishedSummary.querySelector('[data-icon="circle-check"]');

      expect(finishedSummary.classList).toContain('inline-flex');
      expect(finishedSummary.classList).toContain('gap-1.5');
      expect(finishedSummary.classList).not.toContain('px-2');
      expect(waitingLeadingColumn.classList).not.toContain('size-5');
      expect(finishedLeadingColumn.classList).not.toContain('size-5');
      expect(finishedLeadingColumn.className).not.toMatch(/^-m(?:[lrxse])?-/);
      expect(screen.getByTestId('one-shot-agent-list').classList).not.toContain('px-1');
      expect(screen.getByTestId('one-shot-summary-toggle').classList).toContain('px-3!');
      expect(finishedIcon).toBeTruthy();
      expect(finishedSummary.querySelector('[data-icon="check"]')).toBeNull();
      expect(finishedIcon?.classList).toContain('text-muted-foreground!');
      expect(finishedIcon?.classList).toContain('opacity-100');
      expect(finishedIcon?.getAttribute('aria-hidden')).toBe('true');
      expect(waitingIcon?.classList).toContain('text-muted-foreground!');
      expect(waitingIcon?.classList).toContain('opacity-100');
      expect(finishedIcon?.className.baseVal).not.toMatch(/green/);
      for (const token of ['h-3.5!', 'w-3.5!', 'shrink-0']) {
        expect(finishedIcon?.classList).toContain(token);
        expect(waitingIcon?.classList).toContain(token);
      }
    },
  );

  it('supports keyboard disclosure plus navigation and removal inside the finished group', async () => {
    const wsId = 'ws-finished-actions';
    seedSession('agent-a', '2026-01-02T00:00:00.000Z', 'completed', wsId);
    seedSession('agent-b', '2026-01-03T00:00:00.000Z', 'completed', wsId);
    await renderWithSnapshot(
      wsId,
      snapshot(
        [
          oneShotSubscription('watch-finished', wsId, [
            'agent-a',
            'agent-b',
            'agent-c',
            'agent-d',
            'agent-e',
            'agent-f',
            'agent-g',
          ]),
        ],
        [],
        { 'agent-a': 'completed', 'agent-b': 'completed' },
      ),
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

  it('reuses, reveals, and focuses an existing watched agent in the rightmost column', async () => {
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

  it.each(['Enter', ' '])('uses the same rightmost-column path for the %s key', async (key) => {
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

  it('creates one rightmost agent column when no matching panel exists', async () => {
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
    appStore.dispatch(setPanelColumnCount(wsId, 2));
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
      [
        oneShotSubscription('watch-finished', wsId, [
          'agent-a',
          'agent-b',
          'agent-c',
          'agent-d',
          'agent-e',
          'agent-f',
          'agent-g',
        ]),
      ],
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

  it('moves a message-resumed agent out of the finished group while its turn runs (monorepo#3405)', async () => {
    const wsId = 'ws-finished-resumed';
    const agents = [
      'agent-a',
      'agent-b',
      'agent-resumed',
      'agent-c',
      'agent-d',
      'agent-e',
      'agent-f',
    ];
    seedSession('agent-a', '2026-01-02T00:00:00.000Z', 'completed', wsId);
    seedSession('agent-b', '2026-01-03T00:00:00.000Z', 'completed', wsId);
    // Resumed by an interrupt message: still listed in the delegation group's
    // completedAgentIds, but the live session shows a running turn again.
    seedSession('agent-resumed', '2026-01-04T00:00:00.000Z', 'responding', wsId, {
      isResponding: true,
    });
    const wire = snapshot(
      [groupSubscription('group-resume', wsId, agents)],
      [delegationGroup('group-resume', agents, ['agent-a', 'agent-b', 'agent-resumed'])],
    );
    await renderWithSnapshot(wsId, wire);

    await expandWaitingAgents();
    const summary = screen.getByTestId('finished-agent-summary');
    expect(summary.textContent?.trim()).toBe('2 agents finished');
    // The resumed agent renders as an active ungrouped row, sorted into the
    // active tier ahead of the idle/waiting rows.
    expect(visibleAgentIds()).toEqual([
      'agent-resumed',
      'agent-c',
      'agent-d',
      'agent-e',
      'agent-f',
    ]);
    expect(
      within(agentRow('agent-resumed')).getByTestId('mock-avatar-with-state').dataset.state,
    ).toBe('running');
    await fireEvent.click(summary);
    const finishedIds = within(screen.getByTestId('finished-agent-list'))
      .getAllByTestId('agent-list-item')
      .map((row) => row.getAttribute('data-agent-id'));
    expect(finishedIds).toEqual(['agent-b', 'agent-a']);

    // Once the resumed turn settles, the agent returns to the finished group.
    // The daemon may not eagerly clear activity flags when a turn ends, so seed
    // a stale isResponding alongside the terminal status: isAgentRunningState's
    // terminal-status short-circuit must keep the agent in the finished set.
    seedSession('agent-resumed', '2026-01-05T00:00:00.000Z', 'completed', wsId, {
      isResponding: true,
    });
    await refetch(wsId, wire);
    await waitFor(() =>
      expect(screen.getByTestId('finished-agent-summary').textContent?.trim()).toBe(
        '3 agents finished',
      ),
    );
    const settledFinishedIds = within(screen.getByTestId('finished-agent-list'))
      .getAllByTestId('agent-list-item')
      .map((row) => row.getAttribute('data-agent-id'));
    expect(settledFinishedIds).toEqual(['agent-resumed', 'agent-b', 'agent-a']);
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
    expect(screen.queryByTestId('one-shot-header')).toBeNull();
    expect(screen.getByTestId('one-shot-agent-list').dataset.agentListMode).toBe('direct');
    expect(visibleAgentIds()).toEqual(['agent-a', 'agent-b']);
  });

  it('reactively updates direct rows without adding a disclosure', async () => {
    const wsId = 'ws-waiting-reactive';
    await renderWithSnapshot(
      wsId,
      snapshot(
        [groupSubscription('group-a', wsId, ['agent-a'])],
        [delegationGroup('group-a', ['agent-a'])],
      ),
    );
    expect(screen.queryByTestId('one-shot-collapse-toggle')).toBeNull();
    await refetch(
      wsId,
      snapshot(
        [groupSubscription('group-a', wsId, ['agent-a', 'agent-b', 'agent-c'])],
        [delegationGroup('group-a', ['agent-a', 'agent-b', 'agent-c'], ['agent-a'])],
      ),
    );
    await waitFor(() => expect(visibleAgentIds()).toHaveLength(3));
    expect(screen.queryByTestId('one-shot-header')).toBeNull();
    expect(screen.getByTestId('one-shot-agent-list').dataset.agentListMode).toBe('direct');
    expect(visibleAgentIds()).toEqual(['agent-b', 'agent-c', 'agent-a']);
    await refetch(wsId, snapshot());
    await waitFor(() => expect(screen.queryByTestId('one-shot-watches')).toBeNull());
  });

  it('keeps focused controls inside their stable keyed agent identity owner after reorder', async () => {
    const wsId = 'ws-waiting-focused-identity';
    await renderWithSnapshot(
      wsId,
      snapshot([oneShotSubscription('watch-focused', wsId, ['agent-a', 'agent-b'])]),
    );
    const row = agentRow('agent-a');
    const control = within(row).getAllByRole('button')[0] as HTMLButtonElement;
    control.focus();
    expect(document.activeElement).toBe(control);
    expect(control.closest('[data-agent-id]')?.getAttribute('data-agent-id')).toBe('agent-a');

    await refetch(
      wsId,
      snapshot([oneShotSubscription('watch-focused', wsId, ['agent-b', 'agent-a'])]),
    );
    await waitFor(() => expect(visibleAgentIds()).toEqual(['agent-b', 'agent-a']));
    expect(document.activeElement).toBe(control);
    expect(control.closest('[data-agent-id]')?.getAttribute('data-agent-id')).toBe('agent-a');
  });

  it('settles rapid isolated row reversals to the canonical final identities and order', async () => {
    const agents = (count: number, reverse = false) => {
      const rows = Array.from({ length: count }, (_, index) => ({
        id: index === 0 ? 'agent-primary' : `agent-${index}`,
        name: `Agent ${index}`,
      }));
      return reverse ? rows.reverse() : rows;
    };
    const { rerender } = render(AgentSubscriptions, {
      props: {
        workspaceId: 'ws-rapid-isolated',
        agentId: PARENT,
        isolatedPreview: { agents: agents(7), initiallyExpanded: true },
        forceWaitingHeader: true,
      },
    });

    await rerender({
      workspaceId: 'ws-rapid-isolated',
      agentId: PARENT,
      isolatedPreview: { agents: agents(3, true), initiallyExpanded: true },
      forceWaitingHeader: true,
    });
    await rerender({
      workspaceId: 'ws-rapid-isolated',
      agentId: PARENT,
      isolatedPreview: { agents: agents(9), initiallyExpanded: true },
      forceWaitingHeader: true,
    });
    await rerender({
      workspaceId: 'ws-rapid-isolated',
      agentId: PARENT,
      isolatedPreview: { agents: agents(4, true), initiallyExpanded: true },
      forceWaitingHeader: true,
    });
    await waitFor(() =>
      expect(visibleAgentIds()).toEqual(['agent-3', 'agent-2', 'agent-1', 'agent-primary']),
    );
    expect(screen.getAllByTestId('agent-list-item')).toHaveLength(4);
    const list = screen.getByTestId('one-shot-agent-list');
    for (const token of SUBSCRIPTION_INSET_TOP_DIVIDER_CLASS.split(' ')) {
      expect(list.classList).toContain(token);
    }
    expect(list.classList).not.toContain('border-t');
    for (const item of screen.getAllByTestId('agent-list-item')) {
      const owner = item.closest<HTMLElement>('[data-subscription-motion-row]');
      expect(owner).toBeTruthy();
      for (const token of SUBSCRIPTION_INSET_ROW_DIVIDER_CLASS.split(' ')) {
        expect(owner?.classList).toContain(token);
      }
      expect(owner?.classList).not.toContain('border-t');
    }
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

  it('shows each agent own checklist task progress without nesting or sharing row controls', async () => {
    const wsId = 'ws-agent-task-progress';
    seedSession('agent-native', '2026-01-03T00:00:00.000Z', 'responding', wsId, {
      metadata: { taskNoteId: 'task-native-fallback' },
    });
    seedSession('agent-linked', '2026-01-03T00:00:00.000Z', 'waiting', wsId, {
      metadata: { taskNoteId: 'task-linked' },
    });
    sessionState.historyById.set('agent-native', [
      {
        id: 'history-plan',
        role: 'assistant',
        contentBlocks: [
          {
            type: 'plan',
            id: 'history-plan:block',
            entries: [
              { content: 'Native task completed', priority: 'high', status: 'completed' },
              { content: 'Native task running', priority: 'medium', status: 'in_progress' },
            ],
          },
        ],
      },
    ]);
    appStore.dispatch(
      loadWorkspaceTasksSucceeded(
        wsId,
        [
          {
            id: 'task-native-fallback',
            title: 'Hidden native fallback',
            status: 'not_started',
            specLinked: false,
          },
          {
            id: 'task-linked',
            title: 'Linked workspace task',
            status: 'complete',
            specLinked: false,
          },
        ],
        { total: 2, completed: 1, inProgress: 0 },
      ),
    );
    markTranscriptAuthoritative('agent-linked');

    await renderWithSnapshot(
      wsId,
      snapshot([oneShotSubscription('watch-progress', wsId, ['agent-native', 'agent-linked'])]),
    );
    await expandWaitingAgents();

    const nativeRow = agentRow('agent-native');
    const linkedRow = agentRow('agent-linked');
    const nativeTrigger = within(nativeRow).getByTestId('task-progress-trigger');
    const linkedTrigger = within(linkedRow).getByTestId('task-progress-trigger');
    const activationButton = within(nativeRow).getAllByRole('button')[0];

    expect(nativeTrigger.getAttribute('aria-label')).toBe('Task progress: 1 of 2 completed');
    expect(linkedTrigger.getAttribute('aria-label')).toBe('Task progress: 1 of 1 completed');
    expect(nativeTrigger.className).toContain('h-(--row-action-target-compact)');
    expect(nativeTrigger.className).toContain('min-w-(--row-action-target-compact)');
    expect(nativeTrigger.className).toContain('w-fit');
    for (const trigger of [nativeTrigger, linkedTrigger]) {
      expect(within(trigger).getByTestId('task-progress-checklist-icon')).toBeTruthy();
      expect(trigger.querySelectorAll('[data-icon="list-check"]')).toHaveLength(1);
      expect(within(trigger).queryByTestId('task-progress-icon-stack')).toBeNull();
      expect(within(trigger).queryByTestId('task-progress-status-icon')).toBeNull();
      expect(within(trigger).queryByTestId('task-progress-overflow-indicator')).toBeNull();
    }
    expect(activationButton.contains(nativeTrigger)).toBe(false);
    expect(nativeRow.querySelector('.agent-card-content')?.className).toContain('mr-25');
    expect(within(nativeRow).getByTestId('agent-card-trailing-slot').className).toContain('w-25');
    expect(within(nativeRow).getByTestId('one-shot-stop')).toBeTruthy();
    expect(within(nativeRow).getByTestId('one-shot-cancel')).toBeTruthy();

    nativeTrigger.focus();
    expect(screen.queryByRole('dialog', { name: 'Agent tasks' })).toBeNull();
    await fireEvent.click(nativeTrigger);
    const dialog = await screen.findByRole('dialog', { name: 'Agent tasks' });
    expect(document.activeElement).toBe(nativeTrigger);
    expect(within(dialog).getByText('Native task running')).toBeTruthy();
    expect(within(dialog).getByLabelText('Complete: Native task completed')).toBeTruthy();
    expect(within(dialog).queryByTestId('task-progress-completed-toggle')).toBeNull();
    expect(within(dialog).queryByText('Hidden native fallback')).toBeNull();
    expect(within(dialog).queryByText('Linked workspace task')).toBeNull();
    expect(within(dialog).getByText('Native task running').closest('.shimmer-text')).toBeTruthy();

    await fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Agent tasks' })).toBeNull());
    linkedTrigger.focus();
    expect(screen.queryByRole('dialog', { name: 'Agent tasks' })).toBeNull();
    await fireEvent.click(linkedTrigger);
    const linkedDialog = await screen.findByRole('dialog', { name: 'Agent tasks' });
    expect(within(linkedDialog).getByText('Linked workspace task')).toBeTruthy();
    expect(within(linkedDialog).queryByText('Native task running')).toBeNull();
    expect(within(linkedDialog).queryByText('Native task completed')).toBeNull();
  });

  const delegatedTaskCases: Array<{
    name: string;
    tasks: TaskProgressItem[];
    completed: number;
  }> = [
    {
      name: 'pending',
      tasks: [{ id: 'pending', title: 'Pending delegated task', status: 'pending' }],
      completed: 0,
    },
    {
      name: 'running',
      tasks: [{ id: 'running', title: 'Running delegated task', status: 'running' }],
      completed: 0,
    },
    {
      name: 'completed',
      tasks: [{ id: 'completed', title: 'Completed delegated task', status: 'completed' }],
      completed: 1,
    },
    {
      name: 'mixed',
      tasks: [
        { id: 'mixed-pending', title: 'Mixed pending task', status: 'pending' },
        { id: 'mixed-running', title: 'Mixed running task', status: 'running' },
        { id: 'mixed-completed', title: 'Mixed completed task', status: 'completed' },
      ],
      completed: 1,
    },
    {
      name: 'overflow',
      tasks: Array.from({ length: 7 }, (_, index) => ({
        id: `overflow-${index}`,
        title: `Overflow delegated task ${index + 1}`,
        status: index === 6 ? ('completed' as const) : ('pending' as const),
      })),
      completed: 1,
    },
  ];

  it.each(delegatedTaskCases)(
    'keeps one checklist glyph and a complete read-only popover for a $name task set',
    async ({ name, tasks, completed }) => {
      const agentId = `preview-${name}`;
      render(AgentSubscriptions, {
        props: {
          workspaceId: `workspace-${name}`,
          agentId: PARENT,
          isolatedPreview: {
            agents: [{ id: agentId, name: `Preview ${name}`, taskProgress: tasks }],
            initiallyExpanded: true,
          },
        },
      });

      const row = agentRow(agentId);
      const trigger = within(row).getByTestId('task-progress-trigger');
      expect(trigger.getAttribute('aria-label')).toBe(
        `Task progress: ${completed} of ${tasks.length} completed`,
      );
      expect(trigger.querySelectorAll('[data-icon="list-check"]')).toHaveLength(1);
      expect(within(trigger).queryByTestId('task-progress-icon-stack')).toBeNull();
      expect(within(trigger).queryByTestId('task-progress-status-icon')).toBeNull();
      expect(within(trigger).queryByTestId('task-progress-overflow-indicator')).toBeNull();

      trigger.focus();
      expect(screen.queryByRole('dialog', { name: 'Agent tasks' })).toBeNull();
      await fireEvent.click(trigger);
      const dialog = await screen.findByRole('dialog', { name: 'Agent tasks' });
      expect(within(dialog).getAllByTestId('task-progress-row')).toHaveLength(tasks.length);
    },
  );

  it('updates linked task counts live while keeping the progress trigger focused', async () => {
    const wsId = 'ws-agent-task-progress-live';
    seedSession('agent-linked', '2026-01-03T00:00:00.000Z', 'responding', wsId, {
      metadata: { taskNoteId: 'task-linked' },
    });
    appStore.dispatch(
      loadWorkspaceTasksSucceeded(
        wsId,
        [
          {
            id: 'task-linked',
            title: 'Live linked task',
            status: 'in_progress',
            specLinked: false,
          },
        ],
        { total: 1, completed: 0, inProgress: 1 },
      ),
    );
    markTranscriptAuthoritative('agent-linked');
    await renderWithSnapshot(
      wsId,
      snapshot([oneShotSubscription('watch-progress-live', wsId, ['agent-linked'])]),
    );
    await expandWaitingAgents();

    const trigger = within(agentRow('agent-linked')).getByTestId('task-progress-trigger');
    trigger.focus();
    await fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-label')).toBe('Task progress: 0 of 1 completed');
    appStore.dispatch(applyTaskStatusChanged(wsId, 'task-linked', 'complete'));

    await waitFor(() =>
      expect(trigger.getAttribute('aria-label')).toBe('Task progress: 1 of 1 completed'),
    );
    expect(document.activeElement).toBe(trigger);
    expect(await screen.findByLabelText('Complete: Live linked task')).toBeTruthy();
    expect(screen.queryByTestId('task-progress-completed-toggle')).toBeNull();
  });

  it('waits for an AgentLite transcript snapshot before showing a linked fallback', async () => {
    const wsId = 'ws-agent-task-progress-agent-lite-fallback';
    const agentId = 'agent-lite-fallback';
    seedSession(agentId, '2026-01-03T00:00:00.000Z', 'waiting', wsId, {
      metadata: { taskNoteId: 'task-linked-agent-lite' },
    });
    appStore.dispatch(
      loadWorkspaceTasksSucceeded(
        wsId,
        [
          {
            id: 'task-linked-agent-lite',
            title: 'Authoritative linked fallback',
            status: 'in_progress',
            specLinked: false,
          },
        ],
        { total: 1, completed: 0, inProgress: 1 },
      ),
    );
    await renderWithSnapshot(
      wsId,
      snapshot([oneShotSubscription('watch-agent-lite-fallback', wsId, [agentId])]),
    );

    expect(within(agentRow(agentId)).queryByTestId('task-progress-trigger')).toBeNull();
    markTranscriptAuthoritative(agentId);
    await waitFor(() =>
      expect(
        within(agentRow(agentId)).getByTestId('task-progress-trigger').getAttribute('aria-label'),
      ).toBe('Task progress: 0 of 1 completed'),
    );
  });

  it('restores a native plan ahead of the linked fallback for an AgentLite-only child row', async () => {
    const wsId = 'ws-agent-task-progress-agent-lite-native';
    const agentId = 'agent-lite-native';
    seedSession(agentId, '2026-01-03T00:00:00.000Z', 'responding', wsId, {
      metadata: { taskNoteId: 'task-hidden-fallback' },
    });
    appStore.dispatch(
      loadWorkspaceTasksSucceeded(
        wsId,
        [
          {
            id: 'task-hidden-fallback',
            title: 'Hidden linked fallback',
            status: 'complete',
            specLinked: false,
          },
        ],
        { total: 1, completed: 1, inProgress: 0 },
      ),
    );
    await renderWithSnapshot(
      wsId,
      snapshot([oneShotSubscription('watch-agent-lite-native', wsId, [agentId])]),
    );
    expect(within(agentRow(agentId)).queryByTestId('task-progress-trigger')).toBeNull();

    const persisted = {
      id: 'persisted-native-plan',
      role: 'assistant',
      contentBlocks: [
        {
          type: 'plan',
          id: 'persisted-native-plan:block',
          entries: [
            { content: 'Persisted native task', priority: 'high', status: 'in_progress' },
            { content: 'Next native task', priority: 'medium', status: 'pending' },
          ],
        },
      ],
    };
    sessionState.historyById.set(agentId, [persisted]);
    markTranscriptAuthoritative(agentId, 1);
    const trigger = await within(agentRow(agentId)).findByTestId('task-progress-trigger');
    expect(trigger.getAttribute('aria-label')).toBe('Task progress: 0 of 2 completed');

    await fireEvent.click(trigger);
    const dialog = await screen.findByRole('dialog', { name: 'Agent tasks' });
    expect(within(dialog).queryByText('Hidden linked fallback')).toBeNull();
    expect(within(dialog).getByText('Next native task')).toBeTruthy();
  });

  it('keeps grouped rows individually stoppable with group-scoped cancel routing', async () => {
    const wsId = 'ws-waiting-actions-group';
    await renderWithSnapshot(
      wsId,
      snapshot(
        [
          groupSubscription('group-a', wsId, [
            'agent-a',
            'agent-b',
            'agent-c',
            'agent-d',
            'agent-e',
            'agent-f',
            'agent-g',
          ]),
        ],
        [
          delegationGroup('group-a', [
            'agent-a',
            'agent-b',
            'agent-c',
            'agent-d',
            'agent-e',
            'agent-f',
            'agent-g',
          ]),
        ],
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
        [
          groupSubscription('group-a', wsId, [
            'agent-a',
            'agent-b',
            'agent-c',
            'agent-d',
            'agent-e',
            'agent-f',
            'agent-g',
          ]),
        ],
        [
          delegationGroup('group-a', [
            'agent-a',
            'agent-b',
            'agent-c',
            'agent-d',
            'agent-e',
            'agent-f',
            'agent-g',
          ]),
        ],
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
    expect(chevron.getAttribute('aria-controls')).toBeNull();
    summary.focus();
    await fireEvent.click(summary);
    expect(summary.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(summary);
  });

  it('displays live streaming activity message in agent rows', async () => {
    const wsId = 'ws-streaming-activity';
    // Seed agent session with streaming content
    const session = {
      id: 'agent-stream-1',
      workspaceId: wsId,
      name: 'Named agent-stream-1',
      status: 'responding',
      lastAgentResponse: 'I am currently analyzing the codebase...',
      messages: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-03T00:00:00.000Z',
    };
    sessionState.byId.set('agent-stream-1', session);
    mockIsResponding.set('agent-stream-1', true);

    await renderWithSnapshot(
      wsId,
      snapshot([oneShotSubscription('watch-stream', wsId, ['agent-stream-1'])]),
    );

    // Wait for agent card preview to render
    await waitFor(() => expect(screen.getByTestId('agent-card-preview')).toBeTruthy());

    const preview = screen.getByTestId('agent-card-preview');
    expect(preview.textContent).toContain('analyzing the codebase');
  });

  it('displays streaming activity based on lastAgentResponse when available', async () => {
    const wsId = 'ws-streaming-update';
    const session = {
      id: 'agent-update-1',
      workspaceId: wsId,
      name: 'Named agent-update-1',
      status: 'responding',
      lastAgentResponse: 'Analyzing the project structure...',
      messages: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-03T00:00:00.000Z',
    };
    sessionState.byId.set('agent-update-1', session);
    mockIsResponding.set('agent-update-1', true);

    await renderWithSnapshot(
      wsId,
      snapshot([oneShotSubscription('watch-update', wsId, ['agent-update-1'])]),
    );

    await waitFor(() => expect(screen.getByTestId('agent-card-preview')).toBeTruthy());
    expect(screen.getByTestId('agent-card-preview').textContent).toContain('Analyzing');
  });

  it('shows no activity preview when agent is idle with no messages', async () => {
    const wsId = 'ws-no-activity';
    seedSession('agent-idle-1', '2026-01-03T00:00:00.000Z', 'idle', wsId);
    mockIsResponding.set('agent-idle-1', false);
    mockStreamingContent.set('agent-idle-1', '');

    await renderWithSnapshot(
      wsId,
      snapshot([oneShotSubscription('watch-idle', wsId, ['agent-idle-1'])]),
    );

    // Agent card should render but with no preview
    expect(screen.getByTestId('one-shot-agent-list')).toBeTruthy();
    expect(screen.queryByTestId('agent-card-preview')).toBeNull();
  });

  it('truncates long streaming activity without changing row height', async () => {
    const wsId = 'ws-long-activity';
    const longText =
      'This is a very long streaming activity message that should be truncated to prevent horizontal overflow and maintain compact row height across different viewport sizes and zoom levels';
    const session = {
      id: 'agent-long-1',
      workspaceId: wsId,
      name: 'Named agent-long-1',
      status: 'responding',
      lastAgentResponse: longText,
      messages: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-03T00:00:00.000Z',
    };
    sessionState.byId.set('agent-long-1', session);
    mockIsResponding.set('agent-long-1', true);

    await renderWithSnapshot(
      wsId,
      snapshot([oneShotSubscription('watch-long', wsId, ['agent-long-1'])]),
    );

    const preview = await screen.findByTestId('agent-card-preview');

    // Verify truncation classes are applied
    expect(preview.className).toContain('truncate');
    expect(preview.className).toContain('whitespace-nowrap');
    // Verify the full long text is set as title attribute for accessibility
    expect(preview.getAttribute('title')).toContain('very long streaming');
  });

  it('handles Unicode and emoji in streaming activity text', async () => {
    const wsId = 'ws-unicode';
    const unicodeText = 'Processing files... 文件处理中 📁 🔄';
    const session = {
      id: 'agent-unicode-1',
      workspaceId: wsId,
      name: 'Named agent-unicode-1',
      status: 'responding',
      lastAgentResponse: unicodeText,
      messages: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-03T00:00:00.000Z',
    };
    sessionState.byId.set('agent-unicode-1', session);
    mockIsResponding.set('agent-unicode-1', true);

    await renderWithSnapshot(
      wsId,
      snapshot([oneShotSubscription('watch-unicode', wsId, ['agent-unicode-1'])]),
    );

    const preview = await screen.findByTestId('agent-card-preview');
    expect(preview.textContent).toContain('Processing files');
    expect(preview.textContent).toContain('文件处理中');
  });

  it('preserves streaming activity display in after_all delegation groups', async () => {
    const wsId = 'ws-group-streaming';
    const session1 = {
      id: 'agent-group-1',
      workspaceId: wsId,
      name: 'Named agent-group-1',
      status: 'responding',
      lastAgentResponse: 'Agent 1 working on task A',
      messages: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-03T00:00:00.000Z',
    };
    const session2 = {
      id: 'agent-group-2',
      workspaceId: wsId,
      name: 'Named agent-group-2',
      status: 'responding',
      lastAgentResponse: 'Agent 2 working on task B',
      messages: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-03T00:00:00.000Z',
    };
    sessionState.byId.set('agent-group-1', session1);
    sessionState.byId.set('agent-group-2', session2);
    mockIsResponding.set('agent-group-1', true);
    mockIsResponding.set('agent-group-2', true);

    await renderWithSnapshot(
      wsId,
      snapshot(
        [groupSubscription('group-stream', wsId, ['agent-group-1', 'agent-group-2'])],
        [delegationGroup('group-stream', ['agent-group-1', 'agent-group-2'])],
      ),
    );

    const previews = await screen.findAllByTestId('agent-card-preview');
    expect(previews).toHaveLength(2);
    expect(previews[0].textContent).toContain('task A');
    expect(previews[1].textContent).toContain('task B');
  });

  it('renders preview inline with name on same baseline', async () => {
    const wsId = 'ws-inline-layout';
    const session = {
      id: 'agent-1',
      workspaceId: wsId,
      name: 'Test Agent',
      status: 'responding',
      lastAgentResponse: 'Currently processing files',
      messages: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-03T00:00:00.000Z',
    };
    sessionState.byId.set('agent-1', session);
    mockIsResponding.set('agent-1', true);

    await renderWithSnapshot(
      wsId,
      snapshot(
        [groupSubscription('group-1', wsId, ['agent-1'])],
        [delegationGroup('group-1', ['agent-1'])],
      ),
    );

    const preview = await screen.findByTestId('agent-card-preview');
    expect(preview.textContent).toContain('processing files');

    // Preview should have truncate and muted styling
    expect(preview.className).toContain('truncate');
    expect(preview.className).toContain('whitespace-nowrap');
    expect(preview.className).toContain('text-muted-foreground');
  });

  it('timestamp and preview share typography token class', async () => {
    const wsId = 'ws-typography-class';
    const session = {
      id: 'agent-1',
      workspaceId: wsId,
      name: 'Test Agent',
      status: 'responding',
      lastAgentResponse: 'Processing files',
      messages: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-03T00:00:00.000Z',
    };
    sessionState.byId.set('agent-1', session);
    mockIsResponding.set('agent-1', true);

    await renderWithSnapshot(
      wsId,
      snapshot(
        [groupSubscription('group-1', wsId, ['agent-1'])],
        [delegationGroup('group-1', ['agent-1'])],
      ),
    );

    const preview = await screen.findByTestId('agent-card-preview');
    const trailingSlot = screen.getByTestId('agent-card-trailing-slot');
    const timestamp = trailingSlot.querySelector('.type-caption');

    expect(timestamp).not.toBeNull();

    // Both must have identical typography token/class for color and opacity
    expect(preview.className).toContain('text-muted-foreground');
    expect(timestamp!.className).toContain('text-muted-foreground');

    // Timestamp must have tabular-nums class for stable width
    expect(timestamp!.className).toContain('tabular-nums');
  });

  it('timestamp has fixed-width layout classes', async () => {
    const wsId = 'ws-timestamp-layout';
    const session = {
      id: 'agent-1',
      workspaceId: wsId,
      name: 'Test Agent',
      status: 'responding',
      lastAgentResponse: 'Very long preview text that should truncate before pushing the timestamp',
      messages: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-03T00:00:00.000Z',
    };
    sessionState.byId.set('agent-1', session);
    mockIsResponding.set('agent-1', true);

    await renderWithSnapshot(
      wsId,
      snapshot(
        [groupSubscription('group-1', wsId, ['agent-1'])],
        [delegationGroup('group-1', ['agent-1'])],
      ),
    );

    const trailingSlot = screen.getByTestId('agent-card-trailing-slot');
    const timestamp = trailingSlot.querySelector('.type-caption');

    expect(timestamp).not.toBeNull();

    // Timestamp container has fixed width
    expect(trailingSlot.className).toContain('w-14');

    // Timestamp is right-aligned (via Tailwind classes)
    expect(timestamp!.className).toContain('justify-end');
    expect(timestamp!.className).toContain('text-right');
  });

  it('groups agents by semantic priority: attention, active, idle', async () => {
    const wsId = 'ws-semantic-grouping';
    seedSession('idle-agent', '2026-01-01T00:00:00.000Z', 'idle', wsId);
    seedSession('responding-agent', '2026-01-01T00:00:00.000Z', 'responding', wsId);
    seedSession('blocker-agent', '2026-01-01T00:00:00.000Z', 'idle', wsId, {
      attentionRequestKind: 'blocker',
      attentionRequestReason: 'Blocked by X',
    });
    seedSession('discussion-agent', '2026-01-01T00:00:00.000Z', 'idle', wsId, {
      attentionRequestKind: 'discussion',
      attentionRequestReason: 'Need input',
    });

    await renderWithSnapshot(
      wsId,
      snapshot(
        [
          groupSubscription('group-1', wsId, [
            'idle-agent',
            'responding-agent',
            'blocker-agent',
            'discussion-agent',
          ]),
        ],
        [
          delegationGroup('group-1', [
            'idle-agent',
            'responding-agent',
            'blocker-agent',
            'discussion-agent',
          ]),
        ],
      ),
    );

    await expandWaitingAgents();
    const agentIds = visibleAgentIds();

    // Expect: blocker first, discussion second, responding third, idle last
    expect(agentIds).toEqual([
      'blocker-agent',
      'discussion-agent',
      'responding-agent',
      'idle-agent',
    ]);
  });

  it('sorts idle-coded agents with runtime activity evidence in the active tier', async () => {
    const wsId = 'ws-semantic-runtime-evidence';
    seedSession('idle-agent', '2026-01-01T00:00:00.000Z', 'idle', wsId);
    seedSession('responding-flag-agent', '2026-01-01T00:00:00.000Z', 'idle', wsId, {
      isResponding: true,
    });
    seedSession('processing-flag-agent', '2026-01-01T00:00:00.000Z', 'idle', wsId, {
      isProcessing: true,
    });

    await renderWithSnapshot(
      wsId,
      snapshot([
        oneShotSubscription('watch-runtime-evidence', wsId, [
          'idle-agent',
          'responding-flag-agent',
          'processing-flag-agent',
        ]),
      ]),
    );
    await expandWaitingAgents();

    expect(visibleAgentIds()).toEqual([
      'responding-flag-agent',
      'processing-flag-agent',
      'idle-agent',
    ]);
  });
});
