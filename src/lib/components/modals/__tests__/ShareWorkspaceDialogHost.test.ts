/** @vitest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/svelte';
import { beforeEach, expect, it, vi } from 'vitest';
import {
  initialState as shareDefaults,
  closeShareDialog,
} from '$store/renderer/slices/workspace-share/workspace-share-slice';
import { initialState as preferenceDefaults } from '$store/renderer/slices/user-preferences/user-preferences-slice';
import { initialState as identityDefaults } from '$store/renderer/slices/identity/identity-slice';
import { initialState as gitlabDefaults } from '$store/renderer/slices/gitlab-auth/gitlab-auth-slice';
import { initialState as searchDefaults } from '$store/renderer/slices/github-user-search/github-user-search-slice';

const mocks = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  dispatch: vi.fn(),
  navigate: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({ state: () => mocks.state, dispatch: mocks.dispatch });
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
  mocks.state = {
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
  };
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
