/**
 * Reduce a user-entered GitLab instance URL to the bare host the daemon's
 * `sourceControl.*` methods take (`host`): scheme, path, query, hash and
 * trailing slashes are dropped; a port is kept. Returns `''` when nothing
 * host-like remains so callers can fall back to the default host.
 */
export function normalizeGitLabHost(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '';
  const withoutScheme = trimmed.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
  const hostAndPort = withoutScheme.split(/[/?#]/, 1)[0] ?? '';
  return hostAndPort.replace(/^.*@/, '').toLowerCase();
}

/** Where a user creates a PAT with the `api` scope on a given GitLab host. */
export function gitlabPersonalAccessTokenUrl(host: string): string {
  return `https://${host}/-/user_settings/personal_access_tokens?scopes=api`;
}
