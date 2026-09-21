import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/svelte';
import { store as appStore } from '$store/renderer/store';
import {
  resetWorkspaceState,
  setWorkspaceEntity,
  setWorkspaceHasLoaded,
} from '$store/renderer/slices/workspace/workspace-slice';
import { selectWorkspaceById } from '$store/renderer/slices/workspace/workspace-selectors';
import {
  hydrateSidebarNav,
  setAllSpacesViewMode,
} from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
import { WorkspaceStatus, type Workspace } from '$shared/types';
import { WorkspaceId } from '$shared/types/branded-ids';
import AllWorkspacesCardHarness from './mocks/AllWorkspacesCardHarness.svelte';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$features/agent/services/active-streams-tracker', () => ({
  activeStreamsTracker: {
    startPolling: vi.fn(),
    fetchActiveStreams: vi.fn(),
    subscribe: vi.fn(() => () => {}),
    getStreamingAgentIdsForWorkspace: vi.fn(() => []),
  },
}));

let origin: number;

function minutesAgo(minutes: number): string {
  return new Date(origin - minutes * 60_000).toISOString();
}

function workspace(id: string, overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: WorkspaceId(id),
    title: id,
    branch: 'main',
    changesets: [],
    timeline: [],
    conversationInfo: [],
    status: WorkspaceStatus.Active,
    displayStatus: 'idle',
    repositoryName: 'activity-fixture',
    repositoryPath: '/tmp/activity-fixture',
    worktreePath: `/tmp/${id}`,
    createdAt: minutesAgo(120),
    updatedAt: minutesAgo(1),
    lastActivity: minutesAgo(60),
    ...overrides,
  };
}

function timeFor(title: string): Element | null {
  return screen
    .getByRole('button', { name: title, exact: true })
    .closest('[data-workspace-card-row]')!
    .querySelector('[data-workspace-card-time]');
}

function renderWorkspaces(workspaces: Workspace[]) {
  return render(AllWorkspacesCardHarness, {
    props: {
      expanded: true,
      searchVisible: false,
      setup: () => {
        workspaces.forEach((item) => appStore.dispatch(setWorkspaceEntity(item)));
        appStore.dispatch(setWorkspaceHasLoaded(true));
      },
    },
  });
}

async function selectViewMode(mode: 'recent' | 'repo' | 'status') {
  appStore.dispatch(setAllSpacesViewMode(mode));
  const list = screen.getByRole('listbox');
  await waitFor(() => {
    expect(list.querySelectorAll('[data-repository-group]')).toHaveLength(mode === 'repo' ? 1 : 0);
    expect(list.querySelectorAll('[data-status-group]')).toHaveLength(mode === 'status' ? 1 : 0);
    expect(list.querySelector('[data-workspace-card-row]')).not.toBeNull();
  });
}

describe('AllWorkspacesCard elapsed activity', () => {
  beforeEach(() => {
    origin = Date.now();
    appStore.init();
    appStore.dispatch(resetWorkspaceState());
    appStore.dispatch(
      hydrateSidebarNav({
        allSpacesViewMode: 'recent',
        pinnedWorkspaceIds: [],
        collapsedRepoGroupKeys: [],
        collapsedStatusGroupIds: [],
        showArchivedWorkspaces: false,
      }),
    );
  });

  afterEach(() => {
    cleanup();
  });

  for (const mode of ['recent', 'repo', 'status'] as const) {
    it(`updates daemon activity in ${mode} rows without using the newer updatedAt`, async () => {
      renderWorkspaces([workspace('Active workspace')]);
      await selectViewMode(mode);
      await waitFor(() => expect(timeFor('Active workspace')?.textContent?.trim()).toBe('1h'));

      appStore.dispatch(
        setWorkspaceEntity(workspace('Active workspace', { lastActivity: minutesAgo(10) })),
      );
      expect(selectWorkspaceById.select(appStore.state, 'Active workspace')).toMatchObject({
        lastActivity: minutesAgo(10),
        updatedAt: minutesAgo(1),
      });
      await waitFor(() => expect(timeFor('Active workspace')?.textContent?.trim()).toBe('10m'));
    });
  }

  it('retains creation, then update fallback and omits an all-invalid timestamp across modes', async () => {
    renderWorkspaces([
      workspace('Creation fallback', { lastActivity: undefined }),
      workspace('Update fallback', {
        lastActivity: 'invalid',
        createdAt: '1970-01-01T00:00:00.000Z',
        updatedAt: minutesAgo(180),
      }),
      workspace('No timestamp', {
        lastActivity: 'invalid',
        createdAt: 'invalid',
        updatedAt: 'invalid',
      }),
    ]);
    for (const mode of ['recent', 'repo', 'status'] as const) {
      await selectViewMode(mode);
      await waitFor(() => {
        expect(timeFor('Creation fallback')?.textContent?.trim()).toBe('2h');
        expect(timeFor('Update fallback')?.textContent?.trim()).toBe('3h');
        expect(timeFor('No timestamp')?.textContent?.trim()).toBe('');
        expect(timeFor('No timestamp')?.querySelector('[title]')).toBeNull();
      });
    }
  });

  it('changes recent order only when activity changes, not when metadata is updated', async () => {
    const { container } = renderWorkspaces([
      workspace('Older', { lastActivity: minutesAgo(120) }),
      workspace('Newer'),
    ]);
    await selectViewMode('recent');
    const titles = () =>
      [...container.querySelectorAll('[data-workspace-card-title]')].map((el) =>
        el.textContent?.trim(),
      );
    await waitFor(() => expect(titles()).toEqual(['Newer', 'Older']));
    appStore.dispatch(
      setWorkspaceEntity(
        workspace('Older', {
          lastActivity: minutesAgo(120),
          updatedAt: minutesAgo(0),
        }),
      ),
    );
    expect(selectWorkspaceById.select(appStore.state, 'Older')).toMatchObject({
      lastActivity: minutesAgo(120),
      updatedAt: minutesAgo(0),
    });
    await waitFor(() => expect(timeFor('Older')?.textContent?.trim()).toBe('2h'));
    expect(titles()).toEqual(['Newer', 'Older']);
    appStore.dispatch(
      setWorkspaceEntity(
        workspace('Older', {
          lastActivity: minutesAgo(5),
          updatedAt: minutesAgo(0),
        }),
      ),
    );
    expect(selectWorkspaceById.select(appStore.state, 'Older')).toMatchObject({
      lastActivity: minutesAgo(5),
      updatedAt: minutesAgo(0),
    });
    await waitFor(() => expect(titles()).toEqual(['Older', 'Newer']));
    expect(timeFor('Older')?.textContent?.trim()).toBe('5m');
  });
});
