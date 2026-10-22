import type { DiffHunk, LocalFileChange } from '$lib/components/chat/types';
import type { ChatChangesInput } from '$store/renderer/slices/chat-changes/chat-changes-types';
import { stripWorkspacePrefix } from '$lib/utils/file-utils';

export const REFRESH_COOLDOWN_MS = 2000;
export const MAX_UPFRONT_FETCH_COUNT = 20;

export function isPathLocked(paths: Record<string, true>, path: string, workspacePath?: string) {
  const normalized = path.replaceAll('\\', '/');
  if (normalized in paths) return true;
  if (!workspacePath) return false;
  const relative = stripWorkspacePrefix(normalized, workspacePath.replaceAll('\\', '/'));
  return relative !== normalized && relative in paths;
}

export function getChangeCategory(change: LocalFileChange) {
  return change.category ?? (change.staged === true ? 'staged' : 'unstaged');
}

export function computeMergedDestinedPaths(source: LocalFileChange[], groupByCommit: boolean) {
  const groups = new Map<string, { staged: boolean; unstaged: boolean; committed: number }>();
  for (const change of source) {
    const group = groups.get(change.filePath) ?? { staged: false, unstaged: false, committed: 0 };
    const category = getChangeCategory(change);
    if (category === 'committed') group.committed++;
    else group[category] = true;
    groups.set(change.filePath, group);
  }
  return new Set(
    [...groups]
      .filter(([, group]) => {
        const local = group.staged || group.unstaged;
        return local
          ? Number(group.staged) + Number(group.unstaged) + group.committed > 1
          : group.committed > 1 && !groupByCommit;
      })
      .map(([path]) => path),
  );
}

export function computeBranchBaseCollapsedCommittedPaths(
  source: LocalFileChange[],
  groupByCommit: boolean,
) {
  const counts = new Map<string, number>();
  if (!groupByCommit)
    for (const change of source) {
      if (getChangeCategory(change) === 'committed') {
        counts.set(change.filePath, (counts.get(change.filePath) ?? 0) + 1);
      }
    }
  return new Set([...counts].filter(([, count]) => count > 1).map(([path]) => path));
}

export function computeBranchBaseCommittedFallbacks(source: LocalFileChange[], paths: Set<string>) {
  const groups = new Map<string, LocalFileChange[]>();
  for (const change of source) {
    if (paths.has(change.filePath) && getChangeCategory(change) === 'committed') {
      groups.set(change.filePath, [...(groups.get(change.filePath) ?? []), change]);
    }
  }
  return groups;
}

type Numstat = { filePath: string; additions: number; deletions: number };
export function applyNumstatStats(
  source: LocalFileChange[],
  local: Numstat[],
  committed: Numstat[] = [],
) {
  const localConsumed = new Set<string>();
  const committedConsumed = new Set<string>();
  return source.map((change) => {
    const isCommitted = getChangeCategory(change) === 'committed';
    const stats = isCommitted ? committed : local;
    const path = change.filePath.replace(/^\/+/, '');
    const stat =
      stats.find((s) => s.filePath === change.filePath) ??
      stats.find((s) => {
        const statPath = s.filePath.replace(/^\/+/, '');
        return path.endsWith(`/${statPath}`) || statPath.endsWith(`/${path}`);
      });
    if (!stat) return change;
    const consumed = isCommitted ? committedConsumed : localConsumed;
    const additions = consumed.has(stat.filePath) ? 0 : stat.additions;
    const deletions = consumed.has(stat.filePath) ? 0 : stat.deletions;
    consumed.add(stat.filePath);
    return change.additions === additions && change.deletions === deletions
      ? change
      : { ...change, additions, deletions };
  });
}

export function calculateDiffHunkStats(chunks?: DiffHunk[]) {
  let additions = 0;
  let deletions = 0;
  for (const hunk of chunks ?? [])
    for (const line of hunk.lines ?? []) {
      if (line.type === 'Addition') additions++;
      else if (line.type === 'Deletion') deletions++;
    }
  return { additions, deletions };
}

export function toGitRootRelativePath(filePath: string, rootPath?: string) {
  if (!rootPath) return filePath;
  const path = filePath.replaceAll('\\', '/');
  const root = rootPath.replaceAll('\\', '/').replace(/\/$/, '');
  return path.startsWith(`${root}/`) ? path.slice(root.length + 1) : filePath;
}

export function chatChangesResourceKey(input: Omit<ChatChangesInput, 'changes'>) {
  return JSON.stringify([
    input.agentId,
    input.gitRootId,
    input.gitRootPath,
    input.branchBaseRef,
    input.branchBaseCommitSha,
    input.showStagingControls,
    input.isAggregate,
    input.groupByCommit,
    input.nodeOwnedPaths,
  ]);
}

export function generateChangesKey(changes: LocalFileChange[]) {
  return changes
    .map(
      (c) =>
        `${c.filePath}|${c.category || c.staged}|${c.commitHash || ''}${
          c.gitlink ? `|gl:${c.gitlink.oldSha || ''}:${c.gitlink.newSha || ''}` : ''
        }`,
    )
    .sort()
    .join(';;');
}
