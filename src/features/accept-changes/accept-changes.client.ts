/**
 * Accept Changes Client
 *
 * Client-side wrapper for accept changes IPC calls.
 */

import { IPC_CHANNELS } from '../../shared/ipc-registry';
import type { WorkspaceId } from '../../shared/types/branded-ids';
import type {
  WorkspaceGitStatus,
  AcceptAction,
  PrepareAcceptResponse,
  ExecuteAcceptRequest,
  AcceptChangesResult,
  ExportFilesResult,
  MergeStrategy,
  UndoCommitMetadata,
} from './types';

interface IPCResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export class AcceptChangesClient {
  private static async invoke<T>(channel: string, data?: unknown): Promise<IPCResponse<T>> {
    if (typeof window === 'undefined' || !window.electronAPI) {
      throw new Error('IPC not available');
    }
    return window.electronAPI.invoke(channel, data) as Promise<IPCResponse<T>>;
  }

  /**
   * Get the current git status for accept changes workflow
   */
  static async getStatus(workspaceId: WorkspaceId): Promise<WorkspaceGitStatus> {
    const response = await this.invoke<WorkspaceGitStatus>(IPC_CHANNELS.ACCEPT_CHANGES.GET_STATUS, {
      workspaceId,
    });

    if (!response.success || !response.data) {
      throw new Error(response.error || 'Failed to get status');
    }

    return response.data;
  }

  /**
   * Prepare for accept changes - validates and returns suggestions
   */
  static async prepare(
    workspaceId: WorkspaceId,
    action: AcceptAction,
    files?: string[],
  ): Promise<PrepareAcceptResponse> {
    const response = await this.invoke<PrepareAcceptResponse>(IPC_CHANNELS.ACCEPT_CHANGES.PREPARE, {
      workspaceId,
      action,
      files,
    });

    if (!response.success || !response.data) {
      throw new Error(response.error || 'Failed to prepare');
    }

    return response.data;
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
      exportPath?: string;
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
      exportPath: options?.exportPath,
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

    const response = await this.invoke<AcceptChangesResult>(
      IPC_CHANNELS.ACCEPT_CHANGES.EXECUTE,
      request,
    );

    if (!response.success) {
      // Return the result even on failure - it contains step info
      return (
        response.data || {
          success: false,
          steps: [],
          error: response.error || 'Failed to execute',
        }
      );
    }

    return response.data!;
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
    const response = await this.invoke<AcceptChangesResult>(
      IPC_CHANNELS.ACCEPT_CHANGES.MERGE_PR,
      {
        workspaceId,
        prNumber,
        mergeMethod: options?.mergeMethod,
        commitTitle: options?.commitTitle,
        commitMessage: options?.commitMessage,
      },
    );

    if (!response.success) {
      return (
        response.data || {
          success: false,
          steps: [],
          error: response.error || 'Failed to merge PR',
        }
      );
    }

    return response.data!;
  }

  /**
   * Export files to a target folder
   */
  static async exportFiles(
    workspaceId: WorkspaceId,
    targetPath: string,
    options?: {
      files?: string[];
      preserveStructure?: boolean;
    },
  ): Promise<ExportFilesResult> {
    const response = await this.invoke<ExportFilesResult>(IPC_CHANNELS.ACCEPT_CHANGES.EXPORT, {
      workspaceId,
      targetPath,
      files: options?.files,
      preserveStructure: options?.preserveStructure,
    });

    if (!response.success) {
      return (
        response.data || {
          success: false,
          exportedFiles: [],
          targetPath,
          error: response.error || 'Failed to export',
        }
      );
    }

    return response.data!;
  }

  /**
   * Add a git remote to the workspace repository
   */
  static async addRemote(
    workspaceId: WorkspaceId,
    remoteUrl: string,
  ): Promise<WorkspaceGitStatus> {
    const response = await this.invoke<WorkspaceGitStatus>(
      IPC_CHANNELS.ACCEPT_CHANGES.ADD_REMOTE,
      { workspaceId, remoteUrl },
    );

    if (!response.success || !response.data) {
      throw new Error(response.error || 'Failed to add remote');
    }

    return response.data;
  }

  /**
   * Check if a path has uncommitted git changes
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
    const response = await this.invoke<AcceptChangesResult>(
      IPC_CHANNELS.ACCEPT_CHANGES.EXECUTE,
      { workspaceId, action: 'reset-to-trunk' },
    );

    if (!response.success) {
      return (
        response.data || {
          success: false,
          steps: [],
          error: response.error || 'Failed to reset to trunk',
        }
      );
    }

    if (!response.data) {
      return {
        success: false,
        steps: [],
        error: 'Reset succeeded but received no result data',
      };
    }

    return response.data;
  }
}
