/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initialState as preferenceDefaults } from '$store/renderer/slices/user-preferences/user-preferences-slice';
import {
  initialState as identityDefaults,
  setIdentityProviderRequested,
} from '$store/renderer/slices/identity/identity-slice';
import { initialState as gitlabDefaults } from '$store/renderer/slices/gitlab-auth/gitlab-auth-slice';

const mocks = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  dispatch: vi.fn(),
  confirm: vi.fn(),
}));
vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({ state: () => mocks.state, dispatch: mocks.dispatch });
});
vi.mock('$lib/components/patterns/confirm', () => ({ confirm: mocks.confirm }));
vi.mock('svelte-fa', async () => ({
  default: (await import('$lib/components/ui/__tests__/mocks/Fa.svelte')).default,
}));

import ForgeIdentityChoice from './ForgeIdentityChoice.svelte';

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
  mocks.confirm.mockResolvedValue(true);
  mocks.state = {
    userPreferences: preferenceDefaults,
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
    render(ForgeIdentityChoice);
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
