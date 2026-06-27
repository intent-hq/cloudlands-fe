/**
 * Git State Manager
 *
 * Manages and tracks the complete git state for a workspace,
 * including working directory, staging area, commits, and PRs.
 * Supports both local and remote workspaces via SSH.
 */

import { EventEmitter } from '$shared/utils/event-emitter';
import { execAsyncRobust as execAsync } from '../../../shared/git/git-env';
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
import type { RemoteRPCClient } from '../../../shared/main/remote-rpc-client';
import { mainDispatch } from '../../../store/main/redux-store-bridge';
import { gitAuthRequired } from '../../../store/main/slices/git-events/git-events-slice';
import {
  ChangeLocation,
  DiffHunk,
  FileDiff,
  GitBranch,
  GitCommit,
  GitFileChange,
  GitFileStatus,
  GitState,
  GitSyncStatus,
  PullRequest,
} from '../types';
import { githubService } from './github.service';

const logger = new Logger('GitStateManager');

/**
 * Configuration for remote workspace RPC connection
 */
export interface RemoteGitConfig {
  workspaceId: string;
}

export interface GitStateManagerConfig {
  autoSync?: boolean;
  syncInterval?: number; // milliseconds
  fetchInterval?: number; // milliseconds
  trackRemote?: boolean;
  /** Remote workspace configuration - when provided, uses RPC for git commands */
  remoteConfig?: RemoteGitConfig;
}

export class GitStateManager extends EventEmitter {
  private state: GitState | null = null;
  private syncTimer: NodeJS.Timeout | null = null;
  private fetchTimer: NodeJS.Timeout | null = null;
  private syncing = false;
  private pendingSync = false;
  private rpcClient: RemoteRPCClient | null = null;
  private isRemote: boolean = false;

  private readonly config: Required<Omit<GitStateManagerConfig, 'remoteConfig'>> & {
    remoteConfig?: RemoteGitConfig;
  } = {
    autoSync: true,
    syncInterval: 60000, // 60 seconds - fallback only, FSEvents handles instant detection
    fetchInterval: 60000, // 1 minute
    trackRemote: false, // Disabled by default to avoid keychain prompts
  };

  constructor(
    private readonly workspaceId: string,
    private readonly worktreePath: string,
    config?: GitStateManagerConfig,
  ) {
    super();
    this.isRemote = !!config?.remoteConfig;

    // Remote workspaces don't have local FSEvents, so they need fast polling.
    // Use 5s interval for remote workspaces unless explicitly overridden by caller.
    const remoteSyncInterval =
      this.isRemote && config?.syncInterval === undefined ? 5000 : undefined;

    this.config = {
      ...this.config,
      ...config,
      ...(remoteSyncInterval !== undefined && { syncInterval: remoteSyncInterval }),
    };
    this.initialize();
  }

  /**
   * Initialize the state manager
   */
  private async initialize(): Promise<void> {
    try {
      await this.syncState();

      if (this.config.autoSync) {
        this.startAutoSync();
      }

      if (this.config.trackRemote) {
        this.startFetchTimer();
      }

      logger.info('Git state manager initialized', {
        workspaceId: this.workspaceId,
        isRemote: this.isRemote,
      });
    } catch (error) {
      logger.error('Failed to initialize git state manager', error as Error);
    }
  }

  /**
   * Get or create the RPC client for remote workspaces
   */
  private async getRPCClient(): Promise<RemoteRPCClient> {
    if (!this.rpcClient) {
      if (!this.config.remoteConfig) {
        throw new Error('Remote config required for RPC connection');
      }
      this.rpcClient = await remoteRPCManager.getClient(this.config.remoteConfig.workspaceId);
    }
    return this.rpcClient;
  }

