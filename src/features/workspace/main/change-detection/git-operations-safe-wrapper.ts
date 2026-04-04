/**
 * Git Operations Safe Wrapper
 *
 * Drop-in replacement for the old GitOperations class that uses
 * the safe git operations internally.
 */

import { Logger } from '../../../../shared/logger';
import {
  execGitCommand,
  gitStatus as safeGitStatus,
  gitDiff as safeGitDiff,
  gitDiffBatch as safeGitDiffBatch,
  gitCheckIgnore as safeGitCheckIgnore,
  gitCurrentBranch as safeGitCurrentBranch,
  isGitRepository as safeIsGitRepository,
} from './safe-git-operations';
import type { GitStatus, GitDiffResult } from './git-types';
import { filterDiffableFiles } from './diffable-file-filter';

const logger = new Logger('GitOperationsSafe');

/**
 * Safe replacement for GitOperations class
 *
 * This class provides the same interface as the old GitOperations
 * but uses the safe git operations internally.
 */
export class GitOperationsSafe {
  private workspacePath: string;
  private statusCache: { status: GitStatus; timestamp: number } | null = null;
  private readonly CACHE_TTL = 1000; // 1 second cache
  private errorCount = 0;
  private readonly MAX_ERRORS = 5;

  // Cache for git check-ignore results to avoid subprocess spawning for every file event
  private gitIgnoreCache: Map<string, { ignored: boolean; timestamp: number }> = new Map();
  private readonly GIT_IGNORE_CACHE_TTL = 30000; // 30 second cache

  constructor(workspacePath: string) {
    this.workspacePath = workspacePath;
  }

  /**
   * Get git status with caching
   */
  async getStatus(): Promise<GitStatus> {
    // Check cache
    if (this.statusCache && Date.now() - this.statusCache.timestamp < this.CACHE_TTL) {
      return this.statusCache.status;
    }

    try {
      // First check if the directory exists
      const fs = await import('fs');
      if (!fs.existsSync(this.workspacePath)) {
        logger.warn('Workspace directory does not exist', {
          workspacePath: this.workspacePath,
        });
        // Return empty status for non-existent directory
        return {
          staged: [],
          stagedAdded: [],
          stagedDeleted: [],
          unstaged: [],
          untracked: [],
          deleted: [],
          renamed: new Map<string, string>(),
        };
      }

      // Use --untracked-files=all (-uall) to list individual files within untracked directories
      // instead of just showing the directory name (e.g., "src/routes/leaderboard/+page.svelte"
      // instead of "src/routes/leaderboard/")
      const result = await safeGitStatus(this.workspacePath, { all: true });

      // Parse the status output
      const status: GitStatus = {
        staged: [],
        stagedAdded: [],
        stagedDeleted: [],
        unstaged: [],
        untracked: [],
        deleted: [],
        renamed: new Map(),
      };

      const lines = result.stdout.split('\n').filter((line: string) => line.trim());

      for (const line of lines) {
        if (!line || line.length < 3) continue;

        const x = line[0];
        const y = line[1];
        const filePath = line.substring(3);

        // Skip directory paths (end with /) - git sometimes returns directories
        // even with --untracked-files=all if the directory is empty or all contents are gitignored
        if (filePath.endsWith('/')) {
          logger.debug('Skipping directory path in git status', { filePath });
          continue;
        }

        // Handle renamed files
        if (line.includes(' -> ')) {
          const [oldPath, newPath] = filePath.split(' -> ');
          status.renamed.set(oldPath, newPath);
          if (x === 'R') {
            status.staged.push(newPath);
          } else if (y === 'R') {
            status.unstaged.push(newPath);
          }
          continue;
        }

        // Staged changes
        if (x !== ' ' && x !== '?') {
          if (x === 'D') {
            // Staged deletion (file deleted and staged for commit)
            status.stagedDeleted.push(filePath);
          } else if (x === 'A') {
            // Staged new file (added to index but didn't exist in HEAD)
            status.stagedAdded.push(filePath);
          } else {
            status.staged.push(filePath);
          }
        }

        // Unstaged changes
        if (y !== ' ' && y !== '?') {
          if (y === 'D') {
            // Unstaged deletion (file deleted but not staged)
            if (!status.deleted.includes(filePath)) {
              status.deleted.push(filePath);
            }
          } else {
            status.unstaged.push(filePath);
          }
        }

        // Untracked files
        if (x === '?' && y === '?') {
          status.untracked.push(filePath);
        }
      }

      // Cache the result
      this.statusCache = {
        status,
        timestamp: Date.now(),
      };

      // Reset error count on success
      this.errorCount = 0;

      return status;
    } catch (error) {
      this.errorCount++;

      if (this.errorCount >= this.MAX_ERRORS) {
        logger.error('Max git errors exceeded', {
          errorCount: this.errorCount,
          workspacePath: this.workspacePath,
          error,
        });
        throw new Error(`Git operations failed ${this.MAX_ERRORS} times consecutively`);
      }

      logger.error('Failed to get git status', {
        workspacePath: this.workspacePath,
        errorCount: this.errorCount,
        error,
      });

      // Return empty status on error
      return {
        staged: [],
        stagedAdded: [],
        stagedDeleted: [],
        unstaged: [],
        untracked: [],
        deleted: [],
        renamed: new Map(),
      };
    }
  }

