/**
 * On-demand workspace summary computation.
 *
 * Source-of-truth helpers behind the WORKSPACE_CHANNELS.GET_DIFF_SUMMARY,
 * GET_GIT_SUMMARY, and GET_TASKS endpoints. Results are computed fresh from
 * git / the notes service on each call and are never persisted back onto the
 * workspace object.
 */

import { execAsync, execFileAsync } from '../../../shared/git/git-env';
import { Logger } from '../../../shared/logger';
import { m } from '$shared/paraglide/messages.js';
import type {
  Note,
  Workspace,
  WorkspaceDiffSummary,
  WorkspaceGitSummary,
  WorkspaceId,
  WorkspaceTask,
} from '../../../shared/types';
import { getSpecTaskNotes } from '../../../shared/utils/task-stats';
import { getBackendClient } from '../../backend/main/backend.ipc';
import { DiffSummaryRepository } from './diff-summary.repository';

const logger = new Logger('WorkspaceSummaries');

const diffSummaryRepository = new DiffSummaryRepository();

/**
 * Compute the current diff summary for a workspace from git, falling back to
 * the persisted diff summary when git is unavailable. Returns undefined when
 * there are no changes.
 */
export async function computeWorkspaceDiffSummary(
  workspaceId: WorkspaceId,
  worktreePath?: string,
): Promise<WorkspaceDiffSummary | undefined> {
  try {
    if (worktreePath) {
      try {
        // Changed files (staged and unstaged vs HEAD)
        const { stdout } = await execFileAsync('git', ['diff', '--name-only', 'HEAD'], {
          cwd: worktreePath,
          timeout: 5000,
        });

        // Untracked files
        const { stdout: untrackedStdout } = await execFileAsync(
          'git',
          ['ls-files', '--others', '--exclude-standard'],
          { cwd: worktreePath, timeout: 5000 },
        );

        const changedFiles = stdout.trim().split('\n').filter(Boolean);
        const untrackedFiles = untrackedStdout.trim().split('\n').filter(Boolean);
        const totalFiles = new Set([...changedFiles, ...untrackedFiles]).size;

        if (totalFiles > 0) {
          let totalAdditions = 0;
          let totalDeletions = 0;
          try {
            const { stdout: numstatStdout } = await execFileAsync(
              'git',
              ['diff', '--numstat', 'HEAD'],
              { cwd: worktreePath, timeout: 5000 },
            );
            for (const line of numstatStdout.trim().split('\n').filter(Boolean)) {
              const [additions, deletions] = line.split('\t');
              if (additions !== '-') totalAdditions += parseInt(additions, 10) || 0;
              if (deletions !== '-') totalDeletions += parseInt(deletions, 10) || 0;
            }
          } catch {
            // Non-fatal, just won't have line stats
          }

          return {
            schemaVersion: 1,
            updatedAt: new Date().toISOString(),
            totalFiles,
            totalAdditions,
            totalDeletions,
            files: [],
          };
        }

        // Git reports 0 changes
        return undefined;
      } catch {
        // Git command failed, fall back to persisted summary
      }
    }

    const summary = await diffSummaryRepository.load(workspaceId);
    return summary ?? undefined;
  } catch (error) {
    logger.error('Error computing diff summary', error as Error, { workspaceId });
    return undefined;
  }
}

/**
 * Compute the git summary (ahead/behind/unpushed/recent commits) for a
 * workspace. Returns undefined when the branch is even with its base ref or
 * git is unavailable.
 */
export async function computeWorkspaceGitSummary(
  workspace: Pick<Workspace, 'id' | 'worktreePath' | 'baseRef'>,
): Promise<WorkspaceGitSummary | undefined> {
  try {
    const worktreePath = workspace.worktreePath;
    if (!worktreePath) {
      return undefined;
    }

    const baseRef = workspace.baseRef || 'main';

    let ahead = 0;
    let behind = 0;
    let hasUnpushed = false;
    let commits: { sha: string; title: string }[] = [];
    const devNull = process.platform === 'win32' ? 'NUL' : '/dev/null';

    try {
      const { stdout: aheadOutput } = await execAsync(
        `git rev-list --count ${baseRef}..HEAD 2>${devNull} || echo "0"`,
        { cwd: worktreePath },
      );
      ahead = parseInt(aheadOutput.trim(), 10) || 0;

      const { stdout: behindOutput } = await execAsync(
        `git rev-list --count HEAD..${baseRef} 2>${devNull} || echo "0"`,
        { cwd: worktreePath },
      );
      behind = parseInt(behindOutput.trim(), 10) || 0;

      const { stdout: trackingBranch } = await execAsync(
        `git rev-parse --abbrev-ref --symbolic-full-name @{u} 2>${devNull} || echo ""`,
        { cwd: worktreePath },
      );

      if (trackingBranch.trim()) {
        const { stdout: unpushedCount } = await execAsync(
          `git rev-list --count ${trackingBranch.trim()}..HEAD 2>${devNull} || echo "0"`,
          { cwd: worktreePath },
        );
        hasUnpushed = (parseInt(unpushedCount.trim(), 10) || 0) > 0;
      } else {
        // No upstream tracking branch - all commits are unpushed
        hasUnpushed = ahead > 0;
      }

      // Commit titles for tooltips (only if we have commits ahead, limit to 6)
      if (ahead > 0) {
        const { stdout: logOutput } = await execAsync(
          `git log ${baseRef}..HEAD --format="%h|%s" -n 6 2>${devNull} || echo ""`,
          { cwd: worktreePath },
        );
        commits = logOutput
          .trim()
          .split('\n')
          .filter(Boolean)
          .map((line) => {
            const [sha, ...titleParts] = line.split('|');
            return { sha: sha || '', title: titleParts.join('|') || '' };
          });
      }
    } catch {
      // Git commands failed - likely not a git repo or no commits
      return undefined;
    }

    if (ahead === 0 && behind === 0) {
      return undefined;
    }

    return { ahead, behind, hasUnpushed, commits };
  } catch (error) {
    logger.warn('Failed to compute git summary for workspace', {
      workspaceId: workspace.id,
      error: (error as Error).message,
    });
    return undefined;
  }
}

/**
 * List the canonical task facts for a workspace from the notes service.
 * Includes all spec task notes (including cancelled); renderer selectors
 * derive counts and groupings.
 */
export async function getWorkspaceTasks(workspaceId: WorkspaceId): Promise<WorkspaceTask[]> {
  // Route through the daemon (PROTOCOL.md §5.4 `note.list`); the FE presenter
  // still runs `getSpecTaskNotes` locally to derive the spec-linked task facts.
  const result = (await getBackendClient().request('note.list', {
    workspaceId,
  })) as { notes?: Note[] } | undefined;
  const notes = Array.isArray(result?.notes) ? result.notes : [];

  const taskNotes = getSpecTaskNotes(notes);
  return taskNotes.map((note) => ({
    id: note.id as string,
    title: note.title || m.workspaceSummaries_untitledTask_label(),
    status: note.metadata?.task?.status ?? 'not_started',
    updatedAt: note.updatedAt,
  }));
}
