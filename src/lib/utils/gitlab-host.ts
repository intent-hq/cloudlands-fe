import { isCanonicalGitLabInstance } from '$shared/utils/gitlab-resource-link';

/**
 * Accept a bare HTTPS authority or a complete instance root. Keep the raw path
 * until validation: URL parsing alone would erase dot segments and backslashes.
 * This is input validation only; the daemon decides the configured instance.
 */
export function normalizeGitLabInstanceUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed || /[\u0000-\u0020\u007f\\]/.test(trimmed)) return null;
  const value = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const parts = /^https:\/\/([^/?#]+)([^?#]*)$/i.exec(value);
  if (!parts || /[@%]/.test(parts[1])) return null;
  try {
    const origin = new URL(value).origin;
    const candidate = origin + parts[2].replace(/\/$/, '');
    return isCanonicalGitLabInstance(candidate) ? candidate : null;
  } catch {
    return null;
  }
}

/**
 * Derive a bare authority for consumers that specifically require `host`.
 * This is not a complete instance identity and must not replace the full root
 * in auth or checkout requests. Validate user input with normalizeGitLabInstanceUrl first.
 */
export function normalizeGitLabHost(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '';
  const withoutScheme = trimmed.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
  const hostAndPort = withoutScheme.split(/[/?#]/, 1)[0] ?? '';
  return hostAndPort.replace(/^.*@/, '').toLowerCase();
}

/** Where a user creates a PAT with the `api` scope on a complete GitLab instance. */
export function gitlabPersonalAccessTokenUrl(instance: string): string | null {
  const root = normalizeGitLabInstanceUrl(instance);
  return root ? `${root}/-/user_settings/personal_access_tokens?scopes=api` : null;
}
