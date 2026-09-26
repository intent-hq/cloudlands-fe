/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initialState as preferenceDefaults } from '$store/renderer/slices/user-preferences/user-preferences-slice';
import {
  initialState as identityDefaults,
  initializeIdentity,
  setIdentityProviderRequested,
} from '$store/renderer/slices/identity/identity-slice';
import {
  initialState as gitlabDefaults,
  initializeGitLabAuth,
} from '$store/renderer/slices/gitlab-auth/gitlab-auth-slice';
import { initializeGitHubAuth } from '$store/renderer/slices/github-auth/github-auth-slice';
import { initialState as guestSessionsDefaults } from '$store/renderer/slices/guest-sessions/guest-sessions-slice';
import { initialState as connectionDefaults } from '$store/renderer/slices/connections/connections-slice';
import { initialState as workspaceDefaults } from '$store/renderer/slices/workspace/workspace-slice';

const mocks = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  dispatch: vi.fn(),
  confirm: vi.fn(),
  collaboratorOnly: false,
}));
vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({ state: () => mocks.state, dispatch: mocks.dispatch });
});
vi.mock('$lib/components/patterns/confirm', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/components/patterns/confirm')>()),
  confirm: mocks.confirm,
}));
vi.mock('$store/renderer/slices/workspace/workspace-selectors', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('$store/renderer/slices/workspace/workspace-selectors')
  >()),
  selectIsCollaboratorOnlyClient: () => ({
    subscribe: (run: (value: boolean) => void) => {
      run(mocks.collaboratorOnly);
      return () => {};
    },
  }),
}));
vi.mock('svelte-fa', async () => ({
  default: (await import('$lib/components/ui/__tests__/mocks/Fa.svelte')).default,
}));

import ForgeIdentityChoice from './ForgeIdentityChoice.svelte';
import GuestSessionsSettings from './GuestSessionsSettings.svelte';

const gitlabIdentity = {
  provider: 'gitlab' as const,
  host: 'gitlab.example.com',
  externalUserId: '7',
};

async function enableGitLab(enabled: boolean) {
  mocks.state.userPreferences = { ...preferenceDefaults, labsGitLabEnabled: enabled };
  const { appStore } = (await import('$store/renderer/store')) as unknown as {
    appStore: { emitState: () => void };
  };
  appStore.emitState();
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.collaboratorOnly = false;
  mocks.confirm.mockResolvedValue(true);
  mocks.state = {
    userPreferences: preferenceDefaults,
    guestSessions: { ...guestSessionsDefaults, hasReceivedList: true },
    connections: connectionDefaults,
    workspace: workspaceDefaults,
    identity: { ...identityDefaults, provider: 'github' },
    githubAuth: { isAuthenticated: true, user: { login: 'octocat' } },
    gitlabAuth: {
      ...gitlabDefaults,
      isConfigured: true,
      host: gitlabIdentity.host,
      user: { id: '7', login: 'mara' },
      method: 'pat',
    },
    daemonHealth: { stats: { protocolVersion: '10.8' } }, // protocol-version-ok: identity-seam fixture.
  };
});

describe('identity choice in Guest Sessions', () => {
  it.each([false, true])(
    'loads both accounts on a direct visit and honors switch confirmation %s',
    async (confirmed) => {
      const connected = { ...mocks.state };
      mocks.state.githubAuth = { isAuthenticated: false, user: null };
      mocks.state.gitlabAuth = gitlabDefaults;
      mocks.state.identity = identityDefaults;
      await enableGitLab(true);
      render(GuestSessionsSettings);

      for (const action of [initializeGitHubAuth(), initializeGitLabAuth(), initializeIdentity()]) {
        expect(mocks.dispatch.mock.calls.filter(([sent]) => sent.type === action.type)).toEqual([
          [action],
        ]);
      }
      expect(screen.queryByTestId('forge-identity')).toBeNull();
      mocks.state.githubAuth = connected.githubAuth;
      mocks.state.gitlabAuth = connected.gitlabAuth;
      mocks.state.identity = connected.identity;
      await enableGitLab(true);

      mocks.confirm.mockResolvedValueOnce(confirmed);
      await fireEvent.click(await screen.findByTestId('forge-identity-option-gitlab'));
      expect(mocks.confirm).toHaveBeenCalledOnce();
      if (confirmed) {
        await waitFor(() =>
          expect(mocks.dispatch).toHaveBeenCalledWith(setIdentityProviderRequested('gitlab')),
        );
      } else {
        expect(mocks.dispatch).not.toHaveBeenCalledWith(setIdentityProviderRequested('gitlab'));
      }
    },
  );

  it('withholds the identity controls and their loads from collaborator-only clients', () => {
    mocks.collaboratorOnly = true;
    render(GuestSessionsSettings);
    expect(screen.queryByTestId('forge-identity')).toBeNull();
    expect(mocks.dispatch).not.toHaveBeenCalledWith(initializeIdentity());
    expect(mocks.dispatch).not.toHaveBeenCalledWith(initializeGitHubAuth());
    expect(mocks.dispatch).not.toHaveBeenCalledWith(initializeGitLabAuth());
  });
});

describe('GitLab Labs identity choices', () => {
  it('offers a new GitLab identity only after opting in and confirming', async () => {
    render(ForgeIdentityChoice);
    expect(screen.queryByTestId('forge-identity-option-gitlab')).toBeNull();
    await enableGitLab(true);
    await fireEvent.click(await screen.findByTestId('forge-identity-option-gitlab'));
    await waitFor(() =>
      expect(mocks.dispatch).toHaveBeenCalledWith(setIdentityProviderRequested('gitlab')),
    );
    expect(mocks.confirm).toHaveBeenCalledOnce();
  });

  it('does not change a saved GitLab identity or credentials when the lab is disabled', async () => {
    mocks.state.identity = {
      ...identityDefaults,
      provider: 'gitlab',
      currentIdentity: gitlabIdentity,
      currentLogin: 'mara',
    };
    const saved = structuredClone(mocks.state);
    render(GuestSessionsSettings);
    expect(screen.getByTestId('forge-identity-current').getAttribute('data-provider')).toBe(
      'gitlab',
    );
    expect(screen.getByTestId('forge-identity-option-gitlab').hasAttribute('disabled')).toBe(true);
    expect(mocks.state).toEqual(saved);
    expect(mocks.dispatch).not.toHaveBeenCalledWith(setIdentityProviderRequested('github'));
    await fireEvent.click(screen.getByTestId('forge-identity-option-github'));
    await waitFor(() =>
      expect(mocks.dispatch).toHaveBeenCalledWith(setIdentityProviderRequested('github')),
    );
  });

  it('does not submit a GitLab switch if the lab is turned off during confirmation', async () => {
    let finish!: (value: boolean) => void;
    mocks.confirm.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    );
    await enableGitLab(true);
    render(ForgeIdentityChoice);
    await fireEvent.click(screen.getByTestId('forge-identity-option-gitlab'));
    await enableGitLab(false);
    finish(true);
    await Promise.resolve();
    expect(mocks.dispatch).not.toHaveBeenCalledWith(setIdentityProviderRequested('gitlab'));
  });
});
