/**
 * Git Operations Service
 *
 * Provides advanced git operations for workspaces
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { Logger } from '$shared/logger';
import {
  execAsync,
  execFileAsync,
} from '../../../shared/git/git-env';

const logger = new Logger('GitOperations');

/**
 * Validate git ref (SHA, branch name) to prevent command injection.
 * Only allows alphanumeric characters, hyphens, underscores, slashes, and dots.
 */
function isValidGitRef(ref: string): boolean {
  return /^[a-zA-Z0-9\-_/.]+$/.test(ref);
}

export class GitOperations {
  /**
   * Commit staged changes
   */
  static async commit(workspacePath: string, message: string): Promise<string> {
    if (!workspacePath) {
      throw new Error('Workspace path is required');
    }

    if (!message || message.trim().length === 0) {
      throw new Error('Commit message is required');
    }

    try {
      // Use execFileAsync to safely pass the message without shell interpretation
      const { stdout } = await execFileAsync('git', ['commit', '-m', message], {
        cwd: workspacePath,
      });

      logger.debug('Commit successful', { workspacePath });
      return stdout.trim();
    } catch (error) {
      logger.error('Commit failed', error as Error);
      throw new Error(`Failed to commit: ${(error as Error).message}`);
    }
  }

  /**
   * Get diff for a specific file
   */
  static async getFileDiff(workspacePath: string, filePath: string): Promise<string> {
    if (!workspacePath) {
      throw new Error('Workspace path is required');
    }

    if (!filePath) {
      throw new Error('File path is required');
    }

    try {
      // Use execFileAsync to safely pass the file path without shell interpretation
      const { stdout } = await execFileAsync('git', ['diff', '--', filePath], {
        cwd: workspacePath,
        maxBuffer: 50 * 1024 * 1024, // 50MB buffer for large diffs
      });

      logger.debug('Got diff for file', { filePath, workspacePath });
      return stdout;
    } catch (error) {
      logger.error('Get file diff failed', error as Error);
      throw new Error(`Failed to get file diff: ${(error as Error).message}`);
    }
  }

  /**
   * Get overall git diff
   */
  static async getDiff(workspacePath: string): Promise<string> {
    if (!workspacePath) {
      throw new Error('Workspace path is required');
    }

    try {
      const { stdout } = await execAsync('git diff', {
        cwd: workspacePath,
        maxBuffer: 50 * 1024 * 1024, // 50MB buffer for large diffs
      });

      logger.debug('Got overall diff', { workspacePath });
      return stdout;
    } catch (error) {
      logger.error('Get diff failed', error as Error);
      throw new Error(`Failed to get diff: ${(error as Error).message}`);
    }
  }

  /**
   * Get staged diff
   */
  static async getStagedDiff(workspacePath: string): Promise<string> {
    if (!workspacePath) {
      throw new Error('Workspace path is required');
    }

    try {
      const { stdout } = await execAsync('git diff --staged', {
        cwd: workspacePath,
        maxBuffer: 50 * 1024 * 1024, // 50MB buffer for large diffs
      });

      logger.debug('Got staged diff', { workspacePath });
      return stdout;
    } catch (error) {
      logger.error('Get staged diff failed', error as Error);
      throw new Error(`Failed to get staged diff: ${(error as Error).message}`);
    }
  }

  /**
   * Validate that a path is a valid git repository
   */
  static async validateRepository(repoPath: string): Promise<boolean> {
    if (!repoPath) {
      return false;
    }

    try {
      // Check if .git directory exists
      const gitDir = path.join(repoPath, '.git');
      await fs.access(gitDir);

      // Verify it's a valid git repo by running git rev-parse
      try {
        await execAsync('git rev-parse --git-dir', {
          cwd: repoPath,
        });
        logger.debug('Validated repository', { repoPath });
        return true;
      } catch {
        logger.warn('Invalid git repository', { repoPath });
        return false;
      }
    } catch (error) {
      logger.warn('Repository validation failed', { error: (error as Error).message });
      return false;
    }
  }

  /**
   * Get current branch name
   */
  static async getCurrentBranch(workspacePath: string): Promise<string> {
    if (!workspacePath) {
      throw new Error('Workspace path is required');
    }

    try {
      const { stdout } = await execAsync('git rev-parse --abbrev-ref HEAD', {
        cwd: workspacePath,
      });

      return stdout.trim();
    } catch (error) {
      logger.error('Get current branch failed', error as Error);
      throw new Error(`Failed to get current branch: ${(error as Error).message}`);
    }
  }

  /**
   * Get commit log
   */
  static async getLog(workspacePath: string, limit: number = 10): Promise<string> {
    if (!workspacePath) {
      throw new Error('Workspace path is required');
    }

    try {
      // Use execFileAsync to safely pass the limit without shell interpretation
      const { stdout } = await execFileAsync('git', ['log', '--oneline', '-n', String(limit)], {
        cwd: workspacePath,
      });

      return stdout;
    } catch (error) {
      logger.error('Get log failed', error as Error);
      throw new Error(`Failed to get log: ${(error as Error).message}`);
    }
  }

  /**
   * Get remote URL
   */
  static async getRemoteUrl(workspacePath: string): Promise<string> {
    if (!workspacePath) {
      throw new Error('Workspace path is required');
    }

    try {
      const { stdout } = await execAsync('git config --get remote.origin.url', {
        cwd: workspacePath,
      });

      return stdout.trim();
    } catch (error) {
      logger.warn('Get remote URL failed', { error: (error as Error).message });
      return '';
    }
  }

