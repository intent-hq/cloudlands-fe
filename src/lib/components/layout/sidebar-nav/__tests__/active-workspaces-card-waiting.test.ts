/**
 * Test: Waiting section in ActiveWorkspacesCard.
 *
 * Waiting = BE-sent orthogonal `waiting: true` flag (PROTOCOL §5.1) with no
 * streaming agents — agents purely waiting on external conditions (hooks, PR
 * monitors, watched agents). The flag overlays displayStatus, so any
 * displayStatus (even 'complete') can be Waiting. Unread wins over Waiting;
 * Running is excluded by the no-stream check.
 */
import { m } from '$shared/paraglide/messages.js';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/svelte';
import { store as appStore } from '$store/renderer/store';
import {
  setWorkspaceEntity,
  setWorkspaceHasLoaded,
  resetWorkspaceState,
} from '$store/renderer/slices/workspace/workspace-slice';
import {
  hydrateSidebarNav,
  togglePinWorkspace,
} from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
import { WorkspaceStatus, type Workspace, type WorkspaceId } from '$shared/types';
import ActiveWorkspacesCardHarness from './mocks/ActiveWorkspacesCardHarness.svelte';

const setPinnedWorkspaceIds = (ids: string[]) => hydrateSidebarNav({ pinnedWorkspaceIds: ids });

vi.mock('$lib/components/workspace/WorkspaceCard.svelte', async () => ({
  default: (await import('./mocks/MockWorkspaceCard.svelte')).default,
}));

vi.mock('$features/agent/services/active-streams-tracker', () => {
  const streamingIds = new Map<string, string[]>();
  return {
    activeStreamsTracker: {
      fetchActiveStreams: vi.fn(),
      startPolling: vi.fn(),
      getStreamingAgentIdsForWorkspace: vi.fn((wsId: string) => streamingIds.get(wsId) || []),
      subscribe: vi.fn(() => () => {}),
      __getStreamingIdsMap: () => streamingIds,
    },
  };
});

function makeWorkspace(id: string, title: string, overrides?: Partial<Workspace>): Workspace {
  return {
    id: id as WorkspaceId,
    title,
    branch: 'main',
    changesets: [],
    timeline: [],
    conversationInfo: [],
    status: WorkspaceStatus.Active,
    repositoryPath: '/tmp/repo',
    worktreePath: `/tmp/worktrees/${id}`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastActivity: new Date().toISOString(),
    ...overrides,
  };
}

function getSectionHeaders(): string[] {
  return screen.queryAllByRole('heading', { level: 3 }).map((el) => el.textContent ?? '');
}

function renderWith(workspaces: Workspace[]) {
  render(ActiveWorkspacesCardHarness, {
    props: {
      setup: () => {
        workspaces.forEach((w) => appStore.dispatch(setWorkspaceEntity(w)));
        appStore.dispatch(setWorkspaceHasLoaded(true));
      },
      expanded: true,
    },
  });
}

