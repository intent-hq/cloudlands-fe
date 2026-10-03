import { CURRENT_WORKSPACE_TAB_SELECTION_ACTIONS } from '../../tab-state/tab-state-slice';
import { openAgentTabRequested, focusBrowserTabRequested } from '../../app-layout/app-layout-slice';
import * as navigation from '../../workspace-navigation/workspace-navigation-slice';
import * as panel from '../../panel-layout/panel-layout-slice';

export const workspaceSelectionTypes = new Set<string>(
  CURRENT_WORKSPACE_TAB_SELECTION_ACTIONS.map((action) => action.type),
);
// User-facing view intents, not hydration, title updates or background reconciliation.
// Observe the intent even when selecting the already active view leaves state unchanged.
const viewSelectionTypes = new Set<string>([
  openAgentTabRequested.type,
  focusBrowserTabRequested.type,
  ...[
    navigation.setWorkspaceMainPanel,
    navigation.openWorkspaceNote,
    navigation.openWorkspaceFile,
    navigation.openWorkspaceAttachment,
    navigation.openWorkspaceBrowser,
    navigation.openWorkspaceAcceptChanges,
    navigation.openWorkspaceDiff,
    navigation.openWorkspaceActivityChanges,
    navigation.openWorkspaceChatChanges,
    navigation.openWorkspaceLocalChanges,
    navigation.openWorkspaceCommitChangeset,
    navigation.openWorkspaceCodeReview,
    navigation.openWorkspaceDrawer,
    navigation.closeWorkspaceDrawer,
    panel.openTab,
    panel.openTabInRightmostColumnRequested,
    panel.openTabInRightmostColumn,
    panel.openTabInAdjacentOrSplit,
    panel.openTabInNewRootColumn,
    panel.setActiveTab,
    panel.selectNextTab,
    panel.selectPreviousTab,
    panel.focusPanel,
    panel.goBack,
    panel.goForward,
    panel.goBackInFocusHistory,
    panel.goForwardInFocusHistory,
    panel.closeTab,
    panel.closeActiveTab,
    panel.closeFocusedPanelTab,
    panel.closePanel,
    panel.closeOtherTabs,
    panel.closeTabsToRight,
    panel.closeAllTabs,
    panel.reopenClosedTab,
    panel.reopenClosedPanelColumn,
    panel.openBlankWorkingPanel,
    panel.splitPanel,
  ].map((action) => action.type),
]);
export function isViewSelection(
  action: { type: string; payload?: unknown },
  source: string,
  destination: string,
): boolean {
  if (!viewSelectionTypes.has(action.type)) return false;
  const payload = action.payload;
  // Restore's own primary-agent seed is not a newer viewer choice. Keep the
  // exception on that exact action and origin, not the entire hydration window.
  if (
    action.type === panel.openTabInAdjacentOrSplit.type &&
    payload &&
    typeof payload === 'object' &&
    'origin' in payload &&
    payload.origin === 'layout-restore'
  )
    return false;
  const workspaceId = Array.isArray(payload)
    ? payload[0]
    : payload && typeof payload === 'object' && 'wsId' in payload
      ? payload.wsId
      : undefined;
  return workspaceId === source || workspaceId === destination;
}
