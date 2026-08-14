/**
 * Regression test: pinned workspaces must sort to the top of the
 * All workspaces panel (Recent view), both when pins are present at
 * mount time (hydrated) and when toggled live.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { store as appStore } from '$store/renderer/store';
import {
  setWorkspaceEntity,
  setWorkspaceHasLoaded,
} from '$store/renderer/slices/workspace/workspace-slice';
import {
  togglePinWorkspace,
  setPinnedWorkspaceIds,
  setAllSpacesViewMode,
} from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
import { WorkspaceStatus, type Workspace, type WorkspaceId } from '$shared/types';
import AllWorkspacesCardHarness from './mocks/AllWorkspacesCardHarness.svelte';
import {
  configuredVisualStates,
  exerciseVisualStates,
} from '$lib/components/__tests__/helpers/visual-state-characterization';

vi.mock('$lib/components/workspace/WorkspaceCard.svelte', async () => ({
  default: (await import('./mocks/MockWorkspaceCard.svelte')).default,
}));

vi.mock('$features/agent/services/active-streams-tracker', () => ({
  activeStreamsTracker: {
    fetchActiveStreams: vi.fn(),
    startPolling: vi.fn(),
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

function renderedCard(id: string): HTMLElement {
  return screen
    .getAllByTestId('workspace-card')
    .find((element) => element.getAttribute('data-workspace-id') === id)!;
}

describe('AllWorkspacesCard pinned-first ordering (Recent view)', () => {
  // The renderer store is a shared singleton and Store.init() is idempotent, so
  // pin state set in one test would otherwise leak into the next. Reset it here.
  afterEach(() => {
    appStore.dispatch(setPinnedWorkspaceIds([]));
    appStore.dispatch(setAllSpacesViewMode('recent'));
  });

  it('affirms the pinned workspace indicator in every required visual state', async () => {
    const observed = await exerciseVisualStates(async () => {
      const view = render(AllWorkspacesCardHarness, {
        props: {
          setup: () => {
            seedWorkspaces();
            appStore.dispatch(setWorkspaceHasLoaded(true));
            appStore.dispatch(setPinnedWorkspaceIds(['ws-oldest']));
          },
        },
      });
      await waitFor(() =>
        expect(renderedCard('ws-oldest').getAttribute('data-pinned')).toBe('true'),
      );
      const target = renderedCard('ws-oldest');
      target.tabIndex = 0;
      return {
        ...view,
        target,
        assertCapability: () => expect(target.getAttribute('data-pinned')).toBe('true'),
      };
    });
    expect(observed).toEqual(configuredVisualStates);
  });

  it('sorts hydrated pinned workspaces to the top on initial render', async () => {
    render(AllWorkspacesCardHarness, {
      props: {
        setup: () => {
          seedWorkspaces();
          appStore.dispatch(setWorkspaceHasLoaded(true));
          appStore.dispatch(togglePinWorkspace('ws-oldest'));
        },
      },
    });

    await waitFor(() => {
      expect(renderedOrder()).toEqual(['ws-oldest', 'ws-newest', 'ws-middle']);
      expect(renderedCard('ws-oldest').getAttribute('data-pinned')).toBe('true');
    });
    expect(document.querySelector('.border-t')).toBeTruthy();
  });

  it('moves a workspace to the top when pinned, and back when unpinned', async () => {
    render(AllWorkspacesCardHarness, {
      props: {
        setup: () => {
          seedWorkspaces();
          appStore.dispatch(setWorkspaceHasLoaded(true));
        },
        expanded: true,
      },
    });

    await waitFor(() => {
      expect(renderedOrder()).toEqual(['ws-newest', 'ws-middle', 'ws-oldest']);
    });

    appStore.dispatch(togglePinWorkspace('ws-oldest'));

    await waitFor(() => {
      expect(renderedOrder()).toEqual(['ws-oldest', 'ws-newest', 'ws-middle']);
      expect(renderedCard('ws-oldest').getAttribute('data-pinned')).toBe('true');
    });
    expect(document.querySelector('.border-t')).toBeTruthy();

    appStore.dispatch(togglePinWorkspace('ws-oldest'));

    await waitFor(() => {
      expect(renderedOrder()).toEqual(['ws-newest', 'ws-middle', 'ws-oldest']);
      expect(renderedCard('ws-oldest').getAttribute('data-pinned')).toBe('false');
    });
    expect(document.querySelector('.border-t')).toBeNull();
  });

  it('preserves pinned presentation in repository, status, and searched rows', async () => {
    const wsExtra = makeWorkspace('ws-extra', 'Extra', '2026-06-07T12:00:00.000Z');
    render(AllWorkspacesCardHarness, {
      props: {
        setup: () => {
          seedWorkspaces();
          appStore.dispatch(setWorkspaceEntity(wsExtra));
          appStore.dispatch(togglePinWorkspace('ws-oldest'));
          appStore.dispatch(setWorkspaceHasLoaded(true));
          appStore.dispatch(setAllSpacesViewMode('repo'));
        },
        expanded: true,
      },
    });

    await waitFor(() => expect(renderedCard('ws-oldest').getAttribute('data-pinned')).toBe('true'));

    const search = await screen.findByPlaceholderText('Search spaces...');
    await fireEvent.input(search, { target: { value: 'Oldest' } });
    await waitFor(() => expect(renderedOrder()).toEqual(['ws-oldest']));
    expect(renderedCard('ws-oldest').getAttribute('data-pinned')).toBe('true');

    appStore.dispatch(setAllSpacesViewMode('status'));
    await waitFor(() => expect(renderedOrder()).toEqual(['ws-oldest']));
    expect(renderedCard('ws-oldest').getAttribute('data-pinned')).toBe('true');
  });
});
