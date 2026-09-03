import {
  applyPreset,
  clearPanelLayout,
  closeActiveTab,
  closeFocusedPanelTab,
  closeAllOthersEverywhere,
  closeAllTabs,
  closeOtherTabs,
  closePanel,
  closeTab,
  closeTabsByAgentId,
  closeTabsByType,
  closeTabsToRight,
  consumePendingFocus,
  createGridLayout,
  focusPanel,
  goBack,
  goBackInFocusHistory,
  goForward,
  goForwardInFocusHistory,
  initializeLayout,
  loadLayoutHistory,
  moveTabToPanel,
  moveTabToSplit,
  moveTabToSplitLevel,
  openTab,
  openTabInAdjacentOrSplit,
  pruneRecentlyClosed,
  reconcileStaleAgentTabs,
  reopenClosedPanelColumn,
  reopenClosedTab,
  reorderTabs,
  resetLayout,
  selectNextTab,
  selectPreviousTab,
  setActiveTab,
  setDeferSpecTab,
  setRestoreStatus,
  splitPanel,
  toggleExpandPanel,
  updateFileTabPath,
  updateSizes,
  updateSplitSizes,
  updateTabBrowserUrl,
  updateTabFavicon,
  updateTabTitle,
} from './panel-layout-slice';
import { removeScript } from '../scripts/scripts-slice';
import { removeTerminal } from '../terminals/terminals-slice';

export const TAB_REMOVAL_ACTIONS = [
  initializeLayout,
  applyPreset,
  createGridLayout,
  closeTab,
  closeActiveTab,
  closeFocusedPanelTab,
  closeTabsByType,
  closeTabsByAgentId,
  moveTabToPanel,
  moveTabToSplit,
  moveTabToSplitLevel,
  closeOtherTabs,
  closeTabsToRight,
  closeAllTabs,
  closeAllOthersEverywhere,
  closePanel,
  resetLayout,
  goBack,
  goForward,
  reconcileStaleAgentTabs,
  removeScript,
  clearPanelLayout,
];

const TAB_REMOVAL_ACTION_TYPES = new Set(TAB_REMOVAL_ACTIONS.map((action) => action.type));

/** Concrete actions handled by the panel-layout reducer, used to retain prior-state identity. */
export const PANEL_LAYOUT_STATE_ACTIONS = [
  setRestoreStatus,
  loadLayoutHistory,
  openTab,
  pruneRecentlyClosed,
  removeTerminal,
  reopenClosedPanelColumn,
  reopenClosedTab,
  setActiveTab,
  selectNextTab,
  selectPreviousTab,
  reorderTabs,
  updateTabTitle,
  updateTabBrowserUrl,
  updateTabFavicon,
  updateFileTabPath,
  focusPanel,
  splitPanel,
  updateSizes,
  updateSplitSizes,
  toggleExpandPanel,
  goBackInFocusHistory,
  goForwardInFocusHistory,
  setDeferSpecTab,
  consumePendingFocus,
  openTabInAdjacentOrSplit,
  ...TAB_REMOVAL_ACTIONS,
];

export function isTabRemovalAction(action: { type: string }): boolean {
  return TAB_REMOVAL_ACTION_TYPES.has(action.type);
}

export function getPanelLayoutActionWorkspaceId(action: { payload?: unknown }): string | undefined {
  const payload = action.payload;
  if (typeof payload === 'string') return payload;
  if (Array.isArray(payload) && typeof payload[0] === 'string') return payload[0];
  if (
    payload &&
    typeof payload === 'object' &&
    'wsId' in payload &&
    typeof payload.wsId === 'string'
  ) {
    return payload.wsId;
  }
  return undefined;
}
