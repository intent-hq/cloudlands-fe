/**
 * Background Git Actions Service
 *
 * Encapsulates commit and PR creation logic extracted from SidebarChangesPanel.svelte.
 * This service accepts explicit workspace IDs to avoid reactive prop dependencies,
 * preventing bugs where background operations use the wrong workspace when the user navigates.
 */

import { AcceptChangesClient } from './accept-changes.client';
import { commit as commitViaSeam } from '$features/git/git-write-service';
import { loadGitStatus } from '$store/renderer/slices/git/git-slice';
import { refreshRequested } from '$store/renderer/slices/changes/changes-slice';
import type { WorkspaceId } from '$shared/types/branded-ids';
import { PullRequestStatus } from '$shared/types';
import { createLogger } from '$lib/utils/client-logger';
import { m } from '$shared/paraglide/messages.js';
import { updateWorkspaceEntity } from '$store/renderer/slices/workspace/workspace-slice';
import { store as appStore } from '$store/renderer/store';

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
      return { success: false, error: m.acceptChanges_backgroundGit_commitMessageRequired_error() };
    }

    try {
      // Commit of already-staged changes routes through the AppClient seam
      // (git.commit). userRequested:true — the user clicked Commit; the live
      // client attaches the idempotencyKey.
      const result = await commitViaSeam(workspaceId, {
        message: commitMessage.trim(),
        userRequested: true,
      });

      if (result.success) {
        // Refresh file-tracking stores to update UI (the seam already reconciled
        // git status). TODO: drop these once file-tracking moves off legacy IPC.
        try {
          appStore.dispatch(loadGitStatus(workspaceId, true));
          appStore.dispatch(refreshRequested(workspaceId, true));
        } catch (refreshError) {
          // Refresh failed but commit succeeded - UI will update on next refresh
          logger.warn('Store refresh failed after commit', { refreshError });
        }
        return { success: true };
      } else {
        return {
          success: false,
          error: result.error || m.acceptChanges_backgroundGit_commitFailed_error(),
        };
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : m.acceptChanges_backgroundGit_commitFailed_error();
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
      return { success: false, error: m.acceptChanges_backgroundGit_prTitleRequired_error() };
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
          return {
            success: false,
            error: commitResult.error || m.acceptChanges_backgroundGit_commitStagedFailed_error(),
          };
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
          appStore.dispatch(
            updateWorkspaceEntity(workspaceId, {
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
            }),
          );
        }

        // Fire-and-forget refresh: let UI update reactively
        appStore.dispatch(loadGitStatus(workspaceId, true));
        appStore.dispatch(refreshRequested(workspaceId, true));

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
        return {
          success: false,
          error: result.error || m.acceptChanges_backgroundGit_createPrFailed_error(),
        };
      }
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : m.acceptChanges_backgroundGit_createPrFailed_error();
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
