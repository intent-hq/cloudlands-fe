import type { PanelState, PanelTab } from '$store/renderer/slices/panel-layout/panel-layout-types';

export interface BrowserTabEntry {
  tab: PanelTab;
  /** Panel hosting the tab; undefined for hidden (user-closed) tabs. */
  panelId?: string;
  active: boolean;
  hidden: boolean;
}

/** Visible tabs in panel order, followed by the agent's hidden tabs. */
export function getBrowserTabEntries(
  panels: Record<string, PanelState>,
  hiddenTabs: PanelTab[],
  agentId: string,
): BrowserTabEntry[] {
  return [
    ...Object.values(panels).flatMap((panel) =>
      panel.tabs
        .filter((tab) => tab.type === 'browser' && tab.ownerAgentId === agentId)
        .map((tab) => ({
          tab,
          panelId: panel.id,
          active: panel.activeTabId === tab.id,
          hidden: false,
        })),
    ),
    ...hiddenTabs
      .filter((tab) => tab.type === 'browser' && tab.ownerAgentId === agentId)
      .map((tab) => ({ tab, active: false, hidden: true })),
  ];
}
