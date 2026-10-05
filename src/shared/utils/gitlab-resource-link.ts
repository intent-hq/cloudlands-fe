import type { ReviewTarget } from '$shared/types/repository-context';

export type GitLabResourceTarget = ReviewTarget & {
  repository: { provider: 'gitlab'; instanceBaseUrl: string; projectPath: string };
  kind: 'merge-request' | 'issue';
};

/** Parse the original spelling before URL can erase traversal or separators. */
function parts(value: string): { url: URL; path: string[] } | null {
  if (/[\u0000-\u0020\u007f\\]/.test(value)) return null;
  const raw = /^https:\/\/([^/?#]+)([^?#]*)/i.exec(value);
  if (!raw || /[@%]/.test(raw[1])) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    const path = raw[2].replace(/\/$/, '');
    const segments = path ? path.slice(1).split('/') : [];
    if (segments.some((s) => !/^[A-Za-z0-9_.-]+$/.test(s) || s === '.' || s === '..')) return null;
    return { url, path: segments };
  } catch {
    return null;
  }
}

/** Canonical logical roots are configured facts, never discovered from a link. */
export function isCanonicalGitLabInstance(value: string): boolean {
  const parsed = parts(value);
  return (
    !!parsed &&
    !parsed.url.search &&
    !parsed.url.hash &&
    value === parsed.url.origin + (parsed.path.length ? `/${parsed.path.join('/')}` : '')
  );
}

/** A project web URL is selection intent under an already configured logical root. */
export function parseGitLabProjectLink(
  value: string,
  instanceBaseUrl: string,
): GitLabResourceTarget['repository'] | null {
  if (!isCanonicalGitLabInstance(instanceBaseUrl)) return null;
  const parsed = parts(value);
  const base = parts(instanceBaseUrl);
  if (
    !parsed ||
    !base ||
    base.url.origin !== parsed.url.origin ||
    !base.path.every((part, index) => parsed.path[index] === part)
  )
    return null;
  const path = parsed.path.slice(base.path.length);
  if (path.length < 2 || path[0] === 'groups' || path.includes('-')) return null;
  return { provider: 'gitlab', instanceBaseUrl, projectPath: path.join('/') };
}

/**
 * Adapted from the accepted qualified-link parser. Only confirmed URL routes
 * are recognized here; work items, groups and aliases remain ordinary links.
 * The caller retains the untouched URL for navigation/copying.
 */
export function parseGitLabResourceLink(
  value: string,
  instances: readonly { provider: string; instanceBaseUrl: string }[],
): GitLabResourceTarget | null {
  const parsed = parts(value);
  if (!parsed) return null;
  let result: GitLabResourceTarget | null = null;
  for (const instance of instances) {
    if (instance.provider !== 'gitlab' || !isCanonicalGitLabInstance(instance.instanceBaseUrl))
      continue;
    const base = parts(instance.instanceBaseUrl);
    if (!base) continue;
    if (
      base.url.origin !== parsed.url.origin ||
      !base.path.every((part, index) => parsed.path[index] === part)
    )
      continue;
    const path = parsed.path.slice(base.path.length);
    const boundary = path.indexOf('-');
    if (boundary < 2 || path[0] === 'groups') continue;
    const [route, iid, ...subpage] = path.slice(boundary + 1);
    const kind = route === 'merge_requests' ? 'merge-request' : route === 'issues' ? 'issue' : null;
    if (!kind || !/^[1-9]\d*$/.test(iid ?? '') || !Number.isSafeInteger(Number(iid))) continue;
    if (
      subpage.length &&
      (kind !== 'merge-request' ||
        subpage.length !== 1 ||
        !['diffs', 'commits', 'pipelines'].includes(subpage[0]))
    )
      continue;
    const candidate: GitLabResourceTarget = {
      repository: {
        provider: 'gitlab',
        instanceBaseUrl: instance.instanceBaseUrl,
        projectPath: path.slice(0, boundary).join('/'),
      },
      kind,
      number: Number(iid),
    };
    if (result && JSON.stringify(result) !== JSON.stringify(candidate)) return null;
    result = candidate;
  }
  return result;
}

/** Only a syntactic filter before an admitted descriptor capture, not authority. */
export function isGitLabResourceCandidate(value: string): boolean {
  const parsed = parts(value);
  if (!parsed) return false;
  return (
    parseGitLabResourceLink(value, [{ provider: 'gitlab', instanceBaseUrl: parsed.url.origin }]) !==
    null
  );
}
