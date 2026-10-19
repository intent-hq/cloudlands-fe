import { confirm } from '$lib/components/patterns/confirm';
import { notify } from '$lib/components/patterns/notify';
import { selectWorkspaceActionContext } from '$store/renderer/slices/workspace/workspace-selectors';
import { store } from '$store/renderer/store';
import {
  selectCanDeleteScript,
  selectScriptById,
} from '$store/renderer/slices/scripts/scripts-selectors';
import { deleteScriptRequested } from '$store/renderer/slices/scripts/scripts-slice';
import { m } from '$shared/paraglide/messages.js';

/** Both script surfaces use the same confirmation and revalidate after the dialog. */
export async function confirmScriptDeletion(
  workspaceId: string,
  scriptId: string,
  isCurrent: () => boolean,
): Promise<void> {
  const script = selectScriptById.select(store.state, workspaceId, scriptId);
  if (!script || !isCurrent() || !selectCanDeleteScript.select(store.state, workspaceId, scriptId))
    return;
  const authority = selectWorkspaceActionContext.select(store.state, workspaceId);
  if (!authority) {
    notify.error(m.workspace_client_accessChanged_error());
    return;
  }
  if (
    !(await confirm({
      title: m.scripts_delete_title({ name: script.name }),
      description: m.scripts_delete_description(),
      confirmLabel: m.scripts_delete_label(),
      destructive: true,
    }))
  )
    return;
  if (authority !== selectWorkspaceActionContext.select(store.state, workspaceId)) {
    notify.error(m.workspace_client_accessChanged_error());
    return;
  }
  const current = selectScriptById.select(store.state, workspaceId, scriptId);
  if (
    !isCurrent() ||
    !current ||
    current.createdAt !== script.createdAt ||
    current.name !== script.name ||
    !selectCanDeleteScript.select(store.state, workspaceId, scriptId)
  ) {
    notify.error(m.scripts_delete_changed_error());
    return;
  }
  store.dispatch(
    deleteScriptRequested(
      workspaceId,
      scriptId,
      m.terminal_quakeOverlay_deleteScriptFailed_error(),
    ),
  );
}
