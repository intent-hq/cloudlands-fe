/**
 * Git IPC Client
 *
 * Client-side wrapper for git IPC communication.
 * Used by renderer process to communicate with main process.
 */

import type {
  GitStatus,
  CommitInfo,
  WorkspaceId,
  DiffChunk,
  Result,
  CommandResponse,
} from '../../shared/types';
import { GIT_CHANNELS } from '../../shared/ipc';

class GitClient {
  private async invoke<T>(channel: string, data?: any): Promise<Result<T, string>> {
    // Add retry logic for race conditions during startup
    let retries = 3;
    let lastError: any;

    while (retries > 0) {
      try {
        if (typeof window !== 'undefined' && window.electronAPI) {
          const response = await window.electronAPI.invoke(channel, data);
          // Convert CommandResponse to Result type
          return this.commandResponseToResult<T>(response);
        }
        return { ok: false, error: 'IPC not available' };
      } catch (error) {
        lastError = error;
        retries--;

        // Check if it's a "handler not registered" error
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (errorMessage.includes('No handler registered') && retries > 0) {
          // Wait a bit before retrying to allow IPC handlers to be registered
          await new Promise((resolve) => setTimeout(resolve, 100));
        } else {
          // For other errors, don't retry
          break;
        }
      }
    }

    // If we exhausted retries, return the last error
    return {
      ok: false,
      error: lastError instanceof Error ? lastError.message : 'IPC call failed',
    };
  }

  private commandResponseToResult<T>(response: CommandResponse<T>): Result<T, string> {
    if (response.success) {
      return { ok: true, data: response.data as T };
    } else {
      return { ok: false, error: response.error || 'Unknown error' };
    }
  }

  async getStatus(workspaceId: WorkspaceId): Promise<Result<GitStatus, string>> {
    const result = await this.invoke<GitStatus>('git:status', { workspaceId });
    return result;
  }

  async stageFiles(workspaceId: WorkspaceId, files: string[]): Promise<Result<void, string>> {
    return this.invoke<void>('git:stage', { workspaceId, paths: files });
  }

  async unstageFiles(workspaceId: WorkspaceId, files: string[]): Promise<Result<void, string>> {
    return this.invoke<void>('git:unstage', { workspaceId, paths: files });
  }

  /**
   * Stage a specific hunk from a file.
   *
   * @param workspaceId - The workspace ID
   * @param filePath - Path to the file containing the hunk
   * @param hunkPatch - The unified diff patch for the hunk (including file headers)
   */
  async stageHunk(
    workspaceId: WorkspaceId,
    filePath: string,
    hunkPatch: string,
  ): Promise<Result<void, string>> {
    return this.invoke<void>('git:stage-hunk', { workspaceId, filePath, hunkPatch });
  }

  /**
   * Unstage a specific hunk from a file.
   *
   * @param workspaceId - The workspace ID
   * @param filePath - Path to the file containing the hunk
   * @param hunkPatch - The unified diff patch for the hunk (including file headers)
   */
  async unstageHunk(
    workspaceId: WorkspaceId,
    filePath: string,
    hunkPatch: string,
  ): Promise<Result<void, string>> {
    return this.invoke<void>('git:unstage-hunk', { workspaceId, filePath, hunkPatch });
  }

  async commit(workspaceId: WorkspaceId, message: string): Promise<Result<CommitInfo, string>> {
    return this.invoke<CommitInfo>('git:commit', { workspaceId, message });
  }

  async push(
    workspaceId: WorkspaceId,
    branch?: string,
    force?: boolean,
  ): Promise<Result<void, string>> {
    return this.invoke<void>('git:push', { workspaceId, branch, force });
  }

  async pull(workspaceId: WorkspaceId, branch?: string): Promise<Result<void, string>> {
    return this.invoke<void>('git:pull', { workspaceId, branch });
  }

  /**
   * Fetch remote changes without merging.
   * Updates remote tracking branches so divergence can be detected.
   */
  async fetch(workspaceId: WorkspaceId): Promise<Result<void, string>> {
    return this.invoke<void>('git:fetch', { workspaceId });
  }

  async getDiff(workspaceId: WorkspaceId, file?: string): Promise<Result<DiffChunk[], string>> {
    return this.invoke<DiffChunk[]>('git:diff', { workspaceId, file });
  }

  async getHistory(
    workspaceId: WorkspaceId,
    limit?: number,
    since?: string,
    baseRef?: string,
    baseCommitSha?: string,
  ): Promise<Result<CommitInfo[], string>> {
    // Note: git:history returns flat CommitInfo[] (boundary info is only in file-tracking:load-commits)
    return this.invoke<CommitInfo[]>('git:history', {
      workspaceId,
      limit,
      since,
      baseRef,
      baseCommitSha,
    });
  }

  async getFileHistory(
    workspaceId: WorkspaceId,
    filePath: string,
    limit?: number,
  ): Promise<Result<CommitInfo[], string>> {
    return this.invoke<CommitInfo[]>('git:file-history', {
      workspaceId,
      filePath,
      limit,
    });
  }

  async showFile(
    workspaceId: WorkspaceId,
    filePath: string,
    ref: string,
  ): Promise<Result<string, string>> {
    return this.invoke<string>('git:show-file', {
      workspaceId,
      filePath,
      ref,
    });
  }

  async removeLockFile(workspaceId: WorkspaceId): Promise<Result<void, string>> {
    return this.invoke<void>('git:removeLock', { workspaceId });
  }

  async renameBranch(
    workspaceId: WorkspaceId,
    oldBranchName: string,
    newBranchName: string,
  ): Promise<Result<void, string>> {
    return this.invoke<void>('git:rename-branch', {
      workspaceId,
      oldBranchName,
      newBranchName,
    });
  }

  async getCommitDetails(
    workspaceId: WorkspaceId,
    commitHash: string,
  ): Promise<
    CommitInfo & { fileDetails?: Array<{ path: string; additions: number; deletions: number }> }
  > {
    const result = await this.invoke<
      CommitInfo & { fileDetails?: Array<{ path: string; additions: number; deletions: number }> }
    >(GIT_CHANNELS.COMMIT_DETAILS, {
      workspaceId,
      commitHash,
    });

    if (result.ok) {
      return result.data;
    } else {
      throw new Error(result.error);
    }
  }

  async getRemotes(repoPath: string): Promise<
    Result<
      {
        remotes: Array<{ name: string; fetchUrl: string; pushUrl: string }>;
        defaultRemote: string;
      },
      string
    >
  > {
    return this.invoke('git:getRemotes', { repoPath });
  }
}

export const gitClient = new GitClient();
