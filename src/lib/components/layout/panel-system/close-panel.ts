import type { PanelLayoutAdapter } from '$features/layout/panel-layout-adapter';

type ClosablePanelLayout = Pick<PanelLayoutAdapter, 'getPanelIds' | 'closePanel' | 'clearLayout'>;

export function closePanelWithLastPanelPolicy(
  layoutManager: ClosablePanelLayout,
  panelId: string,
  allowCloseLastPanel: boolean,
): void {
  if (allowCloseLastPanel && layoutManager.getPanelIds().length <= 1) {
    layoutManager.clearLayout();
    return;
  }

  layoutManager.closePanel(panelId);
}
