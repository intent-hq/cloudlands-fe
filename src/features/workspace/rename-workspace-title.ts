import type { Workspace } from '$shared/types';
import { m } from '$shared/paraglide/messages.js';
import { store as appStore } from '$store/renderer/store';
import { renameWorkspaceTitleRequested } from '$store/renderer/slices/workspace/workspace-slice';
import type { RenameWorkspaceTitleResult } from '$store/renderer/slices/workspace/workspace-types';
export type { RenameWorkspaceTitleResult } from '$store/renderer/slices/workspace/workspace-types';

let nextWorkspaceTitleMutationToken = 0;

/** Compatibility entrypoint for the two Svelte title surfaces until they retire. */
export async function renameWorkspaceTitle(
  workspace: Workspace,
  title: string,
): Promise<RenameWorkspaceTitleResult> {
  const action = renameWorkspaceTitleRequested({
    workspaceId: workspace.id,
    title,
    previousTitle: workspace.title,
    token: ++nextWorkspaceTitleMutationToken,
  });
  appStore.dispatch(action);
  // Existing source callers consume a result object, including owner shutdown.
  return action.promise.catch(() => ({
    ok: false,
    error: m.ui_reversibleActions_cancelled_message(),
  }));
}