  /**
   * Execute a git command - works for both local and remote workspaces
   * Detects authentication errors and emits domain events for user notification
   */
  private async executeGitCommand(
    command: string,
    cwd?: string,
  ): Promise<{ stdout: string; stderr: string }> {
    const workingDir = cwd || this.worktreePath;
    const isNetworkOp = /\b(push|fetch|pull|clone)\b/.test(command);

    if (isNetworkOp && isKeychainAccessSuppressed(this.workspaceId)) {
      throw new Error('Keychain access was cancelled. Unlock your keychain and retry.');
    }

    try {
      if (this.isRemote && this.config.remoteConfig) {
        // Execute via RPC for remote workspaces
        const client = await this.getRPCClient();
        const fullCommand = `cd "${workingDir}" && ${command}`;
        const result = await client.exec({ command: fullCommand, timeout: 30000 });
        return { stdout: result.stdout, stderr: result.stderr };
      } else {
        // Execute locally for local workspaces
        const result = await execAsync(command, { cwd: workingDir, maxBuffer: 10 * 1024 * 1024 });
        if (isNetworkOp) {
          clearKeychainSuppression(this.workspaceId);
        }
        return result;
      }
    } catch (error) {
      // Handle RPC errors for non-zero exit codes
      if (error instanceof RemoteRPCError && error.data) {
        const data = error.data as { exitCode?: number; stdout?: string; stderr?: string };
        if (data.stdout !== undefined || data.stderr !== undefined) {
          const errorMessage = data.stderr || data.stdout || (error as Error).message;
          const stderr = data.stderr || errorMessage;

          // Return empty result for non-fatal errors (like no upstream branch)
          if (errorMessage?.includes('no upstream')) {
            return { stdout: '', stderr: errorMessage };
          }

          if (
            isNetworkOp &&
            (isKeychainAccessCancelled(stderr) || isKeychainAccessCancelled(errorMessage))
          ) {
            suppressKeychainAccess(this.workspaceId);
            throw new Error('Keychain access was cancelled. Unlock your keychain and retry.');
          }

          // Check if this is an authentication error for remote operations
          if (isNetworkOp && (isGitAuthError(stderr) || isGitAuthError(errorMessage))) {
            const operation =
              command.match(/\b(push|fetch|pull|clone)\b/)?.[0] || 'remote operation';
            suppressKeychainAccess(this.workspaceId);
            const userMessage = getGitAuthErrorMessage(stderr || errorMessage, operation);
            logger.warn('Git remote operation requires authentication', {
              workspaceId: this.workspaceId,
              command,
              error: errorMessage,
            });
            mainDispatch(gitAuthRequired({
              workspaceId: this.workspaceId as any,
              operation,
              message: userMessage,
              rawError: stderr || errorMessage,
              command,
              cwd: workingDir,
            }));
            throw new Error(userMessage);
          }

          throw new Error(`Git command failed (exit ${data.exitCode}): ${stderr}`);
        }
      }

      const errorMessage = (error as Error).message;
      const stderr = (error as any)?.stderr || errorMessage;

      // Return empty result for non-fatal errors (like no upstream branch)
      if (errorMessage?.includes('no upstream')) {
        return { stdout: '', stderr: errorMessage };
      }

      if (
        isNetworkOp &&
        (isKeychainAccessCancelled(stderr) || isKeychainAccessCancelled(errorMessage))
      ) {
        suppressKeychainAccess(this.workspaceId);
        throw new Error('Keychain access was cancelled. Unlock your keychain and retry.');
      }

      // Check if this is an authentication error for remote operations
      if (isNetworkOp && (isGitAuthError(stderr) || isGitAuthError(errorMessage))) {
        const operation = command.match(/\b(push|fetch|pull|clone)\b/)?.[0] || 'remote operation';

        // Always suppress keychain access on auth error to prevent repeated prompts
        suppressKeychainAccess(this.workspaceId);

        const userMessage = getGitAuthErrorMessage(stderr || errorMessage, operation);
        logger.warn('Git remote operation requires authentication', {
          workspaceId: this.workspaceId,
          command,
          error: errorMessage,
        });

        // Emit domain event for UI notification
        mainDispatch(gitAuthRequired({
          workspaceId: this.workspaceId as any, // workspaceId is string here, cast for event
          operation,
          message: userMessage,
          rawError: stderr || errorMessage,
          command,
          cwd: workingDir,
        }));

        // Re-throw with user-friendly message
        throw new Error(userMessage);
      }

      throw error;
    }
  }

  /**
   * Get current git state
   */
  getState(): GitState | null {
    return this.state;
  }

  /**
   * Get sync status
   */
  getSyncStatus(): GitSyncStatus | null {
    if (!this.state) {
      return null;
    }

    const activePR = this.state.pullRequests.find(
      (pr) => pr.sourceBranch === this.state?.branch.name && pr.state === 'open',
    );

    return {
      local: {
        branch: this.state.branch.name,
        commit: this.state.branch.lastCommit?.sha || '',
        uncommittedChanges:
          this.state.status.workingDirectory.length + this.state.status.stagingArea.length,
      },
      remote: {
        branch: this.state.branch.upstream || this.state.branch.name,
        commit: '', // Would need to fetch remote HEAD
        ahead: this.state.branch.ahead,
        behind: this.state.branch.behind,
      },
      pullRequest: activePR
        ? {
            number: activePR.number,
            state: activePR.state,
            mergeable: activePR.mergeable || false,
          }
        : undefined,
      lastSync: this.state.lastSync || new Date().toISOString(),
      syncing: this.syncing,
    };
  }

