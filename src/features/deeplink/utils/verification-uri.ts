/**
 * Allowlist for the GitHub device-flow verification URL the daemon returns
 * from `invite.redeem` (intentd #1872). The URL is server-supplied and ends
 * up in `shell.openExternal`, so it is accepted only when it is `https:` and
 * points at `github.com` (or a subdomain) — no other scheme, no embedded
 * credentials, no lookalike host. The daemon never sends another origin; a
 * compromised or impersonated one must not be able to launch arbitrary URLs.
 */

// i18n-ignore (wire constant, GitHub device-flow origin)
const GITHUB_HOST = 'github.com';

export function isAllowedVerificationUri(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') return false;
  const host = url.hostname.toLowerCase();
  return host === GITHUB_HOST || host.endsWith(`.${GITHUB_HOST}`);
}
