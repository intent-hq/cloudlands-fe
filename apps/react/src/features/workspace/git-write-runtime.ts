import { captureWorkspaceWriteAuthority } from './workspace-write-authority';
import { createBackendGitStageClient } from '$lib/client/live/backend-git-stage-client';
import type { GitWriteOperation } from '../../../../../src/store/renderer/slices/git/git-write-types';
import { m } from '$shared/paraglide/messages.js';
import { backendRequest } from '@/features/backend/backend-transport';
import { store } from '@/store';
import { parseWorkspaceFileTarget } from './workspace-file-target';
import { readGitLocks } from './git-lock-runtime';

export function captureGitWriteAuthority(workspaceId: string, operation: GitWriteOperation) {
  return captureWorkspaceWriteAuthority(workspaceId, operation.admissionContext);
}

/** This host admits exactly one explicit primary-root file; source transport policy is shared. */
export function prepareGitFileWrite(workspaceId: string, operation: GitWriteOperation) {
  if (
    (operation.kind !== 'stage' && operation.kind !== 'unstage') ||
    operation.paths.length !== 1 ||
    !parseWorkspaceFileTarget(operation.paths[0]).valid ||
    operation.paths[0].trim() !== operation.paths[0]
  )
    throw new Error(m.workspace_client_accessChanged_error());
  const { kind, paths } = operation;
  const authority = captureGitWriteAuthority(workspaceId, operation);
  const check = () => {
    if (!authority.canDispatch()) throw new Error(m.workspace_client_accessChanged_error());
    const locks = store.state.agentLock.byWorkspaceId[workspaceId];
    if (locks?.lockedFilePaths[paths[0]]) throw new Error(m.chat_changesPanel_lockedFile_tooltip());
  };
  return async () => {
    check();
    const locks = await readGitLocks(workspaceId, authority.canDispatch);
    if (locks.lockedFilePaths[paths[0]]) throw new Error(m.chat_changesPanel_lockedFile_tooltip());
    check();
    const client = createBackendGitStageClient(async <T>(method: string, params?: unknown) => {
      check();
      return backendRequest<T>(method, params, { onDispatch: check });
    });
    return client[kind](workspaceId, paths);
  };
}
