import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  resetAgentSubscriptionsViewStateForTests,
  setEventSubscriptionsExpanded,
} from '../agent-subscriptions-view-state';

const { liveSubscriptions } = vi.hoisted(() => ({
  liveSubscriptions: {
    hooks: [] as Array<{ agentId: string; state: string }>,
    monitors: [] as Array<{ agentId: string; state: string }>,
    agents: {} as Record<string, string[]>,
  },
}));

vi.mock('../AgentSubscriptions.svelte', async () => ({
  default: (await import('./mocks/MockAgentEventSection.svelte')).default,
}));
vi.mock('../BackgroundHooksRow.svelte', async () => ({
  default: (await import('./mocks/MockHookEventSection.svelte')).default,
}));
vi.mock('../MonitoredPrsRow.svelte', async () => ({
  default: (await import('./mocks/MockPrEventSection.svelte')).default,
}));
vi.mock('../BrowserTabsRow.svelte', async () => ({
  default: (await import('./mocks/MockBrowserTabsSection.svelte')).default,
}));
vi.mock('$store/renderer/slices/background-hooks/background-hooks-selectors', async () => {
  const { readable } = await import('svelte/store');
  return { selectBackgroundHooks: () => readable(liveSubscriptions.hooks) };
});
vi.mock('$store/renderer/slices/pr-monitor/pr-monitor-selectors', async () => {
  const { derived } = await import('svelte/store');
  return {
    selectAgentPrMonitors: (
      _workspaceId: unknown,
      agentId: import('svelte/store').Readable<string>,
    ) =>
      derived(agentId, ($agentId) =>
        liveSubscriptions.monitors.filter((monitor) => monitor.agentId === $agentId),
      ),
  };
});
vi.mock(
  '$store/renderer/slices/agent-subscription-ui/agent-subscription-ui-selectors',
  async () => {
    const { derived } = await import('svelte/store');
    return {
      selectAgentSubscriptionLane: (
        _workspaceId: unknown,
        agentId: import('svelte/store').Readable<string>,
      ) =>
        derived(agentId, ($agentId) => {
          const participantAgentIds = liveSubscriptions.agents[$agentId] ?? [];
          return {
            visible: participantAgentIds.length > 0,
            count: participantAgentIds.length,
            participantAgentIds,
          };
        }),
    };
  },
);
vi.mock('$store/renderer/slices/agent-session/agent-session-selectors', async () => {
  const { readable } = await import('svelte/store');
  return { selectAgentSessionsById: () => readable({}) };
});

import EventSubscriptionsCard from '../EventSubscriptionsCard.svelte';

beforeEach(() => {
  liveSubscriptions.hooks = ['hooks', 'agents-hooks-prs', 'hooks-tabs'].map((agentId) => ({
    agentId,
    state: 'scheduled',
  }));
  liveSubscriptions.monitors = ['prs', 'agents-hooks-prs'].map((agentId) => ({
    agentId,
    state: 'active',
  }));
  liveSubscriptions.agents = {
    agents: ['agent-one'],
    'agents-hooks-prs': ['agent-one'],
  };
});

afterEach(() => {
  cleanup();
  resetAgentSubscriptionsViewStateForTests();
});

async function renderCard(agentId: string, compact = false) {
  render(EventSubscriptionsCard, { workspaceId: 'workspace-a', agentId, compact });
  await tick();
  return screen.getByTestId('event-subscriptions-card');
}

function rect(top: number, height: number): DOMRect {
  return {
    x: 0,
    y: top,
    left: 0,
    right: 320,
    top,
    bottom: top + height,
    width: 320,
    height,
    toJSON: () => ({}),
  } as DOMRect;
}

