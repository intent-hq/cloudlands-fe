/**
 * Git Service
 *
 * Pure business logic for git operations.
 */

import fs from 'fs';
import { createRequire } from 'module';
import path from 'path';
import {
  execAsyncRobust as execAsync,
  execFileAsync,
  execFileAsyncWithRetry,
} from '../../../shared/git/git-env';
import { Logger } from '../../../shared/logger';
import { WorkspaceConfig } from '../../../shared/main/config.js';
import type {
  CommitInfo,
  DiffChunk,
  FileStatus,
  GitStatus,
  Result,
  WorkspaceId,
} from '../../../shared/types';
import {
  GitFileStatus,
  LineType,
} from '../../../shared/types';
import { filterDiffableFiles } from '../../workspace/main/change-detection/diffable-file-filter';
import { getWorktreesLocation } from '../../workspace/main/app-settings.service';
import type { WorkspaceRepository } from '../../workspace/main/workspace.repository';
import { FileSystemWorkspaceRepository } from '../../workspace/main/workspace.repository';

const require = createRequire(import.meta.url);
const logger = new Logger('GitService');

interface GitNumstatEntry {
  filePath: string;
  additions: number;
  deletions: number;
}

export class GitService {
  private readonly workspaceRepository: WorkspaceRepository;
  private statusCache = new Map<string, { status: GitStatus; timestamp: number }>();
  private readonly CACHE_TTL = 5000; // 5 seconds cache TTL - increased to reduce refresh frequency

  // Request deduplication: pending status requests per workspace
  private pendingStatusRequests = new Map<string, Promise<Result<GitStatus, string>>>();

  // Request deduplication: pending history requests per workspace+params
  private pendingHistoryRequests = new Map<
    string,
    Promise<Result<{ commits: CommitInfo[]; boundarySha?: string }, string>>
  >();

  // Result cache for getHistory to avoid redundant calls within a short window
  private historyCache = new Map<
    string,
    { result: Result<{ commits: CommitInfo[]; boundarySha?: string }, string>; timestamp: number }
  >();
  private readonly HISTORY_CACHE_TTL = 5000; // 5 seconds

  // Cache for merge-base (boundary) computation to avoid repeated expensive git subprocess calls
  private boundaryCache = new Map<
    string,
    { boundary: string | null; currentBranch: string; timestamp: number }
  >();
  private readonly BOUNDARY_CACHE_TTL = 10000; // 10 seconds

  // Cache for divergence check results to avoid repeated expensive git rev-parse + merge-base calls
  // Keyed by `${workspaceId}-${branchName}`, stores whether remote branch exists and divergence state
  private divergenceCache = new Map<
    string,
    { remoteBranchExists: boolean; diverged: boolean; timestamp: number }
  >();
  private readonly DIVERGENCE_CACHE_TTL = 10000; // 10 seconds

  // Per-workspace mutex for serializing git write operations (stage, commit, push, etc.)
  // This prevents race conditions when multiple agents complete tasks simultaneously
  private gitOperationMutex = new Map<string, Promise<void>>();

  constructor() {
    this.workspaceRepository = new FileSystemWorkspaceRepository();
  }

  /**
   * Acquire a mutex lock for git operations on a specific workspace.
   * This ensures stage/commit/push operations are serialized per workspace.
   * @returns A release function to call when the operation is complete
   */
  private async acquireGitOperationMutex(workspaceId: WorkspaceId): Promise<() => void> {
    let release!: () => void;
    const newMutex = new Promise<void>((resolve) => {
      release = resolve;
    });

    // Wait for any pending operation to complete
    const previousMutex = this.gitOperationMutex.get(workspaceId) ?? Promise.resolve();
    this.gitOperationMutex.set(workspaceId, newMutex);

    await previousMutex;
    return release;
  }

  /**
   * Check if a directory is a git repository
   */
  async isRepository(dirPath: string): Promise<boolean> {
    try {
      const gitDir = path.join(dirPath, '.git');
      return fs.existsSync(gitDir);
    } catch (error) {
      logger.warn('Error checking if directory is a git repository', { dirPath, error });
      return false;
    }
  }

  /**
   * Get git status for a workspace (with caching and request deduplication)
   * Multiple simultaneous calls for the same workspace will share a single request
   */
  async getStatus(workspaceId: WorkspaceId): Promise<Result<GitStatus, string>> {
    // Validate workspaceId
    if (!workspaceId) {
      logger.warn('getStatus called with undefined workspaceId');
      return {
        ok: false,
        error: 'Invalid workspace ID',
      };
    }

    // Check cache first
    const cached = this.statusCache.get(workspaceId);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return { ok: true, data: cached.status };
    }

    // Check if there's already a pending request for this workspace
    const pendingRequest = this.pendingStatusRequests.get(workspaceId);
    if (pendingRequest) {
      logger.debug('Reusing pending git status request', { workspaceId });
      return pendingRequest;
    }

    // Create the request and track it
    const request = this._doGetStatus(workspaceId);
    this.pendingStatusRequests.set(workspaceId, request);

    // Clean up the pending request after completion
    request.finally(() => {
      this.pendingStatusRequests.delete(workspaceId);
    });

