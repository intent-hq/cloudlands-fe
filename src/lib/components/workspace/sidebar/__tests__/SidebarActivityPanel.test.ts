import { fireEvent, render, screen } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceEvent } from '$features/events/types';
import SidebarActivityPanel from '../SidebarActivityPanel.svelte';

const mocks = vi.hoisted(() => {
  const state = {
    events: [
      {
        id: 'event-1',
        workspaceId: 'workspace-1',
        timestamp: '2026-08-03T12:00:00.000Z',
        type: 'file:changed',
        actor: { type: 'system' },
        data: { path: 'src/file.ts' },
      },
    ] as WorkspaceEvent[],
    loading: false,
    loadingOlder: false,
    olderError: null as string | null,
    endReached: false,
  };
  const selector =
    <T>(getValue: () => T) =>
    () => ({
      subscribe(run: (value: T) => void) {
        run(getValue());
        return () => {};
      },
    });
  return { dispatch: vi.fn(), state, selector };
});

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({ state: () => ({}), dispatch: mocks.dispatch });
});

vi.mock('$store/renderer/slices/workspace-events/workspace-events-selectors', () => ({
  selectWorkspaceEvents: mocks.selector(() => mocks.state.events),
  selectEventsLoading: mocks.selector(() => mocks.state.loading),
  selectOlderEventsLoading: mocks.selector(() => mocks.state.loadingOlder),
  selectOlderEventsError: mocks.selector(() => mocks.state.olderError),
  selectOlderEventsEndReached: mocks.selector(() => mocks.state.endReached),
}));

vi.mock('$store/renderer/slices/workspace-agents/workspace-agents-selectors', () => ({
  selectAllWorkspaceAgents: mocks.selector(() => []),
}));

describe('SidebarActivityPanel', () => {
  beforeEach(() => {
    mocks.dispatch.mockClear();
    mocks.state.loadingOlder = false;
    mocks.state.olderError = null;
    mocks.state.endReached = false;
  });

  it('dispatches the older-events request from the oldest edge', async () => {
    render(SidebarActivityPanel, { props: { workspaceId: 'workspace-1' } });

    await fireEvent.click(screen.getByRole('button', { name: 'Load older activity' }));

    expect(mocks.dispatch).toHaveBeenCalledWith({
      type: 'workspaceEvents/loadOlderEventsRequested',
      payload: ['workspace-1'],
    });
  });

  it('hides the older-events control after reaching the end', () => {
    mocks.state.endReached = true;

    render(SidebarActivityPanel, { props: { workspaceId: 'workspace-1' } });

    expect(screen.queryByRole('button', { name: 'Load older activity' })).toBeNull();
  });

  it('shows a retry control with the older-page error', async () => {
    mocks.state.olderError = 'Connection lost';

    render(SidebarActivityPanel, { props: { workspaceId: 'workspace-1' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(screen.getByRole('status').textContent).toBe('Connection lost');
    expect(mocks.dispatch).toHaveBeenCalledWith({
      type: 'workspaceEvents/loadOlderEventsRequested',
      payload: ['workspace-1'],
    });
  });

  it('disables the older-events control while loading', () => {
    mocks.state.loadingOlder = true;

    render(SidebarActivityPanel, { props: { workspaceId: 'workspace-1' } });

    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Loading older activity…' }).disabled,
    ).toBe(true);
  });
});
