import { appClient } from '$lib/client';
import { createLogger } from '$lib/utils/client-logger';
import { sessionBaseBranch } from './utils/session-import-match';

const logger = createLogger('session-base-branch');

/**
 * The base branch for an imported session in `repoRoot`: its last `gitBranch`
 * when that branch still exists there, else null (keep the form default).
 */
export async function resolveSessionBaseBranch(
  repoRoot: string,
  gitBranch: string | undefined,
): Promise<string | null> {
  if (!gitBranch?.trim()) return null;
  try {
    const listing = await appClient.git.getBranches(repoRoot, true);
    return sessionBaseBranch(gitBranch, listing);
  } catch (error) {
    logger.debug('Could not list branches for the imported session', error);
    return null;
  }
}