  /**
   * Sync git state
   */
  async syncState(): Promise<void> {
    if (this.syncing) {
      this.pendingSync = true;
      return;
    }

    this.syncing = true;
    this.pendingSync = false;
    this.emit('sync:start');

    try {
      // Use Promise.allSettled to handle individual failures gracefully
      const results = await Promise.allSettled([
        this.getCurrentBranch(),
        this.getStatus(),
        this.getRecentCommits(),
        this.getBranches(),
        this.getRemotes(),
        this.getTags(),
        this.getStashes(),
      ]);

      // Extract successful results with defaults for failures
      const [
        branchResult,
        statusResult,
        commitsResult,
        branchesResult,
        remotesResult,
        tagsResult,
        stashesResult,
      ] = results;

      const branch =
        branchResult.status === 'fulfilled'
          ? branchResult.value
          : ({
              name: 'unknown',
              isRemote: false,
              current: true,
              upstream: undefined,
              ahead: 0,
              behind: 0,
              lastCommit: undefined,
            } as GitBranch);

      const status =
        statusResult.status === 'fulfilled'
          ? statusResult.value
          : {
              isClean: true,
              workingDirectory: [],
              stagingArea: [],
              hasConflicts: false,
              ahead: 0,
              behind: 0,
            };

      const commits = commitsResult.status === 'fulfilled' ? commitsResult.value : [];
      const branches = branchesResult.status === 'fulfilled' ? branchesResult.value : [];
      const remotes = remotesResult.status === 'fulfilled' ? remotesResult.value : [];
      const tags = tagsResult.status === 'fulfilled' ? tagsResult.value : [];
      const stashes = stashesResult.status === 'fulfilled' ? stashesResult.value : [];

      // Log any failures
      results.forEach((result, index) => {
        if (result.status === 'rejected') {
          const operations = [
            'getCurrentBranch',
            'getStatus',
            'getRecentCommits',
            'getBranches',
            'getRemotes',
            'getTags',
            'getStashes',
          ];
          const error = result.reason;
          // Only log as error if it's not an EBADF error (which we're handling)
          if (error?.code === 'EBADF' || error?.message?.includes('EBADF')) {
            logger.debug(`${operations[index]} failed with EBADF, using defaults`, {
              workspaceId: this.workspaceId,
            });
          } else {
            logger.warn(`Failed to ${operations[index]}`, {
              workspaceId: this.workspaceId,
              error: error?.message || String(error),
            });
          }
        }
      });

      // Get PRs if we have GitHub integration
      let pullRequests: PullRequest[] = [];
      try {
        // Only attempt to fetch PRs if GitHub is authenticated
        if (await githubService.isAuthenticated()) {
          const repoInfo = await this.getRepoInfo();
          if (repoInfo) {
            pullRequests = await githubService.getPullRequests(repoInfo.owner, repoInfo.name);
          }
        }
      } catch  {
        // Silently handle - this is expected when GitHub integration isn't configured
        // No need to log as it creates noise in the logs
      }

      this.state = {
        workspaceId: this.workspaceId,
        branch,
        status,
        commits,
        branches,
        remotes,
        tags,
        stashes,
        pullRequests,
        lastSync: new Date().toISOString(),
      };

      this.emit('sync:complete', this.state);
      // logger.debug("Git state synced", {
      //   workspaceId: this.workspaceId,
      //   branch: branch.name,
      //   changes: status.workingDirectory.length + status.stagingArea.length,
      // });
    } catch (error) {
      logger.error('Failed to sync git state', error as Error);
      this.emit('sync:error', error);
    } finally {
      this.syncing = false;
      if (this.pendingSync) {
        this.pendingSync = false;
        // Schedule follow-up sync on next tick to avoid deep recursion
        queueMicrotask(() => {
          this.syncState().catch((error) => {
            logger.error('Pending sync failed', error);
          });
        });
      }
    }
  }

