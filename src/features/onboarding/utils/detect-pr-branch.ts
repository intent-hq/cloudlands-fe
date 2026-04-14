/**
 * Detect PR branch information from context mentions in the onboarding prompt.
 *
 * Parses GitHub issue/PR mentions to extract or fetch the source branch so
 * the workspace can be branched off the PR's head.
 */

import { createLogger } from '$lib/utils/client-logger';

const logger = createLogger('detect-pr-branch');

interface ContextMention {
  itemType?: string;
  provider?: string;
  identifier?: string;
  metadata?: string;
}

export interface PRBranchResult {
  branch: string;
  prNumber: number | null;
}

/**
 * Synchronously check context mentions for a PR that already has branch info embedded.
 */
export function findEmbeddedPRBranch(mentions: ContextMention[]): PRBranchResult | null {
  const prWithBranch = mentions.find((mention) => {
    if (mention.itemType !== 'github-issue' && mention.itemType !== 'github-pr') return false;
    try {
      const metadata = mention.metadata ? JSON.parse(mention.metadata) : null;
      return metadata?.sourceBranch && metadata.sourceBranch.length > 0;
    } catch {
      return false;
    }
  });

  if (!prWithBranch) return null;

  try {
    const metadata = prWithBranch.metadata ? JSON.parse(prWithBranch.metadata) : null;
    if (metadata?.sourceBranch) {
      const prNumMatch = prWithBranch.identifier?.match(/#(\d+)$/);
      return {
        branch: metadata.sourceBranch,
        prNumber: prNumMatch ? parseInt(prNumMatch[1], 10) : null,
      };
    }
  } catch {
    // Ignore parse errors
  }

  return null;
}

/**
 * Check whether any GitHub PR/issue mentions exist (even without branch info).
 */
export function hasGitHubPRMention(mentions: ContextMention[]): boolean {
  return mentions.some(
    (mention) =>
      (mention.itemType === 'github-issue' || mention.itemType === 'github-pr') &&
      mention.provider === 'github',
  );
}

/**
 * Find a GitHub PR mention that needs branch info fetched via API.
 * Returns the parsed owner/repo/number, or null if none found.
 */
export function findPRNeedingBranchFetch(
  mentions: ContextMention[],
  lastFetchedIdentifier: string | null,
): { owner: string; repo: string; number: number; identifier: string } | null {
  const prWithoutBranch = mentions.find((mention) => {
    if (mention.itemType !== 'github-issue' && mention.itemType !== 'github-pr') return false;
    if (mention.provider !== 'github') return false;
    try {
      const metadata = mention.metadata ? JSON.parse(mention.metadata) : null;
      return !metadata?.sourceBranch || metadata.sourceBranch.length === 0;
    } catch {
      return true;
    }
  });

  if (!prWithoutBranch || prWithoutBranch.identifier === lastFetchedIdentifier) return null;

  const match = prWithoutBranch.identifier?.match(/^([^/]+)\/([^#]+)#(\d+)$/);
  if (!match) {
    logger.debug('Could not parse PR identifier', { identifier: prWithoutBranch.identifier });
    return null;
  }

  const [, owner, repo, numberStr] = match;
  return {
    owner,
    repo,
    number: parseInt(numberStr, 10),
    identifier: prWithoutBranch.identifier!,
  };
}
