/**
 * Background Git Actions Service
 *
 * Encapsulates commit and PR creation logic extracted from SidebarChangesPanel.svelte.
 * This service accepts explicit workspace IDs to avoid reactive prop dependencies,
 * preventing bugs where background operations use the wrong workspace when the user navigates.
 */

import { prWorkflowRequested } from '$store/renderer/slices/pr-workflow/pr-workflow-slice';
import { setPendingAutoAction } from '$store/renderer/slices/changes/changes-slice';
import { store as appStore } from '$store/renderer/store';

import type { NativeSidebarReviewIntent } from '$store/renderer/slices/changes/changes-types';
import { selectNativeReviewForOwner } from '$store/renderer/slices/repository-context/repository-context-selectors';
import { nativeReviewEditRequested } from '$store/renderer/slices/repository-context/repository-context-slice';

interface CommitParams {
  workspaceId: string;
  commitMessage: string;
}

interface CommitResult {
  success: boolean;
  error?: string;
}

interface CreatePRParams {
  workspaceId: string;
  prTitle: string;
  prDescription: string;
  targetBranch?: string;
  hasStaged?: boolean;
}

interface CreatePRResult {
  success: boolean;
  error?: string;
  needsAuth?: boolean;
  prNumber?: number;
  prHtmlUrl?: string;
}

class BackgroundGitActionsService {
  /** Prepare only the captured staged commit. The root worker owns its session. */
  prepareNativeReview(intent: NativeSidebarReviewIntent): void {
    appStore.dispatch(
      nativeReviewEditRequested(intent.owner, {
        workspaceId: intent.owner.root.workspaceId,
        action: 'commit',
        review: {
          root: intent.owner.root,
          choice: { kind: 'saved' },
          targetBranch: intent.targetBranch,
          companion: { kind: 'create-pr' },
        },
      }),
    );
  }

  /** The explicit user producer queues a prepared original owner, never a write. */
  enqueueNativeReview(intent: NativeSidebarReviewIntent): boolean {
    const view = selectNativeReviewForOwner.select(appStore.state, intent.owner);
    if (view?.status !== 'ready' || !view.preview?.valid || view.observation) return false;
    appStore.dispatch(
      setPendingAutoAction(intent.owner.root.workspaceId, {
        action: 'native-review',
        workspaceId: intent.owner.root.workspaceId,
        intent,
      }),
    );
    return true;
  }

  /**
   * Commit staged changes.
   * Extracted from SidebarChangesPanel handleCommit() lines 2166-2196.
   */
  async commit(params: CommitParams): Promise<CommitResult> {
    return appStore.dispatch(
      prWorkflowRequested(params.workspaceId, {
        kind: 'commit',
        commitMessage: params.commitMessage,
      }),
    );
  }

  /**
   * Create a pull request.
   * Extracted from SidebarChangesPanel handleCreatePR() lines 2058-2153.
   *
   * NOTE: This method does NOT handle GitHub auth initialization or UI concerns.
   * Callers should check auth state beforehand and handle needsAuth in the result.
   */
  async createPR(params: CreatePRParams): Promise<CreatePRResult> {
    const { workspaceId, ...command } = params;
    return appStore.dispatch(prWorkflowRequested(workspaceId, { kind: 'create-pr', ...command }));
  }
}

// Compatibility facade for existing non-component callers. Keep the Promise and
// in-band failure contract until those callers migrate to prWorkflowRequested.
export const backgroundGitActionsService = new BackgroundGitActionsService();
