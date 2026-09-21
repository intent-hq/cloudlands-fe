/**
 * @vitest-environment jsdom
 *
 * WorkspaceCard context-menu owner gating (multiplayer w4).
 *
 * The daemon refuses Transfer/Download, Archive and Delete for a collaborator
 * (`require_owner` → -32003), so a collaborator row's right-click menu omits
 * them — and opens no menu at all when nothing else remains — while an owner
 * row keeps the full menu. No Leave entry is added (leaving lives in Settings).
 *
 * The gate is the production `selectHidesOwnerWorkspaceActions`, driven by
 * store state built through the real reducers, so the guest-window case
 * reproduces the observed state: the window bound to a joined host whose row
 * the daemon reports as `owner` (the host owner's own GitHub account joined
 * its own invite).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import type { Workspace } from '$shared/types';
import { WorkspaceStatus } from '$shared/types';
import type { StoreState } from '$store/renderer/store';
import {
  initialState as workspaceInitialState,
  setWorkspaceEntity,
  workspaceReducer,
} from '$store/renderer/slices/workspace/workspace-slice';
import {
  connectionsListReceived,
  connectionsReducer,
  initialState as connectionsInitialState,
} from '$store/renderer/slices/connections/connections-slice';
import {
  guestSessionsListReceived,
  guestSessionsReducer,
  initialState as guestSessionsInitialState,
} from '$store/renderer/slices/guest-sessions/guest-sessions-slice';
import type { GuestSessionRecord } from '$store/renderer/slices/guest-sessions/guest-sessions-types';
import { createTestWorkspaceId } from '../../../../test/factories/workspace.factory';

const mocks = vi.hoisted(() => {
  const dispatch = vi.fn();
  const storeState: { current: unknown } = { current: {} };

  const readable = <T>(value: T) => ({
    subscribe(run: (v: T) => void) {
      run(value);
      return () => {};
    },
  });

  const selector = <T>(getter: (state: any, ...args: any[]) => T) =>
    Object.assign((...args: any[]) => readable(getter(storeState.current, ...args)), {
      select: (s: any, ...a: any[]) => getter(s ?? storeState.current, ...a),
    });

  return { dispatch, storeState, readable, selector };
});
const pageState = vi.hoisted(() => ({ url: new URL('http://localhost/') }));

vi.mock('$app/state', () => ({ page: pageState }));

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({
    state: () => mocks.storeState.current,
    dispatch: mocks.dispatch,
  });
});

vi.mock('$store/renderer/slices/workspace-tasks/workspace-tasks-selectors', () => ({
  selectWorkspaceTasksLoading: mocks.selector(() => false),
  selectWorkspaceTaskProgress: mocks.selector(() => ({ total: 0, completed: 0 })),
}));

vi.mock('$store/renderer/slices/workspace-tasks/workspace-tasks-slice', () => ({
  ensureWorkspaceTasksLoaded: vi.fn((id) => ({
    type: 'workspace-tasks/ensureLoaded',
    payload: id,
  })),
}));

vi.mock('$store/renderer/slices/workspace/workspace-selectors', async () => {
  const actual = await vi.importActual<
    typeof import('$store/renderer/slices/workspace/workspace-selectors')
  >('$store/renderer/slices/workspace/workspace-selectors');
  return { ...actual, selectWorkspaceActivePullRequest: mocks.selector(() => null) };
});

vi.mock('$store/renderer/slices/pr-monitor/pr-monitor-selectors', () => ({
  selectPrMonitors: mocks.selector(() => []),
}));

vi.mock('$lib/components/workspace/WorkspaceHoverCard.svelte', async () => ({
  default: (await import('../sidebar/__tests__/mocks/MockSimple.svelte')).default,
}));

import WorkspaceCard from '../WorkspaceCard.svelte';
import { appStore } from '$store/renderer/store';

function makeWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: createTestWorkspaceId(),
    title: 'Test Workspace',
    branch: 'main',
    changesets: [],
    timeline: [],
    conversationInfo: [],
    status: WorkspaceStatus.Active,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    activity: 'idle',
    displayStatus: 'idle',
    agentSummary: { agentIds: [], hasActiveAgents: false },
    ...overrides,
  } as Workspace;
}

const GUEST_SESSION: GuestSessionRecord = {
  id: 'guest-1',
  label: 'studio.local',
  host: '10.0.0.5',
  hosts: ['10.0.0.5'],
  port: 8443,
  fingerprint: 'AB:CD',
  tcAddress: null,
  hostname: 'studio.local',
  principalId: 'prin-guest',
  login: 'octocat',
  tokenEncrypted: true,
  updatedAt: 1,
};

/**
 * Store state holding `workspace` as the daemon listed it, in a window bound
 * to `backendId`: the local default (owner window) or `GUEST_SESSION.id` (a
 * window opened for a host joined as a guest). `PRE_BIND` leaves the
 * connections list unreceived: the guest list knows a joined host but the
 * window's backend id is still the boot-time default, so its identity has
 * not settled.
 */
