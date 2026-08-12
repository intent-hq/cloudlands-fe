import type { Workspace } from '$shared/types';
import { stripWorkspacePrefix } from '$lib/utils/file-utils';

type ActivityFileWorkspace = Pick<Workspace, 'worktreePath' | 'repositoryPath' | 'path'>;

function normalizeSeparators(path: string): string {
  return path
    .trim()
    .replaceAll('\\', '/')
    .replace(/\/{2,}/g, '/');
}

/**
 * Convert an event path into the repository-relative shape expected by file tabs.
 * Some daemon events are relative to the workspace container and therefore start
 * with the worktree directory name (commonly `repo/`).
 */
export function normalizeActivityFilePath(
  filePath: string,
  workspace?: ActivityFileWorkspace | null,
): string {
  const normalized = normalizeSeparators(filePath);
  if (!normalized) return '';

  const roots = [workspace?.worktreePath, workspace?.repositoryPath, workspace?.path]
    .filter((root): root is string => Boolean(root))
    .map((root) => normalizeSeparators(root).replace(/\/+$/, ''));

  for (const root of roots) {
    const relative = stripWorkspacePrefix(normalized, root);
    if (relative !== normalized) return relative;
  }

  const containerRelative = normalized.replace(/^\/+/, '').replace(/^\.\/+/, '');
  for (const root of roots) {
    const rootName = root.split('/').pop();
    if (rootName && containerRelative.startsWith(`${rootName}/`)) {
      return containerRelative.slice(rootName.length + 1);
    }
  }

  return normalized.replace(/^\.\/+/, '');
}
