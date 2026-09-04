import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { store as appStore } from '$store/renderer/store';
import {
  resetWorkspaceState,
  setWorkspaceEntity,
  setWorkspaceHasLoaded,
} from '$store/renderer/slices/workspace/workspace-slice';
import {
  hydrateSidebarNav,
  setAllSpacesViewMode,
  setShowArchivedWorkspaces,
} from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
import { WorkspaceStatus, type Workspace, type WorkspaceId } from '$shared/types';
import { m } from '$shared/paraglide/messages.js';
import AllWorkspacesCardHarness from './mocks/AllWorkspacesCardHarness.svelte';

vi.mock('$lib/components/workspace/WorkspaceCard.svelte', async () => ({
  default: (await import('./mocks/MockWorkspaceCard.svelte')).default,
}));
vi.mock('$features/agent/services/active-streams-tracker', () => ({
  activeStreamsTracker: {
    startPolling: vi.fn(),
    fetchActiveStreams: vi.fn(),
    subscribe: vi.fn(() => () => {}),
    getStreamingAgentIdsForWorkspace: vi.fn(() => []),
  },
}));

function workspace(
  id: string,
  repositoryName: string,
  overrides: Partial<Workspace> = {},
): Workspace {
  return {
    id: id as WorkspaceId,
    title: id,
    branch: 'main',
    changesets: [],
    timeline: [],
    conversationInfo: [],
    status: WorkspaceStatus.Active,
    displayStatus: 'in_progress',
    repositoryName,
    repositoryPath: `/tmp/${repositoryName}`,
    worktreePath: `/tmp/${id}`,
    createdAt: '2026-09-01T12:00:00.000Z',
    updatedAt: '2026-09-01T12:00:00.000Z',
    lastActivity: '2026-09-01T12:00:00.000Z',
    ...overrides,
  };
}

function renderView(viewMode: 'repo' | 'status', workspaces: Workspace[]) {
  return render(AllWorkspacesCardHarness, {
    props: {
      expanded: true,
      setup: () => {
        for (const item of workspaces) appStore.dispatch(setWorkspaceEntity(item));
        appStore.dispatch(setWorkspaceHasLoaded(true));
        appStore.dispatch(setAllSpacesViewMode(viewMode));
      },
    },
  });
}

function repositoryGroup(label: string): HTMLElement {
  return screen
    .getByRole('heading', { level: 4, name: label })
    .closest('[data-repository-group]') as HTMLElement;
}

describe('AllWorkspacesCard group actions', () => {
  beforeEach(() => {
    appStore.init();
    appStore.dispatch(resetWorkspaceState());
    appStore.dispatch(
      hydrateSidebarNav({
        pinnedWorkspaceIds: [],
        collapsedStatusGroupIds: [],
        allSpacesViewMode: 'recent',
        showArchivedWorkspaces: false,
      }),
    );
  });

  it('deletes every repository member, including one hidden behind Show more', async () => {
    const workspaces = [1, 2, 3, 4].map((index) => workspace(`alpha-${index}`, 'alpha'));
    renderView('repo', workspaces);

    const group = await waitFor(() => repositoryGroup('alpha'));
    expect(group.querySelectorAll('[data-repository-space-row]')).toHaveLength(3);

    await fireEvent.click(
      within(group).getByRole('button', {
        name: m.layout_allCard_groupDeleteAll_ariaLabel({ group: 'alpha' }),
      }),
    );

    expect(appStore.state.workspaceOperations.showBulkDeleteConfirm).toBe(true);
    expect(appStore.state.workspaceOperations.pendingBulkWorkspaceIds).toEqual([
      'alpha-1',
      'alpha-2',
      'alpha-3',
      'alpha-4',
    ]);
    expect(appStore.state.workspaceOperations.pendingBulkGroupLabel).toBe('alpha');
  });

  it('archives a full status group without toggling its collapsed state', async () => {
    const workspaces = [workspace('active-1', 'alpha'), workspace('active-2', 'beta')];
    renderView('status', workspaces);

    const toggle = await screen.findByRole('button', { name: 'In Progress' });
    const header = toggle.closest('[data-status-group]') as HTMLElement;

    await fireEvent.click(
      within(header).getByRole('button', {
        name: m.layout_allCard_groupArchiveAll_ariaLabel({ group: 'In Progress' }),
      }),
    );

    expect(appStore.state.workspaceOperations.showBulkArchiveConfirm).toBe(true);
    expect(appStore.state.workspaceOperations.pendingBulkWorkspaceIds).toEqual([
      'active-1',
      'active-2',
    ]);
    expect(appStore.state.workspaceOperations.pendingBulkGroupLabel).toBe('In Progress');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(appStore.state.sidebarNav.collapsedStatusGroupIds).toEqual([]);
  });

  it('offers only Delete all for the Archived status group', async () => {
    appStore.dispatch(setShowArchivedWorkspaces(true));
    renderView('status', [
      workspace('active', 'alpha'),
      workspace('archived', 'alpha', { status: WorkspaceStatus.Archived }),
    ]);

    await screen.findByRole('heading', { level: 4, name: 'Archived' });
    const archivedHeader = document.querySelector('[data-status-group="archived"]') as HTMLElement;

    expect(archivedHeader.querySelector('[data-group-archive-all]')).toBeNull();
    expect(
      within(archivedHeader).getByRole('button', {
        name: m.layout_allCard_groupDeleteAll_ariaLabel({ group: 'Archived' }),
      }),
    ).toBeTruthy();
  });
});
