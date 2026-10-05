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
import { store as appStore } from '$store/renderer/store';
import {
  addAcceptRemoteRequested,
  executeAcceptRequested,
  mergePRAcceptRequested,
  prepareAcceptRequested,
  resetAcceptToTrunkRequested,
} from '$store/renderer/slices/accept-workflow/accept-workflow-slice';
import type {
  ExecuteAcceptOptions,
  MergePRAcceptOptions,
} from '$store/renderer/slices/accept-workflow/accept-workflow-types';
import type { WorkspaceId } from '../../shared/types/branded-ids';
import type {
  WorkspaceGitStatus,
  AcceptAction,
  PrepareAcceptResponse,
  AcceptChangesResult,
} from './types';

/**
 * Per-workspace single-flight for `getStatus`. Concurrent callers for the same
 * workspace share one in-flight `backendRequest`; the entry is cleared as soon
 * as it settles (resolve or reject), so this coalesces duplicate concurrent
 * calls without introducing any TTL/caching of the result.
 */
const inFlightGetStatus = new Map<WorkspaceId, Promise<WorkspaceGitStatus>>();

/** Compatibility facade for non-component callers; remove once those callers dispatch intents. */
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
    return appStore.dispatch(prepareAcceptRequested(workspaceId, action, files));
  }

  /**
   * Execute accept changes workflow
   */
  static async execute(
    workspaceId: WorkspaceId,
    action: AcceptAction,
    options?: ExecuteAcceptOptions,
  ): Promise<AcceptChangesResult> {
    return appStore.dispatch(executeAcceptRequested(workspaceId, action, options));
  }

  /**
   * Merge a pull request on GitHub (remote merge)
   */
  static async mergePR(
    workspaceId: WorkspaceId,
    prNumber: number,
    options?: MergePRAcceptOptions,
  ): Promise<AcceptChangesResult> {
    return appStore.dispatch(mergePRAcceptRequested(workspaceId, prNumber, options));
  }

  /**
   * Add a git remote to the workspace repository
   */
  static async addRemote(workspaceId: WorkspaceId, remoteUrl: string): Promise<WorkspaceGitStatus> {
    return appStore.dispatch(addAcceptRemoteRequested(workspaceId, remoteUrl));
  }

  /**
   * Reset workspace branch to trunk HEAD
   * Performs a hard reset, discarding all local commits and changes
   */
  static async resetToTrunk(workspaceId: WorkspaceId): Promise<AcceptChangesResult> {
    return appStore.dispatch(resetAcceptToTrunkRequested(workspaceId));
  }
}
