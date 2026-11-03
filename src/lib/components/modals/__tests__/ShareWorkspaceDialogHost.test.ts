/** @vitest-environment jsdom */
import { tick } from 'svelte';
import { createCollection } from '@themislib/themis/utils/collections/collection-utils';
import type { WorkspaceMember } from '$features/workspace-sharing/types';
import { selectPrincipalActionContext } from '$store/renderer/slices/principal/principal-selectors';
import type { StoreState } from '$store/renderer/types';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { beforeEach, expect, it, vi } from 'vitest';
import { withLegacyPrincipal } from '../../../../test/fixtures/principal-state';
import { initialState as principalDefaults } from '$store/renderer/slices/principal/principal-slice';
import {
  initialState as shareDefaults,
  closeShareDialog,
  shareEnableRequested,
  sharePrerequisitesStarted,
  sharePrerequisitesSettled,
  workspaceShareReducer,
  type WorkspaceShareState,
} from '$store/renderer/slices/workspace-share/workspace-share-slice';
import { initialState as preferenceDefaults } from '$store/renderer/slices/user-preferences/user-preferences-slice';
import { initialState as identityDefaults } from '$store/renderer/slices/identity/identity-slice';
import { initialState as gitlabDefaults } from '$store/renderer/slices/gitlab-auth/gitlab-auth-slice';
import { initialState as searchDefaults } from '$store/renderer/slices/github-user-search/github-user-search-slice';
import { CURRENT_PROTOCOL_VERSION } from '../../../../test/current-protocol-version';

const mocks = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  dispatch: vi.fn(),
  emitState: () => {},
  navigate: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  const module = createAppStoreMockModule({ state: () => mocks.state, dispatch: mocks.dispatch });
  mocks.emitState = module.store.emitState;
  return module;
});
vi.mock('$store/renderer/slices/workspace/workspace-selectors', () => ({
  selectIsWorkspaceOwner: { select: () => true },
  selectWorkspaceById: { select: () => ({ ownerPrincipalId: 'principal' }) },
  selectCanShareWorkspace: { select: () => true },
}));
vi.mock('$lib/utils/workspace-navigation', () => ({ navigateToSettings: mocks.navigate }));
vi.mock('svelte-fa', async () => ({
  default: (await import('$lib/components/ui/__tests__/mocks/Fa.svelte')).default,
}));

import ShareWorkspaceDialogHost from '../ShareWorkspaceDialogHost.svelte';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.state = withLegacyPrincipal({
    workspaceShare: {
      ...shareDefaults,
      open: true,
      workspaceId: 'ws-1',
      workspaceTitle: 'Workspace',
      integrationAuthLoaded: true,
      loadStatus: 'loaded',
    },
    userPreferences: { ...preferenceDefaults },
    identity: identityDefaults,
    githubAuth: { isAuthenticated: false },
    gitlabAuth: gitlabDefaults,
    githubUserSearch: searchDefaults,
    daemonHealth: { stats: { protocolVersion: CURRENT_PROTOCOL_VERSION } }, // protocol-version-ok: identity-seam fixture.
  });
});

/** `forge: false` leaves the owner without a forge, so the connect box shows. */
function setupState(enabling: boolean, forge = true) {
  const share = mocks.state.workspaceShare as WorkspaceShareState;
  const target = {
    workspaceId: 'ws-1',
    session: share.session,
    authority: selectPrincipalActionContext.select(mocks.state as unknown as StoreState),
  };
  mocks.state.workspaceShare = {
    ...workspaceShareReducer(share, sharePrerequisitesStarted({ target, enabling })),
    // Sharing setup follows the connect box: the owner has a forge here.
    integrationAuth: { github: forge, gitlab: false },
  };
  return target;
}

function settledState(enabled: boolean, forge = true) {
  const target = setupState(false, forge);
  mocks.state.workspaceShare = workspaceShareReducer(
    mocks.state.workspaceShare as WorkspaceShareState,
    sharePrerequisitesSettled({ target, enabled, error: null }),
  );
  return target;
}

it('keeps generic account setup on Connections', async () => {
  settledState(false, false);
  render(ShareWorkspaceDialogHost);
  const link = screen.getByRole('button', { name: 'Open Connections' });
  mocks.dispatch.mockClear();
  await fireEvent.click(link);
  expect(mocks.navigate).toHaveBeenCalledExactlyOnceWith({
    tab: 'connections',
    hash: 'integrations',
  });
  expect(mocks.dispatch).toHaveBeenCalledExactlyOnceWith(closeShareDialog());
});

it.each(['guest', 'unresolved'] as const)(
  'withholds a stale Connections action after authority becomes %s',
  async (role) => {
    settledState(false, false);
    render(ShareWorkspaceDialogHost);
    const link = screen.getByRole('button', { name: 'Open Connections' });
    mocks.state = withLegacyPrincipal(mocks.state, 'guest');
    if (role === 'unresolved') mocks.state.principal = principalDefaults;
    mocks.dispatch.mockClear();
    await fireEvent.click(link);
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(mocks.dispatch).not.toHaveBeenCalledWith(closeShareDialog());
  },
);

