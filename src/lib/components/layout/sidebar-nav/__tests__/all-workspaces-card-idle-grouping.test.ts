/**
 * Test: Idle section grouping in AllWorkspacesCard Status view
 *
 * The daemon owns the idle demotion (spec: compute idle displayStatus in
 * daemon): a not-running workspace with open tasks arrives on the wire as
 * displayStatus: 'idle', and the FE renders the BE-sent value verbatim.
 * Verifies:
 * - Workspaces with a BE-sent 'idle' displayStatus land in the Idle section
 * - The Idle section appears above other sections
 * - PR-stage workspaces group under their own section, never Idle
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

  it('groups BE-sent idle workspaces into the Idle section', async () => {
    const wsIdle1 = makeWorkspace('ws-idle-1', 'Idle WS 1', { displayStatus: 'idle' });
    const wsIdle2 = makeWorkspace('ws-idle-2', 'Idle WS 2', { displayStatus: 'idle' });

    render(AllWorkspacesCardHarness, {
      props: {
        setup: () => {
          appStore.dispatch(setWorkspaceEntity(wsIdle1));
          appStore.dispatch(setWorkspaceEntity(wsIdle2));
          appStore.dispatch(setWorkspaceHasLoaded(true));
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

  it('places the Idle section above other sections', async () => {
    const wsIdle = makeWorkspace('ws-idle-1', 'Idle WS 1', { displayStatus: 'idle' });
    const wsInProgress = makeWorkspace('ws-running-1', 'Running WS', {
      displayStatus: 'in_progress',
    });

    render(AllWorkspacesCardHarness, {
      props: {
        setup: () => {
          appStore.dispatch(setWorkspaceEntity(wsIdle));
          appStore.dispatch(setWorkspaceEntity(wsInProgress));
          appStore.dispatch(setWorkspaceHasLoaded(true));
          appStore.dispatch(setAllSpacesViewMode('status'));
        },
        expanded: true,
      },
    });

    await waitFor(() => {
      const headers = getGroupHeaders();
      expect(headers).toContain('Idle');
      expect(headers).toContain('In Progress');
      // Idle should be first
      expect(headers[0]).toBe('Idle');
    });
  });

  it('groups PR-stage workspaces under their own section, never Idle', async () => {
    // The daemon never demotes PR-stage statuses to idle; the FE renders both
    // values verbatim side by side.
    const wsPrOpen = makeWorkspace('ws-pr-open', 'PR Open WS', {
      displayStatus: 'pr_open',
      prStatus: PullRequestStatus.Open,
    });
    const wsIdle = makeWorkspace('ws-idle', 'Idle WS', { displayStatus: 'idle' });

    render(AllWorkspacesCardHarness, {
      props: {
        setup: () => {
          appStore.dispatch(setWorkspaceEntity(wsPrOpen));
          appStore.dispatch(setWorkspaceEntity(wsIdle));
          appStore.dispatch(setWorkspaceHasLoaded(true));
          appStore.dispatch(setAllSpacesViewMode('status'));
        },
        expanded: true,
      },
    });

    await waitFor(() => {
      const headers = getGroupHeaders();
      expect(headers).toContain('PR Open');
      expect(headers).toContain('Idle');
      const prOpenIndex = headers.indexOf('PR Open');
      const idleIndex = headers.indexOf('Idle');
      expect(idleIndex).toBeLessThan(prOpenIndex); // Idle comes first
    });
  });
});
