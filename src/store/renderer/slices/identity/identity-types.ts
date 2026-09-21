import type { IdentityProvider, PrincipalIdentity } from '$features/workspace-sharing/types';

export type { IdentityProvider, PrincipalIdentity };

/**
 * The host's `identity.provider` setting: which connected forge keys the
 * daemon's primary principal. `null` while the setting is unset (the daemon
 * implies the forge from its connections) or unread.
 */
export type IdentityState = {
  provider: IdentityProvider | null;
  loadStatus: 'idle' | 'loading' | 'loaded' | 'error';
  /** `settings.update` for the provider is in flight. */
  saving: boolean;
  error: string | null;
};
