import { store } from '../../store';
import type { IdentityProvider } from './identity-types';

/** The `identity.provider` setting as read; `null` while unset or unread. */
export const selectIdentityProvider = store.createSelector((state) => state.identity.provider);

export const selectIdentitySaving = store.createSelector((state) => state.identity.saving);

export const selectIdentityError = store.createSelector((state) => state.identity.error);

/**
 * The forge that keys this host's identity: the explicit setting when it
 * names a connected forge, else the daemon's implied default (GitHub when
 * connected, else GitLab when connected), else `null` with no forge linked.
 */
export const selectEffectiveIdentityProvider = store.createSelector(
  (state): IdentityProvider | null => {
    const github = state.githubAuth.isAuthenticated;
    const gitlab = state.gitlabAuth.isConfigured;
    const { provider } = state.identity;
    if (provider === 'github' && github) return 'github';
    if (provider === 'gitlab' && gitlab) return 'gitlab';
    if (github) return 'github';
    if (gitlab) return 'gitlab';
    return null;
  },
);

/** Both forges are connected, so the identity is a user choice. */
export const selectIdentityProviderChoosable = store.createSelector(
  (state) => state.githubAuth.isAuthenticated && state.gitlabAuth.isConfigured,
);
