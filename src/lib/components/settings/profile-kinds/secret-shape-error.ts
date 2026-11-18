import { m } from '$shared/paraglide/messages.js';
import type { ProfileProvider } from '$lib/provider-profile-kinds';

/** The inline error for a pasted key or token without its provider's shape. */
export function secretShapeError(provider: ProfileProvider, kind: 'apiKey' | 'token'): string {
  if (kind === 'token') {
    return provider === 'codex'
      ? m.settings_providerProfileKinds_tokenNotJwt_error()
      : m.settings_providerProfileKinds_tokenShapeClaude_error();
  }
  return provider === 'codex'
    ? m.settings_providerProfileKinds_keyShapeCodex_error()
    : m.settings_providerProfileKinds_keyShapeClaude_error();
}