  /**
   * Get diff for a single file
   *
   * Checks if the file is binary or too large before attempting to diff.
   */
  async getDiff(filePath: string, staged: boolean = false): Promise<GitDiffResult> {
    try {
      // Check if file is diffable (not binary, not too large)
      const { skipped } = await filterDiffableFiles(this.workspacePath, [filePath]);

      if (skipped.length > 0) {
        const skip = skipped[0];
        return {
          path: filePath,
          additions: 0,
          deletions: 0,
          diff: skip.reason === 'binary' || skip.reason === 'binary-content' ? 'Binary file (not shown)' : 'File too large to diff',
          isBinary: skip.reason === 'binary' || skip.reason === 'binary-content',
          isTooLarge: skip.reason === 'too-large',
        };
      }

      const diffResult = await safeGitDiff(this.workspacePath, filePath, { staged });
      const diff = diffResult.stdout;

      // Parse diff to extract additions and deletions
      let additions = 0;
      let deletions = 0;

      const lines = diff.split('\n');
      for (const line of lines) {
        if (line.startsWith('+') && !line.startsWith('+++')) {
          additions++;
        } else if (line.startsWith('-') && !line.startsWith('---')) {
          deletions++;
        }
      }

      return {
        path: filePath,
        additions,
        deletions,
        diff,
      };
    } catch (error) {
      logger.error('Failed to get diff', {
        filePath,
        staged,
        error,
      });

      return {
        path: filePath,
        additions: 0,
        deletions: 0,
        diff: '',
      };
    }
  }

  /**
   * Get diffs for multiple files in batch
   *
   * Filters out binary files and files that are too large to diff safely.
   * Binary files will be returned with an empty diff and isBinary: true.
   */
  async getBatchDiffs(filePaths: string[]): Promise<Map<string, GitDiffResult>> {
    try {
      // Filter out binary and large files to prevent crashes
      const { diffable, skipped } = await filterDiffableFiles(this.workspacePath, filePaths);
      const results = new Map<string, GitDiffResult>();

      // Add skipped files with special markers
      for (const { path: filePath, reason } of skipped) {
        results.set(filePath, {
          path: filePath,
          additions: 0,
          deletions: 0,
          diff: reason === 'binary' || reason === 'binary-content' ? 'Binary file (not shown)' : 'File too large to diff',
          isBinary: reason === 'binary' || reason === 'binary-content',
          isTooLarge: reason === 'too-large',
        } as GitDiffResult);
      }

      // Only diff the files that passed filtering
      if (diffable.length > 0) {
        const diffs = await safeGitDiffBatch(this.workspacePath, diffable);

        for (const [filePath, diffResult] of diffs.entries()) {
          const diff = diffResult.stdout;
          // Parse diff to extract additions and deletions
          let additions = 0;
          let deletions = 0;

          const lines = diff.split('\n');
          for (const line of lines) {
            if (line.startsWith('+') && !line.startsWith('+++')) {
              additions++;
            } else if (line.startsWith('-') && !line.startsWith('---')) {
              deletions++;
            }
          }

          results.set(filePath, {
            path: filePath,
            additions,
            deletions,
            diff,
          });
        }
      }

      return results;
    } catch (error) {
      logger.error('Failed to get batch diffs', {
        fileCount: filePaths.length,
        error,
      });

      // Return empty results on error
      const results = new Map<string, GitDiffResult>();
      for (const filePath of filePaths) {
        results.set(filePath, {
          path: filePath,
          additions: 0,
          deletions: 0,
          diff: '',
        });
      }
      return results;
    }
  }

  /**
   * Check if files are ignored by git
   */
  async checkIgnored(filePaths: string[]): Promise<Set<string>> {
    try {
      const ignoredSet = new Set<string>();
      for (const filePath of filePaths) {
        const isIgnored = await safeGitCheckIgnore(this.workspacePath, filePath);
        if (isIgnored) {
          ignoredSet.add(filePath);
        }
      }
      return ignoredSet;
    } catch (error) {
      logger.error('Failed to check ignored files', {
        fileCount: filePaths.length,
        error,
      });
      return new Set();
    }
  }

