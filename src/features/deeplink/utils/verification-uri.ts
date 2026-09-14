/**
 * Allowlist for the GitHub device-flow verification URL the daemon returns
 * from `invite.redeem` (intentd #1872). The URL is server-supplied and ends
 * up in `shell.openExternal`, so it is accepted only when it is `https:` on
 * the default port, points at `github.com` (or a subdomain) and at the
 * device-flow path — no other scheme, port or path, no embedded credentials,
 * no lookalike host. The daemon never sends anything else; a compromised or
 * impersonated one must not be able to launch arbitrary URLs.
 */

// i18n-ignore (wire constant, GitHub device-flow origin)
const GITHUB_HOST = 'github.com';
// i18n-ignore (wire constant, GitHub device-flow path)
const DEVICE_FLOW_PATH = '/login/device';

export function isAllowedVerificationUri(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') return false;
  if (url.port !== '') return false;
  if (url.pathname !== DEVICE_FLOW_PATH && url.pathname !== `${DEVICE_FLOW_PATH}/`) return false;
  const host = url.hostname.toLowerCase();
  return host === GITHUB_HOST || host.endsWith(`.${GITHUB_HOST}`);
}
