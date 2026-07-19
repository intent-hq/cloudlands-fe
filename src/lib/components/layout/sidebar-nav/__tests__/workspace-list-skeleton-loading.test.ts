/**
 * Regression test: workspace list skeleton loading state.
 *
 * When hasLoaded is false, the sidebar should show skeleton placeholders instead
 * of the "No workspaces yet" empty state or a partial workspace list. Once loaded,
 * the normal rendering (empty state, search, workspace cards) should appear.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/svelte';
import { store as appStore } from '$store/renderer/store';
import {
  setWorkspaceEntity,
  setWorkspaceHasLoaded,
  replaceWorkspaceList,
} from '$store/renderer/slices/workspace/workspace-slice';
import { WorkspaceStatus, type Workspace, type WorkspaceId } from '$shared/types';
import AllWorkspacesCardHarness from './mocks/AllWorkspacesCardHarness.svelte';

vi.mock('$lib/components/workspace/WorkspaceCard.svelte', async () => ({
  default: (await import('./mocks/MockWorkspaceCard.svelte')).default,
}));

vi.mock('$features/agent/services/active-streams-tracker', () => ({
  activeStreamsTracker: {
    fetchActiveStreams: vi.fn(),
    getStreamingAgentIdsForWorkspace: vi.fn(() => []),
    subscribe: vi.fn(() => () => {}),
  },
}));

function makeWorkspace(id: string, title: string): Workspace {
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
    createdAt: '2026-06-10T12:00:00.000Z',
    updatedAt: '2026-06-10T12:00:00.000Z',
    lastActivity: '2026-06-10T12:00:00.000Z',
  };
}

const ws1 = makeWorkspace('ws-1', 'Workspace One');

describe('AllWorkspacesCard skeleton loading state', () => {
  it('shows skeleton placeholders when hasLoaded is false and no workspaces', async () => {
    render(AllWorkspacesCardHarness, {
      props: {
        setup: () => {
          // hasLoaded defaults to false (no action needed)
        },
      },
    });

    await waitFor(() => {
      const skeletons = screen.getAllByTestId('workspace-card-skeleton');
      expect(skeletons.length).toBeGreaterThan(0);
    });

    // Should NOT show the "No workspaces yet" empty state
    expect(screen.queryByText('No workspaces yet')).toBeNull();
  });

  it('shows skeleton placeholders when hasLoaded is false even with a partial workspace list', async () => {
    render(AllWorkspacesCardHarness, {
      props: {
        setup: () => {
          appStore.dispatch(setWorkspaceEntity(ws1));
          // hasLoaded is still false — simulating route loader hydrating one workspace
          // before the seeder's full list completes
        },
      },
    });

    await waitFor(() => {
      const skeletons = screen.getAllByTestId('workspace-card-skeleton');
      expect(skeletons.length).toBeGreaterThan(0);
    });

    // Should NOT render the partial workspace list
    expect(screen.queryByTestId('workspace-card')).toBeNull();
  });

  it('renders workspace list and hides skeletons after replaceWorkspaceList + setWorkspaceHasLoaded(true)', async () => {
    const ws2 = makeWorkspace('ws-2', 'Workspace Two');

    render(AllWorkspacesCardHarness, {
      props: {
        setup: () => {
          // Simulate the seeder flow
          appStore.dispatch(replaceWorkspaceList([ws1, ws2]));
          appStore.dispatch(setWorkspaceHasLoaded(true));
        },
      },
    });

    await waitFor(() => {
      const cards = screen.getAllByTestId('workspace-card');
      expect(cards.length).toBe(2);
    });

    // Skeletons should be gone
    expect(screen.queryByTestId('workspace-card-skeleton')).toBeNull();
  });

  it('shows empty state only when loaded and truly empty', async () => {
    render(AllWorkspacesCardHarness, {
      props: {
        setup: () => {
          appStore.dispatch(replaceWorkspaceList([]));
          appStore.dispatch(setWorkspaceHasLoaded(true));
        },
      },
    });

    await waitFor(() => {
      expect(screen.getByText('No workspaces yet')).toBeDefined();
    });

    // No skeletons, no workspace cards
    expect(screen.queryByTestId('workspace-card-skeleton')).toBeNull();
    expect(screen.queryByTestId('workspace-card')).toBeNull();
  });
});
