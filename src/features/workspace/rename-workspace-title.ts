import type { Workspace } from '$shared/types';
import { logger } from '$lib/utils/client-logger';
import { m } from '$shared/paraglide/messages.js';
import { store as appStore } from '$store/renderer/store';
import {
  beginWorkspaceTitleMutation,
  completeWorkspaceTitleMutation,
  failWorkspaceTitleMutation,
} from '$store/renderer/slices/workspace/workspace-slice';
import { workspaceClient } from '$store/renderer/slices/workspace/utils/workspace.client';

export type RenameWorkspaceTitleResult = { ok: true } | { ok: false; error: string };

let nextWorkspaceTitleMutationToken = 0;

async function showRenameError(message: string): Promise<void> {
  try {
    const { toast } = await import('svelte-sonner');
    toast.error(message);
  } catch (error) {
    logger.error('Failed to surface workspace rename error', error);
  }
}

function failureMessage(error?: string): string {
  return error?.trim() || m.workspace_client_updateFailed_error();
}

async function handleFailure(
  workspaceId: string,
  token: number,
  error: string,
): Promise<RenameWorkspaceTitleResult> {
  if (appStore.state.workspace.pendingTitleMutations[workspaceId]?.token !== token) {
    return { ok: false, error };
  }
  appStore.dispatch(failWorkspaceTitleMutation(workspaceId, token));
  await showRenameError(error);
  return { ok: false, error };
}

export async function renameWorkspaceTitle(
  workspace: Workspace,
  title: string,
): Promise<RenameWorkspaceTitleResult> {
  const token = ++nextWorkspaceTitleMutationToken;
  appStore.dispatch(beginWorkspaceTitleMutation(workspace.id, token, title, workspace.title));

  try {
    const result = await workspaceClient.update({ id: workspace.id, title });
    if (result.ok) {
      appStore.dispatch(completeWorkspaceTitleMutation(workspace.id, token, result.data));
      return { ok: true };
    }
    return handleFailure(workspace.id, token, failureMessage(result.error));
  } catch (error) {
    logger.error('Failed to rename workspace', { workspaceId: workspace.id, error });
    return handleFailure(workspace.id, token, failureMessage());
  }
}
