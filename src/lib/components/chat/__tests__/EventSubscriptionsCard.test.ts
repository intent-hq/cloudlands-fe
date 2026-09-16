import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetAgentSubscriptionsViewStateForTests } from '../agent-subscriptions-view-state';

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule();
});

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

import EventSubscriptionsCard from '../EventSubscriptionsCard.svelte';

afterEach(() => {
  cleanup();
  resetAgentSubscriptionsViewStateForTests();
});

async function renderCard(agentId: string, compact = false) {
  render(EventSubscriptionsCard, { workspaceId: 'workspace-a', agentId, compact });
  await tick();
  return screen.getByTestId('event-subscriptions-card');
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
  ])('toggles a %s-only subscription without removing its card', async (agentId, testId) => {
    const card = await renderCard(agentId);
    const toggle = screen.getByRole('button', { name: 'Subscribed to 1 event' });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(card.contains(screen.getByTestId(testId))).toBe(true);

    await fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    await waitFor(() => expect(screen.queryByTestId(testId)).toBeNull());
    expect(card.isConnected).toBe(true);

    await fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    await waitFor(() => expect(card.contains(screen.getByTestId(testId))).toBe(true));
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
});
