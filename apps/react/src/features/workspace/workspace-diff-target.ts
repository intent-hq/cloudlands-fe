import { parseWorkspaceFileTarget } from './workspace-file-target';

export type GitDiffOrigin = { workspaceId: string; path: string; staged: boolean; y: number };

/** Navigation context only; it never grants read authority or supplies a redirect URL. */
export function parseGitDiffOrigin(raw: unknown): GitDiffOrigin | undefined {
  if (typeof raw !== 'string' || raw.length > 8192) return;
  try {
    const value = JSON.parse(raw);
    if (
      !value ||
      typeof value.workspaceId !== 'string' ||
      !value.workspaceId ||
      typeof value.path !== 'string' ||
      !parseWorkspaceFileTarget(value.path).valid ||
      typeof value.staged !== 'boolean' ||
      !Number.isFinite(value.y) ||
      Math.abs(value.y) > 100000
    )
      return;
    return { workspaceId: value.workspaceId, path: value.path, staged: value.staged, y: value.y };
  } catch {
    return;
  }
}

export function matchingGitDiffOrigin(
  raw: unknown,
  workspaceId: string,
  path: string,
  staged: boolean,
) {
  const origin = parseGitDiffOrigin(raw);
  return origin?.workspaceId === workspaceId && origin.path === path && origin.staged === staged
    ? origin
    : undefined;
}
