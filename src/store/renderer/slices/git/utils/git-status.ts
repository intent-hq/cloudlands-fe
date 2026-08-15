import type { GitStatus } from '$shared/types';

export function toGitStatus(status: GitStatus): GitStatus {
  return {
    branch: status.branch,
    ahead: status.ahead,
    behind: status.behind,
    diverged: status.diverged,
    files: status.files.map((file) => ({
      path: file.path,
      status: file.status,
      staged: file.staged,
      // Gitlink (submodule) marking — present only on 160000 entries (#1739).
      ...(file.mode !== undefined ? { mode: file.mode } : {}),
      ...(file.oldSha !== undefined ? { oldSha: file.oldSha } : {}),
      ...(file.newSha !== undefined ? { newSha: file.newSha } : {}),
    })),
    hasUncommittedChanges: status.hasUncommittedChanges,
    hasUntrackedFiles: status.hasUntrackedFiles,
  };
}
