/**
 * Background Git Actions Service
 *
 * Encapsulates commit and PR creation logic extracted from SidebarChangesPanel.svelte.
 * This service accepts explicit workspace IDs to avoid reactive prop dependencies,
 * preventing bugs where background operations use the wrong workspace when the user navigates.
 */

import { prWorkflowRequested } from '$store/renderer/slices/pr-workflow/pr-workflow-slice';
import { store as appStore } from '$store/renderer/store';

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
