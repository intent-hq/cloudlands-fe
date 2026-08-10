/**
 * Test: Waiting section in ActiveWorkspacesCard.
 *
 * Waiting = BE-sent `displayStatus: 'in_progress'` with no streaming agents
 * (PROTOCOL §5.1) — i.e. agents idling on a background hook or on delegated
 * work. Unread wins over Waiting; Running is excluded by the no-stream check.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/svelte';
import { store as appStore } from '$store/renderer/store';
import {
  setWorkspaceEntity,
  setWorkspaceHasLoaded,
  resetWorkspaceState,
} from '$store/renderer/slices/workspace/workspace-slice';
import { WorkspaceStatus, type Workspace, type WorkspaceId } from '$shared/types';
import ActiveWorkspacesCardHarness from './mocks/ActiveWorkspacesCardHarness.svelte';

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
    const { activeStreamsTracker } = await import('$features/agent/services/active-streams-tracker');
    streamingIdsMap = (
      activeStreamsTracker as unknown as { __getStreamingIdsMap: () => Map<string, string[]> }
    ).__getStreamingIdsMap();
    streamingIdsMap.clear();
  });

  it('shows an in_progress workspace with no streams under Waiting', async () => {
    renderWith([makeWorkspace('ws-wait', 'Waiting WS', { displayStatus: 'in_progress' })]);

    await waitFor(() => {
      expect(getSectionHeaders()).toContain('Waiting');
      expect(screen.getByText('Waiting WS')).toBeTruthy();
    });
  });

  it('excludes a streaming in_progress workspace from Waiting (it is Running)', async () => {
    streamingIdsMap.set('ws-run', ['agent-1']);
    renderWith([makeWorkspace('ws-run', 'Running WS', { displayStatus: 'in_progress' })]);

    await waitFor(() => {
      expect(getSectionHeaders()).toContain('Running');
    });
    expect(getSectionHeaders()).not.toContain('Waiting');
  });

  it('keeps an unread in_progress workspace only in Unread', async () => {
    renderWith([
      makeWorkspace('ws-unread', 'Unread WS', {
        displayStatus: 'in_progress',
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
        displayStatus: 'in_progress',
        status: WorkspaceStatus.Archived,
      }),
      makeWorkspace('ws-deleted', 'Deleted WS', {
        displayStatus: 'in_progress',
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
      makeWorkspace('ws-wait', 'Waiting WS', { displayStatus: 'in_progress' }),
    ]);

    await waitFor(() => {
      expect(getSectionHeaders()).toEqual(['Unread', 'Running', 'Waiting']);
    });
  });
});
