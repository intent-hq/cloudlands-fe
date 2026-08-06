/**
 * Divider Session Boundary Service
 *
 * Ends latched "New messages" divider viewing sessions
 * (unreadTracking.dividerSessionByAgentId) at the two stop-looking boundaries:
 *
 *   1. Chat tab close — after any action that can remove agent tabs from the
 *      panel layout, every agent with a divider session whose chat tab is no
 *      longer open anywhere gets endDividerSession.
 *   2. Active-workspace switch — setActiveWorkspaceId to a DIFFERENT workspace
 *      ends every divider session (endAllDividerSessions).
 *
 * Deliberately NOT boundaries: same-workspace tab deactivation (setActiveTab,
 * selectNext/PreviousTab), cached panel destroy, panel focus changes, or
 * re-selecting the already-active workspace.
 *
 * Boundary detection seam: `onBoundary` fires once per detected boundary with
 * the agent ids whose sessions ended, so a follow-up can hook agent.markSeen
 * into the same detection point without re-deriving it.
 *
 * Dependency-light per src/store/renderer AGENTS.md: no module-scope selector
 * imports; reads state via api.getState().
 */

import type { StoreMiddleware } from "$lib/store-shim/types";
import type { StoreState } from "../types";
import {
  endDividerSession,
  endAllDividerSessions,
} from "../slices/unread-tracking/unread-tracking-slice";
import { setActiveWorkspaceId } from "../slices/workspace/workspace-slice";
import {
  initializeLayout,
  applyPreset,
  createGridLayout,
  closeTab,
  closeActiveTab,
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
  clearPanelLayout,
} from "../slices/panel-layout/panel-layout-slice";

// ============================================================================
// Types
// ============================================================================

/** A detected stop-looking boundary; `agentIds` are the sessions that ended. */
export type DividerSessionBoundary =
  | { kind: "tab-close"; agentIds: string[] }
  | {
      kind: "workspace-switch";
      agentIds: string[];
      previousWorkspaceId: string | null;
      nextWorkspaceId: string | null;
    };

export type DividerSessionBoundaryOptions = {
  /** Seam for follow-ups (e.g. agent.markSeen) at the same detection point. */
  onBoundary?: (boundary: DividerSessionBoundary) => void;
};

// ============================================================================
// Helpers
// ============================================================================

/** Agent ids with an agent chat tab open in ANY workspace's panel layout. */
function collectOpenAgentTabIds(state: StoreState): Set<string> {
  const openAgentIds = new Set<string>();
  for (const ws of Object.values(state.panelLayout?.byWorkspaceId ?? {})) {
    for (const panel of Object.values(ws?.panels ?? {})) {
      for (const tab of panel.tabs) {
        if (tab.type === "agent" && typeof tab.agentId === "string" && tab.agentId.length > 0) {
          openAgentIds.add(tab.agentId);
        }
      }
    }
  }
  return openAgentIds;
}

// Actions that can REMOVE agent tabs from the panel layout. Additions and
// same-workspace activation changes are intentionally excluded — they are not
// stop-looking boundaries.
const TAB_REMOVAL_TRIGGER_ACTIONS = new Set<string>([
  initializeLayout.type,
  applyPreset.type,
  createGridLayout.type,
  closeTab.type,
  closeActiveTab.type,
  closeTabsByType.type,
  closeTabsByAgentId.type,
  moveTabToPanel.type,
  moveTabToSplit.type,
  moveTabToSplitLevel.type,
  closeOtherTabs.type,
  closeTabsToRight.type,
  closeAllTabs.type,
  closeAllOthersEverywhere.type,
  closePanel.type,
  resetLayout.type,
  goBack.type,
  goForward.type,
  reconcileStaleAgentTabs.type,
  clearPanelLayout.type,
]);

// ============================================================================
// Middleware
// ============================================================================

export function createDividerSessionBoundaryService(
  options: DividerSessionBoundaryOptions = {},
): StoreMiddleware {
  return (api) => {
    let previousActiveWorkspaceId: string | null =
      (api.getState() as StoreState).workspace?.activeWorkspaceId ?? null;

    return (next) => (action) => {
      const result = next(action);

      if (action.type === setActiveWorkspaceId.type) {
        const state = api.getState() as StoreState;
        const nextWorkspaceId = state.workspace?.activeWorkspaceId ?? null;
        if (nextWorkspaceId === previousActiveWorkspaceId) return result;
        const previousWorkspaceId = previousActiveWorkspaceId;
        previousActiveWorkspaceId = nextWorkspaceId;

        const agentIds = Object.keys(state.unreadTracking?.dividerSessionByAgentId ?? {});
        if (agentIds.length === 0) return result;
        api.dispatch(endAllDividerSessions());
        options.onBoundary?.({
          kind: "workspace-switch",
          agentIds,
          previousWorkspaceId,
          nextWorkspaceId,
        });
        return result;
      }

      if (!TAB_REMOVAL_TRIGGER_ACTIONS.has(action.type)) return result;

      const state = api.getState() as StoreState;
      const sessionAgentIds = Object.keys(state.unreadTracking?.dividerSessionByAgentId ?? {});
      if (sessionAgentIds.length === 0) return result;

      const openAgentIds = collectOpenAgentTabIds(state);
      const closedAgentIds = sessionAgentIds.filter((agentId) => !openAgentIds.has(agentId));
      if (closedAgentIds.length === 0) return result;

      for (const agentId of closedAgentIds) {
        api.dispatch(endDividerSession(agentId));
      }
      options.onBoundary?.({ kind: "tab-close", agentIds: closedAgentIds });
      return result;
    };
  };
}