  /**
   * Get current branch information
   */
  private async getCurrentBranch(): Promise<GitBranch> {
    const devNull = process.platform === 'win32' ? 'NUL' : '/dev/null';
    const { stdout: branchName } = await this.executeGitCommand('git rev-parse --abbrev-ref HEAD');

    const { stdout: upstream } = await this.executeGitCommand(
      `git rev-parse --abbrev-ref --symbolic-full-name @{u} 2>${devNull} || echo ""`,
    );

    let ahead = 0;
    let behind = 0;

    if (upstream.trim()) {
      try {
        const { stdout: counts } = await this.executeGitCommand(
          'git rev-list --left-right --count HEAD...@{u}',
        );
        const [a, b] = counts.trim().split('\t').map(Number);
        ahead = a || 0;
        behind = b || 0;
      } catch {
        // Branch might not have upstream
      }
    }

    // Get last commit
    let lastCommit: GitCommit | undefined;
    try {
      const { stdout: commitInfo } = await this.executeGitCommand(
        'git log -1 --format="%H|%h|%an|%ae|%at|%cn|%ce|%ct|%s|%b|%P"',
      );

      if (commitInfo.trim()) {
        const parts = commitInfo.trim().split('|');
        lastCommit = {
          sha: parts[0],
          shortSha: parts[1],
          author: {
            name: parts[2],
            email: parts[3],
            date: new Date(parseInt(parts[4]) * 1000).toISOString(),
          },
          committer: {
            name: parts[5],
            email: parts[6],
            date: new Date(parseInt(parts[7]) * 1000).toISOString(),
          },
          message: parts[8] + (parts[9] ? `\n\n${parts[9]}` : ''),
          subject: parts[8],
          body: parts[9],
          parents: parts[10] ? parts[10].split(' ') : [],
          files: [],
          stats: { additions: 0, deletions: 0, filesChanged: 0 },
        };
      }
    } catch {
      // No commits yet
    }

    return {
      name: branchName.trim(),
      current: true,
      upstream: upstream.trim() || undefined,
      ahead,
      behind,
      lastCommit,
    };
  }

  /**
   * Get git status
   */
  private async getStatus(): Promise<GitState['status']> {
    const { stdout } = await this.executeGitCommand('git status --porcelain=v2 --branch');

    const workingDirectory: GitFileChange[] = [];
    const stagingArea: GitFileChange[] = [];
    let hasConflicts = false;
    let ahead = 0;
    let behind = 0;

    const lines = stdout.split('\n').filter((line) => line);

    for (const line of lines) {
      if (line.startsWith('# branch.ab')) {
        const match = line.match(/\+(\d+) -(\d+)/);
        if (match) {
          ahead = parseInt(match[1]);
          behind = parseInt(match[2]);
        }
      } else if (line.startsWith('1 ') || line.startsWith('2 ')) {
        // Parse file status
        const parts = line.split(' ');
        const xy = parts[1];
        const filePath = parts[8] || parts[9]; // Handle renames

        if (!filePath) continue;

        const indexStatus = xy[0];
        const workTreeStatus = xy[1];

        // Staged changes
        if (indexStatus !== '.' && indexStatus !== '?') {
          stagingArea.push({
            path: filePath,
            relativePath: filePath,
            status: this.mapGitStatus(indexStatus),
            location: ChangeLocation.StagingArea,
          });
        }

        // Working directory changes
        if (workTreeStatus !== '.' && workTreeStatus !== '?') {
          workingDirectory.push({
            path: filePath,
            relativePath: filePath,
            status: this.mapGitStatus(workTreeStatus),
            location: ChangeLocation.WorkingDirectory,
          });
        }

        // Check for conflicts
        if (indexStatus === 'U' || workTreeStatus === 'U') {
          hasConflicts = true;
        }
      } else if (line.startsWith('? ')) {
        // Untracked file
        const filePath = line.substring(2);
        workingDirectory.push({
          path: filePath,
          relativePath: filePath,
          status: GitFileStatus.Untracked,
          location: ChangeLocation.WorkingDirectory,
        });
      }
    }

    return {
      isClean: workingDirectory.length === 0 && stagingArea.length === 0,
      hasConflicts,
      workingDirectory,
      stagingArea,
      ahead,
      behind,
    };
  }

