import { getPanelLayoutManager } from '$features/layout/panel-layout-adapter';
import { createLogger } from '$lib/utils/client-logger';
import { openAndShowWorkspace } from '$lib/utils/show-workspace';
import { currentRoutePath, parseWorkspaceRoute } from '$lib/utils/workspace-route-path';
import { CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';
import { store } from '$store/renderer/store';
import {
  closeTerminalOverlay,
  openTerminalOverlay,
  selectScript,
  setTerminalPlacement,
} from '$store/renderer/slices/terminals/terminals-slice';
import { selectWorkspaceTerminalState } from '$store/renderer/slices/terminals/terminals-selectors';

const logger = createLogger('OpenMonitoredScript');

const isShowingWorkspace = (workspaceId: string): boolean => {
  const path = currentRoutePath();
  return path !== null && parseWorkspaceRoute(path) === workspaceId;
};

/**
 * Bring the script's workspace on screen first: the menu also lives in the Home
 * preview, where opening a panel tab or the bottom bar of a hidden workspace
 * looked like a no-op. The Assistant has no workspace page, so it stays in place.
 */
async function showOwningWorkspace(workspaceId: string): Promise<boolean> {
  if (workspaceId === CHIEF_WORKSPACE_ID || isShowingWorkspace(workspaceId)) return true;
  try {
    await openAndShowWorkspace(workspaceId);
  } catch (error) {
    logger.warn('Monitored script workspace navigation failed', { workspaceId, error });
    return false;
  }
  // An overtaken or skipped jump must not open the script in a hidden workspace.
  return isShowingWorkspace(workspaceId);
}

/**
 * Navigation only. openUserTab reuses the workspace/script identity, including archived
 * definitions. Resolves false when the workspace could not be shown, so nothing opened.
 */
export async function openMonitoredScript(
  workspaceId: string,
  scriptId: string,
  title: string,
  placement: 'pane' | 'bottom',
): Promise<boolean> {
  if (!(await showOwningWorkspace(workspaceId))) return false;
  if (placement === 'bottom') {
    store.dispatch(selectScript(workspaceId, scriptId));
    store.dispatch(openTerminalOverlay(workspaceId));
    return true;
  }
  getPanelLayoutManager(workspaceId).openUserTab({
    type: 'terminal',
    title,
    scriptId,
    workspaceId,
    closable: true,
  });
  store.dispatch(setTerminalPlacement(workspaceId, scriptId, 'panel'));
  const state = selectWorkspaceTerminalState.select(store.state, workspaceId);
  if (state.isOpen && state.selectedScriptId === scriptId)
    store.dispatch(closeTerminalOverlay(workspaceId));
  return true;
}
