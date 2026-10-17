/** @vitest-environment jsdom */
import { tick } from 'svelte';
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
    },
    userPreferences: { ...preferenceDefaults, labsGitLabEnabled: true },
    identity: identityDefaults,
    githubAuth: { isAuthenticated: false },
    gitlabAuth: gitlabDefaults,
    githubUserSearch: searchDefaults,
    daemonHealth: { stats: { protocolVersion: '10.8' } }, // protocol-version-ok: identity-seam fixture.
  });
});

it.each([true, false])(
  'keeps generic account setup on Connections when GitLab is enabled=%s at activation',
  async (enabled) => {
    render(ShareWorkspaceDialogHost);
    const link = screen.getByRole('button', { name: 'Open Connections' });
    mocks.state.userPreferences = { ...preferenceDefaults, labsGitLabEnabled: enabled };
    mocks.dispatch.mockClear();
    await fireEvent.click(link);
    expect(mocks.navigate).toHaveBeenCalledExactlyOnceWith({
      tab: 'connections',
      hash: 'integrations',
    });
    expect(mocks.dispatch).toHaveBeenCalledExactlyOnceWith(closeShareDialog());
  },
);

it.each(['guest', 'unresolved'] as const)(
  'withholds a stale Connections action after authority becomes %s',
  async (role) => {
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

function setupState(enabling: boolean) {
  const share = mocks.state.workspaceShare as WorkspaceShareState;
  const target = {
    workspaceId: 'ws-1',
    session: share.session,
    authority: selectPrincipalActionContext.select(mocks.state as unknown as StoreState),
  };
  mocks.state.workspaceShare = workspaceShareReducer(
    share,
    sharePrerequisitesStarted({ target, enabling }),
  );
  return target;
}

it('dispatches inline enable without closing the dialog or navigating', async () => {
  const target = setupState(false);
  mocks.state.workspaceShare = workspaceShareReducer(
    mocks.state.workspaceShare as WorkspaceShareState,
    sharePrerequisitesSettled({ target, enabled: false, error: null }),
  );
  render(ShareWorkspaceDialogHost);
  mocks.dispatch.mockClear();
  await fireEvent.click(screen.getByRole('switch', { name: 'Enable sharing' }));
  expect(mocks.dispatch).toHaveBeenCalledExactlyOnceWith(shareEnableRequested());
  expect(mocks.navigate).not.toHaveBeenCalled();
});

it('forwards checking and enabling progress and removes setup after success', async () => {
  const target = setupState(false);
  render(ShareWorkspaceDialogHost);
  expect(
    (screen.getByRole('switch', { name: 'Enable sharing' }) as HTMLButtonElement).disabled,
  ).toBe(true);
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
  const target = setupState(false);
  mocks.state.workspaceShare = workspaceShareReducer(
    mocks.state.workspaceShare as WorkspaceShareState,
    sharePrerequisitesSettled({ target, enabled: false, error: null }),
  );
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
    const target = setupState(false);
    mocks.state.workspaceShare = workspaceShareReducer(
      mocks.state.workspaceShare as WorkspaceShareState,
      sharePrerequisitesSettled({ target, enabled: false, error: null }),
    );
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
