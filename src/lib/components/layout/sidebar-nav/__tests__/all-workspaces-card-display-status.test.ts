/**
 * Test: BE-owned workspace.displayStatus in AllWorkspacesCard Status view
 *
 * intent-hq/intentd#600: the daemon computes the current-cycle displayStatus —
 * including the agent-running promotion to in_progress and the not-running
 * demotion to idle (spec: compute idle displayStatus in daemon) — and the FE
 * renders it verbatim. Since intent-hq/intentd#743 the lite workspace.subscribe
 * snapshot always carries the field, so there is no client-side derivation.
 * Verifies:
 * - BE displayStatus wins over locally cached PR fields (the original bug:
 *   merged PR + open tasks must NOT group as PR Merged when BE says in_progress)
 * - BE-sent 'idle' and 'in_progress' render verbatim under their own groups
 * - Absent/unknown wire values default to 'not_started' instead of triggering
 *   a local derivation
 * - The FE streaming-agents signal never influences the grouping
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

  it('prefers BE displayStatus over locally cached PR fields (original bug)', async () => {
    // Locally this workspace looks merged (prStatus Merged), but the daemon
    // says the current cycle is in_progress (merged PR + open tasks + running
    // agent). It must group under In Progress verbatim, NOT PR Merged — and
    // there is no local idle demotion.
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
      expect(headers).toContain('In Progress');
      expect(headers).not.toContain('PR Merged');
      expect(headers).not.toContain('Idle');
    });
  });

  it('renders a BE-sent idle verbatim under the Idle group', async () => {
    // The daemon demotes a not-running in_progress/not_started cycle to the
    // 'idle' wire value; the FE renders it as-is.
    const ws = makeWorkspace('ws-be-idle', 'Open tasks, nothing running', {
      displayStatus: 'idle',
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
      expect(headers).not.toContain('In Progress');
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
    // A future daemon that adds a new wire value must not make the workspace
    // vanish from the Status view — the guard treats the unknown value as
    // absent, defaulting to not_started (the No Code Changes group).
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
      expect(headers).toContain('No Code Changes');
      expect(headers).not.toContain('PR Merged');
    });
  });

  it('defaults to not_started when displayStatus is absent (no local derivation)', async () => {
    // The lite snapshot always carries displayStatus (intent-hq/intentd#743);
    // an absent field is not healed from cached PR state — it defaults to
    // not_started and groups under No Code Changes.
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
      expect(headers).toContain('No Code Changes');
      expect(headers).not.toContain('PR Merged');
    });
  });

  it('never lets the streaming-agents signal override the BE status', async () => {
    // The daemon owns the agent-running promotion; the FE streaming signal is
    // a card affordance (running dot) only. A streaming agent must NOT regroup
    // a pr_merged workspace under In Progress.
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
      expect(headers).toContain('PR Merged');
      expect(headers).not.toContain('In Progress');
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
        updateWorkspaceEntity('ws-be-live', { displayStatus: 'idle' }),
      ]),
    );

    await waitFor(() => {
      const headers = getGroupHeaders();
      expect(headers).toContain('Idle');
      expect(headers).not.toContain('PR Merged');
    });
  });

  it('does not regroup when the activeStreamsTracker notifies a streaming change', async () => {
    // The tracker still drives the running-dot affordance, but a stream
    // starting must not move the workspace out of its BE-sent group — only a
    // workspace:displayStatus-changed entity merge regroups.
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

    // Let any (incorrect) regroup flush before asserting nothing moved.
    await new Promise((resolve) => setTimeout(resolve, 50));
    const headers = getGroupHeaders();
    expect(headers).toContain('PR Merged');
    expect(headers).not.toContain('In Progress');
  });
});
