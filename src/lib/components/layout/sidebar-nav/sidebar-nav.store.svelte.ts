/**
 * Sidebar Nav Store
 *
 * Manages state for the global sidebar navigation rail.
 * Tracks which item is hovered, which card is open, which panel is open,
 * pinned workspaces, and preserves draft content for the "New Workspace" card.
 *
 * Also centralizes reactive tracking for active streams and unread state
 * so that the badge count and hover card always derive from the same source.
 */

import { activeStreamsTracker } from '$features/agent/services/active-streams-tracker';
import { unreadTrackingService } from '$features/agent/services/unread-tracking.service';

export type SidebarNavItem = 'home' | 'new-workspace' | 'active' | 'all-workspaces' | 'settings';
export type AllSpacesViewMode = 'recent' | 'repo' | 'status';

const PINNED_WORKSPACES_KEY = 'intent:pinned-workspaces';
const VIEW_MODE_KEY = 'intent:all-spaces-view-mode';
const PANEL_WIDTH_KEY = 'intent:sidebar-panel-width';
const PANEL_ITEM_KEY = 'intent:sidebar-panel-item';
const CARD_PINNED_KEY = 'intent:sidebar-card-pinned';

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
  // ── Reactive tracking for active streams & unread state ──
  // Centralized here so that the badge count and hover card always
  // derive from the same version counters (no mount-timing drift).

  /** Bumped whenever active-streams data changes */
  activeStreamsVersion = $state(0);

  /** Bumped whenever unread-tracking data changes */
  unreadVersion = $state(0);

  /** Whether subscriptions have been initialised */
  #subscriptionsInitialized = false;

  /**
   * Idempotent — call from any component that needs reactive stream/unread
   * data.  Sets up listeners on the first call and is a no-op thereafter.
   */
  initSubscriptions(): void {
    if (this.#subscriptionsInitialized) return;
    this.#subscriptionsInitialized = true;

    activeStreamsTracker.startPolling(2000);
    activeStreamsTracker.subscribe(() => this.activeStreamsVersion++);
    unreadTrackingService.subscribe(() => this.unreadVersion++);
  }

  /** Currently hovered nav item (shows hover card) */
  hoveredItem = $state<SidebarNavItem | null>(null);

  /** Currently "pinned" open item (clicked to expand hover card) */
  expandedItem = $state<SidebarNavItem | null>(null);

  /** Whether the expanded card is pinned open (won't close on mouse leave) */
  isCardPinned = $state(
    typeof localStorage !== 'undefined' ? localStorage.getItem(CARD_PINNED_KEY) === 'true' : false,
  );

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

  /** Whether provider onboarding is active (hides sidebar nav) */
  onboardingActive = $state(false);

  /** Draft prompt text preserved for the new workspace card */
  draftPrompt = $state('');

  /** Whether a context menu is open inside the hover card (prevents auto-close) */
  #contextMenuOpenCount = $state(0);

  get contextMenuOpen(): boolean {
    return this.#contextMenuOpenCount > 0;
  }

  incrementContextMenuOpen() {
    this.#contextMenuOpenCount++;
  }

  decrementContextMenuOpen() {
    this.#contextMenuOpenCount = Math.max(0, this.#contextMenuOpenCount - 1);
  }

  /** Track which leave was deferred: 'card' | 'nav' | null */
  #deferredLeave: 'card' | 'nav' | null = null;

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
    // Cancel any deferred leave — pointer is back on the nav
    this.#deferredLeave = null;

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

    // Pinned cards never auto-close — no deferred leave needed
    if (this.isCardPinned) return;

    // Context menu open — defer the leave so we can process it when the menu closes
    if (this.contextMenuOpen) {
      this.#deferredLeave = 'nav';
      return;
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
    // Cancel any deferred leave — pointer is back inside the card
    this.#deferredLeave = null;
  }

  handleCardMouseLeave() {
    // If the card is pinned open, don't auto-close
    if (this.isCardPinned) return;

    if (this.contextMenuOpen) {
      this.#deferredLeave = 'card';
      return;
    }

    this.#leaveTimeout = setTimeout(() => {
      this.hoveredItem = null;
      this.expandedItem = null;
    }, 200);
  }

  /** Called when context menu closes — process any deferred mouseleave */
  onContextMenuClosed() {
    // Don't process deferred leave if another context menu is still open
    if (this.contextMenuOpen) return;

    const leaveType = this.#deferredLeave;
    this.#deferredLeave = null;

    if (!leaveType || this.isCardPinned) return;

    this.#leaveTimeout = setTimeout(() => {
      this.hoveredItem = null;
      if (leaveType === 'card') {
        this.expandedItem = null;
      }
      // 'nav' type intentionally does NOT clear expandedItem
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

  /** Toggle pinned state for the expanded card */
  toggleCardPinned() {
    this.isCardPinned = !this.isCardPinned;
    this.#persistCardPinned(this.isCardPinned);
  }

  /** Close only hover cards (not the panel) */
  closeHoverCards() {
    this.hoveredItem = null;
    this.expandedItem = null;
    // Reset pin if no panel is open (pin was for the hover card)
    if (!this.panelItem) {
      this.isCardPinned = false;
      this.#persistCardPinned(false);
    }
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
    this.isCardPinned = false;
    this.#persistCardPinned(false);
    this.panelItem = null;
    this.#persistPanel(null);
  }

  togglePanel(item: SidebarNavItem) {
    if (this.onboardingActive) return;
    if (this.panelItem === item) {
      // If pinned, unpin instead of closing
      if (this.isCardPinned) {
        this.isCardPinned = false;
        this.#persistCardPinned(false);
        return;
      }
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

  #persistCardPinned(pinned: boolean) {
    try {
      localStorage.setItem(CARD_PINNED_KEY, String(pinned));
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

  // ── Onboarding ──

  setOnboardingActive(value: boolean) {
    this.onboardingActive = value;
    if (value) {
      this.closeAll(true);
    }
  }

  // ── General ──

  /** Close everything (hover cards + panel). Respects pinned panel unless forced. */
  closeAll(force = false) {
    this.closeHoverCards();
    if (!this.isCardPinned || force) {
      this.isCardPinned = false;
      this.#persistCardPinned(false);
      this.panelItem = null;
      this.#persistPanel(null);
    }
  }
}

export const sidebarNavStore = new SidebarNavStore();
