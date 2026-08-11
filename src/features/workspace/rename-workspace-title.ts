import type { Workspace } from '$shared/types';
import { logger } from '$lib/utils/client-logger';
import { m } from '$shared/paraglide/messages.js';
import { store as appStore } from '$store/renderer/store';
import {
  bulkUpdateWorkspaceEntities,
  setWorkspaceEntity,
  updateWorkspaceEntity,
} from '$store/renderer/slices/workspace/workspace-slice';
import { workspaceClient } from '$store/renderer/slices/workspace/utils/workspace.client';
import {
  acknowledgeWorkspaceTitleMutation,
  beginWorkspaceTitleMutation,
  failWorkspaceTitleMutation,
} from './workspace-title-mutation-registry';

export type RenameWorkspaceTitleResult = { ok: true } | { ok: false; error: string };

function patchWorkspaceTitle(workspaceId: string, title: string): void {
  appStore.dispatch(bulkUpdateWorkspaceEntities([updateWorkspaceEntity(workspaceId, { title })]));
}

function readWorkspaceTitle(workspaceId: string): string | undefined {
  const state = appStore.state as
    { workspace?: { workspaces?: { map?: Record<string, Workspace> } } } | undefined;
  return state?.workspace?.workspaces?.map?.[workspaceId]?.title;
}

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
  const failure = failWorkspaceTitleMutation(workspaceId, token);
  if (!failure) return { ok: false, error };

  const currentTitle = readWorkspaceTitle(workspaceId);
  if (currentTitle === undefined || currentTitle === failure.optimisticTitle) {
    patchWorkspaceTitle(workspaceId, failure.previousTitle);
  }
  await showRenameError(error);
  return { ok: false, error };
}

export async function renameWorkspaceTitle(
  workspace: Workspace,
  title: string,
): Promise<RenameWorkspaceTitleResult> {
  const token = beginWorkspaceTitleMutation(workspace.id, title, workspace.title);
  patchWorkspaceTitle(workspace.id, title);

  try {
    const result = await workspaceClient.update({ id: workspace.id, title });
    if (result.ok) {
      if (acknowledgeWorkspaceTitleMutation(workspace.id, token, result.data.title)) {
        appStore.dispatch(setWorkspaceEntity(result.data));
      }
      return { ok: true };
    }
    return handleFailure(workspace.id, token, failureMessage(result.error));
  } catch (error) {
    logger.error('Failed to rename workspace', { workspaceId: workspace.id, error });
    return handleFailure(workspace.id, token, failureMessage());
  }
}
