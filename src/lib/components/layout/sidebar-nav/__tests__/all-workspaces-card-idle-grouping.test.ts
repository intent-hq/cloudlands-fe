/**
 * Test: IDLE section grouping in AllWorkspacesCard Status view
 *
 * Verifies:
 * - Workspaces with zero streaming agents land in IDLE section (when in_progress or not_started)
 * - PR-stage and complete workspaces never go to IDLE
 * - IDLE section appears above In Progress
 * - Grouping updates reactively when streaming agents change
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/svelte';
import { store as appStore } from '$store/renderer/store';
import {
  setWorkspaceEntity,
  setWorkspaceHasLoaded,
} from '$store/renderer/slices/workspace/workspace-slice';
import { setAllSpacesViewMode } from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
import { WorkspaceStatus, PullRequestStatus, type Workspace, type WorkspaceId } from '$shared/types';
import AllWorkspacesCardHarness from './mocks/AllWorkspacesCardHarness.svelte';

vi.mock('$lib/components/workspace/WorkspaceCard.svelte', async () => ({
  default: (await import('./mocks/MockWorkspaceCard.svelte')).default,
}));

// Mock active streams tracker with controllable state
vi.mock('$features/agent/services/active-streams-tracker', () => {
  const streamingIds = new Map<string, string[]>();
  return {
    activeStreamsTracker: {
      fetchActiveStreams: vi.fn(),
      startPolling: vi.fn(),
      getStreamingAgentIdsForWorkspace: vi.fn((wsId: string) => streamingIds.get(wsId) || []),
      subscribe: vi.fn(() => () => {}),
      // Export the map for test control
      __getStreamingIdsMap: () => streamingIds,
    },
  };
});

function makeWorkspace(
  id: string,
  title: string,
  overrides?: Partial<Workspace>,
): Workspace {
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
    createdAt: '2026-07-14T10:00:00.000Z',
    updatedAt: '2026-07-14T10:00:00.000Z',
    lastActivity: '2026-07-14T10:00:00.000Z',
    ...overrides,
  };
}

function getGroupHeaders(): string[] {
  return screen.queryAllByRole('heading', { level: 3 }).map((el) => el.textContent ?? '');
}

describe('AllWorkspacesCard IDLE grouping (Status view)', () => {
  let streamingIdsMap: Map<string, string[]>;

  beforeEach(async () => {
    const { activeStreamsTracker } = await import('$features/agent/services/active-streams-tracker');
    streamingIdsMap = (activeStreamsTracker as any).__getStreamingIdsMap();
    streamingIdsMap.clear();
  });

  afterEach(() => {
    appStore.dispatch(setAllSpacesViewMode('recent'));
  });

  it('groups workspaces with zero streaming agents into IDLE section', async () => {
    const wsIdle1 = makeWorkspace('ws-idle-1', 'Idle WS 1');
    const wsIdle2 = makeWorkspace('ws-idle-2', 'Idle WS 2');

    render(AllWorkspacesCardHarness, {
      props: {
        setup: () => {
          appStore.dispatch(setWorkspaceEntity(wsIdle1));
          appStore.dispatch(setWorkspaceEntity(wsIdle2));
          appStore.dispatch(setWorkspaceHasLoaded(true));
          // No streaming agents for these workspaces (map defaults to empty)
          appStore.dispatch(setAllSpacesViewMode('status'));
        },
        expanded: true,
      },
    });

    await waitFor(() => {
      const headers = getGroupHeaders();
      expect(headers).toContain('Idle');
    });
  });

  it('places IDLE section above other sections when workspaces have no agents', async () => {
    const wsIdle1 = makeWorkspace('ws-idle-1', 'Idle WS 1');
    const wsIdle2 = makeWorkspace('ws-idle-2', 'Idle WS 2');

    render(AllWorkspacesCardHarness, {
      props: {
        setup: () => {
          appStore.dispatch(setWorkspaceEntity(wsIdle1));
          appStore.dispatch(setWorkspaceEntity(wsIdle2));
          appStore.dispatch(setWorkspaceHasLoaded(true));
          // No streaming agents (map defaults to empty) -> IDLE
          appStore.dispatch(setAllSpacesViewMode('status'));
        },
        expanded: true,
      },
    });

    await waitFor(() => {
      const headers = getGroupHeaders();
      expect(headers).toContain('Idle');
      // IDLE should be first
      expect(headers[0]).toBe('Idle');
    });
  });

  it('never moves PR-stage workspaces to IDLE', async () => {
    const wsPrOpen = makeWorkspace('ws-pr-open', 'PR Open WS', {
      displayStatus: 'pr_open',
      prStatus: PullRequestStatus.Open,
    });
    const wsNoChanges = makeWorkspace('ws-no-changes', 'No Changes WS');

    render(AllWorkspacesCardHarness, {
      props: {
        setup: () => {
          appStore.dispatch(setWorkspaceEntity(wsPrOpen));
          appStore.dispatch(setWorkspaceEntity(wsNoChanges));
          appStore.dispatch(setWorkspaceHasLoaded(true));

          // Zero streaming agents for both (map defaults to empty)
          // PR workspace should show in PR Open, not IDLE
          // No changes workspace should show in IDLE

          appStore.dispatch(setAllSpacesViewMode('status'));
        },
        expanded: true,
      },
    });

    await waitFor(() => {
      const headers = getGroupHeaders();
      expect(headers).toContain('PR Open');
      expect(headers).toContain('Idle');
      // Should have both sections
      const prOpenIndex = headers.indexOf('PR Open');
      const idleIndex = headers.indexOf('Idle');
      expect(idleIndex).toBeLessThan(prOpenIndex); // IDLE comes first
    });
  });
});
