/**
 * Note Spellcheck Settings Store
 *
 * Persists spellcheck preference for notes.
 * Defaults to OFF — code-heavy notes benefit from no spellcheck.
 */

const STORAGE_KEY = 'note-spellcheck-settings';

interface NoteSpellcheckSettings {
  enabled: boolean;
}

const defaultSettings: NoteSpellcheckSettings = {
  enabled: false,
};

function loadSettings(): NoteSpellcheckSettings {
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

function saveSettings(settings: NoteSpellcheckSettings) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore storage errors
  }
}

function createNoteSpellcheckSettingsStore() {
  const settings = $state<NoteSpellcheckSettings>(loadSettings());

  return {
    get enabled() {
      return settings.enabled;
    },
    set enabled(value: boolean) {
      settings.enabled = value;
      saveSettings(settings);
    },

    toggle() {
      this.enabled = !this.enabled;
    },
  };
}

export const noteSpellcheckSettings = createNoteSpellcheckSettingsStore();