describe('EventSubscriptionsCard', () => {
  it('promotes the agent cohort header and omits the outer header for an agent-only card', async () => {
    const card = await renderCard('agents');
    expect(card.parentElement?.classList.contains('hidden')).toBe(false);
    expect(screen.getByTestId('mock-agent-event-section')).toBeTruthy();
    expect(screen.getAllByText('Waiting for 1 agent')).toHaveLength(1);
    expect(screen.queryByTestId('event-subscriptions-outer-header')).toBeNull();
    expect(screen.queryByTestId('event-subscriptions-summary')).toBeNull();
  });

  it.each([
    ['hooks', 'mock-hook-event-section'],
    ['prs', 'mock-pr-event-section'],
  ])('shows one bounded card for a %s-only subscription', async (agentId, testId) => {
    const card = await renderCard(agentId);
    expect(card.parentElement?.classList.contains('hidden')).toBe(false);
    expect(card.className).toContain('rounded-lg');
    expect(card.className).toContain('border');
    expect(card.className).toContain('border-border');
    expect(card.className).toContain('bg-card/80');
    expect(card.className).toContain('shadow-sm');
    expect(screen.getByTestId(testId)).toBeTruthy();
    expect(screen.getByText('Subscribed to 1 event')).toBeTruthy();
  });

  it('renders a persisted-collapsed agents-only header and avatar stack from store state', async () => {
    liveSubscriptions.agents['stored-agents'] = ['agent-one', 'agent-two'];
    setEventSubscriptionsExpanded('workspace-a', 'stored-agents', false);

    const card = await renderCard('stored-agents');

    expect(card.parentElement?.classList.contains('hidden')).toBe(false);
    expect(screen.getByRole('button', { name: 'Waiting for 2 agents' })).toBeTruthy();
    expect(card.querySelectorAll('[data-agent-avatar-stack-item]')).toHaveLength(2);
    expect(screen.queryByTestId('event-subscriptions-outer-header')).toBeNull();
  });

  it('keeps the store-backed mixed count and avatars stable across collapse', async () => {
    const agentId = 'stored-mixed';
    liveSubscriptions.agents[agentId] = ['agent-one', 'agent-two'];
    liveSubscriptions.hooks = [{ agentId, state: 'scheduled' }];
    liveSubscriptions.monitors = [{ agentId, state: 'active' }];
    setEventSubscriptionsExpanded('workspace-a', agentId, false);

    const card = await renderCard(agentId);
    const toggle = screen.getByRole('button', { name: 'Subscribed to 4 events' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(card.querySelectorAll('[data-agent-avatar-stack-item]')).toHaveLength(2);

    await fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('button', { name: 'Subscribed to 4 events' })).toBeTruthy();
  });

  it('composes all event categories without nested cards', async () => {
    const card = await renderCard('agents-hooks-prs');
    expect(card.parentElement?.classList.contains('hidden')).toBe(false);
    expect(screen.getByTestId('mock-agent-event-section')).toBeTruthy();
    expect(screen.getByTestId('mock-hook-event-section')).toBeTruthy();
    expect(screen.getByTestId('mock-pr-event-section')).toBeTruthy();
    expect(screen.getByText('Subscribed to 3 events')).toBeTruthy();
    expect(screen.getByTestId('event-subscriptions-outer-header')).toBeTruthy();
    expect(screen.getByText('Waiting for 1 agent')).toBeTruthy();
    expect(card.querySelectorAll('[data-conversation-layer="event-subscriptions"]')).toHaveLength(
      0,
    );
  });

  it('starts expanded and toggles every category without removing the card', async () => {
    const card = await renderCard('agents-hooks-prs');
    const toggle = screen.getByRole('button', { name: 'Subscribed to 3 events' });
    const body = screen.getByTestId('event-subscriptions-body');

    expect(toggle.className).toContain('w-full');
    expect(toggle.className).toContain('px-3!');
    expect(toggle.className).toContain('py-2!');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.getAttribute('aria-controls')).toBe(body.id);
    expect(body.classList.contains('hidden')).toBe(false);
    await fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(body.getAttribute('aria-hidden')).toBe('true');
    await waitFor(() => expect(screen.queryByTestId('event-subscriptions-body')).toBeNull());
    expect(card.isConnected).toBe(true);
    await fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    await waitFor(() => expect(screen.queryByTestId('event-subscriptions-body')).not.toBeNull());
    expect(screen.getByTestId('event-subscriptions-body').getAttribute('aria-hidden')).toBe(
      'false',
    );
    expect(card.parentElement?.className).not.toMatch(/pb-(8|12)|mb-(8|12)/);
  });

  it('persists a collapsed override across remounts in the session', async () => {
    const first = render(EventSubscriptionsCard, {
      props: { workspaceId: 'workspace-a', agentId: 'agents-hooks-prs' },
    });
    await tick();
    await fireEvent.click(screen.getByRole('button', { name: 'Subscribed to 3 events' }));
    await waitFor(() => expect(screen.queryByTestId('event-subscriptions-body')).toBeNull());
    first.unmount();

    await renderCard('agents-hooks-prs');
    expect(
      screen.getByRole('button', { name: 'Subscribed to 3 events' }).getAttribute('aria-expanded'),
    ).toBe('false');
    expect(screen.queryByTestId('event-subscriptions-body')).toBeNull();
  });

  it.each([
    ['hooks', 1],
    ['prs', 1],
  ])('renders a persisted-collapsed %s-only header from store state', async (kind, count) => {
    const agentId = `stored-${kind}`;
    if (kind === 'hooks') {
      liveSubscriptions.hooks = [{ agentId, state: 'scheduled' }];
    } else {
      liveSubscriptions.monitors = [{ agentId, state: 'active' }];
    }
    setEventSubscriptionsExpanded('workspace-a', agentId, false);

    const card = await renderCard(agentId);

    expect(card.parentElement?.classList.contains('hidden')).toBe(false);
    expect(
      screen
        .getByRole('button', { name: `Subscribed to ${count} event` })
        .getAttribute('aria-expanded'),
    ).toBe('false');
    expect(screen.queryByTestId('event-subscriptions-body')).toBeNull();
  });

  it('keeps a persisted-collapsed empty card hidden', async () => {
    setEventSubscriptionsExpanded('workspace-a', 'stored-none', false);

    const card = await renderCard('stored-none');

    expect(card.parentElement?.classList.contains('hidden')).toBe(true);
    expect(screen.queryByTestId('event-subscriptions-outer-header')).toBeNull();
  });

  it('hides the entire bounded surface when every category is empty', async () => {
    const card = await renderCard('none');
    expect(card.parentElement?.classList.contains('hidden')).toBe(true);
    expect(card.parentElement?.getAttribute('data-has-subscriptions')).toBe('false');
  });

  it('shows the card for a browser-tabs-only agent without the events header', async () => {
    const card = await renderCard('tabs');
    expect(card.parentElement?.classList.contains('hidden')).toBe(false);
    expect(screen.getByTestId('mock-browser-tabs-section')).toBeTruthy();
    expect(screen.queryByTestId('event-subscriptions-outer-header')).toBeNull();
    // Tabs-only card must not be labelled "Subscribed to events".
    expect(card.getAttribute('aria-label')).toBe('Browser tabs (2)');
  });

  it('renders browser tabs parallel to a collapsed events disclosure', async () => {
    await renderCard('hooks-tabs');
    const section = screen.getByTestId('event-subscriptions-browser-tabs');
    expect(section.classList.contains('hidden')).toBe(false);
    expect(screen.getByTestId('mock-browser-tabs-section')).toBeTruthy();

    await fireEvent.click(screen.getByRole('button', { name: 'Subscribed to 1 event' }));
    await waitFor(() => expect(screen.queryByTestId('event-subscriptions-body')).toBeNull());
    expect(screen.getByTestId('mock-browser-tabs-section')).toBeTruthy();
  });

  it.each([
    [false, 'mt-8', 32],
    [true, 'mt-6', 24],
  ])('owns a non-collapsing transparent top gap (compact=%s)', async (compact, token, gap) => {
    const card = await renderCard('agents', compact);
    const utility = card.parentElement!;
    const predecessor = document.createElement('div');
    predecessor.dataset.conversationLayer = compact ? 'reasoning' : 'agent-prose';
    utility.before(predecessor);

    predecessor.getBoundingClientRect = () => rect(100, 20);
    utility.getBoundingClientRect = () => rect(120 + gap, 80);
    card.getBoundingClientRect = () => rect(120 + gap, 76);

    expect(utility.classList.contains(token)).toBe(true);
    expect(utility.className).not.toMatch(/bg-|pt-|min-h-/);
    expect(card.getBoundingClientRect().top - predecessor.getBoundingClientRect().bottom).toBe(gap);
  });
});