    return request;
  }

  /**
   * Internal method that actually performs the git status fetch
   */
  private async _doGetStatus(workspaceId: WorkspaceId): Promise<Result<GitStatus, string>> {
    try {
      // Remote workspaces can't do local git operations
      if (this.isRemoteWorkspace(workspaceId)) {
        const worktreePath = this.getWorktreePath(workspaceId);
        logger.debug('Skipping local git status for remote workspace', { workspaceId, worktreePath });
        const emptyStatus: GitStatus = {
          branch: '',
          ahead: 0,
          behind: 0,
          diverged: false,
          files: [],
          hasUncommittedChanges: false,
          hasUntrackedFiles: false,
        };
        this.statusCache.set(workspaceId, { status: emptyStatus, timestamp: Date.now() });
        return { ok: true, data: emptyStatus };
      }

      // Get the worktree path
      const worktreePath = this.getWorktreePath(workspaceId);

      // Verify it's a git repository
      const gitDir = path.join(worktreePath, '.git');
      const isGitRepo = fs.existsSync(gitDir);
      logger.debug('Getting git status', { workspaceId, isGitRepo });

      if (!isGitRepo) {
        logger.warn('Not a git repository', { workspaceId, worktreePath });
        // Return empty status if not a git repo
        const emptyStatus: GitStatus = {
          branch: '',
          ahead: 0,
          behind: 0,
          diverged: false,
          files: [],
          hasUncommittedChanges: false,
          hasUntrackedFiles: false,
        };
        this.statusCache.set(workspaceId, { status: emptyStatus, timestamp: Date.now() });
        return { ok: true, data: emptyStatus };
      }

      // Get branch info
      const { stdout: branch } = await execAsync('git branch --show-current', {
        cwd: worktreePath,
      });
      logger.debug('Current branch', { workspaceId, branch: branch.trim() });

      // Get ahead/behind info
      const branchTrimmed = branch.trim();
      const { stdout: revList } = await execFileAsync(
        'git',
        ['rev-list', '--left-right', '--count', `HEAD...origin/${branchTrimmed}`],
        {
          cwd: worktreePath,
        },
      ).catch(() => ({ stdout: '0\t0' })); // Default if no upstream

      const [ahead, behind] = revList.trim().split('\t').map(Number);
      logger.debug('Branch status', { workspaceId, ahead, behind });

      // Check for divergence using merge-base (more reliable than ahead/behind check)
      // The command `git merge-base --is-ancestor origin/${branch} HEAD` returns 0 if
      // origin/branch is an ancestor of HEAD (i.e., we can fast-forward), and non-zero otherwise.
      let diverged = ahead > 0 && behind > 0; // Keep as fallback
      const branchName = branch.trim();
      if (branchName) {
        // Fast path: if ahead=0 && behind=0, the branch is perfectly in sync with
        // upstream (or has no upstream). Divergence is impossible — skip the expensive
        // merge-base subprocess calls (~580ms each).
        if (ahead === 0 && behind === 0) {
          diverged = false;
          logger.debug('Branch in sync (ahead=0, behind=0), skipping divergence check', {
            workspaceId,
            branch: branchName,
          });
        }
        // Check divergence cache to avoid expensive git subprocess calls (~580ms each)
        else {
          const divergenceCacheKey = `${workspaceId}-${branchName}`;
          const cachedDivergence = this.divergenceCache.get(divergenceCacheKey);
          if (
            cachedDivergence &&
            Date.now() - cachedDivergence.timestamp < this.DIVERGENCE_CACHE_TTL
          ) {
            diverged = cachedDivergence.diverged;
            logger.info('Using cached divergence result', {
              workspaceId,
              branch: branchName,
              diverged,
              remoteBranchExists: cachedDivergence.remoteBranchExists,
            });
          } else {
            logger.info('Checking divergence with merge-base', {
              workspaceId,
              branch: branchName,
            });

            // First, check if the remote branch exists
            let remoteBranchExists = false;
            try {
              await execFileAsync(
                'git',
                ['rev-parse', '--verify', `origin/${branchName}`],
                { cwd: worktreePath },
              );
              remoteBranchExists = true;
              logger.debug('Remote branch exists', { workspaceId, branch: branchName });
            } catch {
              remoteBranchExists = false;
              logger.debug('Remote branch does not exist', { workspaceId, branch: branchName });
            }

            // Only check for divergence if the remote branch exists
            if (remoteBranchExists) {
              try {
                await execFileAsync(
                  'git',
                  ['merge-base', '--is-ancestor', `origin/${branchName}`, 'HEAD'],
                  { cwd: worktreePath },
                );
                // Command succeeded = origin/branch is ancestor of HEAD = NOT diverged
                diverged = false;
                logger.info('Branch is NOT diverged (merge-base succeeded)', {
                  workspaceId,
                  branch: branchName,
                });
              } catch {
                // Command failed = origin/branch is NOT ancestor of HEAD
                // But only mark as diverged if we also have local commits (ahead > 0)
                // If ahead === 0, it's just "remote ahead" and we can pull normally
                diverged = ahead > 0;
                if (diverged) {
                  logger.info('Branch IS DIVERGED (merge-base failed and ahead > 0)', {
                    workspaceId,
                    branch: branchName,
                    ahead,
                  });
                } else {
                  logger.info(
                    'Branch is BEHIND but not diverged (merge-base failed but ahead === 0)',
                    {
                      workspaceId,
                      branch: branchName,
                      behind,
                    },
                  );
                }
              }
            } else {
              // Remote branch doesn't exist, so it's not diverged - just unpushed
              diverged = false;
              logger.info('Remote branch does not exist, not diverged', {
                workspaceId,
                branch: branchName,
              });
            }

            // Cache the divergence result
            this.divergenceCache.set(divergenceCacheKey, {
              remoteBranchExists,
              diverged,
              timestamp: Date.now(),
            });
          }
        }
      }

      // Get file status
      // Use --untracked-files=all to list individual files within untracked directories
      // instead of just showing the directory name (e.g., "src/stores/theme.ts" instead of "src/stores/")
      const { stdout: statusOutput } = await execAsync(
        'git status --porcelain --untracked-files=all',
        {
          cwd: worktreePath,
        },
      );

      // Reduced logging for git status output
      const statusLines = statusOutput.split('\n').filter((l) => l.trim());
      logger.debug('Git status output', {
        workspaceId,
        statusOutputLines: statusLines.length,
      });

      const files = this.parseStatusOutput(statusOutput);
      logger.debug('Parsed files from git status', {
        workspaceId,
        fileCount: files.length,
      });

      const status: GitStatus = {
        branch: branchName,
        ahead,
        behind,
        diverged,
        files,
        hasUncommittedChanges: files.some((f) => f.staged || f.status !== '?'),
        hasUntrackedFiles: files.some((f) => f.status === '?'),
      };

      // Cache the status before returning
      this.statusCache.set(workspaceId, {
        status,
        timestamp: Date.now(),
      });

      logger.info('Returning git status', {
        workspaceId,
        branch: branchName,
        ahead,
        behind,
        diverged,
      });
      return { ok: true, data: status };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Failed to get git status';
      logger.error('Error getting status for workspace', error as Error, { workspaceId });
      return {
        ok: false,
        error: errorMsg,
      };
    }
  }

  /**
   * Clear cache for a workspace (useful after git operations)
   */
  clearStatusCache(workspaceId: WorkspaceId): void {
    logger.debug('Clearing caches for workspace', { workspaceId });
    this.statusCache.delete(workspaceId);

    // Also clear any pending status requests to avoid returning stale data
    // from in-flight requests when .git/ changes are detected
    this.pendingStatusRequests.delete(workspaceId);

    // Also clear history and boundary caches for this workspace
    // to ensure fresh data after commits, pushes, branch switches, etc.
    for (const key of this.historyCache.keys()) {
      if (key.startsWith(`${workspaceId}-`)) {
        this.historyCache.delete(key);
      }
    }
    for (const key of this.boundaryCache.keys()) {
      if (key.startsWith(`${workspaceId}-`)) {
        this.boundaryCache.delete(key);
      }
    }
    for (const key of this.divergenceCache.keys()) {
      if (key.startsWith(`${workspaceId}-`)) {
        this.divergenceCache.delete(key);
      }
    }
  }

  /**
   * Clear all caches (useful when files change externally)
   */
  clearAllCaches(): void {
    logger.debug('Clearing all caches');
    this.statusCache.clear();
    this.historyCache.clear();
    this.boundaryCache.clear();
    this.divergenceCache.clear();
  }

  /**
   * Get current HEAD commit hash
   */
  async getCurrentHead(workspaceId: WorkspaceId): Promise<Result<string, string>> {
    // Validate workspaceId
    if (!workspaceId) {
      logger.warn('getCurrentHead called with undefined workspaceId');
      return {
        ok: false,
        error: 'Invalid workspace ID',
      };
    }

    try {
      const worktreePath = this.getWorktreePath(workspaceId);
      const { stdout } = await execAsync('git rev-parse HEAD', { cwd: worktreePath });
      return { ok: true, data: stdout.trim() };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Failed to get HEAD';
      return { ok: false, error: errorMsg };
    }
  }

  async commit(
    workspaceId: WorkspaceId,
    message: string,
    description?: string,
    options?: { filesToStage?: string[] },
  ): Promise<Result<CommitInfo, string>> {
    // Validate workspaceId
    if (!workspaceId) {
      logger.warn('commit called with undefined workspaceId');
      return {
        ok: false,
        error: 'Invalid workspace ID',
      };
    }

    // Acquire mutex to serialize git operations
    const release = await this.acquireGitOperationMutex(workspaceId);
    try {
      return await this.doCommit(workspaceId, message, description, options);
    } finally {
      release();
    }
  }

  /**
   * Internal commit implementation with retry logic for pre-commit hooks
   */
  private async doCommit(
    workspaceId: WorkspaceId,
    message: string,
    description?: string,
    options?: { filesToStage?: string[] },
    retryCount = 0,
  ): Promise<Result<CommitInfo, string>> {
    const MAX_RETRIES = 2; // Allow up to 2 retries for hook modifications
    const worktreePath = this.getWorktreePath(workspaceId);

    // Build commit message
    let fullMessage = message;
    if (description) {
      fullMessage += `\n\n${description}`;
    }

    try {
      // Make the commit - capture both stdout and stderr for debugging
      // Use larger buffer and timeout to handle large files with pre-commit hooks
      const { stdout: commitStdout, stderr: commitStderr } = await execAsync(
        `git commit -m "${fullMessage.replace(/"/g, '\\"')}"`,
        {
          cwd: worktreePath,
          maxBuffer: 50 * 1024 * 1024, // 50MB buffer for large pre-commit hook output
          timeout: 300_000, // 5 minute timeout for large files with hooks
        },
      );

      // Log commit output for debugging
      if (commitStdout || commitStderr) {
        logger.debug('Git commit output', {
          workspaceId,
          stdout: commitStdout?.substring(0, 500),
          stderr: commitStderr?.substring(0, 500),
        });
      }

      // Get commit info
      const { stdout: logOutput } = await execAsync('git log -1 --format="%H|%an|%ae|%aI|%s"', {
        cwd: worktreePath,
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer
      });

      const [hash, author, email, date, subject] = logOutput.trim().split('|');

      // Get changed files
      const { stdout: filesOutput } = await execAsync(
        `git diff-tree --no-commit-id --name-only -r ${hash}`,
        { cwd: worktreePath, maxBuffer: 10 * 1024 * 1024 },
      );

      const commitInfo: any = {
        hash,
        sha: hash, // Include both hash and sha for compatibility
        author,
        authorName: author,
        email,
        authorEmail: email,
        date,
        message: subject,
        files: filesOutput.trim().split('\n').filter(Boolean),
        isPushed: false, // Default to false, can be checked later if needed
      };

      // Clear cache after commit so next status check gets fresh data
      this.clearStatusCache(workspaceId);

      return { ok: true, data: commitInfo };
    } catch (error) {
      // Extract more useful error info - check both stdout and stderr
      const stdout = (error as any)?.stdout || '';
      const stderr = (error as any)?.stderr || '';
      const errorMessage = error instanceof Error ? error.message : 'Failed to commit changes';

      // Log the full error for debugging (stdout often has pre-commit hook output)
      logger.warn('Git commit attempt failed', {
        workspaceId,
        retryCount,
        errorMessage,
        stdout: stdout.substring(0, 500),
        stderr: stderr.substring(0, 500),
      });

      // Combine stdout and stderr for error analysis (pre-commit hooks often output to stdout)
      const combinedOutput = `${stdout}\n${stderr}`.trim();

      // Check for "nothing to commit" - this often means pre-commit hooks modified files
      const isNothingToCommit =
        combinedOutput.includes('nothing to commit') ||
        combinedOutput.includes('no changes added') ||
        combinedOutput.includes('working tree clean');

      // If hooks modified files and we haven't exhausted retries, re-stage and retry
      // IMPORTANT: Only retry if we have specific files to re-stage (from auto-commit)
      // Never use 'git add -u' which would stage ALL modified files including those
      // changed by setup scripts or other non-agent sources
      if (isNothingToCommit && retryCount < MAX_RETRIES) {
        // Only retry if we have specific files to re-stage
        if (options?.filesToStage && options.filesToStage.length > 0) {
          logger.info(
            'Commit failed with "nothing to commit", attempting to re-stage specific files and retry',
            {
              workspaceId,
              retryCount: retryCount + 1,
              filesToStage: options.filesToStage.length,
              files: options.filesToStage.slice(0, 5),
            },
          );

          try {
            // Re-stage only the specific files that were originally intended for commit
            await execFileAsync('git', ['add', '--', ...options.filesToStage], {
              cwd: worktreePath,
            });

            // Small delay to let filesystem settle
            await new Promise((resolve) => setTimeout(resolve, 100));

            // Retry the commit
            return await this.doCommit(workspaceId, message, description, options, retryCount + 1);
          } catch (restageError) {
            logger.error('Failed to re-stage files for retry', restageError as Error);
            return {
              ok: false,
              error: 'Pre-commit hooks modified files but re-staging failed',
            };
          }
        } else {
          // No specific files provided - don't blindly stage all files
          // This prevents accidentally committing setup script changes or other non-agent changes
          logger.warn(
            'Commit failed with "nothing to commit" but no specific files to re-stage. ' +
              'Not using "git add -u" to avoid committing unrelated changes.',
            {
              workspaceId,
              retryCount,
            },
          );
          return {
            ok: false,
            error:
              'Nothing to commit - staged files may have been unstaged by pre-commit hooks. ' +
              'Please stage specific files before committing.',
          };
        }
      }

      // Check for genuine pre-commit hook failures (not just file modifications)
      const isHookFailure =
        combinedOutput.includes('pre-commit') ||
        combinedOutput.includes('hook') ||
        combinedOutput.includes('Fixing');

      if (isHookFailure && !isNothingToCommit) {
        return {
          ok: false,
          error: `Pre-commit hooks failed: ${combinedOutput.split('\n').slice(0, 5).join(' ').substring(0, 200)}`,
        };
      }

      // Nothing to commit after retries - report clearly
      if (isNothingToCommit) {
        return {
          ok: false,
          error: 'Nothing to commit - no staged changes found after pre-commit hooks',
        };
      }

      return {
        ok: false,
        error: combinedOutput || errorMessage,
      };
    }
  }



  /**
   * List all branches
   * @param workspaceId - The workspace ID
   * @param includeRemote - Whether to include remote branches
   */
  async listBranches(
    workspaceId: WorkspaceId,
    includeRemote = false,
  ): Promise<Result<string[], string>> {
    try {
      const worktreePath = this.getWorktreePath(workspaceId);

      const command = includeRemote ? 'git branch -a' : 'git branch';
      const { stdout } = await execAsync(command, { cwd: worktreePath });

      const branches = stdout
        .split('\n')
        .map((b) => b.trim())
        .filter((b) => b.length > 0)
        .map((b) => b.replace(/^[*+]\s*/, '')); // Remove current branch marker (*) and worktree marker (+)

      return { ok: true, data: branches };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Failed to list branches',
      };
    }
  }

  /**
   * Get diff for files
   * @param workspaceId - The workspace ID
   * @param paths - Optional file paths to get diff for
   * @param staged - If true, get staged diff (git diff --cached). If false, get unstaged diff (git diff). If undefined, get all changes (git diff HEAD)
   */
  async getDiff(
    workspaceId: WorkspaceId,
    paths?: string[],
    staged?: boolean,
  ): Promise<Result<DiffChunk[], string>> {
    // Validate workspaceId
    if (!workspaceId) {
      logger.warn('getDiff called with undefined workspaceId');
      return {
        ok: false,
        error: 'Invalid workspace ID',
      };
    }

    try {
      const worktreePath = this.getWorktreePath(workspaceId);

      // Convert absolute paths to relative paths
      // This handles cases where the caller passes absolute paths instead of relative
      const normalizedPaths = paths?.map((p) => {
        if (p.startsWith('/')) {
          // First try: check if it starts with the current worktree path
          if (worktreePath && (p === worktreePath || p.startsWith(worktreePath + '/'))) {
            return p === worktreePath ? '' : p.slice(worktreePath.length + 1);
          }
          // Second try: extract relative part from any workspace absolute path
          // Pattern: ~/intent/{id}/{project}/{relative-path} (also legacy ~/.workspaces/)
          const workspacesMatch = p.match(/(?:intent|\.workspaces)\/[^/]+\/[^/]+\/(.+)$/);
          if (workspacesMatch) {
            logger.debug('Converted absolute workspace path to relative', {
              original: p,
              converted: workspacesMatch[1],
            });
            return workspacesMatch[1];
          }
          // Last resort: just use the basename
          const parts = p.split('/');
          logger.warn('Could not convert absolute path, using basename', {
            original: p,
            basename: parts[parts.length - 1],
          });
          return parts[parts.length - 1];
        }
        return p;
      });

      // First, check if we're dealing with new/untracked files
      let chunks: DiffChunk[] = [];

      if (normalizedPaths && normalizedPaths.length > 0) {
        // Filter out binary and large files to prevent crashes
        const { diffable: diffablePaths, skipped: skippedPaths } = await filterDiffableFiles(
          worktreePath,
          normalizedPaths,
        );

        // Add placeholder chunks for skipped files
        for (const { path: skippedPath, reason } of skippedPaths) {
          chunks.push({
            file: skippedPath,
            chunks: [],
            oldContent: '',
            newContent:
              reason === 'binary' || reason === 'binary-content'
                ? '[Binary file - content not shown]'
                : '[File too large to display diff]',
            isBinary: reason === 'binary' || reason === 'binary-content',
          } as DiffChunk);
        }

        logger.debug('Processing normalized paths for diff', {
          normalizedPaths,
          diffablePaths,
          skippedCount: skippedPaths.length,
          staged,
          worktreePath,
        });

        // Check the status of each file first
        for (const filePath of diffablePaths) {
          try {
            const { stdout: statusOutput } = await execAsync(
              `git status --porcelain -- "${filePath}"`,
              { cwd: worktreePath },
            );

            logger.debug('Git status for file in getDiff', {
              filePath,
              statusOutput: statusOutput.trim(),
              statusCode: statusOutput.substring(0, 2),
              staged,
            });

            if (statusOutput) {
              const statusCode = statusOutput.substring(0, 2);

              // Check if it's a new/untracked file
              // ?? = untracked file
              // A  = file added to index (staged)
              // AM = file added to index with modifications in working tree
              //  M = modified in working tree only
              // M  = modified in index only
              const isUntrackedFile = statusCode === '??';
              const isNewStagedFile = statusCode[0] === 'A' && staged === true;
              const isModifiedFile = statusCode.includes('M');

              // Only handle as new file if it's truly new (untracked or added)
              logger.debug('Checking new file handling', {
                filePath,
                isUntrackedFile,
                isNewStagedFile,
                isModifiedFile,
                staged,
                willHandleAsNewFile: (isUntrackedFile && staged === false) || isNewStagedFile,
              });

              if ((isUntrackedFile && staged === false) || isNewStagedFile) {
                // For new files, create synthetic diff
                logger.debug('Handling as new/untracked file', {
                  filePath,
                  isUntrackedFile,
                  isNewStagedFile,
                });
                let fileContent = '';

                if (isNewStagedFile) {
                  // For staged new files, read from the index
                  try {
                    const { stdout } = await execAsync(`git show :"${filePath}"`, {
                      cwd: worktreePath,
                    });
                    fileContent = stdout;
                  } catch (err) {
                    logger.warn('Could not read staged new file from index', {
                      filePath,
                      error: err,
                    });
                  }
                } else {
                  // For untracked files, read from the working tree (ASYNC)
                  const { promises: fsPromises } = require('fs');
                  const path = require('path');
                  const fullPath = path.join(worktreePath, filePath);

                  logger.debug('Reading untracked file', { filePath, fullPath });

                  try {
                    fileContent = await fsPromises
                      .readFile(fullPath, 'utf-8')
                      .catch((err: Error) => {
                        logger.warn('Failed to read untracked file', {
                          fullPath,
                          error: err.message,
                        });
                        return '';
                      });
                    logger.debug('Read untracked file content', {
                      filePath,
                      contentLength: fileContent.length,
                      contentPreview: fileContent.substring(0, 100),
                    });
                  } catch (err) {
                    logger.warn('Could not read untracked file', {
                      filePath,
                      fullPath,
                      error: err,
                    });
                  }
                }

                if (fileContent || fileContent === '') {
                  const chunk: DiffChunk = {
                    file: filePath,
                    chunks: [],
                    oldContent: '',
                    newContent: fileContent,
                  };

                  // Create synthetic diff lines
                  if (fileContent) {
                    const lines = fileContent.split('\n');
                    const hunk = {
                      oldStart: 0,
                      oldLines: 0,
                      newStart: 1,
                      newLines: lines.length,
                      lines: lines.map((line) => ({
                        type: LineType.Addition,
                        content: line,
                      })),
                    };
                    chunk.chunks.push(hunk);
                  }

                  chunks.push(chunk);

                  // Skip normal diff processing for this file
                  continue;
                }
              }
            }
          } catch  {
            // Could not check file status
          }
        }
      }

      // If we already handled the file as new, return early
      if (chunks.length > 0) {
        return { ok: true, data: chunks };
      }

      // Build command based on staged parameter for normal diff
      let command = 'git diff';
      if (staged === true) {
        // Show staged changes (index vs HEAD)
        command += ' --cached';
      } else if (staged === false) {
        // Show unstaged changes (working tree vs index)
        // This is the default behavior of git diff
      } else {
        // Show all changes (working tree vs HEAD)
        command += ' HEAD';
      }

      if (normalizedPaths && normalizedPaths.length > 0) {
        command += ` -- ${normalizedPaths.map((p) => `"${p}"`).join(' ')}`;
      }

      logger.info('Executing git diff command', {
        command,
        staged,
        normalizedPaths,
        worktreePath,
      });

      const { stdout: diffOutput } = await execAsync(command, {
        cwd: worktreePath,
        maxBuffer: 50 * 1024 * 1024, // 50MB buffer for large diffs
      });

      logger.info('Git diff output', {
        diffOutputLength: diffOutput?.length,
        diffOutputPreview: diffOutput?.substring(0, 500),
        hasContent: !!diffOutput?.trim(),
      });

      chunks = this.parseDiff(diffOutput);
      // PERF: Changed from INFO to DEBUG to reduce log spam during polling
      logger.debug('Parsed diff chunks', {
        chunkCount: chunks.length,
        fileNames: chunks.map((c) => c.file),
      });

      // For each file in the diff, also get the full file content
      for (const chunk of chunks) {
        // Skip if we already have content (from new file handling above)
        if ((chunk as any).oldContent !== undefined && (chunk as any).newContent !== undefined) {
          continue;
        }

        try {
          let oldFileContent = '';
          let newFileContent = '';

          if (staged === true) {
            // For staged changes: compare index (staged) vs HEAD
            // oldContent = HEAD version, newContent = staged version
            try {
              const { stdout: headFileContent } = await execAsync(`git show HEAD:"${chunk.file}"`, {
                cwd: worktreePath,
              });
              oldFileContent = headFileContent;
            } catch  {
              // File might be new, so HEAD version doesn't exist
              oldFileContent = '';
            }

            try {
              const { stdout: stagedFileContent } = await execAsync(`git show :"${chunk.file}"`, {
                cwd: worktreePath,
              });
              newFileContent = stagedFileContent;
            } catch  {
              // File might be deleted in staging
              newFileContent = '';
            }
          } else {
            // For unstaged changes or all changes: use working tree
            // oldContent = HEAD (or index for unstaged), newContent = working tree
            try {
              const { stdout: fileContent } = await execAsync(`cat "${chunk.file}"`, {
                cwd: worktreePath,
              });
              newFileContent = fileContent;
            } catch  {
              // File might be deleted
              newFileContent = '';
            }

            if (staged === false) {
              // For unstaged changes: oldContent = index version
              try {
                const { stdout: indexFileContent } = await execAsync(`git show :"${chunk.file}"`, {
                  cwd: worktreePath,
                });
                oldFileContent = indexFileContent;
              } catch  {
                // File might be new, so index version doesn't exist
                oldFileContent = '';
              }
            } else {
              // For all changes: oldContent = HEAD version
              try {
                const { stdout: headFileContent } = await execAsync(
                  `git show HEAD:"${chunk.file}"`,
                  { cwd: worktreePath },
                );
                oldFileContent = headFileContent;
              } catch  {
                // File might be new, so HEAD version doesn't exist
                oldFileContent = '';
              }
            }
          }

          // Store the full content in the chunk for later use
          (chunk as any).oldContent = oldFileContent;
          (chunk as any).newContent = newFileContent;
        } catch (err) {
          logger.warn('Could not get full file content', { file: chunk.file, error: err });
        }
      }

      // NOTE: Removed synthetic diff fallback here.
      // Previously, when git diff returned empty (no changes), this code would create
      // a synthetic diff showing the entire file content as additions. This was wrong -
      // an empty diff means no changes, not "show the whole file as additions".
      //
      // Synthetic diffs for new/untracked files are already handled earlier in this
      // function (around line 1500-1550) by checking git status for new files.
      //
      // If chunks.length === 0 here, it means there are no changes for the specified
      // files, which is the correct result to return.

      return { ok: true, data: chunks };
    } catch (error) {
      logger.error('getDiff error', error as Error);
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Failed to get diff',
      };
    }
  }

  /**
   * Get committed branch diff for files, comparing the resolved workspace branch
   * base to HEAD. This intentionally excludes staged/unstaged working-tree
   * changes so renderer-side local-changes merging can treat all branch commits
   * as one committed part in HEAD coordinates.
   */
  async getBranchBaseDiff(
    workspaceId: WorkspaceId,
    paths?: string[],
    baseRef?: string,
    baseCommitSha?: string,
    targetRef = 'HEAD',
  ): Promise<Result<DiffChunk[], string>> {
    if (!workspaceId) {
      logger.warn('getBranchBaseDiff called with undefined workspaceId');
      return { ok: false, error: 'Invalid workspace ID' };
    }

    if (!baseRef && !baseCommitSha) {
      return { ok: false, error: 'Branch base information is required' };
    }

    try {
      const worktreePath = this.getWorktreePath(workspaceId);
      const normalizedPaths = paths?.map((p) => {
        if (p.startsWith('/')) {
          if (worktreePath && (p === worktreePath || p.startsWith(worktreePath + '/'))) {
            return p === worktreePath ? '' : p.slice(worktreePath.length + 1);
          }
          const workspacesMatch = p.match(/(?:intent|\.workspaces)\/[^/]+\/[^/]+\/(.+)$/);
          if (workspacesMatch) return workspacesMatch[1];
          return path.basename(p);
        }
        return p;
      });

      let diffablePaths = normalizedPaths;
      const chunks: DiffChunk[] = [];
      if (normalizedPaths && normalizedPaths.length > 0) {
        const filtered = await filterDiffableFiles(worktreePath, normalizedPaths);
        diffablePaths = filtered.diffable;
        for (const { path: skippedPath, reason } of filtered.skipped) {
          chunks.push({
            file: skippedPath,
            chunks: [],
            oldContent: '',
            newContent:
              reason === 'binary' || reason === 'binary-content'
                ? '[Binary file - content not shown]'
                : '[File too large to display diff]',
            isBinary: reason === 'binary' || reason === 'binary-content',
          } as DiffChunk);
        }

        if (diffablePaths.length === 0) {
          return { ok: true, data: chunks };
        }
      }

      const { stdout: currentBranchOut } = await execFileAsync('git', ['branch', '--show-current'], {
        cwd: worktreePath,
      });
      const currentBranch = currentBranchOut.trim() || targetRef;

      const [mergeBaseSha, validBaseCommitSha] = await Promise.all([
        (async (): Promise<string | null> => {
          if (!baseRef || currentBranch === baseRef) return null;
          const refsToTry = baseRef.includes('/') ? [baseRef] : [`origin/${baseRef}`, baseRef];
          for (const ref of refsToTry) {
            try {
              await execFileAsync('git', ['rev-parse', '--verify', ref], { cwd: worktreePath });
              const { stdout } = await execFileAsync('git', ['merge-base', targetRef, ref], {
                cwd: worktreePath,
              });
              const result = stdout.trim();
              if (result) return result;
            } catch {
              // Try the next candidate ref.
            }
          }
          return null;
        })(),
        (async (): Promise<string | null> => {
          if (!baseCommitSha) return null;
          try {
            await execFileAsync('git', ['merge-base', '--is-ancestor', baseCommitSha, targetRef], {
              cwd: worktreePath,
            });
            return baseCommitSha;
          } catch {
            return null;
          }
        })(),
      ]);

      // Match getHistory boundary resolution: prefer merge-base so rebased
      // branches collapse only the commits currently unique to this branch.
      // baseCommitSha remains a fallback for cases where merge-base cannot be
      // resolved (for example shallow or orphaned worktrees).
      const boundary = mergeBaseSha ?? validBaseCommitSha;
      if (!boundary) {
        logger.warn('getBranchBaseDiff: failed to resolve branch boundary', {
          workspaceId,
          baseRef,
          baseCommitSha: baseCommitSha?.substring(0, 8),
          targetRef,
        });
        return { ok: true, data: chunks };
      }

      const diffArgs = ['diff', `${boundary}..${targetRef}`];
      if (diffablePaths && diffablePaths.length > 0) {
        diffArgs.push('--', ...diffablePaths);
      }

      const { stdout: diffOutput } = await execFileAsync('git', diffArgs, {
        cwd: worktreePath,
        maxBuffer: 50 * 1024 * 1024,
      });

      chunks.push(...this.parseDiff(diffOutput));
      for (const chunk of chunks) {
        if (chunk.oldContent !== undefined && chunk.newContent !== undefined) continue;
        try {
          const { stdout } = await execFileAsync('git', ['show', `${boundary}:${chunk.file}`], {
            cwd: worktreePath,
          });
          chunk.oldContent = stdout;
        } catch {
          chunk.oldContent = '';
        }
        try {
          const { stdout } = await execFileAsync('git', ['show', `${targetRef}:${chunk.file}`], {
            cwd: worktreePath,
          });
          chunk.newContent = stdout;
        } catch {
          chunk.newContent = '';
        }
      }

      return { ok: true, data: chunks };
    } catch (error) {
      logger.error('getBranchBaseDiff error', error as Error);
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Failed to get branch-base diff',
      };
    }
  }

  /**
   * Get cheap line-count stats without loading full file contents.
   */
  async getNumstat(
    workspaceId: WorkspaceId,
    paths?: string[],
    staged?: boolean,
    baseRef?: string,
    baseCommitSha?: string,
    targetRef = 'HEAD',
  ): Promise<Result<GitNumstatEntry[], string>> {
    if (!workspaceId) {
      logger.warn('getNumstat called with undefined workspaceId');
      return { ok: false, error: 'Invalid workspace ID' };
    }

    try {
      const worktreePath = this.getWorktreePath(workspaceId);
      const normalizedPaths = this.normalizeDiffPaths(worktreePath, paths);
      const args = await this.buildNumstatArgs(
        worktreePath,
        normalizedPaths,
        staged,
        baseRef,
        baseCommitSha,
        targetRef,
      );

      const { stdout } = await execFileAsync('git', args, {
        cwd: worktreePath,
        maxBuffer: 10 * 1024 * 1024,
      });

      return { ok: true, data: this.parseNumstat(stdout) };
    } catch (error) {
      logger.error('getNumstat error', error as Error);
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Failed to get numstat',
      };
    }
  }

  /**
   * Get commit history
   */
  async getHistory(
    workspaceId: WorkspaceId,
    limit = 50,
    since?: string,
    baseRef?: string,
    baseCommitSha?: string,
  ): Promise<Result<{ commits: CommitInfo[]; boundarySha?: string }, string>> {
    // Validate workspaceId
    if (!workspaceId) {
      logger.warn('getHistory called with undefined workspaceId');
      return {
        ok: false,
        error: 'Invalid workspace ID',
      };
    }

    // Deduplicate concurrent getHistory calls with the same parameters
    const historyKey = `${workspaceId}-${limit}-${since ?? ''}-${baseRef ?? ''}-${baseCommitSha ?? ''}`;

    // Check result cache first (avoids redundant calls within a short window)
    const cachedResult = this.historyCache.get(historyKey);
    if (cachedResult && Date.now() - cachedResult.timestamp < this.HISTORY_CACHE_TTL) {
      logger.debug('Returning cached getHistory result', { workspaceId, limit });
      return cachedResult.result;
    }

    const pendingHistory = this.pendingHistoryRequests.get(historyKey);
    if (pendingHistory) {
      logger.debug('Reusing pending getHistory request', { workspaceId, limit });
      return pendingHistory;
    }

    const request = this._doGetHistory(workspaceId, limit, since, baseRef, baseCommitSha);
    this.pendingHistoryRequests.set(historyKey, request);
    request
      .then((result) => {
        // Cache successful results
        if (result.ok) {
          this.historyCache.set(historyKey, { result, timestamp: Date.now() });
        }
      })
      .finally(() => {
        this.pendingHistoryRequests.delete(historyKey);
      });
    return request;
  }

  private async _doGetHistory(
    workspaceId: WorkspaceId,
    limit = 50,
    since?: string,
    baseRef?: string,
    baseCommitSha?: string,
  ): Promise<Result<{ commits: CommitInfo[]; boundarySha?: string }, string>> {
    try {
      const worktreePath = this.getWorktreePath(workspaceId);

      // Log the filtering parameters for debugging
      logger.info('getHistory: Starting commit filtering', {
        workspaceId,
        hasBaseCommitSha: !!baseCommitSha,
        baseCommitSha: baseCommitSha?.substring(0, 8),
        hasBaseRef: !!baseRef,
        baseRef,
        worktreePath,
      });

      // Build git log command args (use execFileAsync to avoid shell interpretation
      // of special characters in branch names, e.g. quotes)
      // Use %x00 as delimiter between commits and %x01 for field separator
      // Include %b (body) to get commit message body which may contain trailers
      const logFormatArg = '--format=%H%x01%an%x01%ae%x01%aI%x01%s%x01%b%x00';
      let gitArgs = ['log', '--first-parent', '--no-merges', '-n', String(limit), logFormatArg];

      // Determine the commit range to show.
      // Strategy: if user has explicitly set a baseCommitSha, always use it.
      // Otherwise fall back to merge-base with the base branch.
      //
      // Resolution order:
      //   1. Validate baseCommitSha as ancestor of HEAD — if valid, use it (user's explicit choice)
      //   2. Compute merge-base with base branch (rebase-resilient default)
      //   3. --since=<creation-date> as last resort
      let rangeResolved = false;

      // PERF: Check boundary cache to avoid expensive merge-base computation (4-6 git subprocesses)
      const boundaryCacheKey = `${workspaceId}-${baseRef ?? ''}-${baseCommitSha ?? ''}`;
      const cachedBoundary = this.boundaryCache.get(boundaryCacheKey);
      let boundary: string | null = null;
      let currentBranch: string;

      if (cachedBoundary && Date.now() - cachedBoundary.timestamp < this.BOUNDARY_CACHE_TTL) {
        // Use cached boundary - saves 4-6 git subprocess calls
        boundary = cachedBoundary.boundary;
        currentBranch = cachedBoundary.currentBranch;
        rangeResolved = boundary !== null;
        logger.debug('getHistory: Using cached boundary', {
          workspaceId,
          boundary: boundary?.substring(0, 8),
          currentBranch,
        });
      } else {
        // Get current branch (or HEAD if detached)
        const { stdout: currentBranchOut } = await execAsync('git branch --show-current', {
          cwd: worktreePath,
        });
        currentBranch = currentBranchOut.trim() || 'HEAD';

        // PERF: Run merge-base computation and baseCommitSha validation in parallel
        // These are independent operations that each spawn git subprocesses
        const [mergeBaseSha, validBaseCommitSha] = await Promise.all([
          // Compute merge-base boundary
          (async (): Promise<string | null> => {
            if (!baseRef || currentBranch === baseRef) return null;
            const refsToTry = [`origin/${baseRef}`, baseRef];
            for (const ref of refsToTry) {
              try {
                await execAsync(`git rev-parse --verify ${ref}`, { cwd: worktreePath });
                const { stdout: mergeBaseOut } = await execAsync(`git merge-base HEAD ${ref}`, {
                  cwd: worktreePath,
                });
                const result = mergeBaseOut.trim();
                if (result) {
                  logger.debug('getHistory: Found merge-base', {
                    workspaceId,
                    ref,
                    mergeBase: result.substring(0, 8),
                  });
                  return result;
                }
              } catch {
                // This ref doesn't exist or merge-base failed, try next
              }
            }
            return null;
          })(),
          // Validate baseCommitSha as ancestor of HEAD
          (async (): Promise<string | null> => {
            if (!baseCommitSha) return null;
            try {
              await execFileAsync('git', ['merge-base', '--is-ancestor', baseCommitSha, currentBranch], {
                cwd: worktreePath,
              });
              logger.debug('getHistory: baseCommitSha is valid ancestor', {
                workspaceId,
                baseCommitSha: baseCommitSha.substring(0, 8),
              });
              return baseCommitSha;
            } catch {
              logger.debug('getHistory: baseCommitSha is not an ancestor of HEAD, skipping', {
                workspaceId,
                baseCommitSha: baseCommitSha?.substring(0, 8),
              });
              return null;
            }
          })(),
        ]);

        // Pick the boundary to use.
        // Prefer merge-base: it dynamically adjusts after rebase, so it only
        // shows commits that belong to the workspace branch. baseCommitSha is
        // frozen at workspace-creation time, so after a rebase it includes
        // parent-branch commits that were rebased onto the branch.
        // baseCommitSha is still useful as a fallback when merge-base can't be
        // computed (e.g. orphan branch, shallow clone).
        if (mergeBaseSha) {
          boundary = mergeBaseSha;
          logger.info('getHistory: Using merge-base as boundary', {
            workspaceId,
            mergeBase: mergeBaseSha.substring(0, 8),
            baseCommitSha: validBaseCommitSha?.substring(0, 8) ?? 'none',
            currentBranch,
          });
        } else if (validBaseCommitSha) {
          boundary = validBaseCommitSha;
          logger.info('getHistory: Using baseCommitSha as boundary (no merge-base)', {
            workspaceId,
            baseCommitSha: validBaseCommitSha.substring(0, 8),
            currentBranch,
          });
        }

        // Cache the boundary computation for subsequent calls
        this.boundaryCache.set(boundaryCacheKey, {
          boundary,
          currentBranch,
          timestamp: Date.now(),
        });
      }

      if (boundary) {
        gitArgs = ['log', '--first-parent', '--no-merges', '-n', String(limit), logFormatArg, `${boundary}..${currentBranch}`];
        rangeResolved = true;
      }

      // Final fallback - use --since if available
      if (!rangeResolved && since) {
        gitArgs.push(`--since=${since}`);
        logger.info('getHistory: Falling back to --since filter', { workspaceId, since });
      }

      // Safety net: if the caller provided boundary info (baseRef or baseCommitSha) but
      // it all failed to resolve, AND there's no since fallback, return empty rather than
      // showing arbitrary recent commits that likely belong to the base branch.
      // If the caller didn't provide any boundary info, this is a legitimate "show recent
      // commits" request (e.g., agent PR context) — let it fall through to unbounded log.
      if (!rangeResolved && !since && (baseRef || baseCommitSha)) {
        logger.warn('getHistory: Boundary info provided but failed to resolve, returning empty', {
          workspaceId,
          baseRef,
          baseCommitSha: baseCommitSha?.substring(0, 8),
          currentBranch,
        });
        return { ok: true, data: { commits: [], boundarySha: undefined } };
      }

      const gitCommand = `git ${gitArgs.join(' ')}`;
      logger.info('getHistory: Executing git command', {
        workspaceId,
        gitCommand: gitCommand.substring(0, 200),
        rangeResolved,
      });

      // PERF: Run git log and unpushed commits check in parallel
      // These are independent operations that can execute concurrently
      const [logResult, unpushedResult] = await Promise.all([
        execFileAsyncWithRetry('git', gitArgs, { cwd: worktreePath }),
        (currentBranch && currentBranch !== 'HEAD'
          ? execFileAsync('git', ['log', `origin/${currentBranch}..HEAD`, '--format=%H'], { cwd: worktreePath })
          : Promise.reject(new Error('Detached HEAD: no upstream to compare')))
          .then(({ stdout: unpushedOutput }) => {
            const hashes = new Set(unpushedOutput.trim().split('\n').filter(Boolean));
            logger.debug('Unpushed commits detected', {
              workspaceId,
              unpushedCount: hashes.size,
              unpushedHashes: Array.from(hashes).map((h) => h.substring(0, 8)),
            });
            return { hashes, hasUpstream: true, useContainsCheck: false };
          })
          .catch(() => {
            // No upstream set - we'll use `git branch -r --contains` for each commit instead
            logger.debug('No upstream set, will check each commit against remote branches', {
              workspaceId,
            });
            return { hashes: new Set<string>(), hasUpstream: false, useContainsCheck: true };
          }),
      ]);

      const logOutput = logResult.stdout;
      const unpushedHashes = unpushedResult.hashes;
      const hasUpstream = unpushedResult.hasUpstream;
      const useContainsCheck = unpushedResult.useContainsCheck;

      const commits: CommitInfo[] = [];
      // Split by null character to get individual commits (new format uses %x00 as delimiter)
      const commitBlocks = logOutput.split('\x00').filter(Boolean);

      for (const block of commitBlocks) {
        // Split by \x01 to get fields: hash, author, email, date, subject, body
        const fields = block.split('\x01');
        if (fields.length < 5) continue; // Skip malformed entries

        // Trim the hash to remove any leading/trailing whitespace or newlines
        // (can occur from block splitting)
        const [rawHash, author, email, date, subject, body = ''] = fields;
        const hash = rawHash.trim();

        // Parse trailers from body (Agent-Id: xxx, Linked-Note-Id: xxx)
        let agentId: string | undefined;
        let linkedNoteId: string | undefined;

        const bodyLines = body.trim().split('\n');
        for (const line of bodyLines) {
          const agentMatch = line.match(/^Agent-Id:\s*(.+)$/);
          if (agentMatch) {
            agentId = agentMatch[1].trim();
          }
          const noteMatch = line.match(/^Linked-Note-Id:\s*(.+)$/);
          if (noteMatch) {
            linkedNoteId = noteMatch[1].trim();
          }
        }

        // Filter by since date if provided - this is a safety net to exclude old commits.
        // Only apply when we DON'T have a resolved commit range (boundary..HEAD),
        // because when the user explicitly sets a base commit, the commits between
        // that base and HEAD may be older than the workspace creation date.
        if (since && !rangeResolved) {
          try {
            const commitDate = new Date(date);
            const sinceDate = new Date(since);
            if (commitDate < sinceDate) {
              continue;
            }
          } catch  {
            // Error parsing date, include the commit
          }
        }

        // Determine if commit is pushed:
        // - If has upstream, check if commit hash is NOT in the unpushed set
        // - If no upstream, use `git branch -r --contains` to check if it exists on any remote branch
        let isPushed = false;
        if (hasUpstream) {
          isPushed = !unpushedHashes.has(hash);
        } else if (useContainsCheck) {
          try {
            const { stdout: remoteBranches } = await execAsync(`git branch -r --contains ${hash}`, {
              cwd: worktreePath,
              timeout: 5000,
            });
            isPushed = remoteBranches.trim().length > 0;
          } catch {
            // If check fails, assume not pushed
            isPushed = false;
          }
        }

        commits.push({
          hash,
          sha: hash, // Include both hash and sha for compatibility
          author,
          authorName: author,
          email,
          authorEmail: email,
          date,
          message: subject, // Use subject line as message (cleaner for display)
          files: [], // Will be filled in batch below
          isPushed,
          agentId,
          linkedNoteId,
        } as any);
      }

      // PERF: Batch file lookups into a single git command instead of one subprocess per commit.
      // Previously this spawned N separate `git diff-tree` processes (one per commit).
      // Now we use a single `git show --name-only` call with all hashes at once.
      if (commits.length > 0) {
        try {
          const commitHashes = commits.map((c) => c.hash);
          const { stdout: batchFilesOutput } = await execAsync(
            `git show --name-only --format="FILES_FOR:%H" ${commitHashes.join(' ')}`,
            { cwd: worktreePath },
          );

          // Parse: split by "FILES_FOR:" to get per-commit file lists
          const filesByHash = new Map<string, string[]>();
          const sections = batchFilesOutput.split('FILES_FOR:').filter(Boolean);
          for (const section of sections) {
            const lines = section.trim().split('\n');
            const sectionHash = lines[0].trim();
            const files = lines.slice(1).filter((l) => l.trim().length > 0);
            filesByHash.set(sectionHash, files);
          }

          // Assign files to commits
          for (const commit of commits) {
            (commit as any).files = filesByHash.get(commit.hash) || [];
          }
        } catch (err) {
          // Fallback: leave files empty rather than failing the whole method
          logger.warn('getHistory: Batch file lookup failed, files will be empty', {
            workspaceId,
            error: (err as Error).message,
          });
        }
      }

      logger.info('getHistory: Returning commits', {
        workspaceId,
        commitCount: commits.length,
        commitHashes: commits.slice(0, 5).map((c) => c.hash?.substring(0, 8)),
      });

      return { ok: true, data: { commits, boundarySha: boundary ?? undefined } };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Failed to get history',
      };
    }
  }

  /**
   * Get commit history for a specific file
   */
  async getFileHistory(
    workspaceId: WorkspaceId,
    filePath: string,
    limit = 20,
  ): Promise<Result<CommitInfo[], string>> {
    // Validate workspaceId
    if (!workspaceId) {
      logger.warn('getFileHistory called with undefined workspaceId');
      return {
        ok: false,
        error: 'Invalid workspace ID',
      };
    }

    try {
      const worktreePath = this.getWorktreePath(workspaceId);

      // Build git log command for specific file
      // Use --follow to track file through renames
      const gitCommand = `git log -n ${limit} --format="%H|%an|%ae|%aI|%s" --follow -- "${filePath}"`;

      logger.info('Getting file history', { gitCommand, cwd: worktreePath, filePath });

      const { stdout } = await execAsync(gitCommand, { cwd: worktreePath });

      logger.info('File history output', {
        stdout: stdout.slice(0, 500),
        outputLength: stdout.length,
      });

      const commits: CommitInfo[] = [];

      for (const line of stdout.trim().split('\n')) {
        if (!line) continue;

        const [hash, author, email, date, ...messageParts] = line.split('|');
        const message = messageParts.join('|'); // Handle pipes in commit messages

        commits.push({
          hash,
          sha: hash,
          author,
          authorName: author,
          email,
          authorEmail: email,
          date,
          message,
          files: [filePath],
          isPushed: true, // Assume pushed for simplicity in file history
        } as any);
      }

      logger.info('Parsed file history', { commitCount: commits.length });

      return { ok: true, data: commits };
    } catch (error) {
      logger.error('Failed to get file history', { error, filePath });
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Failed to get file history',
      };
    }
  }

  // Private helper methods

  /**
   * Check if a workspace is remote by reading its metadata.
   * Remote workspaces have paths that exist on a remote server, not locally.
   */
  private isRemoteWorkspace(workspaceId: WorkspaceId): boolean {
    try {
      const workspaceJsonPath = WorkspaceConfig.paths.workspaceMetadata(workspaceId);
      if (fs.existsSync(workspaceJsonPath)) {
        const workspaceData = JSON.parse(fs.readFileSync(workspaceJsonPath, 'utf-8'));
        return workspaceData.isRemote === true;
      }
    } catch (error) {
      logger.debug('Error checking if workspace is remote', { workspaceId, error });
    }
    return false;
  }

  private getWorktreePath(workspaceId: WorkspaceId): string {
    // Validate workspaceId
    if (!workspaceId) {
      logger.error('getWorktreePath called with undefined workspaceId');
      throw new Error('Invalid workspace ID');
    }

    // Check workspace metadata first to determine if this is a remote workspace
    const workspaceJsonPath = WorkspaceConfig.paths.workspaceMetadata(workspaceId);
    logger.debug('Checking workspace metadata', { workspaceId, workspaceJsonPath });

    if (fs.existsSync(workspaceJsonPath)) {
      try {
        const workspaceData = JSON.parse(fs.readFileSync(workspaceJsonPath, 'utf-8'));
        const isRemote = workspaceData.isRemote === true;
        logger.debug('Workspace metadata loaded', {
          workspaceId,
          isRemote,
          hasWorktreePath: !!workspaceData.worktreePath,
          hasRepositoryPath: !!workspaceData.repositoryPath,
          worktreePath: workspaceData.worktreePath,
          repositoryPath: workspaceData.repositoryPath,
        });

        // For remote workspaces, return the path from metadata without local fs checks
        // since the path exists on the remote server, not locally
        if (isRemote) {
          if (workspaceData.worktreePath) {
            logger.debug('Using worktreePath from metadata for remote workspace', {
              worktreePath: workspaceData.worktreePath,
            });
            return workspaceData.worktreePath;
          }
          if (workspaceData.repositoryPath) {
            logger.debug('Using repositoryPath from metadata for remote workspace', {
              repositoryPath: workspaceData.repositoryPath,
            });
            return workspaceData.repositoryPath;
          }
          logger.warn('Remote workspace has no worktree or repository path in metadata', {
            workspaceId,
          });
        } else {
          // For local workspaces, check if paths exist locally
          if (workspaceData.worktreePath && fs.existsSync(workspaceData.worktreePath)) {
            logger.debug('Using worktreePath from metadata', {
              worktreePath: workspaceData.worktreePath,
            });
            return workspaceData.worktreePath;
          }

          if (workspaceData.repositoryPath && fs.existsSync(workspaceData.repositoryPath)) {
            logger.debug('Using repositoryPath from metadata', {
              repositoryPath: workspaceData.repositoryPath,
            });
            return workspaceData.repositoryPath;
          }
        }

        logger.warn('No valid worktree or repository path found in metadata', { workspaceId });
      } catch (error) {
        logger.error('Error reading workspace metadata', error as Error, { workspaceId });
      }
    } else {
      logger.warn('Workspace metadata file not found', { workspaceId, workspaceJsonPath });
    }

    // For local workspaces, check custom worktrees location first, then default, then legacy
    const customWorktreesBase = getWorktreesLocation() || undefined;
    if (customWorktreesBase) {
      const customWorktreePath = WorkspaceConfig.paths.worktree(
        workspaceId,
        undefined,
        undefined,
        customWorktreesBase,
      );
      if (fs.existsSync(customWorktreePath)) {
        logger.debug('Found worktree at custom location', { customWorktreePath });
        return customWorktreePath;
      }
    }

    // Check default location: ~/intent/workspaces/{id}/{repoName}
    const defaultWorktreePath = WorkspaceConfig.paths.worktree(workspaceId);
    logger.debug('Checking default worktree path', { workspaceId, defaultWorktreePath });

    if (fs.existsSync(defaultWorktreePath)) {
      logger.debug('Found worktree at default path', { defaultWorktreePath });
      return defaultWorktreePath;
    }

    // Check legacy location: ~/intent/{id}/{repoName} or ~/.workspaces/{id}/{repoName}
    const legacyWorktreePath = WorkspaceConfig.paths.legacyWorktree(workspaceId);
    if (legacyWorktreePath !== defaultWorktreePath && fs.existsSync(legacyWorktreePath)) {
      logger.debug('Found worktree at legacy path', { legacyWorktreePath });
      return legacyWorktreePath;
    }

    // If we still haven't found a path, try to scan the workspace folder for any git worktree
    const workspaceFolderPath = WorkspaceConfig.paths.workspace(workspaceId);
    logger.debug('Scanning workspace folder for git worktree', {
      workspaceId,
      workspaceFolderPath,
    });

    if (fs.existsSync(workspaceFolderPath)) {
      try {
        const entries = fs.readdirSync(workspaceFolderPath);
        logger.debug('Found entries in workspace folder', { workspaceId, entries });

        for (const entry of entries) {
          if (!entry.startsWith('.')) {
            const fullPath = path.join(workspaceFolderPath, entry);
            const stat = fs.statSync(fullPath);

            if (stat.isDirectory()) {
              // Check if it's a git repository
              const gitPath = path.join(fullPath, '.git');
              if (fs.existsSync(gitPath)) {
                logger.info('Found git worktree by scanning', {
                  workspaceId,
                  worktreePath: fullPath,
                });
                return fullPath;
              }
            }
          }
        }
      } catch (error) {
        logger.error('Error scanning workspace folder', error as Error, { workspaceId });
      }
    }

    // Return worktree path as fallback (will likely fail but provides better error messages)
    logger.warn('Could not find valid worktree or repository path, returning default', {
      workspaceId,
      worktreePath: defaultWorktreePath,
    });
    return defaultWorktreePath;
  }

  private parseStatusOutput(output: string): FileStatus[] {
    const files: FileStatus[] = [];
    // Split by newline first, then filter empty lines
    // Don't use trim() on the whole output as it removes leading spaces from status codes
    const lines = output.split('\n').filter((line) => line.length > 0);

    for (const line of lines) {
      if (line.length < 3) continue; // Skip invalid lines (need at least "XY f")

      // Git status --porcelain format:
      // XY filename
      // Where X = index status (first letter), Y = work tree status (second letter)
      // Position 0: Index status (what's staged)
      // Position 1: Work tree status (what's in the working directory)
      // Position 2: Space separator (always present)
      // Position 3+: Filename
      //
      // Examples:
      // " M file.txt" -> M in work tree, nothing staged = unstaged modification
      // "M  file.txt" -> M in index, nothing in work tree = staged modification
      // "MM file.txt" -> M in both = staged modification with unstaged changes

      const statusCode = line.substring(0, 2);
      const indexStatus = statusCode[0]; // First letter = index (staged)
      const workTreeStatus = statusCode[1]; // Second letter = work tree

      // The filename starts after the status code and space
      // Git status --porcelain format is: "XY filename"
      // Where XY are two status characters, followed by a space, then the filename
      // We use substring(2).trimStart() to handle both standard format and edge cases
      let filePath = '';

      if (line.length > 2) {
        filePath = line.substring(2).trimStart();
      }

      if (!filePath) continue; // Skip if no path

      // Skip directory paths (end with /) - git sometimes returns directories
      // even with --untracked-files=all if the directory is empty or all contents are gitignored
      if (filePath.endsWith('/')) {
        logger.debug('Skipping directory path in git status', { filePath });
        continue;
      }

      // Determine the actual status character
      const actualStatus =
        workTreeStatus !== ' ' ? workTreeStatus : indexStatus !== ' ' ? indexStatus : '?';

      // Git status format:
      // First character (X) = status of index (staging area)
      // Second character (Y) = status of work tree
      //
      // Common patterns:
      // "M " = Modified in index (staged), clean in work tree
      // " M" = Clean in index, modified in work tree (unstaged)
      // "MM" = Modified in both index and work tree (partially staged)
      // "A " = Added to index (staged new file), clean in work tree
      // " A" = Clean in index, added to work tree (shouldn't happen)
      // "??" = Untracked file
      //
      // For files with both staged and unstaged changes (MM, AM, AD, etc.),
      // we create TWO entries: one for staged changes and one for unstaged changes
      const hasStaged = indexStatus !== ' ' && indexStatus !== '?';
      const hasUnstaged = workTreeStatus !== ' ';

      // If file has both staged and unstaged changes, create two entries
      if (hasStaged && hasUnstaged) {
        // Entry for staged changes
        files.push({
          path: filePath,
          status: indexStatus as GitFileStatus,
          staged: true,
        });
        // Entry for unstaged changes
        files.push({
          path: filePath,
          status: workTreeStatus as GitFileStatus,
          staged: false,
        });
      } else {
        // Single entry for files with only staged or only unstaged changes
        const isStaged = hasStaged;
        files.push({
          path: filePath,
          status: actualStatus as GitFileStatus,
          staged: isStaged,
        });
      }
    }

    return files;
  }

  private parseDiff(diffOutput: string): DiffChunk[] {
    const chunks: DiffChunk[] = [];

    if (!diffOutput.trim()) {
      return chunks;
    }

    // Split by file headers (lines starting with "diff --git")
    const fileSections = diffOutput.split(/^diff --git/m).slice(1);

    for (const section of fileSections) {
      const lines = section.split('\n');

      // Parse file header to get file path
      // Format: " a/path/to/file b/path/to/file"
      const headerMatch = lines[0]?.match(/a\/(.+?)\s+b\/(.+?)$/);
      if (!headerMatch) continue;

      const filePath = headerMatch[1];
      const chunk: DiffChunk = {
        file: filePath,
        chunks: [],
      };

      // Parse hunks (sections starting with @@)
      let currentHunk: any = null;
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i];

        // Check for hunk header
        const hunkMatch = line.match(/^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/);
        if (hunkMatch) {
          // Save previous hunk if exists
          if (currentHunk) {
            chunk.chunks.push(currentHunk);
          }

          // Start new hunk
          const oldStart = parseInt(hunkMatch[1], 10);
          const oldLines = parseInt(hunkMatch[2] || '1', 10);
          const newStart = parseInt(hunkMatch[3], 10);
          const newLines = parseInt(hunkMatch[4] || '1', 10);

          currentHunk = {
            oldStart,
            oldLines,
            newStart,
            newLines,
            lines: [],
          };

          continue;
        }

        // Skip file metadata lines
        if (line.startsWith('index ') || line.startsWith('---') || line.startsWith('+++')) {
          continue;
        }

        // Parse diff lines
        if (currentHunk && (line.startsWith('+') || line.startsWith('-') || line.startsWith(' '))) {
          let type: LineType;
          const content = line.substring(1);

          if (line.startsWith('+')) {
            type = LineType.Addition;
          } else if (line.startsWith('-')) {
            type = LineType.Deletion;
          } else {
            type = LineType.Context;
          }

          currentHunk.lines.push({
            type,
            content,
          });
        }
      }

      // Don't forget the last hunk
      if (currentHunk) {
        chunk.chunks.push(currentHunk);
      }

      if (chunk.chunks.length > 0) {
        chunks.push(chunk);
      }
    }

    return chunks;
  }

  private normalizeDiffPaths(worktreePath: string, paths?: string[]): string[] | undefined {
    return paths?.map((p) => {
      if (p.startsWith('/')) {
        if (worktreePath && (p === worktreePath || p.startsWith(worktreePath + '/'))) {
          return p === worktreePath ? '' : p.slice(worktreePath.length + 1);
        }
        const workspacesMatch = p.match(/(?:intent|\.workspaces)\/[^/]+\/[^/]+\/(.+)$/);
        if (workspacesMatch) return workspacesMatch[1];
        return path.basename(p);
      }
      return p;
    });
  }

  private async buildNumstatArgs(
    worktreePath: string,
    paths: string[] | undefined,
    staged: boolean | undefined,
    baseRef: string | undefined,
    baseCommitSha: string | undefined,
    targetRef: string,
  ): Promise<string[]> {
    const args = ['diff', '--numstat'];
    if (baseRef || baseCommitSha) {
      const boundary = await this.resolveBranchBoundary(worktreePath, baseRef, baseCommitSha, targetRef);
      if (!boundary) return ['diff', '--numstat', '--no-index', '/dev/null', '/dev/null'];
      args.push(`${boundary}..${targetRef}`);
    } else if (staged === true) {
      args.push('--cached');
    } else if (staged !== false) {
      args.push('HEAD');
    }

    if (paths && paths.length > 0) args.push('--', ...paths);
    return args;
  }

  private async resolveBranchBoundary(
    worktreePath: string,
    baseRef: string | undefined,
    baseCommitSha: string | undefined,
    targetRef: string,
  ): Promise<string | null> {
    const [mergeBaseSha, validBaseCommitSha] = await Promise.all([
      (async (): Promise<string | null> => {
        if (!baseRef) return null;
        const refsToTry = baseRef.includes('/') ? [baseRef] : [`origin/${baseRef}`, baseRef];
        for (const ref of refsToTry) {
          try {
            await execFileAsync('git', ['rev-parse', '--verify', ref], { cwd: worktreePath });
            const { stdout } = await execFileAsync('git', ['merge-base', targetRef, ref], {
              cwd: worktreePath,
            });
            const result = stdout.trim();
            if (result) return result;
          } catch {
            // Try the next candidate ref.
          }
        }
        return null;
      })(),
      (async (): Promise<string | null> => {
        if (!baseCommitSha) return null;
        try {
          await execFileAsync('git', ['merge-base', '--is-ancestor', baseCommitSha, targetRef], {
            cwd: worktreePath,
          });
          return baseCommitSha;
        } catch {
          return null;
        }
      })(),
    ]);
    return mergeBaseSha ?? validBaseCommitSha;
  }

  private parseNumstat(output: string): GitNumstatEntry[] {
    return output
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [rawAdditions, rawDeletions, ...pathParts] = line.split('\t');
        return {
          filePath: pathParts.join('\t'),
          additions: Number.parseInt(rawAdditions, 10) || 0,
          deletions: Number.parseInt(rawDeletions, 10) || 0,
        };
      });
  }

}

// Export singleton instance
export const gitService = new GitService();
