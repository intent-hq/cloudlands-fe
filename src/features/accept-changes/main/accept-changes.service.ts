/**
 * Accept Changes Service
 *
 * Orchestrates the workflow for accepting and integrating workspace changes
 * back to trunk or other destinations.
 * Supports both local and remote workspaces.
 */

import fs from 'fs/promises';
import path from 'path';
import { execAsync, execFileAsync, type GitEnvPolicy } from '../../../shared/git/git-env';
import {
  getGitAuthErrorMessage,
  isGitAuthError,
  isKeychainAccessCancelled,
} from '../../../shared/git/git-error-handler';
import {
  clearKeychainSuppression,
  isKeychainAccessSuppressed,
  suppressKeychainAccess,
} from '../../../shared/git/keychain-suppression';
import { Logger } from '../../../shared/logger';
import { remoteRPCManager } from '../../../shared/main/remote-rpc-manager';
import { RemoteRPCError } from '../../../shared/main/remote-rpc-client';
import { PullRequestStatus, type WorkspaceId } from '../../../shared/types';
import { unifiedEventBus } from '../../events/main/unified-event-bus';
import { githubService } from '../../git-tracking/main/github.service';
import { getWorkspaceGitInfo } from '../../git/main/git-router';
import { gitService } from '../../git/main/git.service';
import { backgroundGitOpsService } from '../../git/main/background-git-ops.service';
import { changeDetectorManager } from '../../workspace/main/change-detector-manager';
import { getAttributionEngine } from '../../workspace/main/provenance/attribution-engine';
import { FileSystemWorkspaceRepository } from '../../workspace/main/workspace.repository';
import type {
  AcceptChangesResult,
  AcceptChangesStep,
  ExecuteAcceptRequest,
  ExportFilesRequest,
  ExportFilesResult,
  LocalCommitInfo,
  PrepareAcceptRequest,
  PrepareAcceptResponse,
  WorkspaceGitStatus,
} from '../types';

const logger = new Logger('AcceptChangesService');

/** Pattern for safe git ref names — disallows leading dash to prevent option injection */
const SAFE_REF_PATTERN = /^[a-zA-Z0-9._\/][a-zA-Z0-9._\-\/]*$/;

interface KeychainConsentDecision {
  shouldProceed: boolean;
  gitPolicy?: GitEnvPolicy;
  error?: string;
  willTriggerKeychain?: boolean;
}

// Cache entry for git status
interface GitStatusCacheEntry {
  status: WorkspaceGitStatus;
  timestamp: number;
}

export class AcceptChangesService {
  private readonly workspaceRepository: FileSystemWorkspaceRepository;


  // Cache for git status to prevent redundant expensive git operations
  // Key: workspaceId, Value: cached status with timestamp
  private gitStatusCache: Map<string, GitStatusCacheEntry> = new Map();
  private readonly GIT_STATUS_CACHE_TTL_MS = 2000; // 2 seconds - short enough to stay fresh, long enough to dedupe bursts

  constructor() {
    this.workspaceRepository = new FileSystemWorkspaceRepository();
  }

  /**
   * Clear git status cache for a workspace (call after mutations like commit/push)
   */
  clearGitStatusCache(workspaceId?: WorkspaceId): void {
    if (workspaceId) {
      this.gitStatusCache.delete(workspaceId);
    } else {
      this.gitStatusCache.clear();
    }
  }

