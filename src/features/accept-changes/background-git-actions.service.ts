/**
 * Background Git Actions Service
 *
 * Encapsulates commit and PR creation logic extracted from SidebarChangesPanel.svelte.
 * This service accepts explicit workspace IDs to avoid reactive prop dependencies,
 * preventing bugs where background operations use the wrong workspace when the user navigates.
 */

import { AcceptChangesClient } from './accept-changes.client';
import { loadGitStatus } from '$lib/store/slices/git/git-slice';
import { refreshRequested } from '$lib/store/slices/file-tracking/file-tracking-slice';
import type { WorkspaceId } from '$shared/types/branded-ids';
import { PullRequestStatus } from '$shared/types';
import { createLogger } from '$lib/utils/client-logger';
import { getReduxStore } from '$lib/store/redux-dispatch-bridge';
import { updateWorkspaceEntity } from '$lib/store/slices/workspace/workspace-slice';

const logger = createLogger('BackgroundGitActionsService');

export interface CommitParams {
  workspaceId: string;
  commitMessage: string;
}

export interface CommitResult {
  success: boolean;
  error?: string;
}

export interface CreatePRParams {
  workspaceId: string;
  prTitle: string;
  prDescription: string;
  targetBranch?: string;
  hasStaged?: boolean;
}

export interface CreatePRResult {
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
    const { workspaceId, commitMessage } = params;

    if (!commitMessage.trim()) {
      return { success: false, error: 'Commit message is required' };
    }

    try {
      const result = await AcceptChangesClient.execute(workspaceId as WorkspaceId, 'commit', {
        commitMessage: commitMessage.trim(),
      });

      if (result.success) {
        // Refresh stores to update UI
        try {
          getReduxStore().dispatch(loadGitStatus(workspaceId, true));
          getReduxStore().dispatch(refreshRequested(workspaceId));
        } catch (refreshError) {
          // Refresh failed but commit succeeded - UI will update on next refresh
          logger.warn('Store refresh failed after commit', { refreshError });
        }
        return { success: true };
      } else {
        return { success: false, error: result.error || 'Failed to commit' };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to commit';
      logger.error('Commit failed', error as Error);
      return { success: false, error: message };
    }
  }

  /**
   * Create a pull request.
   * Extracted from SidebarChangesPanel handleCreatePR() lines 2058-2153.
   *
   * NOTE: This method does NOT handle GitHub auth initialization or UI concerns.
   * Callers should check auth state beforehand and handle needsAuth in the result.
   */
  async createPR(params: CreatePRParams): Promise<CreatePRResult> {
    const { workspaceId, prTitle, prDescription, targetBranch, hasStaged } = params;

    if (!prTitle.trim()) {
      return { success: false, error: 'PR title is required' };
    }

    try {
      // If there are staged changes, commit them first using the PR title as commit message
      if (hasStaged) {
        const commitResult = await AcceptChangesClient.execute(
          workspaceId as WorkspaceId,
          'commit',
          { commitMessage: prTitle.trim() },
        );
        if (!commitResult.success) {
          return { success: false, error: commitResult.error || 'Failed to commit staged changes' };
        }
      }

      // Create the pull request
      const result = await AcceptChangesClient.execute(workspaceId as WorkspaceId, 'create-pr', {
        prTitle: prTitle.trim(),
        prBody: prDescription.trim(),
        targetBranch,
      });

      if (result.success) {
        // Update local workspace store with PR info from result
        if (result.result?.prNumber && result.result?.prHtmlUrl) {
          getReduxStore().dispatch(updateWorkspaceEntity(workspaceId, {
            activePullRequest: {
              id: String(result.result.prNumber),
              number: result.result.prNumber,
              url: result.result.prHtmlUrl,
              title: prTitle.trim(),
              status: PullRequestStatus.Open,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
            prUrl: result.result.prHtmlUrl,
            prNumber: result.result.prNumber,
            prStatus: PullRequestStatus.Open,
          }));
        }

        // Fire-and-forget refresh: let UI update reactively
        getReduxStore().dispatch(loadGitStatus(workspaceId, true));
        getReduxStore().dispatch(refreshRequested(workspaceId));

        return {
          success: true,
          prNumber: result.result?.prNumber,
          prHtmlUrl: result.result?.prHtmlUrl,
        };
      } else {
        // Check for GitHub authentication error
        if (result.error?.toLowerCase().includes('github authentication')) {
          return { success: false, needsAuth: true };
        }
        return { success: false, error: result.error || 'Failed to create pull request' };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create pull request';
      logger.error('Create PR failed', error as Error);

      // Check for GitHub authentication error in exception
      if (message.toLowerCase().includes('github authentication')) {
        return { success: false, needsAuth: true };
      }
      return { success: false, error: message };
    }
  }
}

export const backgroundGitActionsService = new BackgroundGitActionsService();

