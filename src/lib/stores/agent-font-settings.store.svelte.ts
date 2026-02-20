/**
 * Agent Font Settings Store
 *
 * Persists font style preferences for agent chat messages across the application.
 * Allows users to toggle between: sans (default) and monospace.
 */

const STORAGE_KEY = 'agent-font-settings';

export type AgentFontStyle = 'sans' | 'monospace';

const FONT_STYLES: AgentFontStyle[] = ['sans', 'monospace'];

interface AgentFontSettings {
  fontStyle: AgentFontStyle;
}

const defaultSettings: AgentFontSettings = {
  fontStyle: 'sans',
};

function loadSettings(): AgentFontSettings {
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

function saveSettings(settings: AgentFontSettings) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore storage errors
  }
}

function createAgentFontSettingsStore() {
  const settings = $state(loadSettings());

  return {
    get fontStyle() {
      return settings.fontStyle;
    },
    set fontStyle(value: AgentFontStyle) {
      settings.fontStyle = value;
      saveSettings(settings);
    },

    /**
     * Cycle to the next font style in the sequence: sans -> monospace -> sans
     */
    cycleFontStyle() {
      const currentIndex = FONT_STYLES.indexOf(settings.fontStyle);
      const nextIndex = (currentIndex + 1) % FONT_STYLES.length;
      this.fontStyle = FONT_STYLES[nextIndex];
    },

    /**
     * Get the display label for the current font style
     */
    get fontStyleLabel(): string {
      switch (settings.fontStyle) {
        case 'sans':
          return 'Sans-serif';
        case 'monospace':
          return 'Monospace';
        default:
          return 'Sans-serif';
      }
    },

    /**
     * Check if current style is monospace
     */
    get isMonospace(): boolean {
      return settings.fontStyle === 'monospace';
    },
  };
}

export const agentFontSettings = createAgentFontSettingsStore();
