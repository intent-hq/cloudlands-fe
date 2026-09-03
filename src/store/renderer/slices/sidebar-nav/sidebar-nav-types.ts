/**
 * Sidebar Nav Types
 *
 * Types for the sidebar navigation Redux slice.
 * Safe to import from any process (renderer, main, shared, preload).
 */

export const CHIEF_WORKSPACE_ID = '__chief__';
// i18n-ignore (sentinel compared against daemon-stored names; localizing would break placeholder detection)
export const DEFAULT_CHIEF_THREAD_TITLE = 'New chat with Intent';

export type SidebarNavItem =
  'new-workspace' | 'active' | 'chief' | 'all-workspaces' | 'hud' | 'stats' | 'settings';
export type AllSpacesViewMode = 'recent' | 'repo' | 'status';

/** Panel items that render the combined workspace list and Chief chat. */
const COMBINED_WORKSPACE_PANEL_ITEMS: readonly SidebarNavItem[] = ['chief', 'all-workspaces'];

export function isCombinedWorkspacePanelItem(item: SidebarNavItem): boolean {
  return COMBINED_WORKSPACE_PANEL_ITEMS.includes(item);
}

export type ChiefThreadPreview = {
  agentId: string;
  title: string;
  preview: string;
  updatedAt?: string;
  isActive: boolean;
  messageCount: number;
};

export type SidebarNavState = {
  /** Bumped whenever active stream tracking data changes */
  activeStreamsVersion: number;
  /** Bumped whenever unread-tracking data changes */
  unreadVersion: number;
  /** Currently hovered nav item (shows hover card) */
  hoveredItem: SidebarNavItem | null;
  /** Currently "pinned" open item (clicked to expand hover card) */
  expandedItem: SidebarNavItem | null;
  /** Whether the expanded card is pinned open (won't close on mouse leave) */
  isCardPinned: boolean;
  /** Currently open sidebar panel (persistent, pushes content) */
  panelItem: SidebarNavItem | null;
  /** Panel width in pixels (persisted) */
  panelWidth: number;
  /** Fraction of combined panel height given to the workspace list (persisted) */
  combinedPanelSplit: number;
  /** Whether provider onboarding is active (hides sidebar nav) */
  onboardingActive: boolean;
  /** Whether the compact workspace creation modal is open */
  showCreateModal: boolean;
  /** Draft prompt text preserved for the new workspace card */
  draftPrompt: string;
  /** Persisted view mode for All Spaces card */
  allSpacesViewMode: AllSpacesViewMode;
  /** Whether archived workspaces are included in the All Spaces list (persisted) */
  showArchivedWorkspaces: boolean;
  /** Collapsed All Spaces status-group IDs (persisted) */
  collapsedStatusGroupIds: string[];
  /** Whether the Chief of Staff section in the combined panel is collapsed (persisted) */
  isChiefCollapsed: boolean;
  /** Pinned workspace IDs (persisted to localStorage) */
  pinnedWorkspaceIds: string[];
  /** Global workspace sidebar tab order (persisted) */
  multiSelectTabOrder: string[];
  /** Selected workspace sidebar tabs by workspace ID (persisted) */
  multiSelectSelectedTabIdsByWorkspaceId: Record<string, string[]>;
  /** Custom note ordering by workspace ID (persisted) */
  noteOrderByWorkspaceId: Record<string, string[]>;
  /** Collapsed note IDs by workspace ID (persisted) */
  collapsedNoteIdsByWorkspaceId: Record<string, string[]>;
  /** Persisted current Chief of Staff thread. */
  chiefActiveAgentId: string | null;
  /** Counter for open context menus (prevents hover card auto-close) */
  contextMenuOpenCount: number;
  /** Deferred leave type when context menu prevented auto-close */
  deferredLeave: 'card' | 'nav' | null;
  /** Whether the full-screen usage-stats overlay is open */
  statsOverlayOpen: boolean;
};
