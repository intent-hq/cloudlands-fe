import type { IdentityProvider } from '../types';

/** A pin names a canonical authority, never a URL, path, login or repository. */
export function canonicalInviteHost(provider: IdentityProvider, input: string): string | null {
  const host = input.trim().toLowerCase();
  if (provider === 'github') return !host || host === 'github.com' ? 'github.com' : null;
  if (!host) return 'gitlab.com';
  if (/[\s/@?#\\]/.test(host) || host.includes('://')) return null;
  try {
    const url = new URL(`https://${host}`);
    if (!url.hostname || url.username || url.password || url.pathname !== '/') return null;
    return url.host;
  } catch {
    return null;
  }
}
