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
}

const defaultSettings: LayoutSettings = {
  spacesSidebarWidth: 200,
  spacesSidebarCollapsed: false,
  tabbedSidebarPinned: true,
  sidebarSide: 'left',
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

  return {
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

    // Reset to defaults
    reset() {
      Object.assign(settings, defaultSettings);
      saveSettings(settings);
    },
  };
}

export const layoutSettings = createLayoutSettingsStore();
