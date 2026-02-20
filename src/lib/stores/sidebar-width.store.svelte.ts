/**
 * Sidebar Width Store
 *
 * A simple reactive store to share the left sidebar width across components.
 * The ResizablePanel updates this when resized, and other components can subscribe.
 * Also manages collapsed state for keyboard toggle (Cmd+B).
 */

const STORAGE_KEY = 'workspace-left-panel-width';
const COLLAPSED_STORAGE_KEY = 'workspace-left-panel-collapsed';
const DEFAULT_WIDTH = 350;
const MIN_WIDTH = 180;
const MAX_WIDTH = 800;

// Reactive state for sidebar width in pixels
let sidebarWidth = $state(DEFAULT_WIDTH);
// Store the width before collapse so we can restore it
let widthBeforeCollapse = $state(DEFAULT_WIDTH);
// Collapsed state managed separately from the actual width
let isCollapsed = $state(false);

/**
 * Convert stored percentage to pixels
 */
function percentToPixels(percent: number): number {
  if (typeof window === 'undefined') return DEFAULT_WIDTH;
  return (percent / 100) * window.innerWidth;
}

/**
 * Load width from localStorage and convert from percentage to pixels
 */
function loadWidth(): number {
  if (typeof window === 'undefined') return DEFAULT_WIDTH;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const value = parseFloat(stored);
      if (!isNaN(value) && value > 0) {
        // ResizablePanel stores as percentage when percentageWeight > 0
        const pixels = percentToPixels(value);
        if (pixels >= MIN_WIDTH && pixels <= MAX_WIDTH) {
          return Math.round(pixels);
        }
      }
    }
  } catch {
    // Ignore errors
  }
  return DEFAULT_WIDTH;
}

/**
 * Load collapsed state from localStorage
 */
function loadCollapsed(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const stored = localStorage.getItem(COLLAPSED_STORAGE_KEY);
    return stored === 'true';
  } catch {
    return false;
  }
}

/**
 * Save collapsed state to localStorage
 */
function saveCollapsed(collapsed: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(COLLAPSED_STORAGE_KEY, collapsed ? 'true' : 'false');
  } catch {
    // Ignore errors
  }
}

// Initialize from localStorage
if (typeof window !== 'undefined') {
  sidebarWidth = loadWidth();
  widthBeforeCollapse = sidebarWidth;
  isCollapsed = loadCollapsed();
}

export const sidebarWidthStore = {
  /** Get the current sidebar width in pixels */
  get width() {
    return sidebarWidth;
  },

  /** Get whether the sidebar is collapsed */
  get collapsed() {
    return isCollapsed;
  },

  /** Get the effective width (0 if collapsed, actual width otherwise) */
  get effectiveWidth() {
    return isCollapsed ? 0 : sidebarWidth;
  },

  /** Update the sidebar width (called by ResizablePanel) */
  setWidth(pixels: number) {
    const newWidth = Math.round(Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, pixels)));
    sidebarWidth = newWidth;
    // Also update the restore width when manually resizing (not when collapsed)
    if (!isCollapsed) {
      widthBeforeCollapse = newWidth;
    }
  },

  /** Toggle the collapsed state */
  toggle() {
    if (isCollapsed) {
      // Expand: restore to previous width
      isCollapsed = false;
    } else {
      // Collapse: store current width and set to collapsed
      widthBeforeCollapse = sidebarWidth;
      isCollapsed = true;
    }
    saveCollapsed(isCollapsed);
    // Dispatch event to notify ResizablePanel
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('workspace:toggle-left-sidebar', {
          detail: { collapsed: isCollapsed, restoreWidth: widthBeforeCollapse },
        }),
      );
    }
  },

  /** Set collapsed state explicitly */
  setCollapsed(collapsed: boolean) {
    if (collapsed === isCollapsed) return;
    if (collapsed) {
      widthBeforeCollapse = sidebarWidth;
    }
    isCollapsed = collapsed;
    saveCollapsed(isCollapsed);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('workspace:toggle-left-sidebar', {
          detail: { collapsed: isCollapsed, restoreWidth: widthBeforeCollapse },
        }),
      );
    }
  },

  /** Reload width from localStorage (useful after window resize) */
  reload() {
    sidebarWidth = loadWidth();
    widthBeforeCollapse = sidebarWidth;
    isCollapsed = loadCollapsed();
  },
};
