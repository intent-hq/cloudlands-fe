import { describe, expect, it } from 'vitest';

import type { StoreState } from '../../types';
import { initialState as githubInitial } from '../github-auth/github-auth-slice';
import { initialState as gitlabInitial } from '../gitlab-auth/gitlab-auth-slice';
import {
  selectEffectiveIdentityProvider,
  selectIdentityError,
  selectIdentityProvider,
  selectIdentityProviderChoosable,
  selectIdentitySaving,
} from './identity-selectors';
import {
  identityChanged,
  identityLoaded,
  identityLoadFailed,
  identityProviderSaved,
  identityProviderSaveFailed,
  identityReducer,
  initializeIdentity,
  initialState,
  setIdentityProviderRequested,
} from './identity-slice';

const gitlabTriple = {
  provider: 'gitlab',
  host: 'gitlab.example.com',
  externalUserId: '7',
} as const;

describe('identity slice', () => {
  it('starts unset and unread', () => {
    expect(identityReducer(undefined, { type: '@@init' })).toEqual(initialState);
    expect(initialState).toEqual({
      provider: null,
      loadStatus: 'idle',
      saving: false,
      error: null,
    });
  });

  it('tracks the read: loading, then the mirrored value or the failure', () => {
    const loading = identityReducer({ ...initialState, error: 'stale' }, initializeIdentity());
    expect(loading).toMatchObject({ loadStatus: 'loading', error: null });

    expect(identityReducer(loading, identityLoaded('gitlab'))).toMatchObject({
      provider: 'gitlab',
      loadStatus: 'loaded',
    });
    expect(identityReducer(loading, identityLoaded(null))).toMatchObject({
      provider: null,
      loadStatus: 'loaded',
    });
    expect(identityReducer(loading, identityLoadFailed())).toMatchObject({ loadStatus: 'error' });
  });

  it('tracks the write: saving, then the new provider or the error with the old one kept', () => {
    const seed = { ...initialState, provider: 'github' as const, loadStatus: 'loaded' as const };
    const saving = identityReducer(
      { ...seed, error: 'stale' },
      setIdentityProviderRequested('gitlab'),
    );
    expect(saving).toMatchObject({ provider: 'github', saving: true, error: null });

    expect(identityReducer(saving, identityProviderSaved('gitlab'))).toMatchObject({
      provider: 'gitlab',
      saving: false,
      loadStatus: 'loaded',
    });
    expect(identityReducer(saving, identityProviderSaveFailed('nope'))).toMatchObject({
      provider: 'github',
      saving: false,
      error: 'nope',
    });
  });

  it('follows principal:identity-changed to the new triple, and to unset on null', () => {
    const rekeyed = identityReducer(
      { ...initialState, provider: 'github', loadStatus: 'loaded' },
      identityChanged(gitlabTriple),
    );
    expect(rekeyed.provider).toBe('gitlab');
    expect(identityReducer(rekeyed, identityChanged(null)).provider).toBeNull();
  });
});

describe('identity selectors', () => {
  function state(
    identity: Partial<typeof initialState>,
    forges: { github?: boolean; gitlab?: boolean } = {},
  ) {
    return {
      identity: { ...initialState, ...identity },
      githubAuth: { ...githubInitial, isAuthenticated: forges.github ?? false },
      gitlabAuth: { ...gitlabInitial, isConfigured: forges.gitlab ?? false },
    } as StoreState;
  }

  it('exposes the raw setting, the save flag and the error', () => {
    const s = state({ provider: 'gitlab', saving: true, error: 'x' });
    expect(selectIdentityProvider.select(s)).toBe('gitlab');
    expect(selectIdentitySaving.select(s)).toBe(true);
    expect(selectIdentityError.select(s)).toBe('x');
  });

  it('resolves the effective forge like the daemon: explicit pick when connected, else implied', () => {
    const both = { github: true, gitlab: true };
    expect(selectEffectiveIdentityProvider.select(state({ provider: 'gitlab' }, both))).toBe(
      'gitlab',
    );
    expect(selectEffectiveIdentityProvider.select(state({ provider: 'github' }, both))).toBe(
      'github',
    );
    // Unset: GitHub wins when connected, else GitLab.
    expect(selectEffectiveIdentityProvider.select(state({}, both))).toBe('github');
    expect(selectEffectiveIdentityProvider.select(state({}, { gitlab: true }))).toBe('gitlab');
    // A setting naming a forge that is no longer connected falls back to the connected one.
    expect(
      selectEffectiveIdentityProvider.select(state({ provider: 'gitlab' }, { github: true })),
    ).toBe('github');
    expect(selectEffectiveIdentityProvider.select(state({ provider: 'gitlab' }))).toBeNull();
  });

  it('offers the choice only with both forges connected', () => {
    expect(selectIdentityProviderChoosable.select(state({}, { github: true, gitlab: true }))).toBe(
      true,
    );
    expect(selectIdentityProviderChoosable.select(state({}, { github: true }))).toBe(false);
    expect(selectIdentityProviderChoosable.select(state({}, { gitlab: true }))).toBe(false);
  });
});