it('dispatches inline enable without closing the dialog or navigating', async () => {
  settledState(false);
  render(ShareWorkspaceDialogHost);
  mocks.dispatch.mockClear();
  await fireEvent.click(screen.getByRole('switch', { name: 'Enable sharing' }));
  expect(mocks.dispatch).toHaveBeenCalledExactlyOnceWith(shareEnableRequested());
  expect(mocks.navigate).not.toHaveBeenCalled();
});

it('shows a loading placeholder, not the forge or setup cards, until the first answers arrive', async () => {
  mocks.state.workspaceShare = {
    ...(mocks.state.workspaceShare as WorkspaceShareState),
    integrationAuthLoaded: false,
  };
  render(ShareWorkspaceDialogHost);
  expect(screen.getByRole('status', { name: 'Loading…' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Open Connections' })).toBeNull();
  expect(screen.queryByRole('switch', { name: 'Enable sharing' })).toBeNull();
  mocks.state.workspaceShare = {
    ...(mocks.state.workspaceShare as WorkspaceShareState),
    integrationAuthLoaded: true,
  };
  setupState(false);
  mocks.emitState();
  await tick();
  expect(screen.getByRole('status', { name: 'Loading…' })).toBeTruthy();
  expect(screen.queryByRole('switch', { name: 'Enable sharing' })).toBeNull();
  settledState(false);
  mocks.emitState();
  await tick();
  // The owner has a forge here, so the settled dialog goes straight to setup.
  expect(screen.queryByRole('status', { name: 'Loading…' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Open Connections' })).toBeNull();
  expect(screen.getByRole('switch', { name: 'Enable sharing' })).toBeTruthy();
});

it('forwards enabling progress and removes setup after success', async () => {
  const target = settledState(false);
  render(ShareWorkspaceDialogHost);
  expect(
    (screen.getByRole('switch', { name: 'Enable sharing' }) as HTMLButtonElement).disabled,
  ).toBe(false);
  setupState(true);
  mocks.emitState();
  await tick();
  expect(
    (screen.getByRole('switch', { name: 'Enable sharing' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  mocks.state.workspaceShare = workspaceShareReducer(
    mocks.state.workspaceShare as WorkspaceShareState,
    sharePrerequisitesSettled({ target, enabled: true, error: null }),
  );
  mocks.emitState();
  await tick();
  expect(screen.queryByRole('switch', { name: 'Enable sharing' })).toBeNull();
});

it('refuses a stale inline enable control after host administration is lost', async () => {
  settledState(false);
  render(ShareWorkspaceDialogHost);
  const control = screen.getByRole('switch', { name: 'Enable sharing' });
  mocks.state = withLegacyPrincipal(mocks.state, 'guest');
  mocks.dispatch.mockClear();
  await fireEvent.click(control);
  expect(mocks.dispatch).not.toHaveBeenCalledWith(shareEnableRequested());
});

it.each(['backend', 'identity', 'session'])(
  'refuses a stale inline enable control after %s changes',
  async (change) => {
    settledState(false);
    render(ShareWorkspaceDialogHost);
    const control = screen.getByRole('switch', { name: 'Enable sharing' });
    const root = mocks.state as unknown as StoreState;
    if (change === 'backend')
      mocks.state = withLegacyPrincipal({
        ...root,
        connections: { ...root.connections, windowBackendId: 'new-host' },
      });
    if (change === 'identity') mocks.state.principal = { ...root.principal, invalidation: 1 };
    if (change === 'session') mocks.state.workspaceShare = { ...root.workspaceShare, session: 2 };
    mocks.dispatch.mockClear();
    await fireEvent.click(control);
    expect(mocks.dispatch).not.toHaveBeenCalledWith(shareEnableRequested());
  },
);

it.each([undefined, false, true])(
  'forwards guest role capability %s with confirmed values and row errors',
  async (supported) => {
    const root = mocks.state as unknown as StoreState;
    mocks.state.principal = {
      ...root.principal,
      snapshot: {
        ...root.principal.snapshot!,
        capabilities: { ...root.principal.snapshot!.capabilities, workspaceGuestRoles: supported },
      },
    };
    const member: WorkspaceMember = {
      principalId: 'guest',
      role: 'collaborator',
      hostRole: 'guest',
      login: 'alex',
      displayName: 'Alex',
      avatarUrl: null,
      addedAt: '2026-10-21T00:00:00Z',
    };
    mocks.state.workspaceShare = {
      ...root.workspaceShare,
      members: createCollection('principalId', [member]),
      pendingRolePrincipalIds: ['guest'],
    };
    settledState(true);
    render(ShareWorkspaceDialogHost);
    const trigger = screen.queryByRole('button', {
      name: 'Role for Alex',
    }) as HTMLButtonElement | null;
    if (!supported) {
      expect(trigger).toBeNull();
      return;
    }
    expect(trigger?.disabled).toBe(true);
    expect(trigger?.textContent).toContain('Participant');
    mocks.state.workspaceShare = {
      ...(mocks.state.workspaceShare as WorkspaceShareState),
      pendingRolePrincipalIds: [],
      roleErrors: { guest: 'Could not change this role. Try again.' },
    };
    mocks.emitState();
    await tick();
    expect(trigger?.disabled).toBe(false);
    expect(trigger?.textContent).toContain('Participant');
    expect(screen.getByRole('alert').textContent).toContain('Could not change this role');
  },
);
