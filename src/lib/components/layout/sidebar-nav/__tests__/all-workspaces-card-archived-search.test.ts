import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { goto } from '$app/navigation';
import { store as appStore } from '$store/renderer/store';
import {
  resetWorkspaceState,
  setWorkspaceEntity,
  setWorkspaceHasLoaded,
} from '$store/renderer/slices/workspace/workspace-slice';
import {
  setAllSpacesViewMode,
  setPinnedWorkspaceIds,
  setShowArchivedWorkspaces,
} from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
import { WorkspaceStatus, type Workspace, type WorkspaceId } from '$shared/types';
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

function workspace(
  id: string,
  title: string,
  status: WorkspaceStatus,
  repositoryName: string,
): Workspace {
  return {
    id: id as WorkspaceId,
    title,
    branch: 'main',
    changesets: [],
    timeline: [],
    conversationInfo: [],
    status,
    repositoryName,
    repositoryPath: `/tmp/${repositoryName}`,
    worktreePath: `/tmp/${id}`,
    createdAt: '2026-08-01T12:00:00.000Z',
    updatedAt: '2026-08-01T12:00:00.000Z',
    lastActivity: '2026-08-01T12:00:00.000Z',
    displayStatus: 'idle',
  };
}

function renderCard() {
  return render(AllWorkspacesCardHarness, {
    props: {
      expanded: true,
      setup: () => {
        appStore.dispatch(
          setWorkspaceEntity(
            workspace('active', 'Active space', WorkspaceStatus.Active, 'current-repo'),
          ),
        );
        appStore.dispatch(
          setWorkspaceEntity(
            workspace('archived', 'Past project', WorkspaceStatus.Archived, 'legacy-repo'),
          ),
        );
        appStore.dispatch(setWorkspaceHasLoaded(true));
      },
    },
  });
}

