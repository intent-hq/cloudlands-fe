/**
 * Test: BE-owned workspace.displayStatus in AllWorkspacesCard Status view
 *
 * intent-hq/intentd#600: the daemon computes the current-cycle displayStatus
 * (open/draft PR → open tasks → merged PR → complete) and the FE renders it
 * verbatim when present. Verifies:
 * - BE displayStatus wins over the local PR/task derivation (the original bug:
 *   merged PR + open tasks must NOT group as PR Merged when BE says in_progress)
 * - The local derivation still applies when the field is absent (older daemons)
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

// Mock active streams tracker with controllable state. `subscribe` records
// listeners and `__notify` fires them — the same change-notification path the
// real tracker drives from agent:status-changed / agent:idle events — so the
// live-badge test can assert the card regroups on a tracker notify (the
// direct-subscription replacement for the deleted redux-bridge bump-version
// tests, monorepo#1127).
vi.mock('$features/agent/services/active-streams-tracker', () => {
  const streamingIds = new Map<string, string[]>();
  const listeners = new Set<() => void>();
  return {
    activeStreamsTracker: {
      fetchActiveStreams: vi.fn(),
      startPolling: vi.fn(),
      getStreamingAgentIdsForWorkspace: vi.fn((wsId: string) => streamingIds.get(wsId) || []),
      subscribe: vi.fn((listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      }),
      __getStreamingIdsMap: () => streamingIds,
      __notify: () => {
        for (const listener of [...listeners]) listener();
      },
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

  it('prefers BE displayStatus over the local merged-PR derivation (original bug)', async () => {
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

  it('degrades an unknown wire displayStatus to the local derivation (forward compat)', async () => {
    // A future daemon that adds a 7th wire value must not make the workspace
    // vanish from the Status view — the guard treats the unknown value as
    // absent and the local merged-PR derivation groups it under PR Merged.
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
      expect(getGroupHeaders()).toContain('PR Merged');
    });
  });

  it('falls back to the local derivation when displayStatus is absent (older daemon)', async () => {
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
      expect(getGroupHeaders()).toContain('PR Merged');
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

  it('regroups live when the activeStreamsTracker notifies a streaming change (direct subscription)', async () => {
    // The sidebar cards subscribe to the tracker directly (the Redux bridge
    // was deleted, monorepo#1127): when agent:status-changed / agent:idle
    // refresh the tracker state and it notifies, the card must regroup
    // without any Redux dispatch.
    const { activeStreamsTracker } = await import('$features/agent/services/active-streams-tracker');
    const notify = (activeStreamsTracker as any).__notify as () => void;
    const ws = makeWorkspace('ws-tracker-live', 'Tracker-driven badge', {
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

    // A stream starts: the tracker refreshes its state and notifies.
    streamingIdsMap.set('ws-tracker-live', ['agent-1']);
    notify();

    await waitFor(() => {
      const headers = getGroupHeaders();
      expect(headers).toContain('In Progress');
      expect(headers).not.toContain('PR Merged');
    });

    // The stream ends (agent:idle): the next notify regroups back.
    streamingIdsMap.clear();
    notify();

    await waitFor(() => {
      const headers = getGroupHeaders();
      expect(headers).toContain('PR Merged');
      expect(headers).not.toContain('In Progress');
    });
  });
});
