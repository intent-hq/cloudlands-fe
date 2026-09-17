/**
 * SidebarPanel withholds the Chief from a collaborator-only client
 * (multiplayer w3): the daemon answers its `__chief__` calls with not-found,
 * so the card, its split divider and its collapse toggle are never rendered
 * and the workspace list takes the whole panel. The gate is live — when the
 * flag flips true after mount the card unmounts and releases the Chief
 * workspace with `workspaceUnmounted(CHIEF_WORKSPACE_ID)`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/svelte';
import type { Workspace, WorkspaceId } from '$shared/types';
import { WorkspaceStatusEnum } from '$shared/types';
import { CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';
import { store as appStore } from '$store/renderer/store';
import { closePanel, openPanel } from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
import {
  replaceWorkspaceList,
  setWorkspaceHasLoaded,
} from '$store/renderer/slices/workspace/workspace-slice';
import { workspaceUnmounted } from '$store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';
import { selectIsCollaboratorOnlyClient } from '$store/renderer/slices/workspace/workspace-selectors';
import SidebarPanelHarness from './mocks/SidebarPanelHarness.svelte';

vi.mock('$features/agent/services/active-streams-tracker', () => ({
  activeStreamsTracker: {
    fetchActiveStreams: vi.fn(),
    startPolling: vi.fn(),
    getStreamingAgentIdsForWorkspace: vi.fn(() => []),
    subscribe: vi.fn(() => () => {}),
  },
}));

vi.mock('$lib/electron-bridge', () => ({
  on: vi.fn(),
  off: vi.fn(),
  once: vi.fn(),
  invoke: vi.fn(),
  listenSync: vi.fn(),
}));

function makeWorkspace(id: string, myRole: Workspace['myRole']): Workspace {
  return {
    id: id as WorkspaceId,
    title: id,
    branch: 'main',
    changesets: [],
    timeline: [],
    conversationInfo: [],
    status: WorkspaceStatusEnum.Active,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    myRole,
  } as Workspace;
}

/** Load the workspace list with the given roles (the harness settles an owner window). */
function loadWorkspaces(...roles: Array<Workspace['myRole']>) {
  appStore.dispatch(replaceWorkspaceList(roles.map((role, i) => makeWorkspace(`ws-${i}`, role))));
  appStore.dispatch(setWorkspaceHasLoaded(true));
}

function chiefSurfaces(container: HTMLElement) {
  return {
    card: container.querySelector('[data-combined-panel-chief]'),
    divider: container.querySelector('[data-testid="split-resize-handle"]'),
    toggle: container.querySelector('[data-chief-section-toggle]'),
    spaces: container.querySelector<HTMLElement>('[data-combined-panel-spaces]'),
  };
}

describe('SidebarPanel collaborator-only gate (multiplayer w3)', () => {
  beforeEach(() => {
    global.ResizeObserver = class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    } as any;
    global.MutationObserver = class {
      observe = vi.fn();
      disconnect = vi.fn();
      takeRecords = vi.fn();
    } as any;
  });

  afterEach(() => {
    cleanup();
    appStore.dispatch(closePanel());
    appStore.dispatch(replaceWorkspaceList([]));
    appStore.dispatch(setWorkspaceHasLoaded(false));
    vi.restoreAllMocks();
  });

  it('renders the Chief card, divider and toggle for an owner client', async () => {
    const { container } = render(SidebarPanelHarness, {
      props: {
        setup: () => {
          loadWorkspaces('collaborator', 'owner');
          appStore.dispatch(openPanel('chief'));
        },
      },
    });

    expect(selectIsCollaboratorOnlyClient.select(appStore.state)).toBe(false);
    const { card, divider, toggle, spaces } = chiefSurfaces(container);
    expect(card).not.toBeNull();
    expect(divider).not.toBeNull();
    expect(toggle).not.toBeNull();
    expect(spaces?.style.height).not.toBe('');
  });

  it('withholds the Chief card, divider and toggle from a collaborator-only client; the list takes the panel', async () => {
    const { container } = render(SidebarPanelHarness, {
      props: {
        setup: () => {
          loadWorkspaces('collaborator', 'collaborator');
          appStore.dispatch(openPanel('chief'));
        },
      },
    });

    expect(selectIsCollaboratorOnlyClient.select(appStore.state)).toBe(true);
    const { card, divider, toggle, spaces } = chiefSurfaces(container);
    expect(card).toBeNull();
    expect(divider).toBeNull();
    expect(toggle).toBeNull();
    expect(spaces).not.toBeNull();
    expect(spaces?.style.height).toBe('');
    expect(spaces?.classList.contains('flex-1')).toBe(true);
  });

  it('unmounts the Chief card and releases the Chief workspace when the flag flips true after mount', async () => {
    const { container } = render(SidebarPanelHarness, {
      props: {
        setup: () => {
          loadWorkspaces('collaborator', 'owner');
          appStore.dispatch(openPanel('chief'));
        },
      },
    });
    expect(chiefSurfaces(container).card).not.toBeNull();

    const dispatchSpy = vi.spyOn(appStore, 'dispatch');
    loadWorkspaces('collaborator', 'collaborator');

    await waitFor(() => expect(chiefSurfaces(container).card).toBeNull());
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining(workspaceUnmounted(CHIEF_WORKSPACE_ID)),
    );
  });
});
