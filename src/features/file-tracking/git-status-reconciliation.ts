import type { TrackedChange, FileChangeStatus } from './types';
import { ChangeStage } from './types';
import type { FileStatus } from '$shared/types';
import { GitFileStatus } from '$shared/types';

function displayStatus(status: GitFileStatus): FileChangeStatus | undefined {
  switch (status) {
    case GitFileStatus.Added:
    case GitFileStatus.Copied:
    case GitFileStatus.Untracked:
      return 'added';
    case GitFileStatus.Deleted:
      return 'deleted';
    case GitFileStatus.Renamed:
      return 'renamed';
    case GitFileStatus.Modified:
      return 'modified';
    default:
      return undefined;
  }
}

function pathOf(change: TrackedChange): string {
  return change.relativePath || change.file;
}

/**
 * Build the sidebar's working-change rows from the authoritative git status,
 * enriching current paths with matching file-tracking attribution and stats.
 */
export function reconcileGitStatusChanges(
  files: FileStatus[],
  trackedChanges: TrackedChange[],
): TrackedChange[] {
  const trackedByPath = new Map<string, TrackedChange[]>();
  for (const change of trackedChanges) {
    const path = pathOf(change);
    const matches = trackedByPath.get(path) ?? [];
    matches.push(change);
    trackedByPath.set(path, matches);
  }

  return files.map((file) => {
    const stage = file.staged ? ChangeStage.Staged : ChangeStage.Unstaged;
    const candidates = trackedByPath.get(file.path) ?? [];
    const tracked = candidates.find((change) => change.stage === stage) ?? candidates[0];
    return {
      ...(tracked ?? {
        id: `git-status:${stage}:${file.path}`,
        file: file.path,
        stats: { additions: 0, deletions: 0 },
        attribution: { manual: true, timestamp: 0 },
      }),
      relativePath: file.path,
      stage,
      status: displayStatus(file.status),
      // Submodule (gitlink) marking from git.status (mode 160000) — #1739.
      // Gated on the gitlink mode value (not mere presence) so a future
      // daemon enrichment carrying mode on regular entries (e.g. 100755)
      // cannot route them to the submodule pin presentation.
      ...(file.mode === '160000'
        ? {
            gitlink: {
              mode: file.mode,
              ...(file.oldSha !== undefined ? { oldSha: file.oldSha } : {}),
              ...(file.newSha !== undefined ? { newSha: file.newSha } : {}),
            },
          }
        : {}),
    };
  });
}
