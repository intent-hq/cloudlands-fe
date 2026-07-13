/**
 * Accept Changes Service (local remnant)
 *
 * The accept-changes git/forge orchestration (status, prepare, execute,
 * merge-PR, add-remote) lives in the intentd daemon and is reached from the
 * renderer via `backendRequest('accept-changes.*')` (PROTOCOL.md §5.18).
 *
 * This service retains only `checkPathHasChanges`: a local filesystem probe
 * of an arbitrary path (not a daemon-managed workspace), which must run in
 * the Electron main process.
 */

import { execAsync } from '../../../shared/git/git-env';
import { Logger } from '../../../shared/logger';

const logger = new Logger('AcceptChangesService');

export class AcceptChangesService {
  /**
   * Check if a path has uncommitted git changes
   */
  async checkPathHasChanges(
    targetPath: string,
  ): Promise<{ hasChanges: boolean; isGitRepo: boolean }> {
    try {
      const { stdout: isGitRepo } = await execAsync('git rev-parse --is-inside-work-tree', {
        cwd: targetPath,
      });
      if (isGitRepo.trim() !== 'true') {
        return { hasChanges: false, isGitRepo: false };
      }

      const { stdout: statusOutput } = await execAsync('git status --porcelain', {
        cwd: targetPath,
      });
      return {
        hasChanges: statusOutput.trim().length > 0,
        isGitRepo: true,
      };
    } catch (e) {
      // Not a git repo or git not available
      logger.debug('Path is not a git repository or git check failed', { targetPath, error: e });
      return { hasChanges: false, isGitRepo: false };
    }
  }
}
