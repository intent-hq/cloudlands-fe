import { getPanelLayoutManager } from '$features/layout/panel-layout-adapter';
import { store } from '$store/renderer/store';
import {
  closeTerminalOverlay,
  openTerminalOverlay,
  selectScript,
  setTerminalPlacement,
} from '$store/renderer/slices/terminals/terminals-slice';
import { selectWorkspaceTerminalState } from '$store/renderer/slices/terminals/terminals-selectors';

/** Navigation only. openUserTab reuses the workspace/script identity, including archived definitions. */
export function openMonitoredScript(
  workspaceId: string,
  scriptId: string,
  title: string,
  placement: 'pane' | 'bottom',
): void {
  if (placement === 'bottom') {
    store.dispatch(selectScript(workspaceId, scriptId));
    store.dispatch(openTerminalOverlay(workspaceId));
    return;
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
}
