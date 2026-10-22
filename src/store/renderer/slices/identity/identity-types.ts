import type { IdentityProvider, PrincipalIdentity } from '$features/workspace-sharing/types';

export type { IdentityProvider, PrincipalIdentity };

/**
 * The host's `identity.provider` setting (which connected forge keys the
 * daemon's primary principal; `null` while unset — the daemon implies the
 * forge from its connections — or unread) plus the authoritative identity the
 * daemon actually holds, read from `principal.me` (the `identity?` triple and
 * cached `login`) and refreshed on `principal:identity-changed`.
 */
export type IdentityState = {
  provider: IdentityProvider | null;
  /** `principal.me.identity`; `null` while unlinked or before the first read. */
  currentIdentity: PrincipalIdentity | null;
  /** `principal.me.login`; `null` until a forge identity is cached. */
  currentLogin: string | null;
  /** `principal.me` answered at least once, so `currentIdentity: null` means unlinked. */
  principalLoaded: boolean;
  loadStatus: 'idle' | 'loading' | 'loaded' | 'error';
  /** `settings.update` for the provider is in flight. */
  saving: boolean;
  error: string | null;
};
