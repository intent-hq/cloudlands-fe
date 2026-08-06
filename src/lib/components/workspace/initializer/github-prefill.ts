/**
 * Resolves a pending GitHub issue/PR prefill (set by the chat link action menu)
 * into the selection shape consumed by the initializer's issue-select path
 * (`handleIssueSelect` → `insertContextMention` with itemType `github-issue`).
 *
 * PRs fetch branch info via the existing `git-tracking:get-pull-request` IPC
 * (mirroring IssueSuggestions' handleGitHubPRClick) so source-branch
 * auto-linking works; fetch failures degrade to a minimal mention
 * (identifier + URL). Issues have no single-fetch IPC and always resolve to
 * the minimal mention.
 */
import { invoke } from '$shared/generated/ipc-client';
import { isElectronPlatform } from '$lib/utils/platform-capabilities';
import { createLogger } from '$lib/utils/client-logger';
import type { WorkspaceInitializerPendingGitHubPrefill } from '$store/renderer/slices/workspace-initializer/workspace-initializer-types';

const logger = createLogger('GitHubPrefill');

/**
 * Structurally compatible with IssueSuggestions' `IssueSelectionData`
 * (declared locally so plain-TS consumers don't import types from a .svelte file).
 */
export interface GitHubPrefillSelection {
  type: 'github';
  identifier: string;
  title: string;
  url: string;
  metadata?: {
    state?: string;
    sourceBranch?: string;
    targetBranch?: string;
    project?: string;
  };
}

interface PullRequestDetailsResponse {
  success?: boolean;
  data?: {
    number?: number;
    title?: string;
    state?: string;
    url?: string;
    sourceBranch?: string;
    targetBranch?: string;
  };
}

export async function resolveGitHubPrefillSelection(
  prefill: WorkspaceInitializerPendingGitHubPrefill,
): Promise<GitHubPrefillSelection> {
  const { owner, repo, number, kind, url } = prefill;
  const identifier = `${owner}/${repo}#${number}`;
  const minimal: GitHubPrefillSelection = {
    type: 'github',
    identifier,
    title: `#${number}`,
    url,
    metadata: { project: `${owner}/${repo}` },
  };

  if (kind !== 'pr' || !isElectronPlatform()) {
    return minimal;
  }

  try {
    const response = await invoke<PullRequestDetailsResponse>('git-tracking:get-pull-request', {
      owner,
      repo,
      number,
    });
    if (response?.success && response.data) {
      const { title, state, sourceBranch, targetBranch } = response.data;
      return {
        type: 'github',
        identifier,
        title: title || minimal.title,
        url,
        metadata: {
          state,
          sourceBranch,
          targetBranch,
          project: `${owner}/${repo}`,
        },
      };
    }
    logger.warn('PR details fetch unsuccessful; degrading to minimal mention', { identifier });
  } catch (error) {
    logger.warn('Failed to fetch PR details; degrading to minimal mention', { identifier, error });
  }
  return minimal;
}
