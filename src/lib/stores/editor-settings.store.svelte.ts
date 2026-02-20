/**
 * Shared Editor Settings Store
 *
 * Persists editor preferences across all diff viewers and code panels.
 */

const STORAGE_KEY = 'editor-settings';

interface EditorSettings {
  lineWrapping: boolean;
  foldUnchanged: boolean;
  diffSideBySide: boolean;
  diffIndicators: boolean;
}

const defaultSettings: EditorSettings = {
  lineWrapping: true,
  foldUnchanged: true,
  diffSideBySide: true,
  diffIndicators: true,
};

function loadSettings(): EditorSettings {
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

function saveSettings(settings: EditorSettings) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore storage errors
  }
}

function createEditorSettingsStore() {
  const settings = $state<EditorSettings>(loadSettings());

  return {
    get lineWrapping() {
      return settings.lineWrapping;
    },
    set lineWrapping(value: boolean) {
      settings.lineWrapping = value;
      saveSettings(settings);
    },

    get foldUnchanged() {
      return settings.foldUnchanged;
    },
    set foldUnchanged(value: boolean) {
      settings.foldUnchanged = value;
      saveSettings(settings);
    },

    get diffSideBySide() {
      return settings.diffSideBySide;
    },
    set diffSideBySide(value: boolean) {
      settings.diffSideBySide = value;
      saveSettings(settings);
    },

    get diffIndicators() {
      return settings.diffIndicators;
    },
    set diffIndicators(value: boolean) {
      settings.diffIndicators = value;
      saveSettings(settings);
    },

    // Toggle helpers
    toggleLineWrapping() {
      this.lineWrapping = !this.lineWrapping;
    },
    toggleFoldUnchanged() {
      this.foldUnchanged = !this.foldUnchanged;
    },
    toggleDiffSideBySide() {
      this.diffSideBySide = !this.diffSideBySide;
    },
    toggleDiffIndicators() {
      this.diffIndicators = !this.diffIndicators;
    },
  };
}

export const editorSettings = createEditorSettingsStore();
