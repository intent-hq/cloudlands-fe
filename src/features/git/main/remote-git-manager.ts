/**
 * Remote Git Manager
 *
 * Provides comprehensive git operations for remote workspaces including:
 * - Worktree creation and management
 * - Branch operations
 * - Synchronization with remote repositories
 * - Conflict resolution
 */

import { EventEmitter } from '$shared/utils/event-emitter';
import { WorkspaceConfigConstants } from '$shared/config-constants';
import * as path from 'path';
import { Logger } from '../../../shared/logger';
import { remoteRPCManager } from '../../../shared/main/remote-rpc-manager';
import { RemoteRPCError } from '../../../shared/main/remote-rpc-client';
import type { RemoteRPCClient } from '../../../shared/main/remote-rpc-client';
import type { SSHConnectionConfig } from '../../../shared/main/ssh-manager';

export interface RemoteGitConfig {
  repositoryPath: string;
  workspaceId: string;
  sshConfig?: SSHConnectionConfig;
}

export interface GitBranch {
  name: string;
  current: boolean;
  remote?: string;
  lastCommit?: string;
  ahead?: number;
  behind?: number;
}

export interface GitStatus {
  branch: string;
  ahead: number;
  behind: number;
  diverged: boolean;
  staged: string[];
  modified: string[];
  untracked: string[];
  deleted: string[];
  conflicts: string[];
}

export class RemoteGitManager extends EventEmitter {
  private config: RemoteGitConfig;
  private rpcClient: RemoteRPCClient | null = null;
  private logger = new Logger('RemoteGitManager');

  constructor(config: RemoteGitConfig) {
    super();
    this.config = config;
  }

  /**
   * Get the RPC client, lazily connecting if needed.
   */
  private async getRPCClient(): Promise<RemoteRPCClient> {
    if (this.rpcClient?.isConnected()) {
      return this.rpcClient;
    }
    this.rpcClient = await remoteRPCManager.getClient(this.config.workspaceId, this.config.sshConfig);
    return this.rpcClient;
  }