describe('ActiveWorkspacesCard Waiting section', () => {
  let streamingIdsMap: Map<string, string[]>;

  beforeEach(async () => {
    appStore.init();
    appStore.dispatch(resetWorkspaceState());
    appStore.dispatch(setPinnedWorkspaceIds([]));
    const { activeStreamsTracker } =
      await import('$features/agent/services/active-streams-tracker');
    streamingIdsMap = (
      activeStreamsTracker as unknown as { __getStreamingIdsMap: () => Map<string, string[]> }
    ).__getStreamingIdsMap();
    streamingIdsMap.clear();
  });

  it('shows a waiting-flagged workspace with no streams under Waiting', async () => {
    renderWith([makeWorkspace('ws-wait', 'Waiting WS', { waiting: true })]);

    await waitFor(() => {
      expect(getSectionHeaders()).toContain('Waiting');
      expect(screen.getByText('Waiting WS')).toBeTruthy();
    });
  });

  it('shows a complete workspace with the waiting flag under Waiting', async () => {
    renderWith([
      makeWorkspace('ws-done-wait', 'Complete waiting WS', {
        displayStatus: 'complete',
        waiting: true,
      }),
    ]);

    await waitFor(() => {
      expect(getSectionHeaders()).toContain('Waiting');
      expect(screen.getByText('Complete waiting WS')).toBeTruthy();
    });
  });

  it('does not infer Waiting from in_progress displayStatus without the waiting flag', async () => {
    renderWith([
      makeWorkspace('ws-in-progress', 'In-progress WS', { displayStatus: 'in_progress' }),
    ]);

    await waitFor(() => {
      expect(screen.getByText('No active workspaces')).toBeTruthy();
    });
    expect(getSectionHeaders()).not.toContain('Waiting');
  });

  it('exposes labeled navigation and search semantics without a false listbox role', async () => {
    renderWith(
      Array.from({ length: 4 }, (_, index) =>
        makeWorkspace(`ws-wait-${index}`, `Waiting WS ${index}`, {
          waiting: true,
        }),
      ),
    );

    await waitFor(() => {
      expect(screen.getByRole('navigation', { name: 'Active workspaces' })).toBeTruthy();
    });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(
      screen.getByRole('textbox', { name: m.layout_activeCard_search_placeholder() }),
    ).toBeTruthy();
  });

  it('excludes a streaming waiting-flagged workspace from Waiting (it is Running)', async () => {
    streamingIdsMap.set('ws-run', ['agent-1']);
    renderWith([makeWorkspace('ws-run', 'Running WS', { waiting: true })]);

    await waitFor(() => {
      expect(getSectionHeaders()).toContain('Running');
    });
    expect(getSectionHeaders()).not.toContain('Waiting');
  });

  it('keeps an unread waiting-flagged workspace only in Unread', async () => {
    renderWith([
      makeWorkspace('ws-unread', 'Unread WS', {
        waiting: true,
        attention: 'unread',
      }),
    ]);

    await waitFor(() => {
      expect(getSectionHeaders()).toContain('Unread');
    });
    expect(getSectionHeaders()).not.toContain('Waiting');
    expect(screen.getAllByText('Unread WS')).toHaveLength(1);
  });

  it('excludes archived and deleted workspaces from Waiting', async () => {
    renderWith([
      makeWorkspace('ws-archived', 'Archived WS', {
        waiting: true,
        status: WorkspaceStatus.Archived,
      }),
      makeWorkspace('ws-deleted', 'Deleted WS', {
        waiting: true,
        status: WorkspaceStatus.Deleted,
      }),
    ]);

    await waitFor(() => {
      expect(screen.getByText('No active workspaces')).toBeTruthy();
    });
    expect(getSectionHeaders()).not.toContain('Waiting');
  });

  it('orders sections Unread, Running, Waiting', async () => {
    streamingIdsMap.set('ws-run', ['agent-1']);
    renderWith([
      makeWorkspace('ws-unread', 'Unread WS', { attention: 'unread' }),
      makeWorkspace('ws-run', 'Running WS', { displayStatus: 'in_progress' }),
      makeWorkspace('ws-wait', 'Waiting WS', { waiting: true }),
    ]);

    await waitFor(() => {
      expect(getSectionHeaders()).toEqual(['Unread', 'Running', 'Waiting']);
    });
  });

  it('passes pinned state through every active-list section', async () => {
    streamingIdsMap.set('ws-run', ['agent-1']);
    const workspaces = [
      makeWorkspace('ws-unread', 'Unread pinned', { attention: 'unread' }),
      makeWorkspace('ws-run', 'Running pinned', { displayStatus: 'in_progress' }),
      makeWorkspace('ws-wait', 'Waiting pinned', { waiting: true }),
      makeWorkspace('ws-pin', 'Pinned only'),
    ];

    render(ActiveWorkspacesCardHarness, {
      props: {
        setup: () => {
          workspaces.forEach((workspace) => {
            appStore.dispatch(setWorkspaceEntity(workspace));
            appStore.dispatch(togglePinWorkspace(workspace.id));
          });
          appStore.dispatch(setWorkspaceHasLoaded(true));
        },
        expanded: true,
      },
    });

    await waitFor(() => expect(screen.getAllByTestId('workspace-card')).toHaveLength(4));
    expect(
      screen
        .getAllByTestId('workspace-card')
        .every((card) => card.getAttribute('data-pinned') === 'true'),
    ).toBe(true);
    expect(getSectionHeaders()).toEqual(['Unread', 'Running', 'Waiting', 'Pinned']);
  });
});
