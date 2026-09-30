import { describe, expect, it } from 'vitest';

import type { StoreState } from '../../types';
import { initialState as githubInitial } from '../github-auth/github-auth-slice';
import { initialState as gitlabInitial } from '../gitlab-auth/gitlab-auth-slice';
import {
  selectAnyIdentityForgeConnected,
  selectCurrentIdentity,
  selectCurrentIdentityLogin,
  selectEffectiveIdentityProvider,
  selectIdentityError,
  selectIdentityLoadStatus,
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
  principalLoaded,
  setIdentityProviderRequested,
} from './identity-slice';

const gitlabTriple = {
  provider: 'gitlab',
  host: 'gitlab.example.com',
  externalUserId: '7',
} as const;

const githubTriple = { provider: 'github', host: 'github.com', externalUserId: '42' } as const;

describe('identity slice', () => {
  it('starts unset, unlinked and unread', () => {
    expect(identityReducer(undefined, { type: '@@init' })).toEqual(initialState);
    expect(initialState).toEqual({
      provider: null,
      currentIdentity: null,
      currentLogin: null,
      principalLoaded: false,
      loadStatus: 'idle',
      saving: false,
      error: null,
    });
  });

  it('hydrates the authoritative identity from principal.me, unlinked as null', () => {
    const linked = identityReducer(initialState, principalLoaded(gitlabTriple, 'gl-user'));
    expect(linked).toMatchObject({
      currentIdentity: gitlabTriple,
      currentLogin: 'gl-user',
      principalLoaded: true,
    });
    expect(identityReducer(linked, principalLoaded(null, null))).toMatchObject({
      currentIdentity: null,
      currentLogin: null,
      principalLoaded: true,
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

  it('follows principal:identity-changed to the new triple, leaving the setting alone, and unlinks on null', () => {
    const seed = {
      ...initialState,
      provider: 'github' as const,
      currentIdentity: githubTriple,
      currentLogin: 'octocat',
      principalLoaded: true,
      loadStatus: 'loaded' as const,
    };
    const rekeyed = identityReducer(seed, identityChanged(gitlabTriple));
    // The setting is the daemon's; only its `settings.get` / the save echo moves it.
    expect(rekeyed).toMatchObject({
      provider: 'github',
      currentIdentity: gitlabTriple,
      currentLogin: 'octocat',
    });
    expect(identityReducer(rekeyed, identityChanged(null))).toMatchObject({
      currentIdentity: null,
      currentLogin: null,
      principalLoaded: true,
    });
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

  it('exposes the raw setting, the load status, the save flag, the error and the principal', () => {
    const s = state({
      provider: 'gitlab',
      loadStatus: 'loaded',
      saving: true,
      error: 'x',
      currentIdentity: gitlabTriple,
      currentLogin: 'gl-user',
    });
    expect(selectIdentityProvider.select(s)).toBe('gitlab');
    expect(selectIdentityLoadStatus.select(s)).toBe('loaded');
    expect(selectIdentitySaving.select(s)).toBe(true);
    expect(selectIdentityError.select(s)).toBe('x');
    expect(selectCurrentIdentity.select(s)).toEqual(gitlabTriple);
    expect(selectCurrentIdentityLogin.select(s)).toBe('gl-user');
  });

  it('the identity the daemon holds is authoritative whatever the setting or connections say', () => {
    const both = { github: true, gitlab: true };
    // Unset setting, both connected, retained GitLab identity ⇒ GitLab (not the GitHub default).
    expect(
      selectEffectiveIdentityProvider.select(state({ currentIdentity: gitlabTriple }, both)),
    ).toBe('gitlab');
    // The setting lags the event: the triple wins until settings.get catches up.
    expect(
      selectEffectiveIdentityProvider.select(
        state({ provider: 'github', currentIdentity: gitlabTriple }, both),
      ),
    ).toBe('gitlab');
    expect(
      selectEffectiveIdentityProvider.select(
        state({ currentIdentity: githubTriple }, { gitlab: true }),
      ),
    ).toBe('github');
  });

  it('while unlinked, resolves like the daemon: explicit setting only when connected, else implied', () => {
    const both = { github: true, gitlab: true };
    expect(selectEffectiveIdentityProvider.select(state({ provider: 'gitlab' }, both))).toBe(
      'gitlab',
    );
    expect(selectEffectiveIdentityProvider.select(state({ provider: 'github' }, both))).toBe(
      'github',
    );
    // Unset: the single connected forge, GitHub with both connected.
    expect(selectEffectiveIdentityProvider.select(state({}, both))).toBe('github');
    expect(selectEffectiveIdentityProvider.select(state({}, { gitlab: true }))).toBe('gitlab');
    expect(selectEffectiveIdentityProvider.select(state({}, { github: true }))).toBe('github');
    // An explicit setting naming a disconnected forge leaves the primary unlinked —
    // the daemon clears the retained identity rather than falling back to the other forge.
    expect(
      selectEffectiveIdentityProvider.select(state({ provider: 'gitlab' }, { github: true })),
    ).toBeNull();
    expect(
      selectEffectiveIdentityProvider.select(state({ provider: 'github' }, { gitlab: true })),
    ).toBeNull();
    expect(selectEffectiveIdentityProvider.select(state({ provider: 'gitlab' }))).toBeNull();
    expect(selectEffectiveIdentityProvider.select(state({}))).toBeNull();
  });

  it('offers the choice only with both forges connected; any connection shows the row', () => {
    expect(selectIdentityProviderChoosable.select(state({}, { github: true, gitlab: true }))).toBe(
      true,
    );
    expect(selectIdentityProviderChoosable.select(state({}, { github: true }))).toBe(false);
    expect(selectIdentityProviderChoosable.select(state({}, { gitlab: true }))).toBe(false);
    expect(selectAnyIdentityForgeConnected.select(state({}, { gitlab: true }))).toBe(true);
    expect(selectAnyIdentityForgeConnected.select(state({}))).toBe(false);
  });
});
