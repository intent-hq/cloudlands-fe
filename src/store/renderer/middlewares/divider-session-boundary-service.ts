/**
 * Divider Session Boundary Service
 *
 * Ends latched "New messages" divider viewing sessions
 * (unreadTracking.dividerSessionByAgentId) at the three stop-looking
 * boundaries:
 *
 *   1. Chat tab close — after any action that can remove agent tabs from the
 *      panel layout, every agent with a divider session whose chat tab was
 *      open before the action and is no longer open anywhere after it gets
 *      endDividerSession. The open-tab set is diffed pre/post-action (not just
 *      checked post-action) so agents never hosted in a panel-layout tab at
 *      all — e.g. ChiefCard sidebar conversations — never cross this
 *      boundary just because an unrelated tab closed elsewhere.
 *   2. Chief-card close — ChiefCard conversations live in the sidebar card, not
 *      a panel-layout tab, so their stop-looking boundary is the card becoming
 *      invisible. Chief-card visibility is diffed pre/post any `sidebarNav/`
 *      action; on a visible → hidden transition, divider sessions for
 *      chief-workspace agents get endDividerSession. This uniformly covers
 *      closePanel, closeAll, openPanel/togglePanel switching to another item,
 *      closeHoverCards, setHoveredItem(null), setExpandedItem(null), and
 *      hydrateSidebarNav.
 *   3. Active-workspace switch — setActiveWorkspaceId to a DIFFERENT workspace,
 *      or clearActiveWorkspace (active workspace goes to null, e.g. navigating
 *      to a no-workspace view), ends the divider sessions of NON-chief agents.
 *      Chief sessions are exempt: the chief card is workspace-independent and
 *      stays visible across workspace switches, so the user never stopped
 *      looking at it.
 *
 * Deliberately NOT boundaries: same-workspace tab deactivation (setActiveTab,
 * selectNext/PreviousTab), cached panel destroy, panel focus changes,
 * re-selecting the already-active workspace, switching threads within the chief
 * card (setChiefActiveAgentId), pinning/unpinning, panel width changes, and
 * transient hover flicker while the panel keeps the chief card visible.
 *
 * Boundary detection seam: `onBoundary` fires once per detected boundary with
 * the agent ids whose sessions ended, so a follow-up can hook agent.markSeen
 * into the same detection point without re-deriving it.
 *
 * Dependency-light per src/store/renderer AGENTS.md: no module-scope selector
 * imports; reads state via api.getState().
 */

import type { StoreMiddleware } from "$lib/store-shim/types";
import { CHIEF_WORKSPACE_ID } from "$shared/types/branded-ids";
import type { StoreState } from "../types";
import { endDividerSession } from "../slices/unread-tracking/unread-tracking-slice";
import { setActiveWorkspaceId, clearActiveWorkspace } from "../slices/workspace/workspace-slice";
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
  | { kind: "chief-card-close"; agentIds: string[] }
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

/**
 * Whether the ChiefCard is currently rendered: either the sidebar panel shows
 * the chief item, or the chief item's hover card is up (an expanded item wins
 * over a merely hovered one, matching selectVisibleHoverCardItem).
 */
function isChiefCardVisible(state: StoreState): boolean {
  const nav = state.sidebarNav;
  if (!nav) return false;
  if (nav.panelItem === "chief") return true;
  return (nav.expandedItem ?? nav.hoveredItem) === "chief";
}

/** Divider-session agent ids that belong to the chief virtual workspace. */
function collectChiefSessionAgentIds(state: StoreState): string[] {
  const sessionAgentIds = Object.keys(state.unreadTracking?.dividerSessionByAgentId ?? {});
  if (sessionAgentIds.length === 0) return [];
  const chiefAgentIds = new Set(
    state.agentSessions?.agentIdsByWorkspace?.[CHIEF_WORKSPACE_ID] ?? [],
  );
  return sessionAgentIds.filter((agentId) => chiefAgentIds.has(agentId));
}

/** Prefix of every action that can change chief-card visibility. */
const SIDEBAR_NAV_ACTION_PREFIX = "sidebarNav/";

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
      const isTabRemovalTrigger = TAB_REMOVAL_TRIGGER_ACTIONS.has(action.type);
      const isSidebarNavAction = action.type.startsWith(SIDEBAR_NAV_ACTION_PREFIX);
      const preOpenAgentIds = isTabRemovalTrigger
        ? collectOpenAgentTabIds(api.getState() as StoreState)
        : null;
      const preChiefCardVisible = isSidebarNavAction
        ? isChiefCardVisible(api.getState() as StoreState)
        : false;

      const result = next(action);

      if (action.type === setActiveWorkspaceId.type || action.type === clearActiveWorkspace.type) {
        const state = api.getState() as StoreState;
        const nextWorkspaceId = state.workspace?.activeWorkspaceId ?? null;
        if (nextWorkspaceId === previousActiveWorkspaceId) return result;
        const previousWorkspaceId = previousActiveWorkspaceId;
        previousActiveWorkspaceId = nextWorkspaceId;

        // Chief-hosted sessions survive workspace switches — the chief card is
        // workspace-independent and stays visible, so the user kept looking.
        const chiefAgentIds = new Set(collectChiefSessionAgentIds(state));
        const agentIds = Object.keys(state.unreadTracking?.dividerSessionByAgentId ?? {}).filter(
          (agentId) => !chiefAgentIds.has(agentId),
        );
        if (agentIds.length === 0) return result;
        for (const agentId of agentIds) {
          api.dispatch(endDividerSession(agentId));
        }
        options.onBoundary?.({
          kind: "workspace-switch",
          agentIds,
          previousWorkspaceId,
          nextWorkspaceId,
        });
        return result;
      }

      if (isSidebarNavAction) {
        if (!preChiefCardVisible) return result;
        const state = api.getState() as StoreState;
        if (isChiefCardVisible(state)) return result;

        const agentIds = collectChiefSessionAgentIds(state);
        if (agentIds.length === 0) return result;
        for (const agentId of agentIds) {
          api.dispatch(endDividerSession(agentId));
        }
        options.onBoundary?.({ kind: "chief-card-close", agentIds });
        return result;
      }

      if (!isTabRemovalTrigger || preOpenAgentIds === null) return result;

      const state = api.getState() as StoreState;
      const sessionAgentIds = Object.keys(state.unreadTracking?.dividerSessionByAgentId ?? {});
      if (sessionAgentIds.length === 0) return result;

      const postOpenAgentIds = collectOpenAgentTabIds(state);
      // Only agents whose tab was open before this action AND is gone after it
      // crossed the boundary — agents never hosted in a panel-layout tab (e.g.
      // ChiefCard) were never in preOpenAgentIds, so they're excluded here.
      const closedAgentIds = sessionAgentIds.filter(
        (agentId) => preOpenAgentIds.has(agentId) && !postOpenAgentIds.has(agentId),
      );
      if (closedAgentIds.length === 0) return result;

      for (const agentId of closedAgentIds) {
        api.dispatch(endDividerSession(agentId));
      }
      options.onBoundary?.({ kind: "tab-close", agentIds: closedAgentIds });
      return result;
    };
  };
}
