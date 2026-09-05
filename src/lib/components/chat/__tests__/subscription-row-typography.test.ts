import '../../../../app.css';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const { dispatchMock } = vi.hoisted(() => ({ dispatchMock: vi.fn() }));

const readable = <T>(value: T) => ({
  subscribe(run: (next: T) => void) {
    run(value);
    return () => {};
  },
});

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({ state: () => ({}), dispatch: dispatchMock });
});
vi.mock('$store/renderer/slices/workspace/workspace-selectors', () => ({
  selectWorkspaceById: () =>
    readable({ id: 'ws-1', repositoryOwner: 'acme', repositoryName: 'widgets' }),
  selectIsWorkspaceHostLocal: () => readable(true),
}));
vi.mock('$store/renderer/slices/agent-session/agent-session-selectors', () => ({
  selectAgentSession: () =>
    readable({
      id: 'agent-a',
      name: 'Watched agent',
      status: 'completed',
      messages: [],
      createdAt: '2026-08-13T09:00:00Z',
      updatedAt: '2026-08-13T10:00:00Z',
    }),
  selectAgentSessionsByIds: () =>
    readable([
      { id: 'agent-a', status: 'active', updatedAt: '2026-08-13T10:00:00Z' },
      { id: 'agent-b', updatedAt: '2026-08-13T11:00:00Z' },
      { id: 'agent-c', updatedAt: '2026-08-13T12:00:00Z' },
    ]),
  selectAgentSessionsById: Object.assign(() => readable({}), {
    select: () => ({
      'agent-a': { id: 'agent-a', status: 'active' },
      'agent-b': { id: 'agent-b', status: 'completed' },
      'agent-c': { id: 'agent-c', status: 'completed' },
    }),
  }),
  selectAgentIsResponding: () => readable(false),
  selectAgentPreview: Object.assign(() => readable(null), { select: () => null }),
  selectAgentIsWaiting: () => readable(false),
  selectAgentIsBlockedWaiting: () => readable(false),
  selectAgentSessionStreamingContent: () => readable(''),
  selectAgentSessionHasStreamOwnedMessage: () => readable(false),
}));
vi.mock('$store/renderer/slices/chat-state/chat-state-selectors', () => ({
  selectChatReceivedFirstChunk: () => readable(false),
}));
vi.mock('$store/renderer/slices/permission/permission-selectors', () => ({
  selectPendingCount: () => readable(0),
}));
vi.mock('$store/renderer/slices/changes/changes-selectors', () => ({
  selectAgentLineStats: () => readable(null),
}));
vi.mock('$store/renderer/slices/tab-state/tab-state-selectors', () => ({
  selectCurrentWorkspaceTabId: Object.assign(() => readable(null), { select: () => null }),
}));
vi.mock('$store/renderer/slices/agent-subscription-ui/agent-subscription-ui-selectors', () => ({
  selectAgentSubscriptions: () =>
    readable([
      {
        id: 'watch-1',
        workspaceId: 'ws-1',
        agentId: 'agent-parent',
        actorIds: ['agent-a', 'agent-b', 'agent-c'],
        eventTypes: ['agent:idle'],
        createdAt: '2026-08-13T09:00:00Z',
      },
    ]),
  selectAgentSubscriptionStatuses: () =>
    readable({ 'agent-a': 'running', 'agent-b': 'completed', 'agent-c': 'completed' }),
  selectAgentSubscriptionLane: () =>
    readable({ visible: true, count: 1, participantAgentIds: ['agent-a'] }),
  selectDelegationGroups: () => readable([]),
  selectWokenUpInfo: () => readable(null),
  selectWaitingState: () => readable('waiting'),
}));
vi.mock('$store/renderer/slices/background-hooks/background-hooks-selectors', () => ({
  selectBackgroundHooks: () =>
    readable([
      {
        hookId: 'hook-1',
        workspaceId: 'ws-1',
        agentId: 'agent-parent',
        name: 'Watch CI',
        code: 'return false',
        delayMs: 60_000,
        state: 'scheduled',
        createdAt: '2026-08-13T09:00:00Z',
        nextRunAt: '2026-08-13T12:00:00Z',
        runCount: 0,
      },
    ]),
}));
vi.mock('$store/renderer/slices/pr-monitor/pr-monitor-selectors', () => ({
  selectAgentPrMonitors: () =>
    readable([
      {
        monitorId: 'monitor-1',
        workspaceId: 'ws-1',
        agentId: 'agent-parent',
        repo: 'acme/widgets',
        prNumber: 42,
        title: 'Polish subscriptions',
        state: 'active',
        pendingChanges: [],
        hasPendingChanges: false,
        createdAt: '2026-08-13T09:00:00Z',
        updatedAt: '2026-08-13T10:00:00Z',
      },
    ]),
}));
vi.mock('$features/layout/panel-layout-adapter', () => ({
  hasPanelLayoutManager: () => false,
  getPanelLayoutManager: () => ({
    getPanelIds: () => [],
    getPanel: () => undefined,
    openTabInAdjacentOrSplit: vi.fn(),
  }),
}));
vi.mock('$features/agent/components/agent-avatar/AgentAvatarWithState.svelte', async () => ({
  default: (await import('./mocks/MockAvatarWithState.svelte')).default,
}));
vi.mock('$features/navigation/link-handler', () => ({
  handleLink: vi.fn(),
  openInBrowserPanel: vi.fn(),
}));
vi.mock('$lib/components/ui/tooltip', async () => {
  const SlotOnly = (await import('./mocks/SlotOnly.svelte')).default;
  return { Provider: SlotOnly, Root: SlotOnly, Trigger: SlotOnly, Content: SlotOnly };
});