  /**
   * Execute a git command on the remote server via RPC.
   *
   * The RPC `exec` handler returns non-zero exit codes as JSON-RPC errors
   * (code -32000). We catch RemoteRPCError and extract stdout/stderr/exitCode
   * so callers can inspect the result the same way as before.
   */
  private async executeGitCommand(
    command: string,
    cwd?: string,
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const workingDir = cwd || this.config.repositoryPath;
    const fullCommand = `git ${command}`;
    const client = await this.getRPCClient();

    try {
      const result = await client.exec({ command: fullCommand, cwd: workingDir });
      return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode };
    } catch (error) {
      if (error instanceof RemoteRPCError && (error.data as any)?.exitCode !== undefined) {
        const data = error.data as { exitCode: number; stdout: string; stderr: string };
        return { stdout: data.stdout || '', stderr: data.stderr || '', exitCode: data.exitCode };
      }
      throw error;
    }
  }

  /**
   * Create a git worktree for the workspace
   */
  async createWorktree(branchName?: string, baseBranch?: string): Promise<string> {
    const workspaceBranch = branchName || `workspace/${this.config.workspaceId}`;
    let base = baseBranch || (await this.getDefaultBranch());

    // Resolve the remote home directory to place worktrees outside the repo,
    // mirroring the local pattern: ~/intent/workspaces/{workspaceId}/{repoName}
    const client = await this.getRPCClient();
    const homeResult = await client.exec({ command: 'echo $HOME' });
    if (!homeResult.stdout.trim()) {
      throw new Error('Failed to resolve remote home directory');
    }
    const homeDir = homeResult.stdout.trim();

    const repoName = WorkspaceConfigConstants.slugify(
      path.posix.basename(this.config.repositoryPath),
    ) || 'repo';
    const worktreeParent = path.posix.join(
      homeDir, 'intent', 'workspaces', this.config.workspaceId,
    );
    const worktreePath = path.posix.join(worktreeParent, repoName);

    this.logger.debug(`Creating worktree at ${worktreePath}`);

    // Create parent directory for the worktree
    await client.exec({ command: `mkdir -p "${worktreeParent}"` });

    // Check if branch exists
    const branchExists = await this.branchExists(workspaceBranch);

    try {
      if (branchExists) {
        // Branch exists, add worktree without creating new branch
        const result = await this.executeGitCommand(
          `worktree add "${worktreePath}" "${workspaceBranch}"`,
        );

        if (result.exitCode !== 0) {
          throw new Error(`Failed to create worktree: ${result.stderr}`);
        }
      } else {
        // Resolve the base ref - check if it exists locally, otherwise try origin/
        // This handles the case where user selected a remote branch from the UI
        // (remote branches are displayed without the origin/ prefix)
        const resolvedBase = await this.resolveBaseRef(base);
        if (resolvedBase !== base) {
          this.logger.debug(`Resolved base ref from ${base} to ${resolvedBase}`);
          base = resolvedBase;
        }

        // Create new branch with worktree
        const result = await this.executeGitCommand(
          `worktree add -b "${workspaceBranch}" "${worktreePath}" "${base}"`,
        );

        if (result.exitCode !== 0) {
          throw new Error(`Failed to create worktree: ${result.stderr}`);
        }
      }

      this.logger.debug('Worktree created successfully');
      this.emit('worktree-created', { path: worktreePath, branch: workspaceBranch });

      return worktreePath;
    } catch (error) {
      this.logger.error('Failed to create worktree:', error as Error);
      throw error;
    }
  }

  /**
   * Resolve a base ref, checking local first then remote origin/
   * This handles the case where remote branches are passed without origin/ prefix
   */
  private async resolveBaseRef(ref: string): Promise<string> {
    // First check if ref exists as-is (local branch or already has origin/)
    const localCheck = await this.executeGitCommand(`rev-parse --verify "${ref}"`);
    if (localCheck.exitCode === 0) {
      return ref;
    }

    // Try with origin/ prefix for remote branches
    const remoteRef = `origin/${ref}`;
    const remoteCheck = await this.executeGitCommand(`rev-parse --verify "${remoteRef}"`);
    if (remoteCheck.exitCode === 0) {
      this.logger.debug(`Base ref found as remote branch: ${remoteRef}`);
      return remoteRef;
    }

    // Neither exists, return original (will likely fail but with clear error)
    this.logger.warn(`Base ref not found locally or on origin: ${ref}`);
    return ref;
  }

  /**
   * Remove a git worktree
   */
  async removeWorktree(worktreePath: string, force: boolean = false): Promise<void> {

    this.logger.debug(`Removing worktree at ${worktreePath}`);

    const forceFlag = force ? '--force' : '';
    const result = await this.executeGitCommand(`worktree remove ${worktreePath} ${forceFlag}`);

    if (result.exitCode !== 0 && !result.stderr.includes('not a working tree')) {
      this.logger.warn(`Failed to remove worktree: ${result.stderr}`);
    }

    // Prune any stale worktree references
    await this.executeGitCommand('worktree prune');

    this.emit('worktree-removed', { path: worktreePath });
  }

  /**
   * List all worktrees
   */
  async listWorktrees(): Promise<Array<{ path: string; branch: string; commit: string }>> {

    const result = await this.executeGitCommand('worktree list --porcelain');

    if (result.exitCode !== 0) {
      throw new Error(`Failed to list worktrees: ${result.stderr}`);
    }

    const worktrees: Array<{ path: string; branch: string; commit: string }> = [];
    const lines = result.stdout.split('\n');

    let current: any = {};
    for (const line of lines) {
      if (line.startsWith('worktree ')) {
        if (current.path) {
          worktrees.push(current);
        }
        current = { path: line.substring(9) };
      } else if (line.startsWith('HEAD ')) {
        current.commit = line.substring(5);
      } else if (line.startsWith('branch ')) {
        current.branch = line.substring(7);
      }
    }

    if (current.path) {
      worktrees.push(current);
    }

    return worktrees;
  }

  /**
   * Get the default branch (main/master)
   */
  async getDefaultBranch(): Promise<string> {

    // Try to get the default branch from remote
    const result = await this.executeGitCommand('symbolic-ref refs/remotes/origin/HEAD');

    if (result.exitCode === 0) {
      const match = result.stdout.match(/refs\/remotes\/origin\/(.+)/);
      if (match) {
        return match[1].trim();
      }
    }

    // Fallback: check if main or master exists
    const branches = await this.listBranches();
    if (branches.some((b) => b.name === 'main')) return 'main';
    if (branches.some((b) => b.name === 'master')) return 'master';

    // Last resort: use current branch
    const status = await this.getStatus();
    return status.branch;
  }

  /**
   * Check if a branch exists
   */
  async branchExists(branchName: string): Promise<boolean> {

    const result = await this.executeGitCommand(
      `show-ref --verify --quiet refs/heads/${branchName}`,
    );

    return result.exitCode === 0;
  }

  /**
   * List all branches
   */
  async listBranches(): Promise<GitBranch[]> {

    const result = await this.executeGitCommand('branch -vv');

    if (result.exitCode !== 0) {
      throw new Error(`Failed to list branches: ${result.stderr}`);
    }

    const branches: GitBranch[] = [];
    const lines = result.stdout.split('\n');

    for (const line of lines) {
      if (!line.trim()) continue;

      const current = line.startsWith('*');
      // Handle both current branch marker (*) and worktree marker (+)
      const cleanedLine = line.replace(/^[*+]\s*/, '').trim();
      const parts = cleanedLine.split(/\s+/);
      const name = parts[0];
      const lastCommit = parts[1];

      // Parse tracking info if present
      let remote: string | undefined;
      let ahead = 0;
      let behind = 0;

      const trackingMatch = line.match(/\[([^\]]+)\]/);
      if (trackingMatch) {
        const tracking = trackingMatch[1];
        const remoteParts = tracking.split(':');
        remote = remoteParts[0];

        if (remoteParts[1]) {
          const aheadMatch = remoteParts[1].match(/ahead (\d+)/);
          const behindMatch = remoteParts[1].match(/behind (\d+)/);

          if (aheadMatch) ahead = parseInt(aheadMatch[1], 10);
          if (behindMatch) behind = parseInt(behindMatch[1], 10);
        }
      }

      branches.push({
        name,
        current,
        remote,
        lastCommit,
        ahead,
        behind,
      });
    }

    return branches;
  }

  /**
   * Get git status for the workspace
   */
  async getStatus(worktreePath?: string): Promise<GitStatus> {

    const cwd = worktreePath || this.config.repositoryPath;
    const result = await this.executeGitCommand('status --porcelain=v1 -b', cwd);

    if (result.exitCode !== 0) {
      throw new Error(`Failed to get status: ${result.stderr}`);
    }

    const status: GitStatus = {
      branch: '',
      ahead: 0,
      behind: 0,
      diverged: false,
      staged: [],
      modified: [],
      untracked: [],
      deleted: [],
      conflicts: [],
    };

    const lines = result.stdout.split('\n');

    for (const line of lines) {
      if (!line) continue;

      // Parse branch info
      if (line.startsWith('##')) {
        const branchInfo = line.substring(3);
        const parts = branchInfo.split('...');
        status.branch = parts[0];

        // Parse ahead/behind
        const aheadMatch = branchInfo.match(/ahead (\d+)/);
        const behindMatch = branchInfo.match(/behind (\d+)/);

        if (aheadMatch) status.ahead = parseInt(aheadMatch[1], 10);
        if (behindMatch) status.behind = parseInt(behindMatch[1], 10);

        // Check for divergence using merge-base (more reliable than ahead/behind check)
        // The command `git merge-base --is-ancestor origin/${branch} HEAD` returns 0 if
        // origin/branch is an ancestor of HEAD (i.e., we can fast-forward), and non-zero otherwise.
        status.diverged = status.ahead > 0 && status.behind > 0; // Fallback
        if (status.branch) {
          // First, check if the remote branch exists
          let remoteBranchExists = false;
          try {
            const revParseResult = await this.executeGitCommand(
              `rev-parse --verify origin/${status.branch}`,
              cwd,
            );
            remoteBranchExists = revParseResult.exitCode === 0;
          } catch {
            remoteBranchExists = false;
          }

          // Only check for divergence if the remote branch exists
          if (remoteBranchExists) {
            try {
              const mergeBaseResult = await this.executeGitCommand(
                `merge-base --is-ancestor origin/${status.branch} HEAD`,
                cwd,
              );
              // Command succeeded (exit code 0) = origin/branch is ancestor of HEAD = NOT diverged
              // Only mark as diverged if merge-base failed AND we have local commits (ahead > 0)
              status.diverged = mergeBaseResult.exitCode !== 0 && status.ahead > 0;
            } catch {
              // If command fails completely, fall back to ahead > 0 && behind > 0 check
              // (already set above)
            }
          } else {
            // Remote branch doesn't exist, so it's not diverged - just unpushed
            status.diverged = false;
          }
        }

        continue;
      }

      // Parse file status
      const statusCode = line.substring(0, 2);
      const filePath = line.substring(3);

      if (statusCode === '??') {
        status.untracked.push(filePath);
      } else if (statusCode[0] === 'A' || statusCode[1] === 'A') {
        status.staged.push(filePath);
      } else if (statusCode[0] === 'M' || statusCode[1] === 'M') {
        status.modified.push(filePath);
      } else if (statusCode[0] === 'D' || statusCode[1] === 'D') {
        status.deleted.push(filePath);
      } else if (statusCode === 'UU' || statusCode === 'AA' || statusCode === 'DD') {
        status.conflicts.push(filePath);
      }
    }

    return status;
  }

  /**
   * Fetch from remote
   */
  async fetch(worktreePath?: string): Promise<void> {

    const cwd = worktreePath || this.config.repositoryPath;
    const result = await this.executeGitCommand('fetch --all --prune', cwd);

    if (result.exitCode !== 0) {
      throw new Error(`Failed to fetch: ${result.stderr}`);
    }

    this.emit('fetched');
  }

  /**
   * Pull changes from remote
   */
  async pull(worktreePath?: string, options?: { rebase?: boolean }): Promise<void> {

    const cwd = worktreePath || this.config.repositoryPath;
    const command = options?.rebase ? 'pull --rebase' : 'pull';

    const result = await this.executeGitCommand(command, cwd);

    if (result.exitCode !== 0) {
      if (result.stderr.includes('conflict')) {
        this.emit('merge-conflict', { message: result.stderr });
        throw new Error('Merge conflict detected');
      }
      throw new Error(`Failed to pull: ${result.stderr}`);
    }

    this.emit('pulled');
  }

  /**
   * Push changes to remote
   */
  async push(
    worktreePath?: string,
    options?: { force?: boolean; setUpstream?: boolean },
  ): Promise<void> {

    const cwd = worktreePath || this.config.repositoryPath;
    let command = 'push';

    if (options?.force) command += ' --force';
    if (options?.setUpstream) {
      const status = await this.getStatus(cwd);
      command += ` --set-upstream origin ${status.branch}`;
    }

    const result = await this.executeGitCommand(command, cwd);

    if (result.exitCode !== 0) {
      throw new Error(`Failed to push: ${result.stderr}`);
    }

    this.emit('pushed');
  }

  /**
   * Stage files for commit
   */
  async stageFiles(paths: string[], worktreePath?: string): Promise<void> {

    const cwd = worktreePath || this.config.repositoryPath;
    const pathsArg = paths.length > 0 ? paths.map((p) => `"${p}"`).join(' ') : '.';
    const result = await this.executeGitCommand(`add ${pathsArg}`, cwd);

    if (result.exitCode !== 0) {
      throw new Error(`Failed to stage files: ${result.stderr}`);
    }
  }

  /**
   * Unstage files
   */
  async unstageFiles(paths: string[], worktreePath?: string): Promise<void> {

    const cwd = worktreePath || this.config.repositoryPath;
    const pathsArg = paths.map((p) => `"${p}"`).join(' ');
    const result = await this.executeGitCommand(`reset HEAD -- ${pathsArg}`, cwd);

    if (result.exitCode !== 0) {
      throw new Error(`Failed to unstage files: ${result.stderr}`);
    }
  }

  /**
   * Discard changes to files
   */
  async discardChanges(paths: string[], worktreePath?: string): Promise<void> {

    const cwd = worktreePath || this.config.repositoryPath;
    const pathsArg = paths.map((p) => `"${p}"`).join(' ');
    const result = await this.executeGitCommand(`checkout -- ${pathsArg}`, cwd);

    if (result.exitCode !== 0) {
      throw new Error(`Failed to discard changes: ${result.stderr}`);
    }
  }

  /**
   * Commit staged changes
   */
  async commit(message: string, worktreePath?: string): Promise<string> {

    const cwd = worktreePath || this.config.repositoryPath;
    // Escape message for shell
    const escapedMessage = message.replace(/"/g, '\\"');
    const result = await this.executeGitCommand(`commit -m "${escapedMessage}"`, cwd);

    if (result.exitCode !== 0) {
      throw new Error(`Failed to commit: ${result.stderr}`);
    }

    // Get the commit hash
    const hashResult = await this.executeGitCommand('rev-parse HEAD', cwd);
    return hashResult.stdout.trim();
  }

  /**
   * Get diff for files
   */
  async getDiff(paths: string[], staged: boolean = false, worktreePath?: string): Promise<string> {

    const cwd = worktreePath || this.config.repositoryPath;
    const stagedFlag = staged ? '--cached' : '';
    const pathsArg = paths.length > 0 ? `-- ${paths.map((p) => `"${p}"`).join(' ')}` : '';
    const result = await this.executeGitCommand(`diff ${stagedFlag} ${pathsArg}`, cwd);

    if (result.exitCode !== 0) {
      throw new Error(`Failed to get diff: ${result.stderr}`);
    }

    return result.stdout;
  }

  /**
   * Get commit history
   */
  async getHistory(
    limit: number = 50,
    worktreePath?: string,
  ): Promise<
    Array<{
      hash: string;
      message: string;
      author: string;
      email: string;
      date: string;
    }>
  > {

    const cwd = worktreePath || this.config.repositoryPath;
    const format = '--format=%H|%s|%an|%ae|%aI';
    const result = await this.executeGitCommand(`log -n ${limit} ${format}`, cwd);

    if (result.exitCode !== 0) {
      throw new Error(`Failed to get history: ${result.stderr}`);
    }

    const commits = result.stdout
      .trim()
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => {
        const [hash, message, author, email, date] = line.split('|');
        return { hash, message, author, email, date };
      });

    return commits;
  }

  /**
   * Get current HEAD commit
   */
  async getCurrentHead(worktreePath?: string): Promise<string> {

    const cwd = worktreePath || this.config.repositoryPath;
    const result = await this.executeGitCommand('rev-parse HEAD', cwd);

    if (result.exitCode !== 0) {
      throw new Error(`Failed to get HEAD: ${result.stderr}`);
    }

    return result.stdout.trim();
  }

  /**
   * Get file content at a specific git ref (commit, branch, tag, etc.)
   * @param filePath - The file path (absolute or relative to the repository root)
   * @param ref - The git ref (commit hash, branch name, tag, etc.)
   * @param worktreePath - Optional worktree path to use as cwd
   */
  async showFile(
    filePath: string,
    ref: string,
    worktreePath?: string,
  ): Promise<{ ok: true; data: string } | { ok: false; error: string }> {
    const cwd = worktreePath || this.config.repositoryPath;

    // Convert absolute path to relative if needed
    let relativePath = filePath;
    if (filePath.startsWith('/') && cwd && filePath.startsWith(cwd)) {
      relativePath = filePath.slice(cwd.length);
      if (relativePath.startsWith('/')) {
        relativePath = relativePath.slice(1);
      }
    }

    try {
      const result = await this.executeGitCommand(`show "${ref}:${relativePath}"`, cwd);

      if (result.exitCode !== 0) {
        // If the file doesn't exist at this ref (e.g., new file), return empty string
        if (
          result.stderr.includes('does not exist') ||
          result.stderr.includes('fatal: path')
        ) {
          return { ok: true, data: '' };
        }
        return { ok: false, error: `Failed to get file content: ${result.stderr}` };
      }

      return { ok: true, data: result.stdout };
    } catch (error) {
      const errorMessage = (error as Error).message || '';
      if (errorMessage.includes('does not exist') || errorMessage.includes('fatal: path')) {
        return { ok: true, data: '' };
      }
      return { ok: false, error: `Failed to get file content: ${errorMessage}` };
    }
  }

}
