/**
 * Pure helpers that map an importable session onto the new-workspace form:
 * which known repository holds its cwd, and whether its last git branch can
 * be the base ref.
 */

export interface SessionRepoCandidate {
  path: string;
  type: 'local' | 'github';
}

function normalizePath(path: string): string {
  const unified = path.replace(/\\/g, '/');
  return unified.length > 1 ? unified.replace(/\/+$/, '') : unified;
}

/**
 * True when `cwd` is `root` or a folder inside it.
 * @internal
 */
export function isPathWithin(cwd: string, root: string): boolean {
  const child = normalizePath(cwd);
  const parent = normalizePath(root);
  if (!child || !parent) return false;
  return child === parent || child.startsWith(parent === '/' ? '/' : `${parent}/`);
}

/**
 * The local repository whose path contains the session cwd. The deepest match
 * wins, so a nested repository beats its parent folder.
 */
export function matchSessionRepository<T extends SessionRepoCandidate>(
  cwd: string,
  candidates: readonly T[],
): T | null {
  let best: T | null = null;
  for (const candidate of candidates) {
    if (candidate.type !== 'local' || !candidate.path) continue;
    if (!isPathWithin(cwd, candidate.path)) continue;
    if (!best || normalizePath(candidate.path).length > normalizePath(best.path).length)
      best = candidate;
  }
  return best;
}

/**
 * The git root of `cwd`, given its path relative to that root (the daemon's
 * directory status). Null when the relative path is not a suffix of `cwd`.
 */
export function gitRootFromSubdirectory(cwd: string, relativeFromRoot: string): string | null {
  const relative = relativeFromRoot.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  const normalized = normalizePath(cwd);
  if (!relative) return normalized || null;
  if (!normalized.endsWith(`/${relative}`)) return null;
  const root = normalized.slice(0, -relative.length - 1);
  return root || '/';
}

export interface SessionBranchListing {
  branches: readonly string[];
  remoteBranches?: readonly string[];
}

/**
 * The base ref to preselect for the session's `gitBranch`: the branch when
 * it still exists locally or on a remote, else null (keep the form default).
 */
export function sessionBaseBranch(
  gitBranch: string | undefined,
  listing: SessionBranchListing | null,
): string | null {
  const branch = gitBranch?.trim();
  if (!branch || branch === 'HEAD' || !listing) return null;
  if (listing.branches.includes(branch)) return branch;
  const remote = listing.remoteBranches ?? [];
  if (remote.includes(branch)) return branch;
  const tracked = remote.find((ref) => ref.endsWith(`/${branch}`));
  return tracked ?? null;
}

/** Text the picker matches a typed query against (title, cwd, branch, id). */
export function sessionSearchText(session: {
  title: string;
  cwd: string;
  gitBranch?: string;
  sessionId: string;
  provider: string;
}): string {
  return [session.title, session.cwd, session.gitBranch ?? '', session.sessionId, session.provider]
    .filter(Boolean)
    .join(' ');
}

/** Last path segment of the cwd, for a compact row label. */
export function cwdBasename(cwd: string): string {
  const normalized = normalizePath(cwd);
  const index = normalized.lastIndexOf('/');
  return index >= 0 && index < normalized.length - 1 ? normalized.slice(index + 1) : normalized;
}