import EventSubscriptionsCard from '../EventSubscriptionsCard.svelte';
import {
  resetAgentSubscriptionsViewStateForTests,
  setEventSubscriptionsExpanded,
} from '../agent-subscriptions-view-state';

const originalInnerWidth = window.innerWidth;
const typographyStyle = document.createElement('style');

function typography(element: HTMLElement) {
  const style = getComputedStyle(element);
  return {
    fontSize: style.fontSize,
    fontWeight: style.fontWeight,
    lineHeight: style.lineHeight,
  };
}

function tone(element: Element) {
  const style = getComputedStyle(element);
  return { color: style.color, opacity: style.opacity };
}

beforeAll(() => {
  typographyStyle.textContent = `
    .type-body {
      font-size: var(--text-body-size);
      line-height: var(--text-body-line-height);
      font-weight: var(--text-body-weight);
    }
  `;
  document.head.append(typographyStyle);
});

afterAll(() => typographyStyle.remove());

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove('light', 'dark');
  document.body.style.removeProperty('zoom');
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalInnerWidth });
  dispatchMock.mockClear();
  resetAgentSubscriptionsViewStateForTests();
});

describe('subscription row typography', () => {
  it.each([
    ['light', 1024, '1'],
    ['dark', 320, '1'],
    ['light', 320, '2'],
    ['dark', 1024, '2'],
  ])('stays identical in %s at %ipx and %sx zoom', async (theme, width, zoom) => {
    document.documentElement.classList.add(theme);
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
    document.body.style.zoom = zoom;
    setEventSubscriptionsExpanded('ws-1', 'agent-parent', true);
    render(EventSubscriptionsCard, {
      props: { workspaceId: 'ws-1', agentId: 'agent-parent' },
    });

    await waitFor(() => expect(screen.getByTestId('event-subscriptions-summary')).toBeTruthy());
    await fireEvent.click(await screen.findByTestId('one-shot-summary-toggle'));
    const finishedSummary = screen.getByTestId('finished-agent-summary');
    if (finishedSummary.getAttribute('aria-expanded') === 'false') {
      await fireEvent.click(finishedSummary);
    }
    const agentRow = await screen.findAllByTestId('agent-list-item');
    const rows = [
      screen.getByTestId('event-subscriptions-summary'),
      screen.getByTestId('one-shot-summary-toggle'),
      agentRow[0].querySelector('button')!,
      finishedSummary,
      screen.getByTestId('background-hook-summary'),
      screen.getByTestId('monitored-pr-summary'),
    ];
    const expected = typography(rows[0]);

    for (const row of rows) {
      expect(typography(row)).toEqual(expected);
      expect(row.classList).toContain('type-body');
      expect(row.classList).toContain('font-normal');
    }
  });

  it('renders semantic header icons on the header text tone at narrow 200% zoom', async () => {
    document.documentElement.classList.add('dark');
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 320 });
    document.body.style.zoom = '2';
    setEventSubscriptionsExpanded('ws-1', 'agent-parent', true);
    render(EventSubscriptionsCard, {
      props: { workspaceId: 'ws-1', agentId: 'agent-parent' },
    });

    await waitFor(() => expect(screen.getByTestId('event-subscriptions-summary')).toBeTruthy());
    await fireEvent.click(await screen.findByTestId('one-shot-summary-toggle'));
    const rows = [
      [
        screen.getByTestId('event-subscriptions-summary'),
        screen.getByTestId('event-subscriptions-summary-title'),
      ],
      [screen.getByTestId('one-shot-summary-toggle'), screen.getByTestId('one-shot-summary-title')],
      [
        screen.getByTestId('finished-agent-summary'),
        screen.getByTestId('finished-agent-summary-title'),
      ],
      [screen.getByTestId('background-hook-summary'), screen.getByText('Watch CI')],
      [screen.getByTestId('monitored-pr-summary'), screen.getByText(/Polish subscriptions/)],
    ] as const;

    for (const [row, label] of rows) {
      const icon = row.querySelector('svg')!;
      expect(tone(icon)).toEqual(tone(label));
      expect(tone(icon).opacity).toBe('1');
    }
    expect(tone(screen.getAllByTestId('agent-card-name')[0])).toEqual(
      tone(screen.getByTestId('one-shot-summary-title')),
    );
  });
});
