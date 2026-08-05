/**
 * NotificationNavigateToast component test — structured three-line layout
 * with and without a resolved micro key slot (the slot square must render
 * only when a slot resolved; the avatar/specialist line never depends on it).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { readable } from 'svelte/store';

// AuggieAvatar's selector modules call store.createSelector at load time —
// mock them with plain readables so the component renders without the app
// store (same seams as notification-ipc-service.test.ts).
vi.mock('$store/renderer/slices/theme/theme-selectors', () => ({
  selectIsDarkTheme: () => readable(false),
}));

vi.mock('$store/renderer/slices/agent-session/agent-session-selectors', () => ({
  selectAgentIsThinking: () => readable(false),
  selectAgentProvider: () => readable(undefined),
}));

import NotificationNavigateToast from '../NotificationNavigateToast.svelte';

const structured = {
  agentId: 'agent-1',
  workspaceTitle: 'My Workspace',
  specialist: 'spec-writer',
  specialistDisplayName: 'Coordinator',
  taskTitle: 'Fix toast styling',
  provider: 'auggie',
};

const baseProps = {
  title: 'Agent',
  description: 'Finished',
  actionLabel: 'Open',
  onAction: vi.fn(),
};

describe('NotificationNavigateToast', () => {
  afterEach(cleanup);

  it('renders the structured three-line layout without a slot square when keySlot is null', () => {
    const { container } = render(NotificationNavigateToast, {
      props: { ...baseProps, keySlot: null, structured },
    });

    expect(screen.queryByTitle(/Micro key/)).toBeNull();
    expect(screen.getByText('My Workspace')).toBeTruthy();
    expect(screen.getByText('Coordinator: Fix toast styling')).toBeTruthy();
    expect(screen.getByText('Finished')).toBeTruthy();
    expect(container.querySelector('svg')).toBeTruthy();
  });

  it('renders the slot square next to the structured layout when a slot resolved', () => {
    render(NotificationNavigateToast, {
      props: { ...baseProps, keySlot: 3, structured },
    });

    expect(screen.getByTitle('Micro key 4')).toBeTruthy();
    expect(screen.getByText('My Workspace')).toBeTruthy();
    expect(screen.getByText('Coordinator: Fix toast styling')).toBeTruthy();
  });

  it('renders the fallback title/description without a slot square when keySlot is null', () => {
    render(NotificationNavigateToast, {
      props: { ...baseProps, keySlot: null },
    });

    expect(screen.queryByTitle(/Micro key/)).toBeNull();
    expect(screen.getByText('Agent')).toBeTruthy();
    expect(screen.getByText('Finished')).toBeTruthy();
  });

  it('renders the fallback title with the slot square when a slot resolved', () => {
    render(NotificationNavigateToast, {
      props: { ...baseProps, keySlot: 3 },
    });

    expect(screen.getByTitle('Micro key 4')).toBeTruthy();
    expect(screen.getByText('Agent')).toBeTruthy();
  });

  it('wires the action button', async () => {
    const onAction = vi.fn();
    render(NotificationNavigateToast, {
      props: { ...baseProps, onAction, keySlot: null, structured },
    });

    await fireEvent.click(screen.getByText('Open'));
    expect(onAction).toHaveBeenCalledTimes(1);
  });
});