  /**
   * Check if there are uncommitted changes
   */
  static async hasUncommittedChanges(workspacePath: string): Promise<boolean> {
    if (!workspacePath) {
      throw new Error('Workspace path is required');
    }

    try {
      const { stdout } = await execAsync('git status --porcelain', {
        cwd: workspacePath,
      });

      return stdout.trim().length > 0;
    } catch (error) {
      logger.error('Check uncommitted changes failed', error as Error);
      throw new Error(`Failed to check uncommitted changes: ${(error as Error).message}`);
    }
  }

  /**
   * Get detailed commit history for the current branch
   * Returns commits with their SHA, message, author, date, and file changes
   */
  static async getDetailedCommitHistory(
    workspacePath: string,
    baseBranch: string = 'main',
    limit: number = 50,
  ): Promise<CommitInfo[]> {
    if (!workspacePath) {
      throw new Error('Workspace path is required');
    }

    try {
      // Validate baseBranch to prevent command injection
      if (!isValidGitRef(baseBranch)) {
        throw new Error(`Invalid base branch name: ${baseBranch}`);
      }

      // Get commits that are on current branch but not on base branch
      // Format: SHA|AUTHOR_NAME|AUTHOR_EMAIL|DATE|SUBJECT
      // Use execFileAsync to safely pass arguments without shell interpretation
      const { stdout: commitsRaw } = await execFileAsync(
        'git',
        ['log', '--first-parent', '--no-merges', `${baseBranch}..HEAD`, '--format=%H|%an|%ae|%aI|%s', '-n', String(limit)],
        { cwd: workspacePath },
      );

      if (!commitsRaw.trim()) {
        return [];
      }

      const commits: CommitInfo[] = [];
      const commitLines = commitsRaw.trim().split('\n');

      for (const line of commitLines) {
        const [sha, authorName, authorEmail, date, message] = line.split('|');

        // Get file changes for this commit
        // Use execFileAsync to safely pass SHA without shell interpretation
        const { stdout: filesRaw } = await execFileAsync(
          'git',
          ['diff-tree', '--no-commit-id', '--name-status', '-r', sha],
          { cwd: workspacePath },
        );

        const files: CommitFileChange[] = [];
        if (filesRaw.trim()) {
          const fileLines = filesRaw.trim().split('\n');
          for (const fileLine of fileLines) {
            const [status, ...pathParts] = fileLine.split('\t');
            const filePath = pathParts.join('\t');
            files.push({
              path: filePath,
              status: this.mapGitStatus(status),
              additions: 0,
              deletions: 0,
            });
          }
        }

        // Get stats for the commit (additions/deletions)
        try {
          // Use execFileAsync to safely pass SHA without shell interpretation
          const { stdout: statsRaw } = await execFileAsync(
            'git',
            ['diff-tree', '--numstat', '--no-commit-id', '-r', sha],
            { cwd: workspacePath },
          );

          if (statsRaw.trim()) {
            const statsLines = statsRaw.trim().split('\n');
            for (const statsLine of statsLines) {
              const [additions, deletions, filePath] = statsLine.split('\t');
              const file = files.find((f) => f.path === filePath);
              if (file) {
                file.additions = parseInt(additions) || 0;
                file.deletions = parseInt(deletions) || 0;
              }
            }
          }
        } catch (error) {
          logger.warn('Failed to get stats for commit', { sha, error });
        }

        // Check if commit is pushed
        const isPushed = await this.isCommitPushed(workspacePath, sha);

        commits.push({
          sha,
          message,
          authorName,
          authorEmail,
          date,
          files,
          isPushed,
        });
      }

      return commits;
    } catch (error) {
      logger.error('Get detailed commit history failed', error as Error);
      throw new Error(`Failed to get commit history: ${(error as Error).message}`);
    }
  }

  /**
   * Check if a commit has been pushed to remote
   */
  static async isCommitPushed(workspacePath: string, sha: string): Promise<boolean> {
    try {
      // Check if commit exists on any remote branch
      // Use execFileAsync to safely pass SHA without shell interpretation
      const { stdout } = await execFileAsync('git', ['branch', '-r', '--contains', sha], {
        cwd: workspacePath,
      });

      return stdout.trim().length > 0;
    } catch (error) {
      logger.warn('Failed to check if commit is pushed', { sha, error: (error as Error).message });
      return false;
    }
  }

  /**
   * Get diff for a specific commit
   */
  static async getCommitDiff(workspacePath: string, sha: string): Promise<string> {
    if (!workspacePath || !sha) {
      throw new Error('Workspace path and commit SHA are required');
    }

    try {
      // Use execFileAsync to safely pass SHA without shell interpretation
      const { stdout } = await execFileAsync('git', ['show', sha], {
        cwd: workspacePath,
      });

      return stdout;
    } catch (error) {
      logger.error('Get commit diff failed', error as Error, { sha });
      throw new Error(`Failed to get commit diff: ${(error as Error).message}`);
    }
  }

  /**
   * Map git status codes to readable status
   */
  private static mapGitStatus(status: string): 'added' | 'modified' | 'deleted' | 'renamed' {
    switch (status) {
      case 'A':
        return 'added';
      case 'M':
        return 'modified';
      case 'D':
        return 'deleted';
      case 'R':
        return 'renamed';
      default:
        return 'modified';
    }
  }
}

// Type definitions

/**
 * File change as part of a git commit.
 * This is distinct from the shared FileChange in change-detector.types.ts
 * because it represents a committed change with different metadata.
 */
export interface CommitFileChange {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  additions: number;
  deletions: number;
}

export interface CommitInfo {
  sha: string;
  message: string;
  authorName: string;
  authorEmail: string;
  date: string;
  files: CommitFileChange[];
  isPushed: boolean;
}