  /**
   * Check if a single file is ignored by git, with caching.
   * Uses a 30-second TTL cache to avoid spawning a subprocess for every file event.
   * This is the preferred method for real-time file watcher filtering.
   */
  async checkIgnoredSingle(filePath: string): Promise<boolean> {
    // Check cache first
    const cached = this.gitIgnoreCache.get(filePath);
    if (cached && Date.now() - cached.timestamp < this.GIT_IGNORE_CACHE_TTL) {
      return cached.ignored;
    }

    try {
      const isIgnored = await safeGitCheckIgnore(this.workspacePath, filePath);
      // Update cache
      this.gitIgnoreCache.set(filePath, { ignored: isIgnored, timestamp: Date.now() });
      return isIgnored;
    } catch (error) {
      logger.debug('Failed to check if file is ignored', { filePath, error });
      // On error, don't cache and return false (don't filter)
      return false;
    }
  }

  /**
   * Clear the gitignore cache. Call this when .gitignore files change.
   */
  clearGitIgnoreCache(): void {
    this.gitIgnoreCache.clear();
  }

  /**
   * Get current branch
   */
  async getCurrentBranch(): Promise<string> {
    try {
      const branch = await safeGitCurrentBranch(this.workspacePath);
      return branch || 'unknown';
    } catch (error) {
      logger.error('Failed to get current branch', { error });
      return 'unknown';
    }
  }

  /**
   * Check if path is a git repository
   */
  async isGitRepository(): Promise<boolean> {
    return await safeIsGitRepository(this.workspacePath);
  }

  /**
   * Invalidate the status cache.
   * Note: Does NOT clear the gitignore cache (which has a 30s TTL).
   * Call clearGitIgnoreCache() separately when .gitignore files change.
   */
  invalidateCache(): void {
    this.statusCache = null;
  }

  /**
   * Get error count
   */
  getErrorCount(): number {
    return this.errorCount;
  }

  /**
   * Reset error count
   */
  resetErrorCount(): void {
    this.errorCount = 0;
  }

  /**
   * Get diffs for multiple staged files in batch
   *
   * Same as getBatchDiffs but uses --cached to get staged changes.
   */
  async getBatchDiffsStaged(filePaths: string[]): Promise<Map<string, GitDiffResult>> {
    try {
      // Filter out binary and large files to prevent crashes
      const { diffable, skipped } = await filterDiffableFiles(this.workspacePath, filePaths);
      const results = new Map<string, GitDiffResult>();

      // Add skipped files with special markers
      for (const { path: filePath, reason } of skipped) {
        results.set(filePath, {
          path: filePath,
          additions: 0,
          deletions: 0,
          diff: reason === 'binary' || reason === 'binary-content' ? 'Binary file (not shown)' : 'File too large to diff',
          isBinary: reason === 'binary' || reason === 'binary-content',
          isTooLarge: reason === 'too-large',
        } as GitDiffResult);
      }

      // Only diff the files that passed filtering
      if (diffable.length > 0) {
        const diffs = await safeGitDiffBatch(this.workspacePath, diffable, { staged: true });

        for (const [filePath, diffResult] of diffs.entries()) {
          const diff = diffResult.stdout;
          // Parse diff to extract additions and deletions
          let additions = 0;
          let deletions = 0;

          const lines = diff.split('\n');
          for (const line of lines) {
            if (line.startsWith('+') && !line.startsWith('+++')) {
              additions++;
            } else if (line.startsWith('-') && !line.startsWith('---')) {
              deletions++;
            }
          }

          results.set(filePath, {
            path: filePath,
            additions,
            deletions,
            diff,
          });
        }
      }

      return results;
    } catch (error) {
      logger.error('Failed to get batch staged diffs', {
        fileCount: filePaths.length,
        error,
      });

      // Return empty results on error
      const results = new Map<string, GitDiffResult>();
      for (const filePath of filePaths) {
        results.set(filePath, {
          path: filePath,
          additions: 0,
          deletions: 0,
          diff: '',
        });
      }
      return results;
    }
  }

  /**
   * Get file content at HEAD (before any changes)
   *
   * Useful for calculating deletions for deleted files.
   */
  async getFileAtHead(filePath: string): Promise<string | null> {
    try {
      const result = await execGitCommand(['show', `HEAD:${filePath}`], {
        cwd: this.workspacePath,
        maxBuffer: 10 * 1024 * 1024, // 10MB
      });

      if (result.exitCode === 0) {
        return result.stdout;
      }
      return null;
    } catch (error) {
      logger.debug('Failed to get file at HEAD (might be new file)', {
        filePath,
        error,
      });
      return null;
    }
  }
}

// Export as default for easier migration
export default GitOperationsSafe;
