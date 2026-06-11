/**
 * Regression test: pinned workspaces must sort to the top of the
 * All workspaces panel (Recent view), both when pins are present at
 * mount time (hydrated) and when toggled live.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/svelte';
import { store as appStore } from '$store/renderer/store';
import { setWorkspaceEntity } from '$store/renderer/slices/workspace/workspace-slice';
import { togglePinWorkspace } from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
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

function makeWorkspace(id: string, title: string, lastActivity: string): Workspace {
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
    createdAt: lastActivity,
    updatedAt: lastActivity,
    lastActivity,
  };
}

const wsNewest = makeWorkspace('ws-newest', 'Newest', '2026-06-10T12:00:00.000Z');
const wsMiddle = makeWorkspace('ws-middle', 'Middle', '2026-06-09T12:00:00.000Z');
const wsOldest = makeWorkspace('ws-oldest', 'Oldest', '2026-06-08T12:00:00.000Z');

function seedWorkspaces() {
  appStore.dispatch(setWorkspaceEntity(wsNewest));
  appStore.dispatch(setWorkspaceEntity(wsMiddle));
  appStore.dispatch(setWorkspaceEntity(wsOldest));
}

function renderedOrder(): string[] {
  return screen
    .getAllByTestId('workspace-card')
    .map((el) => el.getAttribute('data-workspace-id') ?? '');
}

describe('AllWorkspacesCard pinned-first ordering (Recent view)', () => {
  it('sorts hydrated pinned workspaces to the top on initial render', async () => {
    render(AllWorkspacesCardHarness, {
      props: {
        setup: () => {
          seedWorkspaces();
          appStore.dispatch(togglePinWorkspace('ws-oldest'));
        },
      },
    });

    await waitFor(() => {
      expect(renderedOrder()).toEqual(['ws-oldest', 'ws-newest', 'ws-middle']);
    });
  });

  it('moves a workspace to the top when pinned, and back when unpinned', async () => {
    render(AllWorkspacesCardHarness, { props: { setup: seedWorkspaces, expanded: true } });

    await waitFor(() => {
      expect(renderedOrder()).toEqual(['ws-newest', 'ws-middle', 'ws-oldest']);
    });

    appStore.dispatch(togglePinWorkspace('ws-oldest'));

    await waitFor(() => {
      expect(renderedOrder()).toEqual(['ws-oldest', 'ws-newest', 'ws-middle']);
    });

    appStore.dispatch(togglePinWorkspace('ws-oldest'));

    await waitFor(() => {
      expect(renderedOrder()).toEqual(['ws-newest', 'ws-middle', 'ws-oldest']);
    });
  });
});

