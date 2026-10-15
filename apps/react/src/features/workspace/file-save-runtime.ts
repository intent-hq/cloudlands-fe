import { getPrincipalSnapshot } from '../../../../../src/store/renderer/slices/principal/principal-projections';
import { store } from '@/store';
import { backendRequest } from '@/features/backend/backend-transport';
import { selectGitWriteContext } from '@/store/git/git-write-selectors';
import { selectWorkspaceById } from '@/store/workspace/workspace-selectors';
import { workspaceRelativeFilePath } from '../../../../../src/features/file/utils/workspace-file-path';
import { createFileWrite } from '$lib/client/live/backend-file-write';
import { m } from '$shared/paraglide/messages.js';
import { readGitLocks } from './git-lock-runtime';
import { captureWorkspaceWriteAuthority } from './workspace-write-authority';
import { canEditWorkspaceText } from './workspace-file-edit-policy';
import type { FilesClient } from '$lib/client/app-client';

/** This host only admits a loaded, complete text resource under the primary workspace root. */
export function captureFileSaveAuthority(workspaceId: string, path: string, absolutePath: string) {
  const context = selectGitWriteContext.select(store.state, workspaceId);
  const workspace = selectWorkspaceById.select(store.state, workspaceId);
  const root = workspace?.worktreePath || workspace?.repositoryPath;
  const relative = root ? workspaceRelativeFilePath(absolutePath, root) : null;
  if (!context || !root || relative !== path || path.startsWith('.intent/attachments/'))
    return null;
  return context;
}

export const writeWorkspaceFile: FilesClient['write'] = async (
  workspaceId,
  path,
  content,
  options,
) => {
  if (!options)
    return { success: false, outcome: 'failed', error: m.workspace_client_accessChanged_error() };
  const context = selectGitWriteContext.select(store.state, workspaceId);
  const authority = captureWorkspaceWriteAuthority(workspaceId, context ?? undefined);
  const check = () => {
    if (!authority.canDispatch() || !canEditWorkspaceText(content.content))
      throw new Error(m.workspace_client_accessChanged_error());
    if (store.state.agentLock.byWorkspaceId[workspaceId]?.lockedFilePaths[path])
      throw new Error(m.chat_changesPanel_lockedFile_tooltip());
  };
  try {
    check();
    const locks = await readGitLocks(workspaceId, authority.canDispatch);
    if (locks.lockedFilePaths[path]) throw new Error(m.chat_changesPanel_lockedFile_tooltip());
    check();
  } catch (error) {
    return {
      success: false,
      outcome: 'failed',
      error: error instanceof Error ? error.message : String(error),
    };
  }
  return createFileWrite(
    async <T>(method: string, params?: unknown, requestOptions?: { onDispatch?: () => void }) => {
      check();
      return backendRequest<T>(method, params, {
        onDispatch: () => {
          check();
          requestOptions?.onDispatch?.();
        },
      });
    },
  )(workspaceId, path, content, options);
};

/** Stable scope for receipt publication, distinct from the connection's dispatch lease. */
export function captureFilePublicationAuthority(
  workspaceId: string,
  path: string,
  absolutePath: string,
) {
  if (!captureFileSaveAuthority(workspaceId, path, absolutePath)) return null;
  const principal = getPrincipalSnapshot(store.state)?.principal;
  const workspace = selectWorkspaceById.select(store.state, workspaceId);
  return principal
    ? JSON.stringify([
        store.state.connections.windowBackendId,
        principal.id,
        principal.hostMembershipRevision,
        workspaceId,
        workspace?.worktreePath || workspace?.repositoryPath,
        path,
      ])
    : null;
}
