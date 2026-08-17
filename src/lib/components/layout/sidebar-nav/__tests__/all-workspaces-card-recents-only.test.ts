import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { store as appStore } from '$store/renderer/store';
import {
  resetWorkspaceState,
  setWorkspaceEntity,
  setWorkspaceHasLoaded,
} from '$store/renderer/slices/workspace/workspace-slice';
import { hydrateSidebarNav, togglePinWorkspace } from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
import { WorkspaceStatus, type Workspace, type WorkspaceId } from '$shared/types';
import AllWorkspacesCardHarness from './mocks/AllWorkspacesCardHarness.svelte';

const setPinnedWorkspaceIds = (ids: string[]) => hydrateSidebarNav({ pinnedWorkspaceIds: ids });

vi.mock('$features/agent/services/active-streams-tracker', () => ({
  activeStreamsTracker: {
    startPolling: vi.fn(),
    fetchActiveStreams: vi.fn(),
    subscribe: vi.fn(() => () => {}),
    getStreamingAgentIdsForWorkspace: vi.fn(() => []),
  },
}));

function workspace(id: string, title: string, lastActivity: string): Workspace {
  return {
    id: id as WorkspaceId,
    title,
    branch: 'main',
    changesets: [],
    timeline: [],
    conversationInfo: [],
    status: WorkspaceStatus.Active,
    repositoryPath: '/tmp/repo',
    worktreePath: `/tmp/${id}`,
    createdAt: lastActivity,
    updatedAt: lastActivity,
    lastActivity,
  };
}

describe('AllWorkspacesCard recents-only presentation', () => {
  beforeEach(() => {
    appStore.init();
    appStore.dispatch(resetWorkspaceState());
    appStore.dispatch(setPinnedWorkspaceIds([]));
  });

  it('shows standard compact workspace rows in activity order without pin priority', async () => {
    render(AllWorkspacesCardHarness, {
      props: {
        recentsOnly: true,
        setup: () => {
          appStore.dispatch(setWorkspaceEntity(workspace('new', 'Newest', '2026-07-03')));
          appStore.dispatch(setWorkspaceEntity(workspace('middle', 'Middle', '2026-07-02')));
          appStore.dispatch(setWorkspaceEntity(workspace('old', 'Oldest', '2026-07-01')));
          appStore.dispatch(togglePinWorkspace('old'));
          appStore.dispatch(setWorkspaceHasLoaded(true));
        },
      },
    });

    await waitFor(() =>
      expect(document.querySelectorAll('[data-recent-space-row]')).toHaveLength(3),
    );

    const rows = [...document.querySelectorAll('[data-recent-space-row]')];
    expect(rows.map((row) => row.getAttribute('data-workspace-id'))).toEqual([
      'new',
      'middle',
      'old',
    ]);
    expect(rows.every((row) => row.querySelector('[data-workspace-card-row]'))).toBe(true);
    expect(rows.every((row) => row.querySelector('[data-workspace-card-time]'))).toBe(true);
    expect(screen.queryByPlaceholderText('Search spaces...')).toBeNull();
    expect(screen.queryByText('Recent')).toBeNull();
    expect(screen.queryByText('Repo')).toBeNull();
    expect(screen.queryByText('Status')).toBeNull();

    await fireEvent.keyDown(screen.getByRole('listbox'), { key: 'ArrowDown' });
    expect(rows[1].querySelector('[data-workspace-card-row]')?.className).toContain(
      'bg-background/50',
    );
  });

  it('can remain visually empty while compact recents are loading', () => {
    render(AllWorkspacesCardHarness, {
      props: { recentsOnly: true, showLoadingText: false },
    });

    expect(screen.queryByText(/loading/i)).toBeNull();
    expect(screen.queryByText('No workspaces yet')).toBeNull();
  });

  it('limits recents by default, expands on demand, and searches every workspace', async () => {
    render(AllWorkspacesCardHarness, {
      props: {
        recentsOnly: true,
        recentLimit: 3,
        searchRecents: true,
        expandableRecents: true,
        excludedWorkspaceIds: ['third'],
        setup: () => {
          appStore.dispatch(setWorkspaceEntity(workspace('first', 'First', '2026-07-05')));
          appStore.dispatch(setWorkspaceEntity(workspace('second', 'Second', '2026-07-04')));
          appStore.dispatch(setWorkspaceEntity(workspace('third', 'Third', '2026-07-03')));
          appStore.dispatch(setWorkspaceEntity(workspace('fourth', 'Fourth', '2026-07-02')));
          appStore.dispatch(setWorkspaceEntity(workspace('fifth', 'Fifth', '2026-07-01')));
          appStore.dispatch(setWorkspaceHasLoaded(true));
        },
      },
    });

    await waitFor(() =>
      expect(document.querySelectorAll('[data-recent-space-row]')).toHaveLength(3),
    );

    await fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
    expect(document.querySelectorAll('[data-recent-space-row]')).toHaveLength(4);
    expect(document.querySelector('[data-workspace-id="third"]')).toBeNull();

    await fireEvent.click(screen.getByRole('button', { name: 'Show less' }));
    expect(document.querySelectorAll('[data-recent-space-row]')).toHaveLength(3);

    await fireEvent.input(screen.getByPlaceholderText('Search spaces...'), {
      target: { value: 'Fourth' },
    });
    await waitFor(() => {
      const rows = document.querySelectorAll('[data-recent-space-row]');
      expect(rows).toHaveLength(1);
      expect(rows[0].getAttribute('data-workspace-id')).toBe('fourth');
    });
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();
  });
});
