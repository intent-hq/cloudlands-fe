import { principalContextChanged } from '$store/renderer/slices/principal/principal-slice';
import { admitLegacyPrincipal } from '../../../../../test/fixtures/principal-state';
/**
 * SidebarPanel withholds the Chief from a collaborator-only client
 * (multiplayer w3): the daemon answers its `__chief__` calls with not-found,
 * so the card and its Intent tab are never rendered
 * and the workspace list takes the whole panel. The gate is live — when the
 * flag flips true after mount the card unmounts and releases the Chief
 * workspace with `workspaceUnmounted(CHIEF_WORKSPACE_ID)`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import type { Workspace, WorkspaceId } from '$shared/types';
import { WorkspaceStatusEnum } from '$shared/types';
import { CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';
import { LOCAL_CONNECTION_ID } from '$shared/types/connections';
import type { GuestSessionRecord } from '$shared/types/guest-sessions';
import { store as appStore } from '$store/renderer/store';
import { closePanel, openPanel } from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
import { connectionsListReceived } from '$store/renderer/slices/connections/connections-slice';
import { guestSessionsListReceived } from '$store/renderer/slices/guest-sessions/guest-sessions-slice';
import { selectIsGuestWindow } from '$store/renderer/slices/guest-sessions/guest-sessions-selectors';
import {
  replaceWorkspaceList,
  setWorkspaceHasLoaded,
} from '$store/renderer/slices/workspace/workspace-slice';
import { workspaceUnmounted } from '$store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';
import { selectIsCollaboratorOnlyClient } from '$store/renderer/slices/workspace/workspace-selectors';
import * as m from '$shared/paraglide/messages.js';
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
  admitLegacyPrincipal(roles.includes('owner') ? 'owner' : 'guest');
  appStore.dispatch(replaceWorkspaceList(roles.map((role, i) => makeWorkspace(`ws-${i}`, role))));
  appStore.dispatch(setWorkspaceHasLoaded(true));
}

function chiefSurfaces(container: HTMLElement) {
  return {
    card: container.querySelector('[data-combined-panel-chief]'),
    tab: screen.queryByRole('tab', { name: m.layout_chiefCard_title() }),
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

  it('lets an owner client switch between workspace and Intent panes', async () => {
    const { container } = render(SidebarPanelHarness, {
      props: {
        setup: () => {
          loadWorkspaces('collaborator', 'owner');
          appStore.dispatch(openPanel('chief'));
        },
      },
    });

    expect(selectIsCollaboratorOnlyClient.select(appStore.state)).toBe(false);
    const { card, tab, spaces } = chiefSurfaces(container);
    expect(card).not.toBeNull();
    expect(tab?.getAttribute('aria-selected')).toBe('true');
    expect(spaces?.hasAttribute('hidden')).toBe(true);
    await fireEvent.click(
      screen.getByRole('tab', { name: m.layout_sidebarPanel_workspacesTab_label() }),
    );
    await waitFor(() => {
      expect(spaces?.hasAttribute('hidden')).toBe(false);
      expect(card?.hasAttribute('inert')).toBe(true);
    });
  });

  it('falls back to Workspaces for collaborator-only clients even on direct Intent navigation', async () => {
    const { container } = render(SidebarPanelHarness, {
      props: {
        setup: () => {
          loadWorkspaces('collaborator', 'collaborator');
          appStore.dispatch(openPanel('chief'));
        },
      },
    });

    expect(selectIsCollaboratorOnlyClient.select(appStore.state)).toBe(true);
    const { card, tab, spaces } = chiefSurfaces(container);
    expect(card).toBeNull();
    expect(tab).toBeNull();
    expect(spaces).not.toBeNull();
    expect(spaces?.hasAttribute('hidden')).toBe(false);
    expect(spaces?.hasAttribute('inert')).toBe(false);
    expect(screen.getByRole('tab', { selected: true }).getAttribute('aria-controls')).toBe(
      spaces?.id,
    );
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
    expect(chiefSurfaces(container).tab).toBeNull();
    expect(chiefSurfaces(container).spaces?.hasAttribute('hidden')).toBe(false);
    expect(chiefSurfaces(container).spaces?.hasAttribute('inert')).toBe(false);
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining(workspaceUnmounted(CHIEF_WORKSPACE_ID)),
    );

    loadWorkspaces('owner');
    await waitFor(() =>
      expect(chiefSurfaces(container).tab?.getAttribute('aria-selected')).toBe('true'),
    );
    expect(chiefSurfaces(container).card?.hasAttribute('hidden')).toBe(false);
  });
});

/**
 * A guest window (bound to a host this app joined, multiplayer w4) lists only
 * the workspaces shared with it, so its list header reads "All shared
 * workspaces"; an owner window keeps "All workspaces". The title keys off the
 * guest-window identity, not the fail-closed collaborator-only flag, so an
 * owner window never flips it — not even before identity settles.
 */