  /**
   * Check keychain access risk and request user consent if needed for network operations.
   * Returns true if the operation should proceed, false if cancelled.
   */
  private async checkKeychainConsentIfNeeded(
    workspaceId: WorkspaceId,
    worktreePath: string,
    operation: 'push' | 'pull' | 'fetch',
  ): Promise<KeychainConsentDecision> {
    try {
      if (isKeychainAccessSuppressed(workspaceId as string)) {
        return {
          shouldProceed: false,
          error: 'Keychain access was cancelled. Unlock your keychain and retry.',
        };
      }

      // Import dynamically to avoid circular dependency issues during initialization
      const { detectKeychainAccessRisk } = await import('../../../shared/git/git-env');
      const { keychainIPCBridge } = await import('../../git/main/keychain.ipc');

      const risk = await detectKeychainAccessRisk(worktreePath, operation);
      const willTriggerKeychain = risk.willTriggerKeychain;

      if (!willTriggerKeychain) {
        // No keychain access expected, proceed immediately
        return { shouldProceed: true, willTriggerKeychain: false };
      }

      logger.info('Keychain access risk detected, requesting user consent', {
        workspaceId,
        operation,
        credentialHelper: risk.credentialHelper,
        remoteUrl: risk.remoteUrl,
      });

      // Request consent from user via IPC
      const outcome = await keychainIPCBridge.requestConsent(workspaceId, operation, risk);

      if (outcome === 'allow') {
        logger.info('User allowed keychain access', { workspaceId, operation });
        return {
          shouldProceed: true,
          gitPolicy: { credentialHelper: 'allow' },
          willTriggerKeychain: true,
        };
      } else {
        logger.info('User denied keychain access', { workspaceId, operation, outcome });
        return { shouldProceed: false, willTriggerKeychain: true };
      }
    } catch (error) {
      // If keychain detection fails, proceed with the operation
      // Better to show the keychain prompt than block the operation
      logger.warn('Keychain consent check failed, proceeding with operation', {
        workspaceId,
        operation,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return { shouldProceed: true, willTriggerKeychain: false };
    }
  }

  /**
   * Execute a rebase with auto-stash support.
   * If the worktree has uncommitted changes, stashes them before rebase and restores after.
   * Returns success status, whether rebase was aborted, and any error message.
   */
  private async rebaseWithAutoStash(
    workspaceId: WorkspaceId,
    trunkRef: string,
    worktreePath: string,
  ): Promise<{ success: boolean; aborted?: boolean; error?: string }> {
    const STASH_MESSAGE = 'Intent: auto-stash before merge rebase';

    // Step 1: Check for dirty state
    let stashCreated = false;
    try {
      const { stdout: statusOutput } = await this.execGitCommand(
        workspaceId,
        'git status --porcelain',
        worktreePath,
      );
      const isDirty = statusOutput.trim().length > 0;

      if (isDirty) {
        // Step 2: Stash changes (including untracked files)
        logger.info('Stashing uncommitted changes before rebase');
        try {
          const { stdout: stashOutput } = await this.execGitCommand(
            workspaceId,
            `git stash push --include-untracked -m "${STASH_MESSAGE}"`,
            worktreePath,
          );
          // Check if stash was actually created
          stashCreated = !stashOutput.includes('No local changes to save');
          logger.info('Stash result', { stashCreated });
        } catch (stashError) {
          // Stash failed - don't attempt rebase with dirty worktree
          logger.error('Failed to stash changes before rebase');
          return {
            success: false,
            error: 'Failed to stash uncommitted changes before rebase. Please commit or stash your changes manually and retry.',
          };
        }
      }
    } catch (statusError) {
      // git status failed - can't determine dirty state, proceed with rebase
      logger.warn('Failed to check dirty state, proceeding with rebase');
    }

    // Step 3: Execute rebase
    let rebaseSuccess = false;
    let rebaseError: string | undefined;
    let wasAborted = false;
    try {
      await this.execGitCommand(workspaceId, `git rebase ${trunkRef}`, worktreePath);
      rebaseSuccess = true;
      logger.info('Rebase completed successfully');
    } catch (error) {
      rebaseError = error instanceof Error ? error.message : String(error);
      // Check if this is a conflict-related failure vs something else
      const isConflict =
        rebaseError.toLowerCase().includes('conflict') ||
        rebaseError.includes('CONFLICT') ||
        rebaseError.includes('could not apply');
      // Don't log raw rebaseError - it may contain file paths (PII)
      logger.warn('Rebase failed, aborting', { isConflict });

      // Abort the rebase
      try {
        await this.execGitCommand(workspaceId, 'git rebase --abort', worktreePath);
        wasAborted = true;
      } catch {
        // Ignore abort errors
      }

      rebaseError = isConflict
        ? 'Conflicts detected. Please rebase manually.'
        : 'Rebase failed. Please try rebasing manually.';
    }

    // Step 4: Pop stash if we created one (regardless of rebase success/failure)
    if (stashCreated) {
      try {
        await this.execGitCommand(workspaceId, 'git stash pop', worktreePath);
        logger.info('Restored stashed changes after rebase', { rebaseSuccess });
      } catch (popError) {
        const popErrorMsg = popError instanceof Error ? popError.message : String(popError);
        // Check if this is a conflict during stash pop
        if (popErrorMsg.includes('CONFLICT') || popErrorMsg.includes('conflict')) {
          logger.warn('Stash pop resulted in conflicts');
          if (rebaseSuccess) {
            return {
              success: false,
              error: `Rebase succeeded but your local changes conflict with the rebased code. Please resolve the conflicts in your working tree and then run 'git stash drop' to clean up the stash.`,
            };
          }
        } else {
          logger.warn('Failed to restore stash after rebase');
          if (rebaseSuccess) {
            return {
              success: false,
              error: `Rebase succeeded but failed to restore your local changes. Your changes are saved in the stash - run 'git stash pop' to restore them.`,
            };
          }
        }
        // If rebase failed too, append stash recovery guidance to the rebase error
        if (popErrorMsg.includes('CONFLICT') || popErrorMsg.includes('conflict')) {
          rebaseError = `${rebaseError} Your uncommitted changes were partially applied with conflicts — resolve the conflicts in your working tree and run \`git stash drop\` to clean up.`;
        } else {
          rebaseError = `${rebaseError} Your uncommitted changes are still in the stash — run \`git stash pop\` to recover them.`;
        }
      }
    }

    return {
      success: rebaseSuccess,
      aborted: wasAborted,
      error: rebaseError,
    };
  }

  /**
   * Execute a git command, routing to SSH for remote workspaces
   * Detects authentication errors and emits domain events for user notification
   */
  private async execGitCommand(
    workspaceId: WorkspaceId,
    command: string,
    worktreePath: string,
  ): Promise<{ stdout: string; stderr: string }> {
    const gitInfo = await getWorkspaceGitInfo(workspaceId);

    let gitPolicy: GitEnvPolicy | undefined;
    let keychainConsent: KeychainConsentDecision | null = null;

    // Check if this is a network operation that might trigger keychain access
    const networkOpMatch = command.match(/\bgit\s+(push|pull|fetch)\b/);
    const isNetworkOp = !!networkOpMatch;
    if (networkOpMatch && !gitInfo?.isRemote) {
      // Only check keychain for local workspaces (remote workspaces use SSH)
      const operation = networkOpMatch[1] as 'push' | 'pull' | 'fetch';
      keychainConsent = await this.checkKeychainConsentIfNeeded(
        workspaceId,
        worktreePath,
        operation,
      );
      if (!keychainConsent.shouldProceed) {
        throw new Error(
          keychainConsent.error || `${operation} cancelled: keychain access was denied`,
        );
      }
      gitPolicy = keychainConsent.gitPolicy;
    }

    try {
      if (gitInfo?.isRemote) {
        // Remote workspace - execute via RPC
        const rpcClient = await remoteRPCManager.getClient(workspaceId as string);
        const fullCommand = `cd "${worktreePath}" && ${command}`;
        try {
          const result = await rpcClient.exec({ command: fullCommand, timeout: 60000 });
          return {
            stdout: result.stdout,
            stderr: result.stderr,
          };
        } catch (error) {
          if (error instanceof RemoteRPCError && error.code === -32000) {
            const data = error.data as { stdout?: string; stderr?: string; exitCode?: number } | undefined;
            return {
              stdout: data?.stdout ?? '',
              stderr: data?.stderr ?? error.message,
            };
          }
          throw error;
        }
      }

      // Local workspace - execute locally
      // Use a 60 second timeout for network operations (fetch/push/pull) to prevent infinite hangs
      // when offline, waiting for credentials, or experiencing network issues.
      // Use a 30 second timeout for other git commands.
      const timeout = isNetworkOp ? 60_000 : 30_000;
      const result = await execAsync(command, { cwd: worktreePath, gitPolicy, timeout });
      if (isNetworkOp && !gitInfo?.isRemote) {
        clearKeychainSuppression(workspaceId as string);
      }
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const stderr = (error as any)?.stderr || errorMessage;

      if (
        isNetworkOp &&
        (isKeychainAccessCancelled(stderr) || isKeychainAccessCancelled(errorMessage))
      ) {
        suppressKeychainAccess(workspaceId as string);
        throw new Error('Keychain access was cancelled. Unlock your keychain and retry.');
      }

      if (
        isNetworkOp &&
        keychainConsent?.willTriggerKeychain &&
        (isGitAuthError(stderr) || isGitAuthError(errorMessage))
      ) {
        suppressKeychainAccess(workspaceId as string);
        throw new Error('Keychain access failed. Unlock your keychain and retry.');
      }

      // Check if this is an authentication error for remote operations
      const isRemoteOp = /\b(push|fetch|pull|clone)\b/.test(command);
      if (isRemoteOp && (isGitAuthError(stderr) || isGitAuthError(errorMessage))) {
        const operation = command.match(/\b(push|fetch|pull|clone)\b/)?.[0] || 'remote operation';
        const userMessage = 'GitHub authentication required to complete the operation.';
        logger.warn('Git remote operation requires authentication', {
          workspaceId,
          command,
          error: errorMessage,
        });

        // Suppress keychain access to prevent repeated prompts after auth failure
        // This stops the macOS keychain dialog from spamming the user
        suppressKeychainAccess(workspaceId as string);

        // Emit domain event for UI notification (modal + toast)
        // Note: Git push/pull requires local credentials (SSH keys or credential manager),
        // NOT GitHub OAuth. GitHub OAuth is only for API operations like creating PRs.
        unifiedEventBus.emitDomainEvent('git:auth-required', {
          workspaceId,
          operation,
          message: userMessage,
          rawError: stderr || errorMessage,
          command,
          cwd: worktreePath,
        });

        // Re-throw with user-friendly message
        throw new Error(userMessage);
      }

      // Re-throw original error for non-auth issues
      throw error;
    }
  }

  /**
   * Resolve the remote target for push operations.
   *
   * Git push/pull/fetch uses local git credentials (SSH keys or credential manager),
   * NOT the GitHub OAuth token. The OAuth token is only for GitHub API operations
   * like creating PRs. If authentication fails during the git command itself,
   * the error handler in execGitInWorktree will emit 'git:auth-required'.
   *
   * @returns 'origin' - Let git use the configured remote with local credentials
   */
  private resolvePushRemote(
    _status: WorkspaceGitStatus,
    _workspaceId: WorkspaceId,
    _operation: string,
  ): string {
    // Always use 'origin' and let git handle authentication via local credentials
    // (SSH keys, credential manager, etc.). The user's local git config determines
    // how authentication works. If auth fails, execGitInWorktree's error handler
    // will emit 'git:auth-required' with guidance for the user.
    return 'origin';
  }

  /**
   * Get the current git status for accept changes workflow
   * Uses a short-lived cache to prevent redundant expensive git operations
   */
  async getWorkspaceGitStatus(workspaceId: WorkspaceId): Promise<WorkspaceGitStatus> {
    // Check cache first
    const cached = this.gitStatusCache.get(workspaceId);
    const now = Date.now();
    if (cached && now - cached.timestamp < this.GIT_STATUS_CACHE_TTL_MS) {
      logger.debug('Using cached git status', { workspaceId, cacheAge: now - cached.timestamp });
      return cached.status;
    }

    // Fetch fresh status
    const status = await this.fetchWorkspaceGitStatus(workspaceId);

    // Cache the result
    this.gitStatusCache.set(workspaceId, { status, timestamp: now });

    return status;
  }

  /**
   * Add a git remote to the workspace repository.
   * Runs `git remote add origin <url>`, clears the status cache, and returns updated status.
   */
  async addRemote(
    workspaceId: WorkspaceId,
    remoteUrl: string,
  ): Promise<WorkspaceGitStatus> {
    const workspace = await this.workspaceRepository.findById(workspaceId);
    if (!workspace) {
      throw new Error(`Workspace not found: ${workspaceId}`);
    }

    const worktreePath = workspace.worktreePath || workspace.path;
    if (!worktreePath) {
      throw new Error(`Workspace has no path: ${workspaceId}`);
    }

    // Validate URL is not empty
    const trimmedUrl = remoteUrl.trim();
    if (!trimmedUrl) {
      throw new Error('Remote URL cannot be empty');
    }

    // Add the remote
    await this.execGitCommand(
      workspaceId,
      `git remote add origin ${trimmedUrl}`,
      worktreePath,
    );

    logger.info('Added git remote', { workspaceId, remoteUrl: trimmedUrl });

    // Clear cache so the next status fetch picks up the new remote
    this.clearGitStatusCache(workspaceId);
    gitService.clearStatusCache(workspaceId);

    // Return fresh status
    return this.getWorkspaceGitStatus(workspaceId);
  }

  /**
   * Internal method to fetch git status (without caching)
   */
  private async fetchWorkspaceGitStatus(workspaceId: WorkspaceId): Promise<WorkspaceGitStatus> {
    let workspace = await this.workspaceRepository.findById(workspaceId);
    if (!workspace) {
      throw new Error(`Workspace not found: ${workspaceId}`);
    }

    const worktreePath = workspace.worktreePath || workspace.path;
    if (!worktreePath) {
      throw new Error(`Workspace has no path: ${workspaceId}`);
    }
    const branch = workspace.branch || 'main';
    const trunkBranch = workspace.baseRef || 'main';

    // Get git status
    const statusResult = await gitService.getStatus(workspaceId);
    const status = statusResult.ok ? statusResult.data : null;

    // Get commits ahead/behind trunk
    let aheadOfTrunk = 0;
    let behindTrunk = 0;
    let localCommits: LocalCommitInfo[] = [];
    let hasRemote = false;
    let isPushed = false;
    let remoteUrl: string | undefined;
    let owner: string | undefined;
    let repo: string | undefined;

    // Get remote URL - this is expected to fail for workspaces without a remote
    try {
      const { stdout: remoteStdout } = await this.execGitCommand(
        workspaceId,
        'git remote get-url origin',
        worktreePath,
      );
      remoteUrl = remoteStdout.trim();
      hasRemote = !!remoteUrl;

      // Parse owner/repo from remote URL
      // Support repo names that include dots (e.g., molecules.gg)
      const match = remoteUrl.match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/);
      if (match) {
        owner = match[1];
        repo = match[2];
      }
    } catch {
      // No remote configured - this is expected for local-only workspaces
      hasRemote = false;
      logger.debug('No git remote configured for workspace', { workspaceId });
    }

    // Determine which trunk ref to compare against
    // Use origin/trunk if we have a remote (more accurate for merge workflow)
    // Fall back to local trunk for local-only repos
    const trunkRef = hasRemote ? `origin/${trunkBranch}` : trunkBranch;

    // Validate trunk branch name and current branch to prevent option injection in git commands
    const isRefSafe = SAFE_REF_PATTERN.test(trunkBranch) && SAFE_REF_PATTERN.test(branch);
    if (!isRefSafe) {
      logger.warn('Invalid trunk branch name, skipping ref-based comparisons', { workspaceId });
    }

    // Fetch origin to ensure we have the latest trunk ref
    // Skip fetch if keychain access has been suppressed (user cancelled macOS keychain dialog)
    // to avoid spamming the user with repeated keychain prompts
    if (isRefSafe && hasRemote && !isKeychainAccessSuppressed(workspaceId as string)) {
      try {
        await this.execGitCommand(workspaceId, `git fetch origin ${trunkBranch}`, worktreePath);
      } catch {
        // Fetch might fail if offline, continue with potentially stale ref
        logger.debug('Failed to fetch origin trunk, using cached ref', {
          workspaceId,
          trunkBranch,
        });
      }
    } else if (hasRemote && isRefSafe) {
      logger.debug('Skipping fetch - keychain access suppressed', { workspaceId, trunkBranch });
    }

    // Get commits ahead/behind
    if (isRefSafe) {
      try {
        const { stdout: revList } = await this.execGitCommand(
          workspaceId,
          `git rev-list --first-parent --left-right --count ${trunkRef}...${branch}`,
          worktreePath,
        );
        const [behind, ahead] = revList.trim().split('\t').map(Number);
        behindTrunk = behind || 0;
        aheadOfTrunk = ahead || 0;
      } catch {
        // Branch comparison might fail if trunk doesn't exist locally
      }
    }

    // Detect if branch content has been squash-merged to trunk
    // This uses tree hash matching: after a squash merge, the squash commit on trunk
    // has the exact same tree hash as the branch tip
    let isContentMergedToTrunk = false;
    if (isRefSafe && aheadOfTrunk > 0) {
      try {
        // Get the branch's tree hash
        const { stdout: branchTree } = await this.execGitCommand(
          workspaceId,
          'git rev-parse HEAD^{tree}',
          worktreePath,
        );
        // Get the merge base
        const { stdout: mergeBase } = await this.execGitCommand(
          workspaceId,
          `git merge-base ${trunkRef} HEAD`,
          worktreePath,
        );
        // Get all tree hashes on trunk since divergence (bounded to prevent large output on long-lived branches)
        const { stdout: trunkTrees } = await this.execGitCommand(
          workspaceId,
          `git log ${mergeBase.trim()}..${trunkRef} --format=%T --max-count=1000`,
          worktreePath,
        );
        // Check if branch tree appears in trunk history
        const trunkTreeList = trunkTrees.trim().split('\n').filter(Boolean);
        isContentMergedToTrunk = trunkTreeList.includes(branchTree.trim());

        if (isContentMergedToTrunk) {
          logger.info('Detected squash merge via tree hash match', {
            workspaceId,
            branchTree: branchTree.trim().substring(0, 12),
          });
        }
      } catch {
        // Tree hash detection failed, default to false
        logger.debug('Tree hash detection failed, defaulting to false', { workspaceId });
      }
    } else if (isRefSafe && aheadOfTrunk === 0 && behindTrunk > 0) {
      // Branch tip is an ancestor of trunk — all branch content is already in trunk
      isContentMergedToTrunk = true;
      logger.info('Branch is fully merged into trunk (aheadOfTrunk === 0, behindTrunk > 0)', {
        workspaceId,
        behindTrunk,
      });
    }

    // Get local commits with file changes
    // Include body (%b) to extract Agent-Id and Linked-Note-Id trailers
    // Use null character to separate body from rest since body can contain newlines
    if (isRefSafe) {
      try {
        const { stdout: logOutput } = await this.execGitCommand(
          workspaceId,
          `git log ${trunkRef}..${branch} --format="%H|%s|%an|%aI|%D%x00%b%x00" --numstat`,
          worktreePath,
        );

        if (logOutput.trim()) {
          localCommits = this.parseCommitLog(logOutput);
        }
      } catch {
        // Log might fail if no commits
      }
    }

    // Check if branch is pushed and get pushed commit hashes (only if we have a remote)
    let pushedCommitHashes: Set<string> = new Set();
    if (hasRemote && isRefSafe) {
      try {
        await this.execGitCommand(
          workspaceId,
          `git rev-parse --verify origin/${branch}`,
          worktreePath,
        );
        isPushed = true;

        // Get all pushed commit hashes to mark individual commits correctly
        try {
          const { stdout: pushedLog } = await this.execGitCommand(
            workspaceId,
            `git log origin/${trunkBranch}..origin/${branch} --format=%H`,
            worktreePath,
          );
          pushedCommitHashes = new Set(pushedLog.trim().split('\n').filter(Boolean));
        } catch {
          // If we can't get pushed commits, fall back to empty set
        }
      } catch {
        isPushed = false;
      }
    }

    // Update local commits with correct isPushed status
    localCommits = localCommits.map((commit) => ({
      ...commit,
      isPushed: pushedCommitHashes.has(commit.hash),
    }));

    logger.debug('Commit isPushed status', {
      totalCommits: localCommits.length,
      pushedCommitHashCount: pushedCommitHashes.size,
      commits: localCommits.map((c) => ({
        hash: c.hash.substring(0, 7),
        message: c.message.substring(0, 30),
        isPushed: c.isPushed,
      })),
    });

    // Get available remote branches for target branch selection
    let availableBranches: string[] = [];
    let defaultBranch: string | undefined;
    try {
      // Get remote branches
      const { stdout: remoteBranches } = await this.execGitCommand(
        workspaceId,
        'git branch -r --format="%(refname:short)"',
        worktreePath,
      );
      availableBranches = remoteBranches
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((b) => b.replace(/^origin\//, ''))
        .filter((b) => b !== 'HEAD' && !b.startsWith('HEAD'));

      // Determine default branch (main or master typically)
      if (availableBranches.includes('main')) {
        defaultBranch = 'main';
      } else if (availableBranches.includes('master')) {
        defaultBranch = 'master';
      } else if (availableBranches.length > 0) {
        defaultBranch = availableBranches[0];
      }
    } catch (error) {
      logger.warn('Error getting remote branches', { error });
    }

    // Discover and refresh the correct PR for this workspace.
    // Priority: thirdPartySources URL > branch matching
    // NOTE: We do NOT blindly trust stored prNumber/activePullRequest because they may
    // have been incorrectly linked by previous baseRef matching bugs.
    let existingPR: WorkspaceGitStatus['existingPR'];

    if (owner && repo) {
      let prNumberToFetch: number | undefined;
      let prefetchedPR: Awaited<ReturnType<typeof githubService.getPullRequest>> | undefined;

      // Strategy 1: Check thirdPartySources for GitHub PR URLs (explicit user link)
      if (workspace.thirdPartySources) {
        for (const source of workspace.thirdPartySources) {
          const prMatch = source.url?.match(/github\.com\/[^/]+\/[^/]+\/pull\/(\d+)/);
          if (prMatch) {
            prNumberToFetch = parseInt(prMatch[1], 10);
            break;
          }
        }
      }

      // Strategy 2: Match open PRs by source branch (the workspace's own branch only)
      if (!prNumberToFetch) {
        const branchesToMatch = new Set<string>();
        if (workspace.branch) branchesToMatch.add(workspace.branch);
        branchesToMatch.delete('main');
        branchesToMatch.delete('master');
        branchesToMatch.delete('develop');

        if (branchesToMatch.size > 0) {
          try {
            const openPRs = await githubService.getPullRequests(owner, repo, { state: 'open' });
            const matchingPR = openPRs.find((pr) => {
              const src = pr.sourceBranch || '';
              return branchesToMatch.has(src);
            });
            if (matchingPR) {
              prNumberToFetch = matchingPR.number;
            }
          } catch (prError) {
            logger.debug('[AcceptChanges] PR branch matching failed', { error: prError });
          }
        }
      }

      // Strategy 3: Use stored prNumber/activePullRequest ONLY if no discovery found a PR,
      // and validate that the stored PR's source branch matches the workspace branch.
      // Only reject on POSITIVE MISMATCH (both non-empty and different).
      // If sourceBranch is empty (YAML parsing issue), keep the stored PR.
      if (!prNumberToFetch) {
        const storedPRNumber = workspace.prNumber ?? workspace.activePullRequest?.number;
        if (storedPRNumber) {
          try {
            const storedPR = await githubService.getPullRequest(owner, repo, storedPRNumber);
            if (storedPR && storedPR.sourceBranch && workspace.branch && storedPR.sourceBranch !== workspace.branch) {
              // Positive mismatch: PR belongs to a different branch
              logger.info('[AcceptChanges] Stored PR does not match workspace branch, clearing stale link', {
                storedPRNumber,
                storedPRSourceBranch: storedPR.sourceBranch,
                workspaceBranch: workspace.branch,
              });
              // Clear the stale PR association from workspace
              try {
                const clearedWorkspace = {
                  ...workspace,
                  prNumber: undefined,
                  prUrl: undefined,
                  prStatus: undefined,
                  activePullRequest: undefined,
                  updatedAt: new Date().toISOString(),
                };
                await this.workspaceRepository.save(clearedWorkspace);
                workspace = clearedWorkspace;
                unifiedEventBus.emit('workspace:updated', {
                  workspaceId: clearedWorkspace.id,
                  changes: {
                    activePullRequest: undefined,
                    prNumber: undefined,
                    prUrl: undefined,
                    prStatus: undefined,
                  },
                });
              } catch (clearError) {
                logger.warn('Failed to clear stale PR association', { error: clearError });
              }
            } else if (storedPR) {
              // Either branches match, or we can't validate (empty sourceBranch) — keep it
              prNumberToFetch = storedPRNumber;
              prefetchedPR = storedPR; // Avoid re-fetching below
            }
          } catch (prError) {
            logger.debug('[AcceptChanges] Failed to validate stored PR', { error: prError });
            // API failed — keep the stored PR number as fallback
            prNumberToFetch = storedPRNumber;
          }
        }
      }

      // Fetch the PR from GitHub to get latest status (reuse prefetched PR if available)
      if (prNumberToFetch) {
        try {
          const pr = prefetchedPR ?? await githubService.getPullRequest(owner, repo, prNumberToFetch);
          if (pr) {
            // Derive state: mergedAt takes priority (state may still say 'closed' for merged PRs)
            const prState: 'open' | 'closed' | 'merged' | 'draft' = pr.mergedAt
              ? 'merged'
              : (pr.state as 'open' | 'closed' | 'draft');
            existingPR = {
              number: pr.number,
              url: pr.url,
              htmlUrl: pr.htmlUrl ?? pr.url,
              title: pr.title,
              state: prState,
            };

            const nextPrStatus =
              prState === 'merged'
                ? PullRequestStatus.Merged
                : prState === 'closed'
                  ? PullRequestStatus.Closed
                  : prState === 'draft'
                    ? PullRequestStatus.Draft
                    : PullRequestStatus.Open;

            const prInfo = {
              id: String(pr.number),
              number: pr.number,
              url: pr.htmlUrl ?? pr.url,
              title: pr.title,
              status: nextPrStatus,
              createdAt: pr.createdAt ?? workspace.activePullRequest?.createdAt ?? new Date().toISOString(),
              updatedAt: pr.updatedAt ?? new Date().toISOString(),
            };

            // Only save if PR changed (new discovery or status update)
            const currentPRNumber = workspace.activePullRequest?.number;
            const currentPRStatus = workspace.prStatus;
            if (currentPRNumber !== pr.number || currentPRStatus !== nextPrStatus) {
              const updatedWorkspace = {
                ...workspace,
                prNumber: pr.number,
                prUrl: pr.htmlUrl ?? pr.url,
                prStatus: nextPrStatus,
                activePullRequest: prInfo,
                updatedAt: new Date().toISOString(),
              };

              try {
                await this.workspaceRepository.save(updatedWorkspace);
                workspace = updatedWorkspace;
                unifiedEventBus.emit('workspace:updated', {
                  workspaceId: updatedWorkspace.id,
                  changes: {
                    activePullRequest: prInfo,
                    prNumber: pr.number,
                    prUrl: pr.htmlUrl,
                    prStatus: nextPrStatus,
                  },
                });
              } catch (saveError) {
                logger.warn('Failed to save PR status', { error: saveError });
              }
            }
          }
        } catch (prError) {
          logger.warn('Failed to refresh PR from GitHub', {
            prNumber: prNumberToFetch,
            error: prError,
          });
        }
      }
    }

    // Detect merge conflicts
    let hasConflicts = false;
    if (behindTrunk > 0) {
      hasConflicts = await this.detectMergeConflicts(
        workspaceId,
        worktreePath,
        branch,
        trunkRef,
      );
    }

    // Detect if local branch has diverged from remote tracking branch
    // This happens after rebase when local history differs from remote
    // We need force push if origin/branch is NOT an ancestor of local branch
    // (i.e., we can't fast-forward push)
    let hasDivergedFromRemote = false;
    if (isPushed && hasRemote) {
      try {
        // Check if origin/branch is an ancestor of local branch
        // If it is, we can fast-forward push (no divergence)
        // If it's not, histories have diverged (e.g., after rebase) and we need force push
        await this.execGitCommand(
          workspaceId,
          `git merge-base --is-ancestor origin/${branch} ${branch}`,
          worktreePath,
        );
        // Command succeeded = origin/branch is ancestor of local = no divergence
        hasDivergedFromRemote = false;
      } catch {
        // Command failed = origin/branch is NOT ancestor of local = diverged
        hasDivergedFromRemote = true;
        logger.info('Branch has diverged from remote (cannot fast-forward)', {
          workspaceId,
          branch,
        });
      }
    }

    // Count files properly - note that files with both staged and unstaged changes
    // appear twice in the array (once for each status), so we use Set to get unique paths
    const allUncommittedPaths = new Set(status?.files.map((f) => f.path) || []);
    const stagedPaths = new Set(status?.files.filter((f) => f.staged).map((f) => f.path) || []);

    return {
      branch,
      trunkBranch,
      aheadOfTrunk,
      behindTrunk,
      hasRemote,
      isPushed,
      uncommittedCount: allUncommittedPaths.size,
      stagedCount: stagedPaths.size,
      localCommits,
      existingPR,
      canMergeDirectly: behindTrunk === 0 && !hasConflicts,
      hasConflicts,
      hasDivergedFromRemote,
      isContentMergedToTrunk,
      remoteUrl,
      owner,
      repo,
      availableBranches,
      defaultBranch,
    };
  }

  /**
   * Detect merge conflicts between current branch and target branch
   * Uses git merge-tree --write-tree (Git 2.38+) to simulate a merge without modifying the working tree.
   * Falls back to legacy merge-tree for older Git versions.
   */
  private async detectMergeConflicts(
    workspaceId: WorkspaceId,
    worktreePath: string,
    currentBranch: string,
    targetBranch: string,
  ): Promise<boolean> {
    try {
      // Modern approach: git merge-tree --write-tree (Git 2.38+)
      // Exit code 0 = clean merge (no conflicts)
      // Exit code 1 = conflicts detected
      await this.execGitCommand(
        workspaceId,
        `git merge-tree --write-tree -- ${targetBranch} ${currentBranch}`,
        worktreePath,
      );
      // Exit code 0 means clean merge, no conflicts
      return false;
    } catch (error) {
      // Exit code 1 from merge-tree --write-tree means conflicts
      const exitCode = (error as any)?.code ?? (error as any)?.status;
      if (exitCode === 1) {
        return true;
      }

      // If --write-tree is not supported (older Git), fall back to legacy approach
      const errorMessage = error instanceof Error ? error.message : String(error);
      const isUnsupportedFlag =
        errorMessage.includes('unknown option') ||
        errorMessage.includes('unrecognized argument');

      if (isUnsupportedFlag) {
        return this.detectMergeConflictsLegacy(workspaceId, worktreePath, currentBranch, targetBranch);
      }

      // Other errors - assume no conflicts to avoid blocking operations
      return false;
    }
  }

  /**
   * Legacy fallback for detecting merge conflicts on Git < 2.38.
   * Uses the three-way merge-tree approach with merge-base.
   */
  private async detectMergeConflictsLegacy(
    workspaceId: WorkspaceId,
    worktreePath: string,
    currentBranch: string,
    targetBranch: string,
  ): Promise<boolean> {
    try {
      const { stdout: mergeBase } = await this.execGitCommand(
        workspaceId,
        `git merge-base ${targetBranch} ${currentBranch}`,
        worktreePath,
      );
      const base = mergeBase.trim();

      if (!base) {
        return false;
      }

      const { stdout: mergeTreeOutput } = await this.execGitCommand(
        workspaceId,
        `git merge-tree ${base} ${targetBranch} ${currentBranch}`,
        worktreePath,
      );

      const hasConflictMarkers =
        mergeTreeOutput.includes('<<<<<<<') &&
        mergeTreeOutput.includes('>>>>>>>');

      return hasConflictMarkers;
    } catch {
      return false;
    }
  }

  private parseCommitLog(logOutput: string): LocalCommitInfo[] {
    // Parse git log output with --numstat into commit info with files
    // Format: "%H|%s|%an|%aI|%D\x00%b\x00" --numstat
    // The body is enclosed in null characters to handle newlines
    const commits: LocalCommitInfo[] = [];

    // Split by commit blocks (separated by the pattern where hash starts)
    // Each commit block contains: header\x00body\x00numstat_lines
    const commitBlocks = logOutput.split(/(?=^[a-f0-9]{40}\|)/m).filter(Boolean);

    for (const block of commitBlocks) {
      // Split header+body from numstat using the null character
      const nullIndex = block.indexOf('\x00');
      if (nullIndex === -1) continue;

      const header = block.substring(0, nullIndex);
      const rest = block.substring(nullIndex + 1);

      // Find the second null character to get body
      const secondNullIndex = rest.indexOf('\x00');
      const body = secondNullIndex !== -1 ? rest.substring(0, secondNullIndex) : '';
      const numstatPart = secondNullIndex !== -1 ? rest.substring(secondNullIndex + 1) : rest;

      // Parse header: hash|message|author|date|refs
      const parts = header.split('|');
      if (parts.length < 4 || parts[0].length !== 40) continue;

      // Parse trailers from body
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

      const currentFiles: { path: string; additions: number; deletions: number }[] = [];
      // Parse numstat lines
      const numstatLines = numstatPart.trim().split('\n');
      for (const line of numstatLines) {
        const numstatMatch = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
        if (numstatMatch) {
          const additions = numstatMatch[1] === '-' ? 0 : parseInt(numstatMatch[1], 10);
          const deletions = numstatMatch[2] === '-' ? 0 : parseInt(numstatMatch[2], 10);
          const filePath = numstatMatch[3];
          currentFiles.push({ path: filePath, additions, deletions });
        }
      }

      commits.push({
        hash: parts[0],
        message: parts[1],
        author: parts[2],
        date: parts[3],
        isPushed: parts[4]?.includes('origin/') ?? false,
        filesChanged: currentFiles.length,
        files: currentFiles,
        agentId,
        linkedNoteId,
      });
    }

    return commits;
  }

  /**
   * Prepare for accept changes - validates and returns suggestions
   */
  async prepare(request: PrepareAcceptRequest): Promise<PrepareAcceptResponse> {
    const workspace = await this.workspaceRepository.findById(request.workspaceId);
    if (!workspace) {
      return {
        valid: false,
        warnings: [],
        errors: ['Workspace not found'],
        filesCount: 0,
        additions: 0,
        deletions: 0,
        files: [],
      };
    }

    const worktreePath = workspace.worktreePath || workspace.path;
    if (!worktreePath) {
      return {
        valid: false,
        warnings: [],
        errors: ['Workspace has no path'],
        filesCount: 0,
        additions: 0,
        deletions: 0,
        files: [],
      };
    }
    const status = await this.getWorkspaceGitStatus(request.workspaceId);
    const warnings: string[] = [];
    const errors: string[] = [];
    const isRefSafe = SAFE_REF_PATTERN.test(status.trunkBranch) && SAFE_REF_PATTERN.test(status.branch);

    // Validation based on action
    if (request.action === 'push' || request.action === 'create-pr') {
      if (!status.hasRemote) {
        errors.push('No remote configured for this repository');
      }
      // if (status.uncommittedCount > 0) {
      //   warnings.push(`${status.uncommittedCount} uncommitted changes will not be included`);
      // }
    }

    if (request.action === 'merge') {
      if (status.behindTrunk > 0) {
        warnings.push(
          `Branch is ${status.behindTrunk} commits behind ${status.trunkBranch}. Consider rebasing first.`,
        );
      }
      if (status.hasConflicts) {
        errors.push('There are merge conflicts that need to be resolved');
      }
    }

    // Get diff stats and file list
    let additions = 0;
    let deletions = 0;
    const files: PrepareAcceptResponse['files'] = [];

    try {
      // Get numstat for committed changes (branch diff against trunk)
      // These are just for stats - NOT added to files array since they're already committed
      if (isRefSafe) {
        const { stdout: numstat } = await this.execGitCommand(
          request.workspaceId,
          `git diff --numstat ${status.trunkBranch}...${status.branch}`,
          worktreePath,
        );

        if (numstat.trim()) {
          for (const line of numstat.trim().split('\n')) {
            const [adds, dels, filePath] = line.split('\t');
            if (filePath) {
              const fileAdds = adds === '-' ? 0 : parseInt(adds) || 0;
              const fileDels = dels === '-' ? 0 : parseInt(dels) || 0;
              // Only count stats for committed files, don't add to files array
              // Committed files should NOT appear in the staging area
              additions += fileAdds;
              deletions += fileDels;
            }
          }
        }
      }

      // Get all working directory files (staged and unstaged)
      const gitStatusResult = await gitService.getStatus(request.workspaceId);
      if (gitStatusResult.ok && gitStatusResult.data) {
        // Get stats for staged files
        try {
          const { stdout: stagedNumstat } = await this.execGitCommand(
            request.workspaceId,
            'git diff --cached --numstat',
            worktreePath,
          );

          if (stagedNumstat.trim()) {
            for (const line of stagedNumstat.trim().split('\n')) {
              const [adds, dels, filePath] = line.split('\t');
              if (filePath) {
                const fileAdds = adds === '-' ? 0 : parseInt(adds) || 0;
                const fileDels = dels === '-' ? 0 : parseInt(dels) || 0;
                const existing = files.find((f) => f.path === filePath);
                if (existing) {
                  // Update existing file with staged changes
                  existing.additions += fileAdds;
                  existing.deletions += fileDels;
                  existing.staged = true;
                } else {
                  files.push({
                    path: filePath,
                    additions: fileAdds,
                    deletions: fileDels,
                    staged: true,
                  });
                }
                additions += fileAdds;
                deletions += fileDels;
              }
            }
          }
        } catch {
          // Ignore errors getting staged stats
        }

        // Get stats for unstaged files
        try {
          const { stdout: unstagedNumstat } = await this.execGitCommand(
            request.workspaceId,
            'git diff --numstat',
            worktreePath,
          );

          if (unstagedNumstat.trim()) {
            for (const line of unstagedNumstat.trim().split('\n')) {
              const [adds, dels, filePath] = line.split('\t');
              if (filePath) {
                const fileAdds = adds === '-' ? 0 : parseInt(adds) || 0;
                const fileDels = dels === '-' ? 0 : parseInt(dels) || 0;
                // Check if file already exists as staged
                const existingStaged = files.find((f) => f.path === filePath && f.staged);
                // Check if file already exists as unstaged
                const existingUnstaged = files.find((f) => f.path === filePath && !f.staged);

                if (existingUnstaged) {
                  // Update existing unstaged entry
                  existingUnstaged.additions += fileAdds;
                  existingUnstaged.deletions += fileDels;
                } else if (existingStaged) {
                  // File has both staged and unstaged changes - create separate unstaged entry
                  // This ensures the file appears in both staged and unstaged lists
                  files.push({
                    path: filePath,
                    additions: fileAdds,
                    deletions: fileDels,
                    staged: false,
                  });
                } else {
                  // New unstaged-only file
                  files.push({
                    path: filePath,
                    additions: fileAdds,
                    deletions: fileDels,
                    staged: false,
                  });
                }
                additions += fileAdds;
                deletions += fileDels;
              }
            }
          }
        } catch {
          // Ignore errors getting unstaged stats
        }

        // Add any remaining untracked files from git status
        // Note: gitStatusResult.data.files can have two entries for a file with both staged and unstaged changes
        for (const file of gitStatusResult.data.files) {
          // Check for existing entry with the SAME staged status
          const existingWithSameStatus = files.find(
            (f) => f.path === file.path && f.staged === file.staged,
          );
          if (!existingWithSameStatus) {
            files.push({
              path: file.path,
              additions: 0,
              deletions: 0,
              staged: file.staged,
            });
          }
        }
      }
    } catch {
      // Diff might fail - try to get just git status files
      try {
        const gitStatusResult = await gitService.getStatus(request.workspaceId);
        if (gitStatusResult.ok && gitStatusResult.data) {
          for (const file of gitStatusResult.data.files) {
            files.push({
              path: file.path,
              additions: 0,
              deletions: 0,
              staged: file.staged,
            });
          }
        }
      } catch {
        // Ignore
      }
    }

    // Count unique files (a file with both staged and unstaged changes appears twice in the array)
    const filesCount = new Set(files.map((f) => f.path)).size;

    // Generate suggestions
    const commitMessages = status.localCommits.map((c) => c.message);
    const suggestedCommitMessage =
      commitMessages.length === 1 ? commitMessages[0] : commitMessages.join('\n- ');

    const suggestedPRTitle =
      commitMessages.length === 1
        ? commitMessages[0]
        : `${workspace.title || 'Changes'} (${status.localCommits.length} commits)`;

    const suggestedPRBody = '';

    return {
      valid: errors.length === 0,
      warnings,
      errors,
      suggestedCommitMessage,
      suggestedPRTitle,
      suggestedPRBody,
      filesCount,
      additions,
      deletions,
      files,
    };
  }

  /**
   * Execute accept changes workflow
   */
  async execute(request: ExecuteAcceptRequest): Promise<AcceptChangesResult> {
    logger.info('Executing accept changes', {
      action: request.action,
      workspaceId: request.workspaceId,
    });

    // Clear cache before executing - mutations will change git state
    this.clearGitStatusCache(request.workspaceId);

    const steps: AcceptChangesStep[] = [];
    const workspace = await this.workspaceRepository.findById(request.workspaceId);

    if (!workspace) {
      logger.error('Workspace not found', { workspaceId: request.workspaceId });
      return {
        success: false,
        steps,
        error: 'Workspace not found',
      };
    }

    const worktreePath = workspace.worktreePath || workspace.path;
    if (!worktreePath) {
      logger.error('Workspace has no path', { workspaceId: request.workspaceId });
      return {
        success: false,
        steps,
        error: 'Workspace has no path',
      };
    }
    const status = await this.getWorkspaceGitStatus(request.workspaceId);
    logger.info('Git status for execute', {
      branch: status.branch,
      owner: status.owner,
      repo: status.repo,
      isPushed: status.isPushed,
      hasRemote: status.hasRemote,
    });

    // Register background git operation for tracking
    // Only track commit/push/create-pr as background operations
    // undo/merge/export flows are not long-running and don't need tracking
    const trackedActions = ['commit', 'push', 'create-pr'] as const;
    const isTrackedAction = trackedActions.includes(request.action as typeof trackedActions[number]);
    const operationId = isTrackedAction
      ? backgroundGitOpsService.registerOperation(
          request.workspaceId,
          request.action as 'commit' | 'push' | 'create-pr',
          {
            message: request.commitMessage,
            prTitle: request.prTitle,
          },
        )
      : null;

    try {
      // Accumulate result data for the final completeOperation call
      let operationResult: { commitHash?: string; noChanges?: boolean; reason?: string } = {};

      // Step 1: Stage unstaged changes if requested
      if (request.options?.stageUnstaged && status.uncommittedCount > 0) {
        steps.push({ id: 'stage', name: 'Stage changes', status: 'running' });
        if (operationId) backgroundGitOpsService.updateProgress(operationId, 'Staging changes');
        try {
          await this.execGitCommand(request.workspaceId, 'git add -A', worktreePath);
          steps[steps.length - 1].status = 'completed';
        } catch (error) {
          steps[steps.length - 1].status = 'failed';
          steps[steps.length - 1].error = (error as Error).message;
          if (operationId) backgroundGitOpsService.failOperation(operationId, 'Failed to stage changes');
          return { success: false, steps, error: 'Failed to stage changes' };
        }
      }

      // Step 2: Commit if there are staged changes
      // Also commit for create-pr action if there are staged changes
      if (
        request.action === 'commit' ||
        request.action === 'create-pr' ||
        request.options?.pushAfterCommit
      ) {
        const statusResult = await gitService.getStatus(request.workspaceId);
        const hasStaged = statusResult.ok && statusResult.data?.files.some((f) => f.staged);

        if (hasStaged && request.commitMessage) {
          steps.push({ id: 'commit', name: 'Commit changes', status: 'running' });
          if (operationId) backgroundGitOpsService.updateProgress(operationId, 'Committing changes');
          try {
            logger.info('Starting git commit', {
              workspaceId: request.workspaceId,
              messageLength: request.commitMessage.length,
            });
            const commitResult = await gitService.commit(
              request.workspaceId,
              request.commitMessage,
            );
            if (!commitResult.ok) {
              throw new Error(commitResult.error);
            }
            logger.info('Git commit completed', {
              workspaceId: request.workspaceId,
              commitHash: commitResult.data?.hash?.slice(0, 7),
            });
            steps[steps.length - 1].status = 'completed';

            // Capture commit hash for the final operation result
            if (commitResult.data?.hash) {
              operationResult.commitHash = commitResult.data.hash;
            }

            // Handle post-commit transition directly (staged -> committed) and await it
            // This ensures the file tracking state is updated before returning to the frontend
            // Previously we emitted an event that was handled asynchronously, causing a race
            // condition where the frontend's refresh() could load stale data
            try {
              const gitIntegration = global.gitIntegrations?.get(request.workspaceId);
              if (gitIntegration) {
                await gitIntegration.handlePostCommit(commitResult.data?.hash);
                await gitIntegration.syncCurrentState(true);
                logger.info('Post-commit transition and sync complete', {
                  workspaceId: request.workspaceId,
                  commitHash: commitResult.data?.hash?.slice(0, 7),
                });
              } else {
                logger.warn('No git integration found for workspace after commit', {
                  workspaceId: request.workspaceId,
                });
              }
            } catch (postCommitError) {
              // Log but don't fail the commit - the commit itself succeeded
              logger.error('Failed to handle post-commit transition', postCommitError as Error);
            }

            // Also emit the event for other listeners (e.g., renderer notification)
            // Set postCommitHandled=true so the event listener skips redundant work
            try {
              unifiedEventBus.emitDomainEvent('git:commit-created', {
                workspaceId: request.workspaceId,
                commitSha: commitResult.data?.hash || '',
                postCommitHandled: true,
              });
              logger.info('Emitted git:commit-created event', {
                workspaceId: request.workspaceId,
                commitHash: commitResult.data?.hash?.slice(0, 7),
              });
            } catch (eventError) {
              // Log but don't fail the commit - the commit itself succeeded
              logger.error('Failed to emit git:commit-created event', eventError as Error);
            }
          } catch (error) {
            const errorMessage = (error as Error).message;
            steps[steps.length - 1].status = 'failed';
            steps[steps.length - 1].error = errorMessage;
            // Check for pre-commit hook failures
            if (errorMessage.includes('pre-commit') || errorMessage.includes('hook')) {
              if (operationId) {
                backgroundGitOpsService.failOperation(
                  operationId,
                  'Pre-commit hooks failed. Check for conflicting unstaged changes.',
                );
              }
              return {
                success: false,
                steps,
                error: 'Pre-commit hooks failed. Check for conflicting unstaged changes.',
              };
            }
            if (operationId) {
              backgroundGitOpsService.failOperation(
                operationId,
                errorMessage || 'Failed to commit changes',
              );
            }
            return { success: false, steps, error: errorMessage || 'Failed to commit changes' };
          }
        } else if (request.action === 'commit' && !hasStaged) {
          // No staged changes for a commit action - mark as no-op
          operationResult.noChanges = true;
          operationResult.reason = 'No staged changes';
        }
      }

      // Step 3: Push if requested
      if (
        request.action === 'push' ||
        request.options?.pushAfterCommit ||
        request.action === 'create-pr'
      ) {
        logger.info('Starting push step', {
          isPushed: status.isPushed,
          branch: status.branch,
          upToCommitHash: request.upToCommitHash,
        });

        // Validate that upToCommitHash is actually reachable from HEAD
        // After a rebase, commit hashes change and the old hash becomes orphaned
        // In that case, fall back to pushing HEAD
        let refToPush = request.upToCommitHash || 'HEAD';
        if (request.upToCommitHash && request.upToCommitHash !== 'HEAD') {
          try {
            // Check if the commit is an ancestor of or equal to HEAD
            await this.execGitCommand(
              request.workspaceId,
              `git merge-base --is-ancestor ${request.upToCommitHash} HEAD`,
              worktreePath,
            );
            // If we get here, the commit is reachable from HEAD
          } catch {
            // Commit is not reachable from HEAD (orphaned after rebase)
            // Fall back to pushing HEAD
            logger.warn('upToCommitHash is not reachable from HEAD, falling back to HEAD', {
              upToCommitHash: request.upToCommitHash,
            });
            refToPush = 'HEAD';
          }
        }

        const remoteTarget = this.resolvePushRemote(status, request.workspaceId, 'push');
        steps.push({ id: 'push', name: 'Push to remote', status: 'running' });
        if (operationId) backgroundGitOpsService.updateProgress(operationId, 'Pushing to remote');
        try {
          // Set upstream if first push
          if (!status.isPushed) {
            logger.info('Setting upstream and pushing', { branch: status.branch, refToPush });
            // First, unset any existing upstream to avoid "multiple upstream branches" error
            // This can happen when a branch has tracking from multiple remotes
            try {
              await this.execGitCommand(
                request.workspaceId,
                `git branch --unset-upstream ${status.branch}`,
                worktreePath,
              );
            } catch {
              // Ignore error if no upstream was set
            }
            // Now push with explicit refspec and set upstream
            await this.execGitCommand(
              request.workspaceId,
              `git push ${remoteTarget} ${refToPush}:refs/heads/${status.branch} --set-upstream`,
              worktreePath,
            );

            // After pushing, manually update the remote tracking ref
            // The --set-upstream flag doesn't properly update the tracking ref when pushing a specific commit hash
            // We need to manually update refs/remotes/origin/{branch} so that 'git log @{u}..HEAD' correctly shows the commit as pushed
            try {
              const resolvedRef =
                refToPush === 'HEAD'
                  ? (
                      await this.execGitCommand(
                        request.workspaceId,
                        'git rev-parse HEAD',
                        worktreePath,
                      )
                    ).stdout.trim()
                  : refToPush;

              // Update the remote tracking reference
              await this.execGitCommand(
                request.workspaceId,
                `git update-ref refs/remotes/origin/${status.branch} ${resolvedRef}`,
                worktreePath,
              );

              logger.info('Updated remote-tracking ref after first push', {
                branch: status.branch,
                ref: resolvedRef,
              });
            } catch (updateRefError) {
              // Non-fatal - fetch will fix this eventually
              logger.warn('Failed to update remote-tracking ref after first push', {
                error: updateRefError,
              });
            }
          } else {
            // Use force push if branch has diverged from remote (e.g., after rebase)
            const forceFlag = status.hasDivergedFromRemote ? ' --force-with-lease' : '';
            logger.info('Pushing to existing remote', {
              refToPush,
              forcePush: status.hasDivergedFromRemote,
            });
            // Push specific commit or HEAD to remote branch
            await this.execGitCommand(
              request.workspaceId,
              `git push ${remoteTarget} ${refToPush}:refs/heads/${status.branch}${forceFlag}`,
              worktreePath,
            );

            // After pushing, update the remote tracking ref AND set upstream
            // The -u flag only works when pushing HEAD, not specific commits
            // We need to manually update refs/remotes/origin/{branch} so that
            // 'git log @{u}..HEAD' correctly shows the commit as pushed
            try {
              const resolvedRef =
                refToPush === 'HEAD'
                  ? (
                      await this.execGitCommand(
                        request.workspaceId,
                        'git rev-parse HEAD',
                        worktreePath,
                      )
                    ).stdout.trim()
                  : refToPush;

              // Update the remote tracking reference
              await this.execGitCommand(
                request.workspaceId,
                `git update-ref refs/remotes/origin/${status.branch} ${resolvedRef}`,
                worktreePath,
              );

              // Also ensure upstream is set (required for @{u} to work in git log)
              await this.execGitCommand(
                request.workspaceId,
                `git branch --set-upstream-to=origin/${status.branch} ${status.branch}`,
                worktreePath,
              );

              logger.info('Updated remote-tracking ref and upstream', {
                branch: status.branch,
                ref: resolvedRef,
              });
            } catch (updateRefError) {
              // Non-fatal - fetch will fix this eventually
              logger.warn('Failed to update remote-tracking ref', { error: updateRefError });
            }
          }
          steps[steps.length - 1].status = 'completed';
          logger.info('Push completed successfully');

          // Clear git caches so subsequent queries get fresh data
          this.clearGitStatusCache(request.workspaceId);
          gitService.clearStatusCache(request.workspaceId);

          // Invalidate committed changes cache so isPushed status is recalculated
          const gitIntegration = global.gitIntegrations?.get(request.workspaceId);
          if (gitIntegration?.invalidateCommittedChangesCache) {
            gitIntegration.invalidateCommittedChangesCache();
          }
        } catch (error) {
          logger.error('Push failed', error as Error);
          steps[steps.length - 1].status = 'failed';
          const errorMessage = (error as Error).message;
          steps[steps.length - 1].error = errorMessage;
          const stderr = (error as any)?.stderr || errorMessage;

          // Check for non-fast-forward (diverged branch) error
          if (stderr.includes('non-fast-forward') || stderr.includes('behind its remote')) {
            logger.info('Push failed due to diverged branch');
            // Clear cache so next attempt can detect divergence and force push
            this.clearGitStatusCache(request.workspaceId);
            if (operationId) backgroundGitOpsService.failOperation(operationId, 'Branch has diverged from remote');
            return {
              success: false,
              steps,
              error:
                'Branch has diverged from remote (e.g., after rebase). Please try pushing again.',
            };
          }

          if (status.remoteUrl?.includes('github.com') && isGitAuthError(stderr)) {
            // Git push requires local credentials (SSH keys or credential manager),
            // not GitHub OAuth. Only emit git:auth-required, not github:auth-required.
            const pushCommand = `git push origin ${status.branch}`;
            unifiedEventBus.emitDomainEvent('git:auth-required', {
              workspaceId: request.workspaceId,
              operation: 'push',
              message: getGitAuthErrorMessage(stderr, 'push'),
              rawError: stderr,
              command: pushCommand,
              cwd: worktreePath,
            });
          }
          if (operationId) backgroundGitOpsService.failOperation(operationId, 'Failed to push changes');
          return { success: false, steps, error: 'Failed to push changes' };
        }
      }

      // Step: Undo push (force push to earlier commit)
      if (request.action === 'undo-push') {
        if (!request.upToCommitHash) {
          if (operationId) backgroundGitOpsService.failOperation(operationId, 'Commit hash required for undo-push');
          return { success: false, steps, error: 'Commit hash required for undo-push' };
        }

        logger.info('Starting undo-push step', {
          branch: status.branch,
          upToCommitHash: request.upToCommitHash,
        });
        steps.push({ id: 'undo-push', name: 'Undo pushed commits', status: 'running' });
        try {
          const remoteTarget = this.resolvePushRemote(status, request.workspaceId, 'undo-push');

          // For undo-push, we use --force instead of --force-with-lease because:
          // 1. The user explicitly wants to revert to a previous commit
          // 2. --force-with-lease can fail with "stale info" if local refs are out of sync
          // 3. This is an intentional destructive operation to undo pushed commits
          await this.execGitCommand(
            request.workspaceId,
            `git push ${remoteTarget} ${request.upToCommitHash}:refs/heads/${status.branch} --force`,
            worktreePath,
          );

          // Fetch to update remote tracking refs so git knows which commits are now unpushed
          // This ensures the UI correctly shows the cloud icon status
          await this.execGitCommand(
            request.workspaceId,
            `git fetch origin ${status.branch}`,
            worktreePath,
          );

          steps[steps.length - 1].status = 'completed';
          logger.info('Undo-push completed successfully');

          // Clear git caches so subsequent queries get fresh data
          this.clearGitStatusCache(request.workspaceId);
          gitService.clearStatusCache(request.workspaceId);

          // Invalidate committed changes cache so isPushed status is recalculated
          const gitIntegration = global.gitIntegrations?.get(request.workspaceId);
          if (gitIntegration?.invalidateCommittedChangesCache) {
            gitIntegration.invalidateCommittedChangesCache();
          }
        } catch (error) {
          logger.error('Undo-push failed', error as Error);
          steps[steps.length - 1].status = 'failed';
          steps[steps.length - 1].error = (error as Error).message;
          if (operationId) backgroundGitOpsService.failOperation(operationId, 'Failed to undo push');
          return { success: false, steps, error: 'Failed to undo push' };
        }
      }

      // Step: Undo local commit (soft reset to bring changes back to staging)
      if (request.action === 'undo-commit') {
        if (!request.upToCommitHash) {
          if (operationId) backgroundGitOpsService.failOperation(operationId, 'Commit hash required for undo-commit');
          return { success: false, steps, error: 'Commit hash required for undo-commit' };
        }

        logger.info('Starting undo-commit step', {
          branch: status.branch,
          upToCommitHash: request.upToCommitHash,
          hasUndoMetadata: !!request.undoCommitsMetadata?.length,
        });
        steps.push({ id: 'undo-commit', name: 'Undo local commit', status: 'running' });
        try {
          // Use soft reset to keep changes in the working directory/staging area
          await this.execGitCommand(
            request.workspaceId,
            `git reset --soft ${request.upToCommitHash}`,
            worktreePath,
          );

          steps[steps.length - 1].status = 'completed';
          logger.info('Undo-commit completed successfully');

          // Clear git caches so subsequent queries get fresh data
          this.clearGitStatusCache(request.workspaceId);
          gitService.clearStatusCache(request.workspaceId);

          // Invalidate committed changes cache
          const gitIntegration = global.gitIntegrations?.get(request.workspaceId);
          if (gitIntegration?.invalidateCommittedChangesCache) {
            gitIntegration.invalidateCommittedChangesCache();
          }

          // Restore agent attributions for files from undone commits
          // This ensures files are grouped by their original agent/task in the UI
          if (request.undoCommitsMetadata?.length) {
            const attributionEngine = getAttributionEngine();
            for (const commitMeta of request.undoCommitsMetadata) {
              if (commitMeta.agentId && commitMeta.files?.length) {
                logger.info('Restoring agent attribution for undone commit files', {
                  agentId: commitMeta.agentId,
                  agentName: commitMeta.agentName,
                  linkedNoteId: commitMeta.linkedNoteId,
                  fileCount: commitMeta.files.length,
                });

                for (const filePath of commitMeta.files) {
                  // Record agent write for each file so it gets attributed correctly
                  // when git-integration detects the staged changes
                  attributionEngine.recordAgentWrite(
                    {
                      agentId: commitMeta.agentId,
                      agentName: commitMeta.agentName || 'Agent',
                      // Use linkedNoteId as sessionId to preserve grouping
                      sessionId: commitMeta.linkedNoteId,
                    },
                    filePath,
                    '', // Content not needed for attribution from undo
                    worktreePath,
                    request.workspaceId,
                  );
                }
              }
            }
          }

          if (operationId) backgroundGitOpsService.completeOperation(operationId);
          return { success: true, steps };
        } catch (error) {
          logger.error('Undo-commit failed', error as Error);
          steps[steps.length - 1].status = 'failed';
          steps[steps.length - 1].error = (error as Error).message;
          if (operationId) backgroundGitOpsService.failOperation(operationId, 'Failed to undo commit');
          return { success: false, steps, error: 'Failed to undo commit' };
        }
      }

      // Step: Reset to trunk (hard reset to trunk HEAD)
      if (request.action === 'reset-to-trunk') {
        logger.info('Starting reset-to-trunk step', {
          branch: status.branch,
          trunkBranch: status.trunkBranch,
          hasRemote: status.hasRemote,
        });
        steps.push({ id: 'reset-to-trunk', name: 'Reset to trunk', status: 'running' });

        // Server-side validation: ensure worktree is clean before destructive reset
        // Use a fresh git status check (bypasses the cached gitService.getStatus() with 5s TTL)
        try {
          const { stdout: porcelainStatus } = await this.execGitCommand(
            request.workspaceId,
            'git status --porcelain',
            worktreePath,
          );
          if (porcelainStatus.trim().length > 0) {
            logger.warn('reset-to-trunk aborted: fresh worktree check found uncommitted changes', {
              dirtyFileCount: porcelainStatus.trim().split('\n').length,
            });
            steps[steps.length - 1].status = 'failed';
            steps[steps.length - 1].error = 'Cannot reset: uncommitted or staged changes exist';
            if (operationId) backgroundGitOpsService.failOperation(operationId, 'Cannot reset: uncommitted changes');
            return { success: false, steps, error: 'Cannot reset while there are uncommitted or staged changes. Please commit or discard changes first.' };
          }
        } catch (statusError) {
          logger.warn('reset-to-trunk aborted: failed to verify worktree cleanliness', {
            error: (statusError as Error).message,
          });
          steps[steps.length - 1].status = 'failed';
          steps[steps.length - 1].error = 'Failed to verify worktree state';
          if (operationId) backgroundGitOpsService.failOperation(operationId, 'Failed to verify worktree state');
          return { success: false, steps, error: 'Unable to verify worktree is clean before reset. Please try again.' };
        }

        // Validate branch names to prevent shell injection (uses shared SAFE_REF_PATTERN)
        if (!SAFE_REF_PATTERN.test(status.trunkBranch)) {
          steps[steps.length - 1].status = 'failed';
          steps[steps.length - 1].error = 'Invalid trunk branch name';
          if (operationId) backgroundGitOpsService.failOperation(operationId, 'Invalid trunk branch name');
          return { success: false, steps, error: `Invalid trunk branch name: ${status.trunkBranch}` };
        }

        try {
          // Fetch origin to get latest trunk ref (non-fatal if fails)
          if (status.hasRemote && !isKeychainAccessSuppressed(request.workspaceId as string)) {
            try {
              await this.execGitCommand(
                request.workspaceId,
                `git fetch origin ${status.trunkBranch}`,
                worktreePath,
              );
            } catch (fetchError) {
              logger.warn('Failed to fetch origin before reset-to-trunk, continuing with cached ref', {
                error: (fetchError as Error).message,
              });
            }
          }

          // Determine reset target: origin/trunk if remote exists, else local trunk
          const resetTarget = status.hasRemote
            ? `origin/${status.trunkBranch}`
            : status.trunkBranch;

          // Hard reset to trunk HEAD
          await this.execGitCommand(
            request.workspaceId,
            `git reset --hard ${resetTarget}`,
            worktreePath,
          );

          // Get the new HEAD SHA
          const { stdout: headSha } = await this.execGitCommand(
            request.workspaceId,
            'git rev-parse HEAD',
            worktreePath,
          );
          const newHeadSha = headSha.trim();

          steps[steps.length - 1].status = 'completed';
          logger.info('Reset-to-trunk completed successfully', {
            newHeadSha: newHeadSha.slice(0, 7),
          });

          // Clear git caches so subsequent queries get fresh data
          this.clearGitStatusCache(request.workspaceId);
          gitService.clearStatusCache(request.workspaceId);

          // Invalidate committed changes cache
          const gitIntegration = global.gitIntegrations?.get(request.workspaceId);
          if (gitIntegration?.invalidateCommittedChangesCache) {
            gitIntegration.invalidateCommittedChangesCache();
          }

          if (operationId) backgroundGitOpsService.completeOperation(operationId);
          return { success: true, steps, result: { newHeadSha } };
        } catch (error) {
          logger.error('Reset-to-trunk failed', error as Error);
          steps[steps.length - 1].status = 'failed';
          steps[steps.length - 1].error = (error as Error).message;
          if (operationId) backgroundGitOpsService.failOperation(operationId, 'Failed to reset to trunk');
          return { success: false, steps, error: 'Failed to reset to trunk' };
        }
      }

      // Step: Rebase onto trunk (standalone, outside merge flow)
      if (request.action === 'rebase-onto-trunk') {
        logger.info('Starting rebase-onto-trunk step', {
          branch: status.branch,
          trunkBranch: status.trunkBranch,
        });
        steps.push({ id: 'rebase-onto-trunk', name: 'Rebase onto trunk', status: 'running' });

        // Validate branch names to prevent shell injection
        if (!SAFE_REF_PATTERN.test(status.trunkBranch)) {
          steps[steps.length - 1].status = 'failed';
          steps[steps.length - 1].error = 'Invalid trunk branch name';
          return { success: false, steps, error: `Invalid trunk branch name: ${status.trunkBranch}` };
        }
        if (!SAFE_REF_PATTERN.test(status.branch)) {
          steps[steps.length - 1].status = 'failed';
          steps[steps.length - 1].error = 'Invalid branch name';
          return { success: false, steps, error: `Invalid branch name: ${status.branch}` };
        }

        const trunkRef = status.hasRemote
          ? `origin/${status.trunkBranch}`
          : status.trunkBranch;

        // Fetch latest trunk
        if (status.hasRemote && !isKeychainAccessSuppressed(request.workspaceId as string)) {
          try {
            await this.execGitCommand(
              request.workspaceId,
              `git fetch origin ${status.trunkBranch}`,
              worktreePath,
            );
          } catch (fetchError) {
            logger.warn('Failed to fetch origin before rebase-onto-trunk, continuing with cached ref', {
              error: (fetchError as Error).message,
            });
          }
        }

        // Check for conflicts via detectMergeConflicts — abort early if conflicts
        const hasConflicts = await this.detectMergeConflicts(
          request.workspaceId,
          worktreePath,
          status.branch,
          trunkRef,
        );
        if (hasConflicts) {
          logger.warn('Rebase-onto-trunk aborted: conflicts detected');
          steps[steps.length - 1].status = 'failed';
          steps[steps.length - 1].error = 'Conflicts detected. Please rebase manually.';
          return {
            success: false,
            steps,
            error: 'Conflicts detected. Please rebase manually.',
          };
        }

        // Capture trunk tip SHA before rebase
        let capturedTrunkSha: string | undefined;
        try {
          const { stdout: trunkTipOut } = await this.execGitCommand(
            request.workspaceId,
            `git rev-parse ${trunkRef}`,
            worktreePath,
          );
          capturedTrunkSha = trunkTipOut.trim();
        } catch {
          logger.warn('Failed to resolve trunk tip SHA for rebase-onto-trunk');
        }

        // Perform the rebase
        const rebaseResult = await this.rebaseWithAutoStash(
          request.workspaceId,
          trunkRef,
          worktreePath,
        );
        if (!rebaseResult.success) {
          const errorMessage = rebaseResult.error || 'Rebase onto trunk failed. Please try rebasing manually.';
          steps[steps.length - 1].status = 'failed';
          steps[steps.length - 1].error = errorMessage;
          return {
            success: false,
            steps,
            error: errorMessage,
          };
        }

        // Clear git caches so subsequent queries get fresh data
        this.clearGitStatusCache(request.workspaceId);
        gitService.clearStatusCache(request.workspaceId);

        // Invalidate committed changes cache since rebase rewrites history
        const gitIntegration = global.gitIntegrations?.get(request.workspaceId);
        if (gitIntegration?.invalidateCommittedChangesCache) {
          gitIntegration.invalidateCommittedChangesCache();
        }

        // Refresh git state after successful rebase
        changeDetectorManager.triggerImmediateCheck(request.workspaceId, 'post-rebase-onto-trunk');

        steps[steps.length - 1].status = 'completed';
        logger.info('Rebase-onto-trunk completed successfully');

        return {
          success: true,
          steps,
          result: { autoRebased: true, newBaseSha: capturedTrunkSha },
        };
      }

      // Step 4: Create PR if requested
      if (request.action === 'create-pr' || request.options?.createPRAfterPush) {
        // When createPRAfterPush is true and push succeeded, we need to:
        // 1. Complete the push operation (if it was tracked)
        // 2. Register a new create-pr operation so the toast shows "PR created" instead of "pushed"
        let prOperationId: string | null = null;
        if (request.options?.createPRAfterPush && operationId) {
          // Complete the push operation now that push has succeeded
          backgroundGitOpsService.completeOperation(operationId);
          // Register a new operation for PR creation
          prOperationId = backgroundGitOpsService.registerOperation(
            request.workspaceId,
            'create-pr',
            {
              message: request.commitMessage,
              prTitle: request.prTitle,
            },
          );
        } else {
          // For direct create-pr action, use the existing operationId
          prOperationId = operationId;
        }

        logger.info('Starting create PR step', { owner: status.owner, repo: status.repo });
        if (prOperationId) backgroundGitOpsService.updateProgress(prOperationId, 'Creating pull request');
        if (!status.owner || !status.repo) {
          logger.error('Could not determine GitHub repository', {
            owner: status.owner,
            repo: status.repo,
          });
          if (prOperationId) {
            backgroundGitOpsService.failOperation(
              prOperationId,
              'Could not determine GitHub repository',
            );
          }
          return { success: false, steps, error: 'Could not determine GitHub repository' };
        }

        // First, check if a PR already exists for this branch
        const existingPRs = await githubService.getPullRequests(status.owner, status.repo, {
          state: 'open',
          head: `${status.owner}:${status.branch}`,
          base: request.targetBranch || status.trunkBranch,
        });

        if (existingPRs && existingPRs.length > 0) {
          // PR already exists - use it instead of creating a new one
          const existingPR = existingPRs[0];
          logger.info('PR already exists for this branch', {
            prNumber: existingPR.number,
            prUrl: existingPR.htmlUrl,
          });

          steps.push({ id: 'create-pr', name: 'Found existing pull request', status: 'completed' });

          // Update workspace with the existing PR info
          try {
            const prInfo = {
              id: String(existingPR.number),
              number: existingPR.number,
              url: existingPR.htmlUrl,
              title: existingPR.title,
              status: PullRequestStatus.Open,
              createdAt: existingPR.createdAt,
              updatedAt: existingPR.updatedAt,
            };
            const updatedWorkspace = {
              ...workspace,
              activePullRequest: prInfo,
              prUrl: existingPR.htmlUrl,
              prNumber: existingPR.number,
              prStatus: PullRequestStatus.Open,
              updatedAt: new Date().toISOString(),
            };
            await this.workspaceRepository.save(updatedWorkspace);

            // Emit event to notify renderer of workspace update
            unifiedEventBus.emitDomainEvent('workspace:updated', {
              workspaceId: request.workspaceId,
              changes: {
                activePullRequest: prInfo,
                prUrl: existingPR.htmlUrl,
                prNumber: existingPR.number,
                prStatus: PullRequestStatus.Open,
              },
            });
          } catch (saveError) {
            logger.warn('Failed to save workspace with PR info', { error: saveError });
          }

          const existingPrOpId = prOperationId || operationId;
          if (existingPrOpId) backgroundGitOpsService.completeOperation(existingPrOpId, { prNumber: existingPR.number, prUrl: existingPR.htmlUrl });
          return {
            success: true,
            steps,
            result: {
              prNumber: existingPR.number,
              prUrl: existingPR.url,
              prHtmlUrl: existingPR.htmlUrl,
              existingPR: true,
            },
          };
        }

        steps.push({ id: 'create-pr', name: 'Create pull request', status: 'running' });
        try {
          logger.info('Creating pull request', {
            owner: status.owner,
            repo: status.repo,
            head: status.branch,
            base: request.targetBranch || status.trunkBranch,
            title: request.prTitle,
          });
          const pr = await githubService.createPullRequest(status.owner, status.repo, {
            title: request.prTitle || 'Changes from workspace',
            head: status.branch,
            base: request.targetBranch || status.trunkBranch,
            body: request.prBody,
          });

          if (pr) {
            logger.info('PR created successfully', { prNumber: pr.number, prUrl: pr.url });
            steps[steps.length - 1].status = 'completed';

            // Update workspace with the new PR info
            try {
              const prInfo = {
                id: String(pr.number),
                number: pr.number,
                url: pr.htmlUrl,
                title: request.prTitle || 'Changes from workspace',
                status: PullRequestStatus.Open,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              };
              const updatedWorkspace = {
                ...workspace,
                activePullRequest: prInfo,
                prUrl: pr.htmlUrl,
                prNumber: pr.number,
                prStatus: PullRequestStatus.Open,
                updatedAt: new Date().toISOString(),
              };
              await this.workspaceRepository.save(updatedWorkspace);
              logger.info('Workspace updated with PR info', {
                workspaceId: request.workspaceId,
                prNumber: pr.number,
              });

              // Emit event to notify renderer of workspace update
              unifiedEventBus.emitDomainEvent('workspace:updated', {
                workspaceId: request.workspaceId,
                changes: {
                  activePullRequest: prInfo,
                  prUrl: pr.htmlUrl,
                  prNumber: pr.number,
                  prStatus: PullRequestStatus.Open,
                },
              });
            } catch (saveError) {
              logger.warn('Failed to save workspace with PR info', { error: saveError });
              // Don't fail the whole operation if save fails
            }

            // Mark operation as completed with PR info
            const newPrOpId = prOperationId || operationId;
            if (newPrOpId) {
              backgroundGitOpsService.completeOperation(newPrOpId, {
                prNumber: pr.number,
                prUrl: pr.htmlUrl,
              });
            }

            return {
              success: true,
              steps,
              result: {
                prNumber: pr.number,
                prUrl: pr.url,
                prHtmlUrl: pr.htmlUrl,
              },
            };
          } else {
            throw new Error('Failed to create PR');
          }
        } catch (error) {
          logger.error('Failed to create PR', error as Error);
          steps[steps.length - 1].status = 'failed';
          const errorMessage = (error as Error).message;
          steps[steps.length - 1].error = errorMessage;

          // Provide user-friendly error messages for common issues
          let userError = 'Failed to create pull request';
          const isAuthError =
            errorMessage.includes('not authenticated') ||
            errorMessage.includes('Bad credentials') ||
            errorMessage.includes('401') ||
            errorMessage.includes('Unauthorized');

          if (isAuthError) {
            userError = 'GitHub authentication required to create pull request.';
            // Emit event to trigger GitHub auth modal
            unifiedEventBus.emitDomainEvent('github:auth-required', {
              workspaceId: request.workspaceId,
              operation: 'create-pr',
              message: userError,
            });
          } else if (
            errorMessage.includes('400') ||
            errorMessage.includes('Unidentified internal error')
          ) {
            // 400 errors from Augment API are often internal backend issues
            // Don't prompt for re-auth as it won't help - provide a direct link instead
            const createPrUrl = `https://github.com/${status.owner}/${status.repo}/compare/${status.trunkBranch}...${status.branch}?expand=1`;
            userError =
              'Unable to create PR via Augment API. This appears to be a backend issue. ' +
              `You can create the PR directly on GitHub: ${createPrUrl}`;
            logger.warn('PR creation failed - Augment API backend error', {
              owner: status.owner,
              repo: status.repo,
              branch: status.branch,
              base: status.trunkBranch,
              error: errorMessage,
              createPrUrl,
            });
            // Note: Not emitting github:auth-required as re-auth won't fix this backend issue
          } else if (errorMessage.includes('No commits between')) {
            userError =
              'No commits to create PR from. Please commit your changes first, then push to remote.';
          } else if (errorMessage.includes('pull request already exists')) {
            userError = 'A pull request already exists for this branch.';
          } else if (errorMessage.includes('Validation Failed')) {
            userError = `GitHub validation failed: ${errorMessage}`;
          }

          const failOpId = prOperationId || operationId;
          if (failOpId) backgroundGitOpsService.failOperation(failOpId, userError);
          return { success: false, steps, error: userError };
        }
      }

      // Step 5: Merge if requested
      if (request.action === 'merge') {
        // First, commit any staged changes
        const statusResult = await gitService.getStatus(request.workspaceId);
        const hasStaged = statusResult.ok && statusResult.data?.files.some((f) => f.staged);

        if (hasStaged) {
          steps.push({ id: 'commit', name: 'Commit staged changes', status: 'running' });
          try {
            const message = request.commitMessage || `Changes for merge to ${status.trunkBranch}`;
            await this.execGitCommand(
              request.workspaceId,
              `git commit -m "${message.replace(/"/g, '\\"')}"`,
              worktreePath,
            );
            steps[steps.length - 1].status = 'completed';
            logger.info('Committed staged changes before merge');

            // Handle post-commit transition directly and await it
            // This ensures file tracking state is updated before continuing
            try {
              const { stdout: commitHash } = await this.execGitCommand(
                request.workspaceId,
                'git rev-parse HEAD',
                worktreePath,
              );
              const trimmedHash = commitHash.trim();

              // Handle post-commit directly (same fix as regular commit)
              const gitIntegration = global.gitIntegrations?.get(request.workspaceId);
              if (gitIntegration) {
                await gitIntegration.handlePostCommit(trimmedHash);
                await gitIntegration.syncCurrentState(true);
                logger.info('Post-commit transition complete for merge commit', {
                  workspaceId: request.workspaceId,
                  commitHash: trimmedHash.slice(0, 7),
                });
              }

              // Emit event with postCommitHandled flag
              unifiedEventBus.emitDomainEvent('git:commit-created', {
                workspaceId: request.workspaceId,
                commitSha: trimmedHash,
                postCommitHandled: true,
              });
              logger.info('Emitted git:commit-created event for merge commit', {
                workspaceId: request.workspaceId,
                commitHash: trimmedHash.slice(0, 7),
              });
            } catch (eventError) {
              logger.error('Failed to handle post-commit for merge', eventError as Error);
            }
          } catch (error) {
            steps[steps.length - 1].status = 'failed';
            steps[steps.length - 1].error = (error as Error).message;
            if (operationId) backgroundGitOpsService.failOperation(operationId, 'Failed to commit staged changes');
            return { success: false, steps, error: 'Failed to commit staged changes' };
          }
        }

        steps.push({ id: 'merge', name: 'Merge to trunk', status: 'running' });
        try {
          const remoteTarget = this.resolvePushRemote(status, request.workspaceId, 'merge');

          // Debug logging for merge operation
          logger.info('Starting merge operation', {
            workspaceId: request.workspaceId,
            currentBranch: status.branch,
            trunkBranch: status.trunkBranch,
            requestTargetBranch: request.targetBranch,
            remoteTarget,
            mergeStrategy: request.mergeStrategy,
            rebaseFirst: request.options?.rebaseFirst,
            isPushed: status.isPushed,
            hasDivergedFromRemote: status.hasDivergedFromRemote,
            aheadOfTrunk: status.aheadOfTrunk,
            behindTrunk: status.behindTrunk,
          });

          // Check if remote has the trunk branch
          // We need to distinguish between:
          // 0. No remote configured -> proceed with local-only merge (skip ls-remote entirely)
          // 0b. localOnly option set -> proceed with local-only merge (skip remote entirely)
          // 1. Remote reachable, branch exists -> proceed with remote merge
          // 2. Remote reachable, branch missing -> proceed with local-only merge
          // 3. Remote unreachable (auth/network error) -> fail with error
          let hasRemoteTrunk = false;
          let remoteReachable = true;
          const localOnly = request.options?.localOnly === true;

          if (localOnly) {
            // User explicitly requested local-only merge - skip all remote operations
            hasRemoteTrunk = false;
            logger.info('Local-only merge requested by user', {
              trunkBranch: status.trunkBranch,
            });
          } else if (!status.hasRemote) {
            // No remote configured at all - go straight to local-only merge
            hasRemoteTrunk = false;
            logger.info('No remote configured, will use local-only merge', {
              trunkBranch: status.trunkBranch,
            });
          } else {
            try {
              const { stdout: lsRemoteOut } = await this.execGitCommand(
                request.workspaceId,
                `git ls-remote --heads ${remoteTarget} ${status.trunkBranch}`,
                worktreePath,
              );
              // If the command succeeds and returns output, remote has the branch
              hasRemoteTrunk = lsRemoteOut.trim().length > 0;
            } catch (lsRemoteError) {
              const stderr = (lsRemoteError as any)?.stderr || '';
              // Check if this is a "remote ref not found" vs "remote unreachable" error
              // If ls-remote succeeds but returns empty, that's fine (branch just doesn't exist)
              // If ls-remote fails entirely, that's a connectivity/auth issue
              if (stderr.includes('Could not resolve host') ||
                  stderr.includes('Connection refused') ||
                  stderr.includes('Authentication failed') ||
                  stderr.includes('Permission denied') ||
                  stderr.includes('fatal: unable to access') ||
                  stderr.includes('fatal: repository') ||
                  (lsRemoteError as any)?.code === 128 && !stderr.includes("couldn't find remote ref")) {
                // Remote is unreachable - this is an error we should surface
                remoteReachable = false;
                logger.warn('Remote unreachable during trunk branch check', {
                  trunkBranch: status.trunkBranch,
                  errorCode: (lsRemoteError as any)?.code,
                });
              } else {
                // ls-remote failed but likely because the remote doesn't have the branch
                // or the remote itself doesn't exist - proceed with local-only merge
                hasRemoteTrunk = false;
                logger.info('Remote trunk branch not found, will use local-only merge', {
                  trunkBranch: status.trunkBranch,
                });
              }
            }

            // If remote is unreachable, fail early with a clear message
            if (!remoteReachable) {
              steps[steps.length - 1].status = 'failed';
              if (operationId) backgroundGitOpsService.failOperation(operationId, 'Unable to reach remote');
              return {
                success: false,
                steps,
                error: `Unable to reach remote '${remoteTarget}'. Check your network connection and authentication.`,
              };
            }
          }

          logger.info('Remote trunk check', { hasRemoteTrunk, trunkBranch: status.trunkBranch });

          // Fetch latest trunk first (needed for both rebase check and merge)
          // Skip if remote doesn't have the trunk branch
          if (hasRemoteTrunk) {
            await this.execGitCommand(
              request.workspaceId,
              `git fetch ${remoteTarget} ${status.trunkBranch}`,
              worktreePath,
            );
          }

          // Determine the trunk ref to use for comparisons
          const trunkRef = hasRemoteTrunk ? `origin/${status.trunkBranch}` : status.trunkBranch;

          // If rebaseFirst is requested, rebase onto trunk
          if (request.options?.rebaseFirst) {
            logger.info('Rebasing onto trunk before merge', {
              trunkBranch: status.trunkBranch,
              trunkRef,
            });
            const rebaseResult = await this.rebaseWithAutoStash(
              request.workspaceId,
              trunkRef,
              worktreePath,
            );
            if (!rebaseResult.success) {
              steps[steps.length - 1].status = 'failed';
              steps[steps.length - 1].error = rebaseResult.error || 'Failed to rebase';
              return {
                success: false,
                steps,
                error: rebaseResult.error || 'Failed to rebase. Resolve conflicts manually.',
              };
            }

            // Refresh git state after successful rebase (don't rely on file watcher)
            // This mirrors the post-commit pattern (~line 1340) for reliable state sync
            gitService.clearStatusCache(request.workspaceId);
            unifiedEventBus.emitDomainEvent('git:status-changed', {
              workspaceId: request.workspaceId,
            });
            changeDetectorManager.triggerImmediateCheck(request.workspaceId, 'post-rebase-first');
            logger.info('Post-rebase state refresh triggered', {
              workspaceId: request.workspaceId,
              context: 'rebaseFirst',
            });
          }

          // In worktrees, we can't checkout the trunk branch (it's checked out in the main repo)
          // Instead, we need to:
          // 1. Push to remote first (if not already pushed) - only if remote exists
          // 2. Use git push to update the trunk branch with our changes (or local merge if no remote)

          // Push our branch (force push if we just rebased or branch has diverged from remote)
          // This handles both: 1) rebase done via rebaseFirst option, 2) manual rebase in terminal
          // Skip push if remote doesn't have trunk (local-only merge)
          if (hasRemoteTrunk) {
            const needsForcePush =
              (request.options?.rebaseFirst && status.isPushed) || status.hasDivergedFromRemote;
            logger.info('Pushing branch before merge', {
              branch: status.branch,
              forcePush: needsForcePush,
              hasDivergedFromRemote: status.hasDivergedFromRemote,
            });
            try {
              await this.execGitCommand(
                request.workspaceId,
                `git branch --unset-upstream ${status.branch}`,
                worktreePath,
              );
            } catch {
              // Ignore if no upstream
            }
            const forceFlag = needsForcePush ? ' --force-with-lease' : '';
            await this.execGitCommand(
              request.workspaceId,
              `git push ${remoteTarget} HEAD:refs/heads/${status.branch} --set-upstream${forceFlag}`,
              worktreePath,
            );
          } else {
            logger.info('Skipping push - no remote trunk, will do local merge');
          }

          // Check if we can fast-forward (branch is based on trunk)
          let canFastForward = false;
          try {
            await this.execGitCommand(
              request.workspaceId,
              `git merge-base --is-ancestor ${trunkRef} HEAD`,
              worktreePath,
            );
            canFastForward = true;
          } catch {
            canFastForward = false;
          }

          // Track if we auto-rebased (needed for force push and result reporting)
          let autoRebased = false;
          let rebaseBaseSha: string | undefined; // Trunk tip SHA at time of auto-rebase (new fork point)

          if (!canFastForward) {
            // Branch is behind trunk - re-check conflicts with fresh refs (post-fetch)
            const freshHasConflicts = await this.detectMergeConflicts(
              request.workspaceId,
              worktreePath,
              status.branch,
              trunkRef,
            );
            if (freshHasConflicts) {
              // Conflicts detected via merge-tree - skip rebase, return error for manual resolution
              logger.warn('Branch needs rebase but has conflicts - skipping auto-rebase');
              steps[steps.length - 1].status = 'failed';
              steps[steps.length - 1].error = 'Conflicts detected. Please rebase manually.';
              if (operationId) backgroundGitOpsService.failOperation(operationId, 'Conflicts detected');
              return {
                success: false,
                steps,
                error: 'Conflicts detected. Please rebase manually.',
              };
            }

            // No conflicts detected - attempt auto-rebase
            logger.info('Auto-rebasing onto trunk (no conflicts detected)', {
              trunkBranch: status.trunkBranch,
              trunkRef,
            });

            // Capture the trunk tip SHA BEFORE rebase - this is the exact "onto" SHA we're rebasing to
            let capturedTrunkSha: string | undefined;
            try {
              const { stdout: trunkTipOut } = await this.execGitCommand(
                request.workspaceId,
                `git rev-parse ${trunkRef}`,
                worktreePath,
              );
              capturedTrunkSha = trunkTipOut.trim();
            } catch {
              // Failed to resolve trunk ref - continue without baseSHA update
              logger.warn('Failed to resolve trunk tip SHA for baseSHA update');
            }

            const rebaseResult = await this.rebaseWithAutoStash(
              request.workspaceId,
              trunkRef,
              worktreePath,
            );
            if (!rebaseResult.success) {
              const errorMessage = rebaseResult.error || 'Auto-rebase failed. Please try rebasing manually.';
              steps[steps.length - 1].status = 'failed';
              steps[steps.length - 1].error = errorMessage;
              if (operationId) backgroundGitOpsService.failOperation(operationId, errorMessage);
              return {
                success: false,
                steps,
                error: errorMessage,
              };
            }

            // Refresh git state after successful rebase (don't rely on file watcher)
            // This mirrors the post-commit pattern (~line 1340) for reliable state sync
            gitService.clearStatusCache(request.workspaceId);
            unifiedEventBus.emitDomainEvent('git:status-changed', {
              workspaceId: request.workspaceId,
            });
            changeDetectorManager.triggerImmediateCheck(request.workspaceId, 'post-auto-rebase');
            logger.info('Post-rebase state refresh triggered', {
              workspaceId: request.workspaceId,
              context: 'auto-rebase',
            });

            autoRebased = true;
            rebaseBaseSha = capturedTrunkSha;

            // After successful rebase, we need to force push our branch to update remote
            // (the branch was already pushed to remote earlier in this flow)
            if (hasRemoteTrunk) {
              logger.info('Force pushing branch after auto-rebase');
              try {
                await this.execGitCommand(
                  request.workspaceId,
                  `git push ${remoteTarget} HEAD:refs/heads/${status.branch} --force-with-lease`,
                  worktreePath,
                );
              } catch (error) {
                // Don't log raw error - it may contain file paths (PII)
                logger.error('Force push after auto-rebase failed');
                steps[steps.length - 1].status = 'failed';
                steps[steps.length - 1].error = 'Failed to push after rebase.';
                if (operationId) backgroundGitOpsService.failOperation(operationId, 'Failed to push after rebase');
                return {
                  success: false,
                  steps,
                  error: 'Failed to push after rebase.',
                };
              }
            }
          }

          // Use git push to update trunk with our branch (fast-forward merge)
          // For squash merge, we create a single commit first
          if (request.mergeStrategy === 'squash') {
            // For squash, we need to create a squashed commit
            // Get the merge base
            const { stdout: mergeBase } = await this.execGitCommand(
              request.workspaceId,
              `git merge-base ${trunkRef} HEAD`,
              worktreePath,
            );

            // Create a tree from current HEAD
            const { stdout: treeHash } = await this.execGitCommand(
              request.workspaceId,
              'git write-tree',
              worktreePath,
            );

            // Create a squash commit with the merge base as parent
            const commitMessage = request.commitMessage || `Squashed commit from ${status.branch}`;
            const { stdout: commitHash } = await this.execGitCommand(
              request.workspaceId,
              `git commit-tree ${treeHash.trim()} -p ${mergeBase.trim()} -m "${commitMessage.replace(/"/g, '\\"')}"`,
              worktreePath,
            );

            if (hasRemoteTrunk) {
              // Push this commit to remote trunk
              await this.execGitCommand(
                request.workspaceId,
                `git push ${remoteTarget} ${commitHash.trim()}:refs/heads/${status.trunkBranch}`,
                worktreePath,
              );
            } else {
              // Local-only: update the local trunk branch ref
              await this.execGitCommand(
                request.workspaceId,
                `git update-ref refs/heads/${status.trunkBranch} ${commitHash.trim()}`,
                worktreePath,
              );
              logger.info('Updated local trunk branch with squash commit', {
                trunkBranch: status.trunkBranch,
                commitHash: commitHash.trim(),
              });
            }

            steps[steps.length - 1].status = 'completed';
            if (operationId) backgroundGitOpsService.completeOperation(operationId, { commitHash: commitHash.trim() });
            return {
              success: true,
              steps,
              result: {
                mergeCommitHash: commitHash.trim(),
                ...(autoRebased && { autoRebased: true }),
                ...(rebaseBaseSha && { newBaseSha: rebaseBaseSha }),
              },
            };
          } else {
            // Regular merge - fast-forward trunk to current HEAD
            // Get current commit hash
            const { stdout: hashOut } = await this.execGitCommand(
              request.workspaceId,
              'git rev-parse HEAD',
              worktreePath,
            );
            const currentCommit = hashOut.trim();

            if (hasRemoteTrunk) {
              // Push current branch to remote trunk (fast-forward)
              await this.execGitCommand(
                request.workspaceId,
                `git push ${remoteTarget} HEAD:refs/heads/${status.trunkBranch}`,
                worktreePath,
              );
            } else {
              // Local-only: update the local trunk branch ref to current HEAD
              await this.execGitCommand(
                request.workspaceId,
                `git update-ref refs/heads/${status.trunkBranch} ${currentCommit}`,
                worktreePath,
              );
              logger.info('Updated local trunk branch to current HEAD', {
                trunkBranch: status.trunkBranch,
                commitHash: currentCommit,
              });
            }

            steps[steps.length - 1].status = 'completed';
            if (operationId) backgroundGitOpsService.completeOperation(operationId, { commitHash: currentCommit });
            return {
              success: true,
              steps,
              result: {
                mergeCommitHash: currentCommit,
                ...(autoRebased && { autoRebased: true }),
                ...(rebaseBaseSha && { newBaseSha: rebaseBaseSha }),
              },
            };
          }
        } catch (error) {
          const errorMessage = (error as Error).message || String(error);
          const stderr = (error as any)?.stderr || '';
          // Log error without sensitive path information (PII compliance)
          logger.error('Merge failed', {
            error: errorMessage,
            trunkBranch: status.trunkBranch,
            branch: status.branch,
            errorCode: (error as any)?.code,
          });
          steps[steps.length - 1].status = 'failed';
          steps[steps.length - 1].error = errorMessage;
          // Pass through the actual error message instead of generic one
          const userError = stderr ? `${errorMessage}: ${stderr}` : errorMessage;
          if (operationId) backgroundGitOpsService.failOperation(operationId, userError || 'Failed to merge');
          return { success: false, steps, error: userError || 'Failed to merge changes' };
        }
      }

      // Step 6: Export files if requested
      if (request.action === 'export' && request.exportPath) {
        steps.push({ id: 'export', name: 'Export files', status: 'running' });
        try {
          const exportResult = await this.exportFiles({
            workspaceId: request.workspaceId,
            targetPath: request.exportPath,
            files: request.files,
            preserveStructure: true,
          });

          if (!exportResult.success) {
            throw new Error(exportResult.error || 'Export failed');
          }

          steps[steps.length - 1].status = 'completed';
          if (operationId) backgroundGitOpsService.completeOperation(operationId);
          return {
            success: true,
            steps,
            result: {
              exportedFiles: exportResult.exportedFiles,
            },
          };
        } catch (error) {
          steps[steps.length - 1].status = 'failed';
          steps[steps.length - 1].error = (error as Error).message;
          if (operationId) backgroundGitOpsService.failOperation(operationId, 'Failed to export files');
          return { success: false, steps, error: 'Failed to export files' };
        }
      }

      logger.info('Accept changes completed successfully', {
        action: request.action,
        workspaceId: request.workspaceId,
        stepsCompleted: steps.filter((s) => s.status === 'completed').length,
        totalSteps: steps.length,
      });

      // Mark operation as completed (if not already completed by PR creation)
      // Pass accumulated result info (e.g., commitHash) for the success toast
      if (operationId) backgroundGitOpsService.completeOperation(operationId, operationResult);

      return { success: true, steps };
    } catch (error) {
      logger.error('Accept changes failed', error as Error);

      // Mark operation as failed
      if (operationId) backgroundGitOpsService.failOperation(operationId, (error as Error).message);

      return {
        success: false,
        steps,
        error: (error as Error).message,
      };
    }
  }

  /**
   * Export files to a target folder
   */
  async exportFiles(request: ExportFilesRequest): Promise<ExportFilesResult> {
    const workspace = await this.workspaceRepository.findById(request.workspaceId);
    if (!workspace) {
      return {
        success: false,
        exportedFiles: [],
        targetPath: request.targetPath,
        error: 'Workspace not found',
      };
    }

    const worktreePathValue = workspace.worktreePath || workspace.path;
    if (!worktreePathValue) {
      return {
        success: false,
        exportedFiles: [],
        targetPath: request.targetPath,
        error: 'Workspace has no worktree path',
      };
    }
    const worktreePath: string = worktreePathValue;
    const exportedFiles: string[] = [];

    try {
      // Get list of changed files from multiple sources
      const status = await this.getWorkspaceGitStatus(request.workspaceId);
      const allFiles = new Set<string>();
      const stagedFileSet = new Set<string>();
      const isRefSafe = SAFE_REF_PATTERN.test(status.trunkBranch) && SAFE_REF_PATTERN.test(status.branch);

      // 1. Committed changes (diff from trunk to current branch)
      if (isRefSafe) {
        try {
          const { stdout: committedFiles } = await this.execGitCommand(
            request.workspaceId,
            `git diff --name-only ${status.trunkBranch}...${status.branch}`,
            worktreePath,
          );
          committedFiles
            .trim()
            .split('\n')
            .filter(Boolean)
            .forEach((f) => allFiles.add(f));
        } catch (e) {
          logger.debug('No committed changes to export', { error: e });
        }
      }

      // 2. All staged changes including new files
      try {
        const { stdout: stagedOutput } = await this.execGitCommand(
          request.workspaceId,
          'git diff --cached --name-only',
          worktreePath,
        );
        stagedOutput
          .trim()
          .split('\n')
          .filter(Boolean)
          .forEach((f) => {
            allFiles.add(f);
            stagedFileSet.add(f);
          });
      } catch (e) {
        logger.debug('No staged changes to export', { error: e });
      }

      // 3. Unstaged modified changes
      try {
        const { stdout: unstagedFiles } = await this.execGitCommand(
          request.workspaceId,
          'git diff --name-only',
          worktreePath,
        );
        unstagedFiles
          .trim()
          .split('\n')
          .filter(Boolean)
          .forEach((f) => allFiles.add(f));
      } catch (e) {
        logger.debug('No unstaged changes to export', { error: e });
      }

      // 4. Untracked files (new files not yet staged)
      try {
        const { stdout: untrackedFiles } = await this.execGitCommand(
          request.workspaceId,
          'git ls-files --others --exclude-standard',
          worktreePath,
        );
        untrackedFiles
          .trim()
          .split('\n')
          .filter(Boolean)
          .forEach((f) => allFiles.add(f));
      } catch (e) {
        logger.debug('No untracked files to export', { error: e });
      }

      // Determine the initial file list (user-provided or auto-detected)
      const filesToFilter = request.files || Array.from(allFiles);

      // Filter out gitignored files using git check-ignore
      let filesToExport = filesToFilter;
      if (filesToFilter.length > 0) {
        try {
          // Use git check-ignore to find which files are ignored
          // Use printf with pipe to pass files via stdin to avoid command line length limits
          // Escape single quotes for shell safety, and backslashes to prevent interpretation
          const escapedFiles = filesToFilter
            .join('\n')
            .replace(/\\/g, '\\\\')
            .replace(/'/g, "'\\''");
          const { stdout: ignoredOutput } = await this.execGitCommand(
            request.workspaceId,
            `printf '%s' '${escapedFiles}' | git check-ignore --stdin`,
            worktreePath,
          );
          const ignoredFiles = new Set(ignoredOutput.trim().split('\n').filter(Boolean));
          if (ignoredFiles.size > 0) {
            logger.debug('Filtering out gitignored files from export', {
              ignoredFiles: Array.from(ignoredFiles),
            });
            filesToExport = filesToFilter.filter((f) => !ignoredFiles.has(f));
          }
        } catch (e) {
          // git check-ignore exits with code 1 if no files are ignored, which is fine
          logger.debug('git check-ignore returned no ignored files or failed', { error: e });
        }
      }
      logger.info('Exporting files', {
        targetPath: request.targetPath,
        fileCount: filesToExport.length,
        files: filesToExport,
        stagedFiles: Array.from(stagedFileSet),
      });

      // Copy all files
      for (const file of filesToExport) {
        const sourcePath = path.join(worktreePath, file);
        const destPath = request.preserveStructure
          ? path.join(request.targetPath, file)
          : path.join(request.targetPath, path.basename(file));

        try {
          // Ensure destination directory exists
          await fs.mkdir(path.dirname(destPath), { recursive: true });
          // Copy file
          await fs.copyFile(sourcePath, destPath);
          exportedFiles.push(file);
          logger.debug('Exported file', { file, destPath });
        } catch (error) {
          logger.warn(`Failed to export file: ${file}`, { error });
        }
      }

      // Stage files in target that were staged in source
      const filesToStage = exportedFiles.filter((f) => stagedFileSet.has(f));
      if (filesToStage.length > 0) {
        try {
          // Stage files in the target repository using execFileAsync for safety
          // (avoids shell injection from malicious file names)
          await execFileAsync('git', ['add', '--', ...filesToStage], {
            cwd: request.targetPath,
          });
          logger.info('Staged files in target repository', { files: filesToStage });
        } catch (e) {
          logger.warn('Failed to stage files in target repository', { error: e });
        }
      }

      return {
        success: true,
        exportedFiles,
        targetPath: request.targetPath,
      };
    } catch (error) {
      logger.error('Export files failed', error as Error);
      return {
        success: false,
        exportedFiles,
        targetPath: request.targetPath,
        error: (error as Error).message,
      };
    }
  }

  /**
   * Merge a pull request on GitHub (remote merge)
   * After merging, fetches the latest state so local git is up to date.
   */
  async mergePR(
    workspaceId: WorkspaceId,
    prNumber: number,
    options?: {
      mergeMethod?: 'merge' | 'squash' | 'rebase';
      commitTitle?: string;
      commitMessage?: string;
    },
  ): Promise<AcceptChangesResult> {
    const steps: AcceptChangesStep[] = [];
    const status = await this.getWorkspaceGitStatus(workspaceId);

    if (!status.owner || !status.repo) {
      return {
        success: false,
        steps,
        error: 'Could not determine GitHub repository owner and name',
      };
    }

    steps.push({ id: 'merge-pr', name: 'Merge pull request on GitHub', status: 'running' });
    try {
      const result = await githubService.mergePullRequest(
        status.owner,
        status.repo,
        prNumber,
        options,
      );

      if (!result.merged) {
        steps[steps.length - 1].status = 'failed';
        steps[steps.length - 1].error = result.message;
        return {
          success: false,
          steps,
          error: result.message || 'GitHub refused to merge the pull request',
        };
      }

      steps[steps.length - 1].status = 'completed';
      logger.info('PR merged on GitHub', {
        workspaceId,
        prNumber,
        sha: result.sha,
      });

      // Fetch latest from remote to sync local state
      const workspace = await this.workspaceRepository.findById(workspaceId);
      const worktreePath = workspace?.worktreePath || workspace?.path;
      if (worktreePath) {
        try {
          await this.execGitCommand(workspaceId, 'git fetch --all', worktreePath);
        } catch {
          logger.debug('Post-merge fetch failed (non-critical)', { workspaceId });
        }
      }

      // Clear caches
      this.clearGitStatusCache(workspaceId);
      gitService.clearStatusCache(workspaceId);

      return {
        success: true,
        steps,
        result: {
          mergeCommitHash: result.sha,
        },
      };
    } catch (error) {
      steps[steps.length - 1].status = 'failed';
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to merge PR on GitHub';
      steps[steps.length - 1].error = errorMessage;
      return { success: false, steps, error: errorMessage };
    }
  }

  /**
   * Check if a path has uncommitted git changes
   */
  async checkPathHasChanges(
    targetPath: string,
  ): Promise<{ hasChanges: boolean; isGitRepo: boolean }> {
    try {
      const { stdout: isGitRepo } = await execAsync('git rev-parse --is-inside-work-tree', {
        cwd: targetPath,
      });
      if (isGitRepo.trim() !== 'true') {
        return { hasChanges: false, isGitRepo: false };
      }

      const { stdout: statusOutput } = await execAsync('git status --porcelain', {
        cwd: targetPath,
      });
      return {
        hasChanges: statusOutput.trim().length > 0,
        isGitRepo: true,
      };
    } catch (e) {
      // Not a git repo or git not available
      logger.debug('Path is not a git repository or git check failed', { targetPath, error: e });
      return { hasChanges: false, isGitRepo: false };
    }
  }
}
