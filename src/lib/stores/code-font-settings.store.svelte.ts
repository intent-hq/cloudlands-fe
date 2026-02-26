/**
 * Code Font Settings Store
 *
 * Persists font family preferences for code viewers (CodeEditor, DiffViewer, MonacoDiffViewer).
 * Allows users to select from system monospace fonts.
 */

import { invoke } from '$lib/electron-bridge';

const STORAGE_KEY = 'code-font-settings';

const SYSTEM_DEFAULT_FONT =
  "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Monaco, Consolas, monospace";

interface FontOption {
  value: string;
  label: string;
  fontFamily: string;
}

function loadFontFamily(): string {
  if (typeof window === 'undefined') return 'system-default';
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return parsed.fontFamily || 'system-default';
    }
  } catch {
    // Ignore parse errors
  }
  return 'system-default';
}

function saveFontFamily(fontFamily: string) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ fontFamily }));
  } catch {
    // Ignore storage errors
  }
}

function createCodeFontSettingsStore() {
  let fontFamily = $state(loadFontFamily());
  let systemFonts = $state<string[]>([]);

  // Load system fonts asynchronously
  async function loadSystemFonts() {
    try {
      const result = (await invoke('system:list-fonts', {})) as
        | { success: true; data: string[] }
        | { success: false; error: string };

      if (result.success) {
        systemFonts = result.data;
      }
    } catch (error) {
      console.warn('Failed to load system fonts:', error);
    }
  }

  // Trigger font loading
  if (typeof window !== 'undefined') {
    loadSystemFonts();
  }

  return {
    get fontFamily() {
      return fontFamily;
    },
    set fontFamily(value: string) {
      fontFamily = value;
      saveFontFamily(value);
    },

    get fontOptions(): FontOption[] {
      const options: FontOption[] = [
        { value: 'system-default', label: 'System Default', fontFamily: SYSTEM_DEFAULT_FONT },
      ];

      for (const font of systemFonts) {
        options.push({
          value: font,
          label: font,
          fontFamily: `'${font}', monospace`,
        });
      }

      return options;
    },

    get fontFamilyCSS(): string {
      if (fontFamily === 'system-default') {
        return SYSTEM_DEFAULT_FONT;
      }
      return `'${fontFamily}', monospace`;
    },

    get fontFamilyLabel(): string {
      if (fontFamily === 'system-default') {
        return 'System Default';
      }
      return fontFamily;
    },
  };
}

export const codeFontSettings = createCodeFontSettingsStore();