describe('SidebarPanel workspace-list title in a guest window (multiplayer w4)', () => {
  const GUEST: GuestSessionRecord = {
    id: 'guest-1',
    label: 'tc.example.ts.net',
    host: '10.0.0.9',
    hosts: ['10.0.0.9'],
    port: 8443,
    fingerprint: 'AB:CD',
    tcAddress: 'tc.example.ts.net',
    hostname: 'Host Mac',
    principalId: 'principal-1',
    login: 'octocat',
    tokenEncrypted: true,
    workspaces: [],
    updatedAt: 1,
  };
  const LOCAL_CONNECTION = {
    id: LOCAL_CONNECTION_ID,
    label: 'This machine (local)',
    host: null,
    port: null,
    fingerprint: null,
    isLocal: true,
  };
  const GUEST_CONNECTION = {
    id: GUEST.id,
    label: GUEST.label,
    host: GUEST.host,
    port: GUEST.port,
    fingerprint: GUEST.fingerprint,
    isLocal: false,
  };

  /** Bind the window to the joined host (its backend id is the guest session). */
  function bindWindowToGuest() {
    appStore.dispatch(
      connectionsListReceived({
        connections: [LOCAL_CONNECTION, GUEST_CONNECTION],
        activeId: GUEST.id,
        windowBackendId: GUEST.id,
      }),
    );
    appStore.dispatch(
      guestSessionsListReceived({ sessions: [GUEST], openIds: [], connectedIds: [] }),
    );
  }

  /** Rebind the window to the local backend with no host joined (an owner window). */
  function bindWindowToLocal() {
    appStore.dispatch(
      connectionsListReceived({
        connections: [LOCAL_CONNECTION],
        activeId: LOCAL_CONNECTION_ID,
        windowBackendId: LOCAL_CONNECTION_ID,
      }),
    );
    appStore.dispatch(guestSessionsListReceived({ sessions: [], openIds: [], connectedIds: [] }));
  }

  function panelTitle(container: HTMLElement) {
    return container
      .querySelector('[data-combined-panel-spaces] .panel-title')
      ?.textContent?.trim();
  }

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
    bindWindowToLocal();
    vi.restoreAllMocks();
  });

  // Runs first in this block: `connections.hasReceivedList` has no reset action,
  // so identity is only unsettled before any test here binds the window. The
  // precondition assertion below fails loudly if that ever stops holding.
  it('keeps "All workspaces" while the connected principal is unresolved', async () => {
    const { container } = render(SidebarPanelHarness, {
      props: {
        setup: () => {
          // A host is joined but the connections list has not bound
          // `windowBackendId` yet: identity is unsettled, the collaborator-only
          // flag fails closed, and the title must not follow it.
          appStore.dispatch(
            guestSessionsListReceived({ sessions: [GUEST], openIds: [], connectedIds: [] }),
          );
          loadWorkspaces('owner');
          appStore.dispatch(principalContextChanged(null));
          appStore.dispatch(openPanel('chief'));
        },
      },
    });

    expect(selectIsCollaboratorOnlyClient.select(appStore.state)).toBe(true);
    expect(selectIsGuestWindow.select(appStore.state)).toBe(false);
    expect(panelTitle(container)).toBe(m.layout_sidebarNav_allWorkspaces_title());

    bindWindowToGuest();
    await waitFor(() =>
      expect(panelTitle(container)).toBe(m.layout_sidebarNav_allSharedWorkspaces_title()),
    );
  });

  it('titles the list "All workspaces" in an owner window', () => {
    const { container } = render(SidebarPanelHarness, {
      props: {
        setup: () => {
          loadWorkspaces('collaborator', 'owner');
          appStore.dispatch(openPanel('chief'));
        },
      },
    });

    expect(selectIsGuestWindow.select(appStore.state)).toBe(false);
    expect(panelTitle(container)).toBe(m.layout_sidebarNav_allWorkspaces_title());
  });

  it('titles the list "All shared workspaces" in a guest window', () => {
    const { container } = render(SidebarPanelHarness, {
      props: {
        setup: () => {
          bindWindowToGuest();
          loadWorkspaces('collaborator');
          appStore.dispatch(openPanel('chief'));
        },
      },
    });

    expect(selectIsGuestWindow.select(appStore.state)).toBe(true);
    expect(panelTitle(container)).toBe(m.layout_sidebarNav_allSharedWorkspaces_title());
  });
});
