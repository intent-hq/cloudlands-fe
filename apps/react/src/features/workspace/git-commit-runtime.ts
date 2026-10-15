import { createBackendGitCommitClient } from '$lib/client/live/backend-git-commit-client';
import { createBackendGitReadRuntime } from '$lib/client/live/backend-git-read-runtime';
import type { GitWriteOperation } from '../../../../../src/store/renderer/slices/git/git-write-types';
import { m } from '$shared/paraglide/messages.js';
import { backendRequest } from '@/features/backend/backend-transport';
import { store } from '@/store';
import { selectGitCommitAuthorityKey } from '@/store/git/git-commit-selectors';
import { captureGitWriteAuthority } from './git-write-runtime';
import { readGitLocks } from './git-lock-runtime';
import { parseWorkspaceFileTarget } from './workspace-file-target';

/** Current index only: rereads fence this app's intent, not external Git processes. */
export function prepareGitCommitWrite(
  workspaceId: string,
  operation: GitWriteOperation,
  canExecute: () => boolean,
) {
  if (
    operation.kind !== 'commit' ||
    !operation.params.currentIndex ||
    operation.params.files !== undefined ||
    !operation.params.userRequested ||
    operation.params.amend ||
    !operation.params.message.trim()
  )
    throw new Error(m.acceptChanges_backgroundGit_commitMessageRequired_error());
  const authority = captureGitWriteAuthority(workspaceId, operation);
  const check = () => {
    if (
      !canExecute() ||
      !authority.canDispatch() ||
      operation.authorityKey !== selectGitCommitAuthorityKey.select(store.state, workspaceId)
    )
      throw new Error(m.workspace_client_accessChanged_error());
  };
  return async () => {
    try {
      check();
      const reads = createBackendGitReadRuntime({
        request: async <T>(method: string, params: Record<string, unknown>) => {
          check();
          return backendRequest<T>(method, params, { onDispatch: check });
        },
      });
      const status = await reads.status(workspaceId, { forceRefresh: true });
      check();
      if (!status) throw new Error(m.fileExplorer_layout_loadFailed_error());
      const paths = [
        ...new Set(status.files.filter((file) => file.staged).map((file) => file.path)),
      ].sort();
      if (!paths.length) throw new Error(m.workspace_commitDrawer_noStaged_tooltip());
      if (
        paths.some((path) => !parseWorkspaceFileTarget(path).valid) ||
        JSON.stringify(paths) !== JSON.stringify(operation.reviewedPaths)
      )
        throw new Error(m.workspace_localCommit_changed_error());
      const locks = await readGitLocks(workspaceId, () => canExecute() && authority.canDispatch());
      const checkLocks = () => {
        check();
        if (
          paths.some(
            (path) =>
              locks.lockedFilePaths[path] ||
              store.state.agentLock.byWorkspaceId[workspaceId]?.lockedFilePaths[path],
          )
        )
          throw new Error(m.chat_changesPanel_lockedFile_tooltip());
      };
      checkLocks();
      const client = createBackendGitCommitClient(
        async <T>(method: string, params?: unknown, options?: { onDispatch?: () => void }) => {
          checkLocks();
          return backendRequest<T>(method, params, {
            onDispatch: () => {
              checkLocks();
              options?.onDispatch?.();
            },
          });
        },
      );
      return client.commit(workspaceId, operation.params);
    } catch (error) {
      // All throwing work above precedes the commit client, which owns dispatch uncertainty.
      return {
        success: false,
        error: error instanceof Error ? error.message : m.workspace_client_accessChanged_error(),
      };
    }
  };
}
