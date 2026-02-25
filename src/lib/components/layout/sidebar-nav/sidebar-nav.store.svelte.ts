/**
 * Sidebar Nav Store
 *
 * Manages state for the global sidebar navigation rail.
 * Tracks which item is hovered, which card is open, which panel is open,
 * pinned workspaces, and preserves draft content for the "New Workspace" card.
 */

export type SidebarNavItem = 'home' | 'new-workspace' | 'active' | 'all-workspaces' | 'settings';
export type AllSpacesViewMode = 'recent' | 'repo' | 'status';

const PINNED_WORKSPACES_KEY = 'intent:pinned-workspaces';
const VIEW_MODE_KEY = 'intent:all-spaces-view-mode';
const PANEL_WIDTH_KEY = 'intent:sidebar-panel-width';
const PANEL_ITEM_KEY = 'intent:sidebar-panel-item';

function loadPinnedWorkspaces(): string[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const stored = localStorage.getItem(PINNED_WORKSPACES_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function savePinnedWorkspaces(ids: string[]) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(PINNED_WORKSPACES_KEY, JSON.stringify(ids));
  } catch {
    // localStorage may be full or unavailable
  }
}

class SidebarNavStore {
  /** Currently hovered nav item (shows hover card) */
  hoveredItem = $state<SidebarNavItem | null>(null);

  /** Currently "pinned" open item (clicked to expand hover card) */
  expandedItem = $state<SidebarNavItem | null>(null);

  /** Currently open sidebar panel (persistent, pushes content) */
  panelItem = $state<SidebarNavItem | null>(
    (typeof localStorage !== 'undefined'
      ? (localStorage.getItem(PANEL_ITEM_KEY) as SidebarNavItem | null)
      : null) || null,
  );

  /** Panel width in pixels (persisted) */
  panelWidth = $state<number>(
    (typeof localStorage !== 'undefined' ? Number(localStorage.getItem(PANEL_WIDTH_KEY)) : 0) ||
      288,
  );

  /** Draft prompt text preserved for the new workspace card */
  draftPrompt = $state('');

  /** Persisted view mode for All Spaces card */
  allSpacesViewMode = $state<AllSpacesViewMode>(
    (typeof localStorage !== 'undefined'
      ? (localStorage.getItem(VIEW_MODE_KEY) as AllSpacesViewMode)
      : null) || 'recent',
  );

  /** Pinned workspace IDs (persisted to localStorage) */
  #pinnedWorkspaceIds = $state<string[]>(loadPinnedWorkspaces());

  /** Hover delay timeout */
  #hoverTimeout: ReturnType<typeof setTimeout> | null = null;
  #leaveTimeout: ReturnType<typeof setTimeout> | null = null;

  /** The active visible card (either hovered or expanded) */
  get activeCard(): SidebarNavItem | null {
    return this.expandedItem ?? this.hoveredItem;
  }

  /** Whether any hover card is visible */
  get isCardVisible(): boolean {
    return this.activeCard !== null;
  }

  /** Whether a sidebar panel is currently open */
  get isPanelOpen(): boolean {
    return this.panelItem !== null;
  }

  /** List of pinned workspace IDs */
  get pinnedIds(): string[] {
    return this.#pinnedWorkspaceIds;
  }

  // ── Hover card methods ──

  handleMouseEnter(item: SidebarNavItem) {
    if (this.#leaveTimeout) {
      clearTimeout(this.#leaveTimeout);
      this.#leaveTimeout = null;
    }
    if (this.#hoverTimeout) {
      clearTimeout(this.#hoverTimeout);
    }

    // If an expanded item is open, switch immediately
    if (this.expandedItem) {
      this.hoveredItem = item;
      return;
    }

    // Home and settings don't have hover cards — skip
    if (item === 'home' || item === 'settings') return;

    // Otherwise delay hover card appearance
    this.#hoverTimeout = setTimeout(() => {
      this.hoveredItem = item;
    }, 120);
  }

  handleMouseLeave() {
    if (this.#hoverTimeout) {
      clearTimeout(this.#hoverTimeout);
      this.#hoverTimeout = null;
    }

    this.#leaveTimeout = setTimeout(() => {
      this.hoveredItem = null;
      // Don't clear expandedItem on mouse leave - it stays until clicked elsewhere
    }, 200);
  }

  handleCardMouseEnter() {
    if (this.#leaveTimeout) {
      clearTimeout(this.#leaveTimeout);
      this.#leaveTimeout = null;
    }
  }

  handleCardMouseLeave() {
    this.#leaveTimeout = setTimeout(() => {
      this.hoveredItem = null;
      this.expandedItem = null;
    }, 200);
  }

  /** Toggle expanded state for an item */
  toggleExpanded(item: SidebarNavItem) {
    if (this.expandedItem === item) {
      this.expandedItem = null;
    } else {
      this.expandedItem = item;
    }
  }

  /** Close only hover cards (not the panel) */
  closeHoverCards() {
    this.hoveredItem = null;
    this.expandedItem = null;
    if (this.#hoverTimeout) {
      clearTimeout(this.#hoverTimeout);
      this.#hoverTimeout = null;
    }
    if (this.#leaveTimeout) {
      clearTimeout(this.#leaveTimeout);
      this.#leaveTimeout = null;
    }
  }

  // ── Panel methods ──

  openPanel(item: SidebarNavItem) {
    this.closeHoverCards();
    this.panelItem = item;
    this.#persistPanel(item);
  }

  closePanel() {
    this.panelItem = null;
    this.#persistPanel(null);
  }

  togglePanel(item: SidebarNavItem) {
    if (this.panelItem === item) {
      this.closePanel();
    } else {
      this.openPanel(item);
    }
  }

  setPanelWidth(width: number) {
    this.panelWidth = width;
    try {
      localStorage.setItem(PANEL_WIDTH_KEY, String(width));
    } catch {
      // localStorage may be full or unavailable
    }
  }

  #persistPanel(item: SidebarNavItem | null) {
    try {
      if (item) {
        localStorage.setItem(PANEL_ITEM_KEY, item);
      } else {
        localStorage.removeItem(PANEL_ITEM_KEY);
      }
    } catch {
      // localStorage may be full or unavailable
    }
  }

  // ── Pinned workspaces ──

  pinWorkspace(id: string) {
    if (!this.#pinnedWorkspaceIds.includes(id)) {
      this.#pinnedWorkspaceIds = [...this.#pinnedWorkspaceIds, id];
      savePinnedWorkspaces(this.#pinnedWorkspaceIds);
    }
  }

  unpinWorkspace(id: string) {
    this.#pinnedWorkspaceIds = this.#pinnedWorkspaceIds.filter((wid) => wid !== id);
    savePinnedWorkspaces(this.#pinnedWorkspaceIds);
  }

  togglePinWorkspace(id: string) {
    if (this.isPinned(id)) {
      this.unpinWorkspace(id);
    } else {
      this.pinWorkspace(id);
    }
  }

  isPinned(id: string): boolean {
    return this.#pinnedWorkspaceIds.includes(id);
  }

  // ── View mode ──

  setAllSpacesViewMode(mode: AllSpacesViewMode) {
    this.allSpacesViewMode = mode;
    try {
      localStorage.setItem(VIEW_MODE_KEY, mode);
    } catch {
      // localStorage may be full or unavailable
    }
  }

  // ── General ──

  /** Close everything (hover cards + panel) */
  closeAll() {
    this.closeHoverCards();
    this.panelItem = null;
    this.#persistPanel(null);
  }
}

export const sidebarNavStore = new SidebarNavStore();
