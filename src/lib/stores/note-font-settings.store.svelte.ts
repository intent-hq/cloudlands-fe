/**
 * Note Font Settings Store
 *
 * Persists font style preferences for notes across the application.
 * Allows users to cycle through: sans (default), monospace, and serif.
 */

const STORAGE_KEY = 'note-font-settings';

export type NoteFontStyle = 'sans' | 'monospace';

const FONT_STYLES: NoteFontStyle[] = ['sans', 'monospace'];

interface NoteFontSettings {
  fontStyle: NoteFontStyle;
}

const defaultSettings: NoteFontSettings = {
  fontStyle: 'sans',
};

function loadSettings(): NoteFontSettings {
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

function saveSettings(settings: NoteFontSettings) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore storage errors
  }
}

function createNoteFontSettingsStore() {
  const settings = $state<NoteFontSettings>(loadSettings());

  return {
    get fontStyle() {
      return settings.fontStyle;
    },
    set fontStyle(value: NoteFontStyle) {
      settings.fontStyle = value;
      saveSettings(settings);
    },

    /**
     * Cycle to the next font style in the sequence: sans -> monospace -> serif -> sans
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
  };
}

export const noteFontSettings = createNoteFontSettingsStore();
