import { getItems } from '@themislib/themis/utils/collections/collection-utils';
import { visibleRecentAgents, type RecentEntry } from '$shared/recent-agents';
import { resolveShortcut } from '$shared/keyboard-shortcut-bindings';
import { store } from '../../store';
import type { StoreState } from '../../types';
import type { PanelTab } from '../panel-layout/panel-layout-types';

/**
 * The entries the switcher offers: entries of connections that are still saved (a forgotten
 * device or ended guest session drops out), less this machine's browser and terminal tabs that
 * a restored layout no longer holds. Before the connection list loads, every saved entry.
 */
export const selectRecentAgents = store.createSelector((state): RecentEntry[] => {
  const local = state.connections.windowBackendId;
  const entries = getItems(state.recentAgents.entries)
    .map(({ key: _key, ...entry }) => entry as RecentEntry)
    .filter((entry) => {
      if (entry.kind === 'agent' || entry.connectionId !== local) return true;
      const layout = state.panelLayout.byWorkspaceId[entry.workspaceId];
      if (layout?.restoreStatus !== 'restored' && layout?.restoreStatus !== 'empty') return true;
      const tabs = [
        ...Object.values(layout.panels).flatMap((panel) => panel.tabs),
        ...(layout.hiddenTabs ? getItems(layout.hiddenTabs) : []),
      ];
      return tabs.some((tab) => tab.id === entry.tabId);
    });
  if (!state.connections.hasReceivedList) return entries;
  const saved = new Set<string>([
    state.connections.windowBackendId,
    ...getItems(state.connections.connections)
      .filter((connection) => !connection.displayOnly)
      .map((connection) => connection.id),
    ...getItems(state.guestSessions.sessions).map((session) => session.id),
  ]);
  return visibleRecentAgents(entries, saved);
});

interface ShownPanelTab {
  workspaceId: string;
  panelId: string;
  tab: PanelTab;
}

function shownPanelTab(state: StoreState): ShownPanelTab | null {
  const workspaceId = state.tabState.currentTabId;
  if (!workspaceId) return null;
  const layout = state.panelLayout.byWorkspaceId[workspaceId];
  const panelId = layout?.focusedPanelId;
  const panel = panelId ? layout.panels[panelId] : undefined;
  const tab = panel?.tabs.find((candidate) => candidate.id === panel.activeTabId);
  return panelId && tab ? { workspaceId, panelId, tab } : null;
}

/** The focused panel tab of the workspace this window shows. */
export const selectShownPanelTab = store.createSelector(
  (state): PanelTab | null => shownPanelTab(state)?.tab ?? null,
);

/**
 * {@link selectShownPanelTab} as `workspace/panel/tab`, or null. A string, so the selector
 * channel emits only when focus moves.
 */
export const selectShownPanelTabKey = store.createSelector((state): string | null => {
  const shown = shownPanelTab(state);
  return shown ? `${shown.workspaceId}/${shown.panelId}/${shown.tab.id}` : null;
});

/** The switcher's effective binding (the user's, else this platform's default). */
export const selectRecentAgentsBinding = store.createSelector((state): string =>
  resolveShortcut('navigation.recent-agents', state.userPreferences?.shortcutOverrides ?? {}),
);