describe('AllWorkspacesCard archived discovery', () => {
  beforeEach(() => {
    appStore.init();
    appStore.dispatch(resetWorkspaceState());
    appStore.dispatch(setPinnedWorkspaceIds([]));
    appStore.dispatch(setAllSpacesViewMode('recent'));
    appStore.dispatch(setShowArchivedWorkspaces(false));
    vi.mocked(goto).mockReset();
  });

  it('keeps archived workspaces hidden until the visibility control is enabled', async () => {
    renderCard();

    expect(await screen.findByText('Active space')).toBeTruthy();
    expect(screen.queryByText('Past project')).toBeNull();

    await fireEvent.input(screen.getByPlaceholderText('Search spaces...'), {
      target: { value: 'Past project' },
    });
    expect(screen.queryByText('Past project')).toBeNull();

    appStore.dispatch(setShowArchivedWorkspaces(true));

    expect(await screen.findByText('Past project')).toBeTruthy();
    expect(screen.getByText('Archived workspace')).toBeTruthy();
    expect(document.querySelector('[data-workspace-archived-toggle]')).toBeNull();
  });

  it('searches active and archived metadata and keeps Enter aligned to filtered rows', async () => {
    renderCard();
    appStore.dispatch(setShowArchivedWorkspaces(true));

    const search = screen.getByPlaceholderText('Search spaces...');
    await fireEvent.input(search, { target: { value: 'Active space' } });
    await waitFor(() => {
      expect(screen.getByText('Active space')).toBeTruthy();
      expect(screen.queryByText('Past project')).toBeNull();
    });

    await fireEvent.input(search, { target: { value: 'Past project' } });
    await waitFor(() => {
      expect(screen.queryByText('Active space')).toBeNull();
      expect(screen.getByText('Past project')).toBeTruthy();
    });

    await fireEvent.input(search, { target: { value: 'legacy-repo' } });

    await waitFor(() => {
      expect(screen.queryByText('Active space')).toBeNull();
      expect(screen.getByText('Past project')).toBeTruthy();
    });

    await fireEvent.keyDown(search, { key: 'Enter' });
    await waitFor(() => expect(goto).toHaveBeenCalledWith('/workspace/archived'));
  });

  it('uses the canonical single-border focus treatment and keeps listbox keys on the expanded input', async () => {
    renderCard();

    const controls = document.querySelector('[data-workspace-search-controls]');
    const search = screen.getByPlaceholderText('Search spaces...');

    await waitFor(() => expect(document.activeElement).toBe(search));

    expect(controls?.classList.contains('min-w-0')).toBe(true);
    expect(controls?.classList.contains('overflow-visible')).toBe(true);
    expect(controls?.classList.contains('px-2')).toBe(true);
    expect(search.classList.contains('box-border')).toBe(true);
    expect(search.classList.contains('w-full')).toBe(true);
    expect(search.classList.contains('min-w-0')).toBe(true);
    expect(search.classList.contains('border')).toBe(true);
    expect(search.classList.contains('border-border')).toBe(true);
    expect(search.classList.contains('focus-visible:border-ring')).toBe(true);
    expect(search.classList.contains('focus-visible:outline-none')).toBe(true);
    expect(search.classList.contains('focus-visible:ring-0')).toBe(true);
    expect(search.className).not.toMatch(/focus-visible:ring-(?:1|2|4|8)|ring-inset|ring-offset/);

    const keydown = new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true });
    search.dispatchEvent(keydown);

    expect(keydown.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(search);
  });

  it('shows archived rows in repository view with the existing trailing label', async () => {
    appStore.dispatch(setShowArchivedWorkspaces(true));
    appStore.dispatch(setAllSpacesViewMode('repo'));
    renderCard();

    expect(await screen.findByRole('heading', { level: 4, name: 'legacy-repo' })).toBeTruthy();
    expect(screen.getByText('Past project')).toBeTruthy();
    expect(screen.getByText('Archived workspace')).toBeTruthy();
  });

  it('puts archived rows in a dedicated final Archived status section', async () => {
    appStore.dispatch(setShowArchivedWorkspaces(true));
    appStore.dispatch(setAllSpacesViewMode('status'));
    renderCard();

    await screen.findByText('Past project');
    expect(
      screen.getAllByRole('heading', { level: 4 }).map((heading) => heading.textContent),
    ).toEqual(['Idle', 'Archived']);
  });

  it('keeps archived visibility when search is hidden and distinguishes archived-only emptiness', async () => {
    const { unmount } = render(AllWorkspacesCardHarness, {
      props: {
        expanded: true,
        searchVisible: false,
        setup: () => {
          appStore.dispatch(
            setWorkspaceEntity(
              workspace('archived', 'Past project', WorkspaceStatus.Archived, 'legacy-repo'),
            ),
          );
          appStore.dispatch(setWorkspaceHasLoaded(true));
        },
      },
    });

    expect(await screen.findByText('No active workspaces')).toBeTruthy();
    expect(screen.queryByPlaceholderText('Search spaces...')).toBeNull();
    appStore.dispatch(setShowArchivedWorkspaces(true));
    expect(await screen.findByText('Past project')).toBeTruthy();

    unmount();
    render(AllWorkspacesCardHarness, { props: { expanded: true, searchVisible: false } });
    expect(await screen.findByText('Past project')).toBeTruthy();
  });

  it('never includes archived rows in the active recents-only quick card', async () => {
    appStore.dispatch(setShowArchivedWorkspaces(true));
    render(AllWorkspacesCardHarness, {
      props: {
        recentsOnly: true,
        setup: () => {
          appStore.dispatch(
            setWorkspaceEntity(
              workspace('active', 'Active space', WorkspaceStatus.Active, 'current-repo'),
            ),
          );
          appStore.dispatch(
            setWorkspaceEntity(
              workspace('archived', 'Past project', WorkspaceStatus.Archived, 'legacy-repo'),
            ),
          );
          appStore.dispatch(setWorkspaceHasLoaded(true));
        },
      },
    });

    expect(await screen.findByText('Active space')).toBeTruthy();
    expect(screen.queryByText('Past project')).toBeNull();
  });
});
