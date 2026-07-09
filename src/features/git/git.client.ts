/**
 * Git Client
 *
 * Renderer-side wrapper for git operations. Channels with a daemon arm
 * (PROTOCOL.md §5.6) resolve via `backendRequest('git.*')`: status, stage,
 * unstage, commit (→ `git.agentCommit`, the wire-canonical commit), history
 * (→ `git.commits`), commit details (→ `git.commitDetails`) and show-file
 * (→ `git.showFile`). Operations without a dedicated daemon RPC (hunk
 * staging/unstaging, push, fetch) stay on their legacy channels, which the
 * git-bridge-seeder serves through the daemon-owned `host.exec` (§5.14). All
 * daemon-backed reads/mutations preserve the historical `Result<T, string>`
 * contract — transport/daemon errors fold to `{ ok: false, error }`, never a
 * throw.
 */

import type {
  GitStatus,
  CommitInfo,
  WorkspaceId,
  Result,
  CommandResponse,
} from '../../shared/types';
import { invoke as invokeIpc } from '../../shared/generated/ipc-client';
import { backendRequest } from '$lib/client/live/backend-transport';

/** Fold a thrown transport/daemon error into a failed Result. */
function toError(error: unknown, fallback: string): { ok: false; error: string } {
  return { ok: false, error: error instanceof Error ? error.message : fallback };
}

class GitClient {
  private async invoke<T>(channel: string, data?: any): Promise<Result<T, string>> {
    // Add retry logic for race conditions during startup
    let retries = 3;
    let lastError: any;

    while (retries > 0) {
      try {
        if (typeof window !== 'undefined' && window.electronAPI) {
          const response = await invokeIpc<CommandResponse<T>>(channel, data);
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

  // `git.status` (PROTOCOL §5.6) returns the working-tree summary directly in
  // the renderer `GitStatus` shape.
  async getStatus(workspaceId: WorkspaceId): Promise<Result<GitStatus, string>> {
    try {
      const data = await backendRequest<GitStatus>('git.status', { workspaceId });
      return { ok: true, data };
    } catch (error) {
      return toError(error, 'Failed to get git status');
    }
  }

  // `git.stage` (PROTOCOL §5.6) requires explicit paths; all-files globs
  // ('.'/'*'/'--all') are rejected by the daemon with -32603.
  async stageFiles(workspaceId: WorkspaceId, files: string[]): Promise<Result<void, string>> {
    try {
      await backendRequest('git.stage', { workspaceId, paths: files });
      return { ok: true, data: undefined };
    } catch (error) {
      return toError(error, 'Failed to stage files');
    }
  }

  // `git.unstage` (PROTOCOL §5.6 extensions) — the inverse of `git.stage`;
  // idempotent on already-unstaged paths.
  async unstageFiles(workspaceId: WorkspaceId, files: string[]): Promise<Result<void, string>> {
    try {
      await backendRequest('git.unstage', { workspaceId, paths: files });
      return { ok: true, data: undefined };
    } catch (error) {
      return toError(error, 'Failed to unstage files');
    }
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

  // `git.agentCommit` (PROTOCOL §5.6) is the wire-canonical commit method
  // (`git.commit` is deprecated). This client only serves user-driven commits,
  // so `userRequested: true` is asserted on every call.
  async commit(workspaceId: WorkspaceId, message: string): Promise<Result<CommitInfo, string>> {
    try {
      const result = await backendRequest<{ hash?: string }>('git.agentCommit', {
        workspaceId,
        message,
        userRequested: true,
      });
      // Historical contract: the legacy git:commit handler returned only the
      // commit hash in the CommitInfo slot.
      return { ok: true, data: { hash: result?.hash ?? '' } as CommitInfo };
    } catch (error) {
      return toError(error, 'Failed to commit');
    }
  }

  async push(
    workspaceId: WorkspaceId,
    branch?: string,
    force?: boolean,
  ): Promise<Result<void, string>> {
    return this.invoke<void>('git:push', { workspaceId, branch, force });
  }

  /**
   * Fetch remote changes without merging.
   * Updates remote tracking branches so divergence can be detected.
   */
  async fetch(workspaceId: WorkspaceId): Promise<Result<void, string>> {
    return this.invoke<void>('git:fetch', { workspaceId });
  }

  // `git.commits` (PROTOCOL §5.6, alias `git.log`) — paginated reverse-
  // chronological first-parent history. Items already carry the renderer
  // `CommitInfo` shape (hash/sha/author/email/date/message/files). The
  // pagination envelope (`nextToken`) is not threaded through this seam.
  async getHistory(
    workspaceId: WorkspaceId,
    limit?: number,
  ): Promise<Result<CommitInfo[], string>> {
    try {
      const result = await backendRequest<{ items?: CommitInfo[] }>('git.commits', {
        workspaceId,
        ...(limit !== undefined ? { limit } : {}),
      });
      return { ok: true, data: Array.isArray(result?.items) ? result.items : [] };
    } catch (error) {
      return toError(error, 'Failed to get git history');
    }
  }

  // `git.showFile` (PROTOCOL §5.6) — raw file content at a revision
  // (`git show <ref>:<path>` semantics; index ref ':0' supported). A path
  // missing at the ref folds to '' on the daemon side, mirroring the legacy
  // local handler.
  async showFile(
    workspaceId: WorkspaceId,
    filePath: string,
    ref: string,
  ): Promise<Result<string, string>> {
    try {
      const result = await backendRequest<{ content?: unknown }>('git.showFile', {
        workspaceId,
        filePath,
        ref,
      });
      return { ok: true, data: typeof result?.content === 'string' ? result.content : '' };
    } catch (error) {
      return toError(error, 'Failed to show file');
    }
  }

  // `git.commitDetails` (PROTOCOL §5.6) — metadata + per-file
  // `(additions, deletions)` for one commit. The wire envelope
  // (`commitHash`/`authorEmail`) is mapped onto the renderer `CommitInfo`
  // field names (`hash`/`email`); this method keeps its historical throwing
  // contract.
  async getCommitDetails(
    workspaceId: WorkspaceId,
    commitHash: string,
  ): Promise<
    CommitInfo & { fileDetails?: Array<{ path: string; additions: number; deletions: number }> }
  > {
    const result = await backendRequest<{
      commitHash?: string;
      author?: string;
      authorEmail?: string;
      date?: string;
      message?: string;
      files?: string[];
      fileDetails?: Array<{ path: string; additions: number; deletions: number }>;
    }>('git.commitDetails', { workspaceId, commitHash });
    return {
      hash: result?.commitHash || commitHash,
      author: result?.author ?? '',
      email: result?.authorEmail ?? '',
      date: result?.date ?? '',
      message: result?.message ?? '',
      files: Array.isArray(result?.files) ? result.files : [],
      ...(Array.isArray(result?.fileDetails) ? { fileDetails: result.fileDetails } : {}),
    };
  }
}

export const gitClient = new GitClient();
