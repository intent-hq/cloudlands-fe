/**
 * Accept Changes Client
 *
 * Client-side wrapper for the accept-changes workflow. Git/forge orchestration
 * (commit → push → create-PR → merge) lives in the intentd daemon and is
 * reached via `backendRequest('accept-changes.*')` (PROTOCOL.md §5.18).
 * Only `checkPathHasChanges` stays on local Electron IPC — it probes an
 * arbitrary local filesystem path, which the daemon does not manage.
 */

import { backendRequest } from '$lib/client/live/backend-transport';
import { IPC_CHANNELS } from '../../shared/ipc-registry';
import { invoke as invokeIpc } from '../../shared/generated/ipc-client';
import type { WorkspaceId } from '../../shared/types/branded-ids';
import type {
  WorkspaceGitStatus,
  AcceptAction,
  PrepareAcceptResponse,
  ExecuteAcceptRequest,
  AcceptChangesResult,
  MergeStrategy,
  UndoCommitMetadata,
} from './types';

interface IPCResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

/** Convert a thrown transport/daemon error into a failed AcceptChangesResult. */
function toFailureResult(error: unknown, fallbackMessage: string): AcceptChangesResult {
  return {
    success: false,
    steps: [],
    error: error instanceof Error ? error.message : fallbackMessage,
  };
}

export class AcceptChangesClient {
  private static async invoke<T>(channel: string, data?: unknown): Promise<IPCResponse<T>> {
    if (typeof window === 'undefined' || !window.electronAPI) {
      throw new Error('IPC not available');
    }
    return invokeIpc<IPCResponse<T>>(channel, data);
  }

  /**
   * Get the current git status for accept changes workflow
   */
  static async getStatus(workspaceId: WorkspaceId): Promise<WorkspaceGitStatus> {
    return backendRequest<WorkspaceGitStatus>('accept-changes.getStatus', { workspaceId });
  }

  /**
   * Prepare for accept changes - validates and returns suggestions
   */
  static async prepare(
    workspaceId: WorkspaceId,
    action: AcceptAction,
    files?: string[],
  ): Promise<PrepareAcceptResponse> {
    return backendRequest<PrepareAcceptResponse>('accept-changes.prepare', {
      workspaceId,
      action,
      files,
    });
  }

  /**
   * Execute accept changes workflow
   */
  static async execute(
    workspaceId: WorkspaceId,
    action: AcceptAction,
    options?: {
      files?: string[];
      commitMessage?: string;
      prTitle?: string;
      prBody?: string;
      targetBranch?: string;
      mergeStrategy?: MergeStrategy;
      upToCommitHash?: string;
      /** Metadata about commits being undone, used to restore attributions */
      undoCommitsMetadata?: UndoCommitMetadata[];
      stageUnstaged?: boolean;
      pushAfterCommit?: boolean;
      createPRAfterPush?: boolean;
      rebaseFirst?: boolean;
      localOnly?: boolean;
    },
  ): Promise<AcceptChangesResult> {
    const request: ExecuteAcceptRequest = {
      workspaceId,
      action,
      files: options?.files,
      commitMessage: options?.commitMessage,
      prTitle: options?.prTitle,
      prBody: options?.prBody,
      targetBranch: options?.targetBranch,
      mergeStrategy: options?.mergeStrategy,
      upToCommitHash: options?.upToCommitHash,
      undoCommitsMetadata: options?.undoCommitsMetadata,
      options: {
        stageUnstaged: options?.stageUnstaged,
        pushAfterCommit: options?.pushAfterCommit,
        createPRAfterPush: options?.createPRAfterPush,
        rebaseFirst: options?.rebaseFirst,
        localOnly: options?.localOnly,
      },
    };

    try {
      return await backendRequest<AcceptChangesResult>('accept-changes.execute', request);
    } catch (error) {
      // Preserve the historical contract: execute() reports failures in-band.
      return toFailureResult(error, 'Failed to execute');
    }
  }

  /**
   * Merge a pull request on GitHub (remote merge)
   */
  static async mergePR(
    workspaceId: WorkspaceId,
    prNumber: number,
    options?: {
      mergeMethod?: 'merge' | 'squash' | 'rebase';
      commitTitle?: string;
      commitMessage?: string;
    },
  ): Promise<AcceptChangesResult> {
    try {
      return await backendRequest<AcceptChangesResult>('accept-changes.mergePR', {
        workspaceId,
        prNumber,
        mergeMethod: options?.mergeMethod,
        commitTitle: options?.commitTitle,
        commitMessage: options?.commitMessage,
      });
    } catch (error) {
      return toFailureResult(error, 'Failed to merge PR');
    }
  }

  /**
   * Add a git remote to the workspace repository
   */
  static async addRemote(
    workspaceId: WorkspaceId,
    remoteUrl: string,
  ): Promise<WorkspaceGitStatus> {
    return backendRequest<WorkspaceGitStatus>('accept-changes.addRemote', {
      workspaceId,
      remoteUrl,
    });
  }

  /**
   * Check if a path has uncommitted git changes.
   *
   * Stays on local Electron IPC (not the daemon): it inspects an arbitrary
   * local filesystem path (e.g. an export destination) that is not a
   * daemon-managed workspace.
   */
  static async checkPathHasChanges(
    targetPath: string,
  ): Promise<{ hasChanges: boolean; isGitRepo: boolean }> {
    const response = await this.invoke<{ hasChanges: boolean; isGitRepo: boolean }>(
      IPC_CHANNELS.ACCEPT_CHANGES.CHECK_PATH_HAS_CHANGES,
      { targetPath },
    );

    if (!response.success || !response.data) {
      // Default to no changes if check fails
      return { hasChanges: false, isGitRepo: false };
    }

    return response.data;
  }

  /**
   * Reset workspace branch to trunk HEAD
   * Performs a hard reset, discarding all local commits and changes
   */
  static async resetToTrunk(workspaceId: WorkspaceId): Promise<AcceptChangesResult> {
    try {
      return await backendRequest<AcceptChangesResult>('accept-changes.execute', {
        workspaceId,
        action: 'reset-to-trunk',
      });
    } catch (error) {
      return toFailureResult(error, 'Failed to reset to trunk');
    }
  }
}
