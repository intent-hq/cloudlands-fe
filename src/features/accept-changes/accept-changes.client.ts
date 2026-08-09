/**
 * Accept Changes Client
 *
 * Client-side wrapper for the accept-changes workflow. Git/forge orchestration
 * (commit → push → create-PR → merge) lives in the intentd daemon and is
 * reached via `backendRequest('accept-changes.*')` (PROTOCOL.md §5.18).
 * The legacy local-IPC `checkPathHasChanges` probe was retired with its last
 * caller (nothing consumed the export-destination check in this build).
 */

import { backendRequest } from '$lib/client/live/backend-transport';
import { m } from '$shared/paraglide/messages.js';
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

/** Convert a thrown transport/daemon error into a failed AcceptChangesResult. */
function toFailureResult(error: unknown, fallbackMessage: string): AcceptChangesResult {
  return {
    success: false,
    steps: [],
    error: error instanceof Error ? error.message : fallbackMessage,
  };
}

/**
 * Per-workspace single-flight for `getStatus`. Concurrent callers for the same
 * workspace share one in-flight `backendRequest`; the entry is cleared as soon
 * as it settles (resolve or reject), so this coalesces duplicate concurrent
 * calls without introducing any TTL/caching of the result.
 */
const inFlightGetStatus = new Map<WorkspaceId, Promise<WorkspaceGitStatus>>();

export class AcceptChangesClient {
  /**
   * Get the current git status for accept changes workflow.
   *
   * By default, concurrent calls for the same workspace are coalesced into
   * one in-flight request (see `inFlightGetStatus`). Pass
   * `forceRefresh: true` when the caller needs a status that reflects state
   * as of *now* (e.g. right after a commit/push/reset) and must not receive
   * a response from a request that started before that mutation. A forced
   * call always issues a fresh `backendRequest` and republishes it as the
   * shared in-flight entry, so subsequent non-forced callers join the fresh
   * request instead of a stale one.
   */
  static async getStatus(
    workspaceId: WorkspaceId,
    options?: { forceRefresh?: boolean },
  ): Promise<WorkspaceGitStatus> {
    if (!options?.forceRefresh) {
      const existing = inFlightGetStatus.get(workspaceId);
      if (existing) {
        return existing;
      }
    }

    const request: Promise<WorkspaceGitStatus> = backendRequest<WorkspaceGitStatus>(
      'accept-changes.getStatus',
      { workspaceId },
    ).finally(() => {
      // Only clear the entry if it still points at this request - a forced
      // refresh may have already replaced it with a newer in-flight request.
      if (inFlightGetStatus.get(workspaceId) === request) {
        inFlightGetStatus.delete(workspaceId);
      }
    });
    inFlightGetStatus.set(workspaceId, request);
    return request;
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
      return toFailureResult(error, m.acceptChanges_client_executeFailed_error());
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
      return toFailureResult(error, m.acceptChanges_client_mergePrFailed_error());
    }
  }

  /**
   * Add a git remote to the workspace repository
   */
  static async addRemote(workspaceId: WorkspaceId, remoteUrl: string): Promise<WorkspaceGitStatus> {
    return backendRequest<WorkspaceGitStatus>('accept-changes.addRemote', {
      workspaceId,
      remoteUrl,
    });
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
      return toFailureResult(error, m.acceptChanges_client_resetToTrunkFailed_error());
    }
  }
}
