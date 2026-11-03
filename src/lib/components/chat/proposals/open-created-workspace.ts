import { notify } from '$lib/components/patterns/notify';
import { claimNavigation, openAndShowWorkspace } from '$lib/utils/show-workspace';
import { m } from '$shared/paraglide/messages.js';
import { WorkspaceId } from '$shared/types/branded-ids';
import { workspaceClient } from '$store/renderer/slices/workspace/utils/workspace.client';
import { selectWorkspaceById } from '$store/renderer/slices/workspace/workspace-selectors';
import { setWorkspaceEntity } from '$store/renderer/slices/workspace/workspace-slice';
import { store as appStore } from '$store/renderer/store';

/**
 * Open the workspace an applied workspace-create card created. A workspace
 * this window has not loaded yet (created by the agent, another client, or
 * before a restart) is fetched first; one that no longer exists shows an
 * error toast instead of navigating to a dead route. Archived workspaces
 * open normally and show their own archived banner. A navigation made while
 * the lookup is pending wins: the late lookup then opens nothing.
 */
export async function openCreatedWorkspace(workspaceId: string): Promise<boolean> {
  if (!selectWorkspaceById.select(appStore.state, workspaceId)) {
    const ownsNavigation = claimNavigation();
    let error: string;
    try {
      const result = await workspaceClient.open(WorkspaceId(workspaceId));
      if (result.ok) {
        appStore.dispatch(setWorkspaceEntity(result.data));
        if (!ownsNavigation()) return false;
        await openAndShowWorkspace(workspaceId);
        return true;
      }
      error = result.error;
    } catch (thrown) {
      error = thrown instanceof Error ? thrown.message : String(thrown);
    }
    notify.error(m.chat_proposalCard_createdWorkspaceMissing_error(), { description: error });
    return false;
  }
  await openAndShowWorkspace(workspaceId);
  return true;
}