const PRE_BIND = Symbol('pre-bind');
function seedState(workspace: Workspace, backendId: string | typeof PRE_BIND = 'local'): void {
  mocks.storeState.current = {
    workspace: workspaceReducer(workspaceInitialState, setWorkspaceEntity(workspace)),
    connections:
      backendId === PRE_BIND
        ? connectionsInitialState
        : connectionsReducer(
            connectionsInitialState,
            connectionsListReceived({
              connections: [],
              activeId: backendId,
              windowBackendId: backendId,
            }),
          ),
    guestSessions: guestSessionsReducer(
      guestSessionsInitialState,
      guestSessionsListReceived({ sessions: [GUEST_SESSION], openIds: [], connectedIds: [] }),
    ),
  } as StoreState;
}

async function openContextMenu(
  workspace: Workspace,
  onOpenInNewWindow?: () => void,
  backendId?: string | typeof PRE_BIND,
) {
  seedState(workspace, backendId);
  const { container } = render(WorkspaceCard, { props: { workspace, onOpenInNewWindow } });
  // The card binds its workspace id in a post-mount effect; the store mock's
  // readables evaluate once at subscribe time, so re-notify them the way the
  // selector runtime would on that id change.
  await tick();
  (appStore as unknown as { emitState: () => void }).emitState();
  const row = container.querySelector('[data-workspace-card-row]')!;
  expect(row).toBeTruthy();
  await fireEvent.contextMenu(row);
  return container;
}

const menuItemNames = () =>
  screen.queryAllByRole('menuitem').map((item) => item.textContent?.trim() ?? '');

beforeEach(() => {
  cleanup();
  mocks.dispatch.mockClear();
  mocks.storeState.current = {};
});

describe('WorkspaceCard context menu owner gating', () => {
  it('offers Transfer, Archive and Delete to the workspace owner', async () => {
    await openContextMenu(makeWorkspace({ myRole: 'owner' }), vi.fn());

    expect(screen.getByRole('menu')).toBeTruthy();
    expect(menuItemNames()).toEqual([
      'Open in New Window',
      'Transfer/Download…',
      'Archive',
      'Delete Workspace…',
    ]);
  });

  it('hides the owner-only actions from a collaborator and keeps the rest', async () => {
    const onOpenInNewWindow = vi.fn();
    await openContextMenu(makeWorkspace({ myRole: 'collaborator' }), onOpenInNewWindow);

    expect(menuItemNames()).toEqual(['Open in New Window']);
    expect(screen.queryByRole('menuitem', { name: /leave/i })).toBeNull();

    await fireEvent.click(screen.getByRole('menuitem', { name: 'Open in New Window' }));
    expect(onOpenInNewWindow).toHaveBeenCalledOnce();
    expect(mocks.dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: expect.stringMatching(/workspaceTransfer|delete|archive/i) }),
    );
  });

  it('opens no menu for a collaborator row when nothing would remain', async () => {
    const container = await openContextMenu(makeWorkspace({ myRole: 'collaborator' }));

    expect(screen.queryByRole('menu')).toBeNull();
    expect(container.querySelector('[role="menuitem"]')).toBeNull();
  });

  // Reproduces the r12 guest-window state (same GitHub account on host and
  // guest): the window is bound to a joined host and the daemon reports the
  // row as `owner`. A guest window is never an owner seat, so the menu must
  // not offer Transfer/Archive/Delete whatever `myRole` says.
  it.each(['owner', undefined] as const)(
    'hides the owner-only actions in a guest window when the row reports myRole %s',
    async (myRole) => {
      const onOpenInNewWindow = vi.fn();
      await openContextMenu(makeWorkspace({ myRole }), onOpenInNewWindow, GUEST_SESSION.id);

      expect(menuItemNames()).toEqual(['Open in New Window']);
      expect(mocks.dispatch).not.toHaveBeenCalledWith(
        expect.objectContaining({
          type: expect.stringMatching(/workspaceTransfer|delete|archive/i),
        }),
      );
    },
  );

  // Boot order: the guest list has arrived with a joined host but the
  // connections list has not bound the window's backend id yet, so the
  // window cannot be told apart from a guest one. The row reporting `owner`
  // must not make the actions flash before the identity settles.
  it('hides the owner-only actions before the window backend binding lands, even for a row reporting myRole owner', async () => {
    await openContextMenu(makeWorkspace({ myRole: 'owner' }), vi.fn(), PRE_BIND);

    expect(menuItemNames()).toEqual(['Open in New Window']);
  });

  it('keeps the full menu in an owner window that merely knows a joined host', async () => {
    await openContextMenu(makeWorkspace({ myRole: 'owner' }), vi.fn(), 'local');

    expect(menuItemNames()).toEqual([
      'Open in New Window',
      'Transfer/Download…',
      'Archive',
      'Delete Workspace…',
    ]);
  });
});
