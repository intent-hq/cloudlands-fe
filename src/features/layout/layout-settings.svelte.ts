/**
 * Layout Settings Store
 *
 * Manages persistent layout settings using localStorage.
 * Uses the panel layout with splittable panels and tabs.
 */

const STORAGE_KEY = 'layout-settings';

export interface LayoutSettings {
  /**
   * Default width of the spaces sidebar in pixels
   */
  spacesSidebarWidth: number;

  /**
   * Whether the spaces sidebar is collapsed to icons only
   */
  spacesSidebarCollapsed: boolean;

  /**
   * Whether the tabbed sidebar (file explorer, agents, etc.) is pinned visible
   * When true, sidebar is always visible
   * When false, sidebar only shows on hover
   */
  tabbedSidebarPinned: boolean;

  /**
   * Which side the workspace sidebar is on
   */
  sidebarSide: 'left' | 'right';

  /**
   * Width of the spaces overlay when sidebar is on the right (independent of sidebar width)
   */
  spacesOverlayWidth: number;

  /**
   * Whether the spaces overlay was open (persisted so it survives refresh when sidebar is on right)
   */
  spacesOverlayOpen: boolean;
}

const defaultSettings: LayoutSettings = {
  spacesSidebarWidth: 200,
  spacesSidebarCollapsed: false,
  tabbedSidebarPinned: true,
  sidebarSide: 'left',
  spacesOverlayWidth: 350,
  spacesOverlayOpen: false,
};

function loadSettings(): LayoutSettings {
  if (typeof window === 'undefined') return defaultSettings;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return { ...defaultSettings, ...JSON.parse(stored) };
    }
  } catch {
    // Ignore parse errors
  }
  return defaultSettings;
}

function saveSettings(settings: LayoutSettings) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore storage errors
  }
}

function createLayoutSettingsStore() {
  const settings = $state<LayoutSettings>(loadSettings());

  // Transient (non-persisted) UI state shared across components
  let _spacesOverlayResizing = $state(false);
  let _spacesOverlayOpenTransient = $state(false);

  return {
    /** Whether the spaces list overlay is currently open.
     *  When sidebar is on the right, persisted to localStorage (survives refresh).
     *  When sidebar is on the left, transient only (resets on refresh). */
    get spacesOverlayOpen() {
      return settings.sidebarSide === 'right' ? settings.spacesOverlayOpen : _spacesOverlayOpenTransient;
    },
    set spacesOverlayOpen(value: boolean) {
      if (settings.sidebarSide === 'right') {
        settings.spacesOverlayOpen = value;
        saveSettings(settings);
      } else {
        _spacesOverlayOpenTransient = value;
      }
    },

    /** Whether the spaces overlay is currently being resized (transient, not persisted) */
    get spacesOverlayResizing() {
      return _spacesOverlayResizing;
    },
    set spacesOverlayResizing(value: boolean) {
      _spacesOverlayResizing = value;
    },

    get spacesSidebarWidth() {
      return settings.spacesSidebarWidth;
    },
    set spacesSidebarWidth(value: number) {
      settings.spacesSidebarWidth = value;
      saveSettings(settings);
    },

    get spacesSidebarCollapsed() {
      return settings.spacesSidebarCollapsed;
    },
    set spacesSidebarCollapsed(value: boolean) {
      settings.spacesSidebarCollapsed = value;
      saveSettings(settings);
    },

    get tabbedSidebarPinned() {
      return settings.tabbedSidebarPinned;
    },
    set tabbedSidebarPinned(value: boolean) {
      settings.tabbedSidebarPinned = value;
      saveSettings(settings);
    },

    // Toggle helpers
    toggleSpacesSidebar() {
      this.spacesSidebarCollapsed = !this.spacesSidebarCollapsed;
    },

    toggleTabbedSidebarPinned() {
      this.tabbedSidebarPinned = !this.tabbedSidebarPinned;
    },

    get sidebarSide() {
      return settings.sidebarSide;
    },
    set sidebarSide(value: 'left' | 'right') {
      settings.sidebarSide = value;
      saveSettings(settings);
    },

    toggleSidebarSide() {
      this.sidebarSide = this.sidebarSide === 'left' ? 'right' : 'left';
    },

    get spacesOverlayWidth() {
      return settings.spacesOverlayWidth;
    },
    set spacesOverlayWidth(value: number) {
      settings.spacesOverlayWidth = value;
      saveSettings(settings);
    },

    // Reset to defaults
    reset() {
      Object.assign(settings, defaultSettings);
      saveSettings(settings);
    },
  };
}

export const layoutSettings = createLayoutSettingsStore();