  /**
   * Get recent commits
   */
  private async getRecentCommits(limit = 50): Promise<GitCommit[]> {
    try {
      const { stdout } = await this.executeGitCommand(
        `git log -${limit} --format="%H|%h|%an|%ae|%at|%cn|%ce|%ct|%s|%b|%P" --numstat`,
      );

      const commits: GitCommit[] = [];
      const lines = stdout.split('\n');
      let currentCommit: GitCommit | null = null;

      for (const line of lines) {
        if (line.includes('|')) {
          // Commit info line
          if (currentCommit) {
            commits.push(currentCommit);
          }

          const parts = line.split('|');
          currentCommit = {
            sha: parts[0],
            shortSha: parts[1],
            author: {
              name: parts[2],
              email: parts[3],
              date: new Date(parseInt(parts[4]) * 1000).toISOString(),
            },
            committer: {
              name: parts[5],
              email: parts[6],
              date: new Date(parseInt(parts[7]) * 1000).toISOString(),
            },
            message: parts[8] + (parts[9] ? `\n\n${parts[9]}` : ''),
            subject: parts[8],
            body: parts[9],
            parents: parts[10] ? parts[10].split(' ') : [],
            files: [],
            stats: { additions: 0, deletions: 0, filesChanged: 0 },
          };
        } else if (line.match(/^\d+\t\d+\t/)) {
          // Numstat line
          if (currentCommit) {
            const [additions, deletions, file] = line.split('\t');
            currentCommit.stats.additions += parseInt(additions) || 0;
            currentCommit.stats.deletions += parseInt(deletions) || 0;
            currentCommit.stats.filesChanged++;
            currentCommit.files.push({
              path: file,
              relativePath: file,
              status: GitFileStatus.Modified,
              location: ChangeLocation.LocalCommit,
              additions: parseInt(additions) || 0,
              deletions: parseInt(deletions) || 0,
            });
          }
        }
      }

      if (currentCommit) {
        commits.push(currentCommit);
      }

      return commits;
    } catch {
      return [];
    }
  }

  /**
   * Get all branches
   */
  private async getBranches(): Promise<GitBranch[]> {
    try {
      const { stdout } = await this.executeGitCommand(
        'git branch -a --format="%(refname:short)|%(upstream:short)|%(upstream:track)"',
      );

      const branches: GitBranch[] = [];
      const lines = stdout.split('\n').filter((line) => line);

      for (const line of lines) {
        const [name, upstream, tracking] = line.split('|');

        // Parse tracking info
        let ahead = 0;
        let behind = 0;
        if (tracking) {
          const aheadMatch = tracking.match(/ahead (\d+)/);
          const behindMatch = tracking.match(/behind (\d+)/);
          if (aheadMatch) ahead = parseInt(aheadMatch[1]);
          if (behindMatch) behind = parseInt(behindMatch[1]);
        }

        branches.push({
          name: name.replace('remotes/', ''),
          current: false,
          upstream,
          ahead,
          behind,
        });
      }

      return branches;
    } catch {
      return [];
    }
  }

  /**
   * Get remotes
   */
  private async getRemotes(): Promise<any[]> {
    try {
      const { stdout } = await this.executeGitCommand('git remote -v');

      const remotes: any[] = [];
      const seen = new Set<string>();

      for (const line of stdout.split('\n').filter((line) => line)) {
        const [name, url] = line.split('\t');
        if (!seen.has(name)) {
          remotes.push({ name, url: url.split(' ')[0] });
          seen.add(name);
        }
      }

      return remotes;
    } catch {
      return [];
    }
  }

  /**
   * Get tags
   */
  private async getTags(): Promise<any[]> {
    try {
      const { stdout } = await this.executeGitCommand(
        'git tag -l --format="%(refname:short)|%(objectname)|%(subject)"',
      );

      return stdout
        .split('\n')
        .filter((line) => line)
        .map((line) => {
          const [name, sha, message] = line.split('|');
          return { name, sha, message };
        });
    } catch {
      return [];
    }
  }

  /**
   * Get stashes
   */
  private async getStashes(): Promise<any[]> {
    try {
      const { stdout } = await this.executeGitCommand('git stash list --format="%gd|%s|%H|%ai"');

      return stdout
        .split('\n')
        .filter((line) => line)
        .map((line, index) => {
          const [, message, sha, date] = line.split('|');
          return { index, message, sha, date };
        });
    } catch {
      return [];
    }
  }

  /**
   * Get repository info
   */
  private async getRepoInfo(): Promise<{ owner: string; name: string } | null> {
    try {
      const { stdout } = await this.executeGitCommand('git remote get-url origin');

      const url = stdout.trim();
      const match = url.match(/github\.com[:/]([^/]+)\/([^.]+)/);

      if (match) {
        return {
          owner: match[1],
          name: match[2].replace('.git', ''),
        };
      }
    } catch {
      // No remote or not GitHub
    }

    return null;
  }

