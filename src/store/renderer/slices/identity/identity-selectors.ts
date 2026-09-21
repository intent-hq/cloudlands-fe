import { store } from '../../store';
import type { IdentityProvider, PrincipalIdentity } from './identity-types';

/** The `identity.provider` setting as read; `null` while unset or unread. */
export const selectIdentityProvider = store.createSelector((state) => state.identity.provider);

export const selectIdentityLoadStatus = store.createSelector((state) => state.identity.loadStatus);

export const selectIdentitySaving = store.createSelector((state) => state.identity.saving);

export const selectIdentityError = store.createSelector((state) => state.identity.error);

/** The identity triple `principal.me` holds for this connection; `null` while unlinked or unread. */
export const selectCurrentIdentity = store.createSelector(
  (state): PrincipalIdentity | null => state.identity.currentIdentity,
);

/** The cached forge `login` `principal.me` reports; `null` until an identity is linked. */
export const selectCurrentIdentityLogin = store.createSelector(
  (state): string | null => state.identity.currentLogin,
);

/**
 * The forge that keys this host's identity, resolved like the daemon does
 * (§5.48 "Identity model"): the identity the daemon actually holds
 * (`principal.me`, kept current by `principal:identity-changed`) is
 * authoritative when linked. While unlinked: an explicit setting names its
 * forge when connected and leaves the primary unlinked (`null`) when that
 * forge is disconnected — never silently the other one; unset falls to the
 * implied default — the single connected forge, GitHub with both connected —
 * and `null` with no forge connected.
 */
export const selectEffectiveIdentityProvider = store.createSelector(
  (state): IdentityProvider | null => {
    const { provider, currentIdentity } = state.identity;
    if (currentIdentity) return currentIdentity.provider;
    const github = state.githubAuth.isAuthenticated;
    const gitlab = state.gitlabAuth.isConfigured;
    if (provider === 'github') return github ? 'github' : null;
    if (provider === 'gitlab') return gitlab ? 'gitlab' : null;
    if (github) return 'github';
    if (gitlab) return 'gitlab';
    return null;
  },
);

/** At least one forge is connected, so an identity row has something to show or offer. */
export const selectAnyIdentityForgeConnected = store.createSelector(
  (state) => state.githubAuth.isAuthenticated || state.gitlabAuth.isConfigured,
);

/** Both forges are connected, so the identity is a user choice. */
export const selectIdentityProviderChoosable = store.createSelector(
  (state) => state.githubAuth.isAuthenticated && state.gitlabAuth.isConfigured,
);
