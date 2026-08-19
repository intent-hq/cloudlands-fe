import type { PanelLayoutAdapter } from '$features/layout/panel-layout-adapter';

type ClosablePanelLayout = Pick<
  PanelLayoutAdapter,
  'getPanelIds' | 'closePanel' | 'closeAllTabs' | 'clearLayout'
>;

export function closePanelWithLastPanelPolicy(
  layoutManager: ClosablePanelLayout,
  panelId: string,
  allowCloseLastPanel: boolean,
): void {
  if (layoutManager.getPanelIds().length <= 1) {
    if (allowCloseLastPanel) layoutManager.clearLayout();
    else layoutManager.closeAllTabs(panelId);
    return;
  }

  layoutManager.closePanel(panelId);
}
