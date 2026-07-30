/**
 * Test: BE-owned workspace.displayStatus in AllWorkspacesCard Status view
 *
 * intent-hq/intentd#600: the daemon computes the current-cycle displayStatus
 * (open/draft PR → open tasks → merged PR → complete) and the FE renders it
 * verbatim. Since intent-hq/intentd#743 the lite workspace.subscribe snapshot
 * always carries the field, so there is no client-side derivation. Verifies:
 * - BE displayStatus wins over locally cached PR fields (the original bug:
 *   merged PR + open tasks must NOT group as PR Merged when BE says in_progress)
 * - Absent/unknown wire values default to 'not_started' (grouped Idle) instead
 *   of triggering a local derivation
 * - The client-side running/idle grouping layer stays on top of the BE value
 * - A displayStatus entity merge (the workspace:displayStatus-changed store
 *   path) regroups the sidebar live without a refetch
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/svelte';
import { store as appStore } from '$store/renderer/store';
import {
  setWorkspaceEntity,
  setWorkspaceHasLoaded,
  resetWorkspaceState,
  updateWorkspaceEntity,
  bulkUpdateWorkspaceEntities,
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
      getStreamingAgentIdsForWorkspace: vi.fn((wsId: string) => streamingIds.get(wsId) || []),
      subscribe: vi.fn(() => () => {}),
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

describe('AllWorkspacesCard BE displayStatus (Status view)', () => {
  let streamingIdsMap: Map<string, string[]>;

  beforeEach(async () => {
    const { activeStreamsTracker } = await import('$features/agent/services/active-streams-tracker');
    streamingIdsMap = (activeStreamsTracker as any).__getStreamingIdsMap();
    streamingIdsMap.clear();
  });

  afterEach(() => {
    appStore.dispatch(setAllSpacesViewMode('recent'));
  });

  it('prefers BE displayStatus over locally cached PR fields (original bug)', async () => {
    // Locally this workspace looks merged (prStatus Merged), but the daemon
    // says the current cycle is in_progress (merged PR + open tasks). It must
    // NOT group under PR Merged; not running, so the idle layer demotes
    // in_progress to Idle.
    const ws = makeWorkspace('ws-be-inprog', 'Merged PR but open tasks', {
      prStatus: PullRequestStatus.Merged,
      displayStatus: 'in_progress',
    });

    render(AllWorkspacesCardHarness, {
      props: {
        setup: () => {
          appStore.dispatch(resetWorkspaceState());
          appStore.dispatch(setWorkspaceEntity(ws));
          appStore.dispatch(setWorkspaceHasLoaded(true));
          appStore.dispatch(setAllSpacesViewMode('status'));
        },
        expanded: true,
      },
    });

    await waitFor(() => {
      const headers = getGroupHeaders();
      expect(headers).toContain('Idle');
      expect(headers).not.toContain('PR Merged');
    });
  });

  it('groups under PR Merged when the BE says pr_merged', async () => {
    const ws = makeWorkspace('ws-be-merged', 'Cycle done', {
      displayStatus: 'pr_merged',
    });

    render(AllWorkspacesCardHarness, {
      props: {
        setup: () => {
          appStore.dispatch(resetWorkspaceState());
          appStore.dispatch(setWorkspaceEntity(ws));
          appStore.dispatch(setWorkspaceHasLoaded(true));
          appStore.dispatch(setAllSpacesViewMode('status'));
        },
        expanded: true,
      },
    });

    await waitFor(() => {
      expect(getGroupHeaders()).toContain('PR Merged');
    });
  });

  it('defaults an unknown wire displayStatus to not_started (forward compat)', async () => {
    // A future daemon that adds a 7th wire value must not make the workspace
    // vanish from the Status view — the guard treats the unknown value as
    // absent, defaulting to not_started (demoted to Idle when not running).
    // Locally cached PR fields are ignored: there is no local derivation.
    const ws = makeWorkspace('ws-unknown-status', 'Future wire value', {
      prStatus: PullRequestStatus.Merged,
      displayStatus: 'something_new' as never,
    });

    render(AllWorkspacesCardHarness, {
      props: {
        setup: () => {
          appStore.dispatch(resetWorkspaceState());
          appStore.dispatch(setWorkspaceEntity(ws));
          appStore.dispatch(setWorkspaceHasLoaded(true));
          appStore.dispatch(setAllSpacesViewMode('status'));
        },
        expanded: true,
      },
    });

    await waitFor(() => {
      const headers = getGroupHeaders();
      expect(headers).toContain('Idle');
      expect(headers).not.toContain('PR Merged');
    });
  });

  it('defaults to not_started when displayStatus is absent (no local derivation)', async () => {
    // The lite snapshot always carries displayStatus (intent-hq/intentd#743);
    // an absent field is not healed from cached PR state — it defaults to
    // not_started and groups under Idle.
    const ws = makeWorkspace('ws-legacy-merged', 'Legacy merged', {
      prStatus: PullRequestStatus.Merged,
    });

    render(AllWorkspacesCardHarness, {
      props: {
        setup: () => {
          appStore.dispatch(resetWorkspaceState());
          appStore.dispatch(setWorkspaceEntity(ws));
          appStore.dispatch(setWorkspaceHasLoaded(true));
          appStore.dispatch(setAllSpacesViewMode('status'));
        },
        expanded: true,
      },
    });

    await waitFor(() => {
      const headers = getGroupHeaders();
      expect(headers).toContain('Idle');
      expect(headers).not.toContain('PR Merged');
    });
  });

  it('keeps the running override on top of the BE status', async () => {
    // A streaming agent unconditionally groups the workspace under In
    // Progress, even when the BE base status is pr_merged.
    const ws = makeWorkspace('ws-be-running', 'Running with merged cycle', {
      displayStatus: 'pr_merged',
    });
    streamingIdsMap.set('ws-be-running', ['agent-1']);

    render(AllWorkspacesCardHarness, {
      props: {
        setup: () => {
          appStore.dispatch(resetWorkspaceState());
          appStore.dispatch(setWorkspaceEntity(ws));
          appStore.dispatch(setWorkspaceHasLoaded(true));
          appStore.dispatch(setAllSpacesViewMode('status'));
        },
        expanded: true,
      },
    });

    await waitFor(() => {
      const headers = getGroupHeaders();
      expect(headers).toContain('In Progress');
      expect(headers).not.toContain('PR Merged');
    });
  });

  it('regroups live when a displayStatus entity merge lands (event store path)', async () => {
    // The daemon-events-bridge folds workspace:displayStatus-changed through
    // bulkUpdateWorkspaceEntities(updateWorkspaceEntity(...)); dispatching the
    // same actions must regroup the sidebar without a refetch.
    const ws = makeWorkspace('ws-be-live', 'Live transition', {
      displayStatus: 'pr_merged',
    });

    render(AllWorkspacesCardHarness, {
      props: {
        setup: () => {
          appStore.dispatch(resetWorkspaceState());
          appStore.dispatch(setWorkspaceEntity(ws));
          appStore.dispatch(setWorkspaceHasLoaded(true));
          appStore.dispatch(setAllSpacesViewMode('status'));
        },
        expanded: true,
      },
    });

    await waitFor(() => {
      expect(getGroupHeaders()).toContain('PR Merged');
    });

    appStore.dispatch(
      bulkUpdateWorkspaceEntities([
        updateWorkspaceEntity('ws-be-live', { displayStatus: 'in_progress' }),
      ]),
    );

    await waitFor(() => {
      const headers = getGroupHeaders();
      expect(headers).toContain('Idle');
      expect(headers).not.toContain('PR Merged');
    });
  });
});