  /**
   * Map git status character to enum
   */
  private mapGitStatus(status: string): GitFileStatus {
    switch (status) {
      case 'A':
        return GitFileStatus.Added;
      case 'M':
        return GitFileStatus.Modified;
      case 'D':
        return GitFileStatus.Deleted;
      case 'R':
        return GitFileStatus.Renamed;
      case 'C':
        return GitFileStatus.Copied;
      case 'U':
        return GitFileStatus.Conflicted;
      case '?':
        return GitFileStatus.Untracked;
      case '!':
        return GitFileStatus.Ignored;
      default:
        return GitFileStatus.Modified;
    }
  }

  /**
   * Get diff for a file
   */
  async getFileDiff(filePath: string, staged = false): Promise<FileDiff | null> {
    try {
      const diffCmd = staged ? `git diff --cached -- "${filePath}"` : `git diff -- "${filePath}"`;

      const { stdout: patch } = await this.executeGitCommand(diffCmd);

      if (!patch) {
        return null;
      }

      // Parse the diff
      const hunks: DiffHunk[] = [];
      const lines = patch.split('\n');
      let currentHunk: DiffHunk | null = null;

      for (const line of lines) {
        if (line.startsWith('@@')) {
          // New hunk
          const match = line.match(/@@ -(\d+),?(\d*) \+(\d+),?(\d*) @@/);
          if (match) {
            if (currentHunk) {
              hunks.push(currentHunk);
            }
            currentHunk = {
              oldStart: parseInt(match[1]),
              oldLines: parseInt(match[2] || '1'),
              newStart: parseInt(match[3]),
              newLines: parseInt(match[4] || '1'),
              lines: [],
              content: '',
              header: line,
            };
          }
        } else if (
          currentHunk &&
          (line.startsWith('+') || line.startsWith('-') || line.startsWith(' '))
        ) {
          currentHunk.lines.push(line);
          currentHunk.content += `${line}\n`;
        }
      }

      if (currentHunk) {
        hunks.push(currentHunk);
      }

      // Get file status
      const status = this.state?.status;
      const location = staged ? ChangeLocation.StagingArea : ChangeLocation.WorkingDirectory;
      const changes = staged ? status?.stagingArea : status?.workingDirectory;
      const fileChange = changes?.find((f) => f.path === filePath);

      return {
        file: fileChange || {
          path: filePath,
          relativePath: filePath,
          status: GitFileStatus.Modified,
          location,
        },
        hunks,
        patch,
      };
    } catch (error) {
      logger.error('Failed to get file diff', error as Error, { filePath });
      return null;
    }
  }

  /**
   * Start auto-sync
   */
  private startAutoSync(): void {
    this.syncTimer = setInterval(() => {
      this.syncState().catch((error) => {
        logger.error('Auto-sync failed', error);
      });
    }, this.config.syncInterval);
  }

  /**
   * Start fetch timer
   */
  private startFetchTimer(): void {
    this.fetchTimer = setInterval(() => {
      this.fetch().catch((error) => {
        logger.debug('Auto-fetch failed', { error });
      });
    }, this.config.fetchInterval);
  }

  /**
   * Fetch from remote
   */
  private async fetch(): Promise<void> {
    // Skip fetch if keychain access has been suppressed (user cancelled macOS keychain dialog)
    // This prevents repeated keychain prompts on the fetch timer
    if (isKeychainAccessSuppressed(this.workspaceId)) {
      logger.debug('Skipping fetch - keychain access suppressed', {
        workspaceId: this.workspaceId,
      });
      return;
    }

    try {
      await this.executeGitCommand('git fetch --all');
      if (this.state) {
        this.state.lastFetch = new Date().toISOString();
      }
      logger.debug('Fetched from remote', { workspaceId: this.workspaceId });
    } catch (error) {
      logger.debug('Failed to fetch from remote', { error });
    }
  }

  /**
   * Cleanup
   */
  async cleanup(): Promise<void> {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }

    if (this.fetchTimer) {
      clearInterval(this.fetchTimer);
      this.fetchTimer = null;
    }

    // Clear RPC client reference (managed by remoteRPCManager)
    this.rpcClient = null;

    this.removeAllListeners();
  }
}
