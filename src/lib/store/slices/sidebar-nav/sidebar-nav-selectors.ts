/**
 * Sidebar Nav Selectors
 */

import { createSelector } from "../../utils/create-selector";
import type { SidebarNavItem } from "./sidebar-nav-types";

// ── Direct state selectors ──
export const selectActiveStreamsVersion = createSelector(
  (state) => state.sidebarNav.activeStreamsVersion,
);

export const selectUnreadVersion = createSelector(
  (state) => state.sidebarNav.unreadVersion,
);

export const selectHoveredItem = createSelector(
  (state) => state.sidebarNav.hoveredItem,
);

export const selectExpandedItem = createSelector(
  (state) => state.sidebarNav.expandedItem,
);

export const selectIsCardPinned = createSelector(
  (state) => state.sidebarNav.isCardPinned,
);

export const selectPanelItem = createSelector(
  (state) => state.sidebarNav.panelItem,
);

export const selectPanelWidth = createSelector(
  (state) => state.sidebarNav.panelWidth,
);

export const selectOnboardingActive = createSelector(
  (state) => state.sidebarNav.onboardingActive,
);

export const selectDraftPrompt = createSelector(
  (state) => state.sidebarNav.draftPrompt,
);

export const selectAllSpacesViewMode = createSelector(
  (state) => state.sidebarNav.allSpacesViewMode,
);

export const selectPinnedWorkspaceIds = createSelector(
  (state) => state.sidebarNav.pinnedWorkspaceIds,
);

// ── Derived selectors ──

/** The active visible card (either hovered or expanded) */
export const selectActiveCard = createSelector(
  (state): SidebarNavItem | null => {
    const { expandedItem, hoveredItem } = state.sidebarNav;
    return expandedItem ?? hoveredItem;
  },
);

/** Whether any hover card is visible */
export const selectIsCardVisible = createSelector(
  (state) => selectActiveCard.select(state) !== null,
);

/** Whether a sidebar panel is currently open */
export const selectIsPanelOpen = createSelector(
  (state) => state.sidebarNav.panelItem !== null,
);

/** Check if a specific workspace is pinned */
export const selectIsWorkspacePinned = createSelector(
  (state, id: string) => state.sidebarNav.pinnedWorkspaceIds.includes(id),
);

/** Whether any context menu is open (prevents hover card auto-close) */
export const selectContextMenuOpen = createSelector(
  (state) => state.sidebarNav.contextMenuOpenCount > 0,
);

/** The deferred leave type when context menu prevented auto-close */
export const selectDeferredLeave = createSelector(
  (state) => state.sidebarNav.deferredLeave,
);

