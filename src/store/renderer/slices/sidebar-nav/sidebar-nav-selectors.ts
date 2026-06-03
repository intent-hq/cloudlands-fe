/**
 * Sidebar Nav Selectors
 */

import { store } from "../../store";
import type { SidebarNavItem } from "./sidebar-nav-types";

// ── Direct state selectors ──
export const selectActiveStreamsVersion = store.createSelector(
  (state) => state.sidebarNav.activeStreamsVersion,
);

export const selectUnreadVersion = store.createSelector(
  (state) => state.sidebarNav.unreadVersion,
);

export const selectHoveredItem = store.createSelector(
  (state) => state.sidebarNav.hoveredItem,
);

export const selectExpandedItem = store.createSelector(
  (state) => state.sidebarNav.expandedItem,
);

export const selectIsCardPinned = store.createSelector(
  (state) => state.sidebarNav.isCardPinned,
);

export const selectPanelItem = store.createSelector(
  (state) => state.sidebarNav.panelItem,
);

export const selectPanelWidth = store.createSelector(
  (state) => state.sidebarNav.panelWidth,
);

export const selectOnboardingActive = store.createSelector(
  (state) => state.sidebarNav.onboardingActive,
);

export const selectShowCreateModal = store.createSelector(
  (state) => state.sidebarNav.showCreateModal,
);

export const selectDraftPrompt = store.createSelector(
  (state) => state.sidebarNav.draftPrompt,
);

export const selectAllSpacesViewMode = store.createSelector(
  (state) => state.sidebarNav.allSpacesViewMode,
);

export const selectPinnedWorkspaceIds = store.createSelector(
  (state) => state.sidebarNav.pinnedWorkspaceIds,
);

export const selectMultiSelectSidebarTabOrder = store.createSelector(
  (state): string[] => state.sidebarNav.multiSelectTabOrder,
);

export const selectMultiSelectSidebarSelectedTabIds = store.createSelector(
  (state, workspaceId: string): string[] =>
    state.sidebarNav.multiSelectSelectedTabIdsByWorkspaceId[workspaceId] ?? ["overview"],
);

export const selectWorkspaceNoteOrder = store.createSelector(
  (state, workspaceId: string): string[] => state.sidebarNav.noteOrderByWorkspaceId[workspaceId] ?? [],
);

export const selectWorkspaceCollapsedNoteIds = store.createSelector(
  (state, workspaceId: string): string[] => state.sidebarNav.collapsedNoteIdsByWorkspaceId[workspaceId] ?? [],
);

// ── Derived selectors ──

/** The active visible card (either hovered or expanded) */
export const selectActiveCard = store.createSelector(
  (state): SidebarNavItem | null => {
    const { expandedItem, hoveredItem } = state.sidebarNav;
    return expandedItem ?? hoveredItem;
  },
);

/** Whether any hover card is visible */
export const selectIsCardVisible = store.createSelector(
  (state) => selectActiveCard.select(state) !== null,
);

/** Whether a sidebar panel is currently open */
export const selectIsPanelOpen = store.createSelector(
  (state) => state.sidebarNav.panelItem !== null,
);

/** Check if a specific workspace is pinned */
export const selectIsWorkspacePinned = store.createSelector(
  (state, id: string) => state.sidebarNav.pinnedWorkspaceIds.includes(id),
);

/** Whether any context menu is open (prevents hover card auto-close) */
export const selectContextMenuOpen = store.createSelector(
  (state) => state.sidebarNav.contextMenuOpenCount > 0,
);

/** The deferred leave type when context menu prevented auto-close */
export const selectDeferredLeave = store.createSelector(
  (state) => state.sidebarNav.deferredLeave,
);

