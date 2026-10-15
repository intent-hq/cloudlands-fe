import type {
  CommitHistoryPage,
  CommitHistoryPageOptions,
  CommitHistoryReaderDependencies,
} from '../commit-history-types';
import { BackendError } from './backend-transport-types';
import { parseCommitHistoryPage } from './utils/commit-history-wire';

/** Metadata-only bounded history. Errors and absent wire fields never become an empty success. */
export function createBackendCommitHistoryReader(dependencies: CommitHistoryReaderDependencies) {
  function assertCurrent() {
    if (dependencies.isCurrent && !dependencies.isCurrent()) {
      throw new BackendError({
        code: 'WORKSPACE_LOAD_ROUTE_UNAVAILABLE',
        // i18n-ignore (internal captured-route diagnostic)
        message: 'Captured commit history scope unavailable',
      });
    }
  }

  return async function readPage(
    workspaceId: string,
    options: CommitHistoryPageOptions,
  ): Promise<CommitHistoryPage> {
    assertCurrent();
    const result = await dependencies.request<unknown>('file-tracking.loadCommits', {
      workspaceId,
      includeOlder: options.includeOlder,
      limit: options.limit,
      ...(options.pageToken !== undefined ? { nextToken: options.pageToken } : {}),
    });
    assertCurrent();
    return parseCommitHistoryPage(result);
  };
}
