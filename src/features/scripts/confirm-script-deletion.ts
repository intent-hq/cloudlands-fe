import { confirm } from '$lib/components/patterns/confirm';
import { notify } from '$lib/components/patterns/notify';
import { selectWorkspaceActionContext } from '$store/renderer/slices/workspace/workspace-selectors';
import { store } from '$store/renderer/store';
import {
  selectCanDeleteScript,
  selectScriptById,
} from '$store/renderer/slices/scripts/scripts-selectors';
import { deleteScriptRequested } from '$store/renderer/slices/scripts/scripts-slice';
import { selectScriptMonitors } from '$store/renderer/slices/script-monitor/script-monitor-selectors';
import { isLiveScriptStatus } from '$features/scripts/utils/script-status';
import { m } from '$shared/paraglide/messages.js';

function deletionDescription(workspaceId: string, scriptId: string, live: boolean): string {
  if (!live) return m.scripts_delete_description();
  const monitored = selectScriptMonitors
    .select(store.state, workspaceId)
    .monitors.some((row) => row.scriptId === scriptId && row.state === 'active');
  return monitored
    ? m.scripts_delete_runningMonitored_description()
    : m.scripts_delete_running_description();
}

/**
 * Every script surface uses the same confirmation and revalidates after the dialog.
 * The daemon stops a live script before removing it, which settles its monitors.
 */
export async function confirmScriptDeletion(
  workspaceId: string,
  scriptId: string,
  isCurrent: () => boolean,
): Promise<void> {
  const script = selectScriptById.select(store.state, workspaceId, scriptId);
  if (!script || !isCurrent() || !selectCanDeleteScript.select(store.state, workspaceId, scriptId))
    return;
  const live = isLiveScriptStatus(script.runtime?.status);
  const authority = selectWorkspaceActionContext.select(store.state, workspaceId);
  if (!authority) {
    notify.error(m.workspace_client_accessChanged_error());
    return;
  }
  if (
    !(await confirm({
      title: m.scripts_delete_title({ name: script.name }),
      description: deletionDescription(workspaceId, scriptId, live),
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
    (!live && isLiveScriptStatus(current.runtime?.status)) ||
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
