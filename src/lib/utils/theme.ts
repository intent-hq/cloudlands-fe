import {
  parseVSCodeTheme,
  type ParsedVSCodeTheme,
} from './vscode-theme-parser';
import {
  applyCustomMonacoTheme,
  revertMonacoTheme,
} from './monaco-theme';
import { dispatchWindowEvent } from './window-events';
import { safeLocalStorage } from './safe-storage';

export type Theme = 'light' | 'dark' | 'system';
export type SetThemeOptions = {
  persist?: boolean;
};

const CUSTOM_THEME_STORAGE_KEY = 'custom-vscode-theme';
const PRESET_ID_STORAGE_KEY = 'theme-preset-id';
const PRESET_SET_STORAGE_KEY = 'theme-preset-set';

// Check if we're in a browser environment
const isBrowser = typeof window !== 'undefined';

export class ThemeManager {
  private static instance: ThemeManager | null = null;
  private currentTheme: Theme = 'system';
  private mediaQuery: MediaQueryList | null = null;
  /** Single custom theme from user-imported file (not a preset set) */
  private customTheme: ParsedVSCodeTheme | null = null;
  /** Preset set dark variant */
  private presetDarkTheme: ParsedVSCodeTheme | null = null;
  /** Preset set light variant */
  private presetLightTheme: ParsedVSCodeTheme | null = null;
  private appliedCSSVariableKeys: string[] = [];
  private activePresetId: string | null = null;
  private readonly handleSystemThemeChange = () => {
    if (this.currentTheme === 'system') {
      this.applyTheme();
    }
  };

  private constructor() {
    // Only initialize browser-dependent features when in browser context
    if (isBrowser) {
      this.mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      this.loadTheme();
      this.setupListeners();
    }
  }

  static getInstance(): ThemeManager {
    if (!ThemeManager.instance) {
      ThemeManager.instance = new ThemeManager();
    }
    return ThemeManager.instance;
  }

  /** @internal Exposed for testing only */
  static resetInstance(): void {
    ThemeManager.instance?.dispose();
    ThemeManager.instance = null;
  }

  private loadTheme() {
    const stored = safeLocalStorage.getItem('theme') as Theme | null;
    if (stored) {
      this.currentTheme = stored;
    }

    // Restore persisted preset ID
    this.activePresetId = safeLocalStorage.getItem(PRESET_ID_STORAGE_KEY);

    // Restore persisted preset set (dark + light variants)
    const presetSetJSON = safeLocalStorage.getItem(PRESET_SET_STORAGE_KEY);
    if (presetSetJSON) {
      try {
        const { dark, light } = JSON.parse(presetSetJSON);
        this.presetDarkTheme = parseVSCodeTheme(dark);
        this.presetLightTheme = parseVSCodeTheme(light);
      } catch {
        safeLocalStorage.removeItem(PRESET_SET_STORAGE_KEY);
        this.activePresetId = null;
        safeLocalStorage.removeItem(PRESET_ID_STORAGE_KEY);
      }
    }

    // Restore persisted user-imported custom theme (non-preset)
    if (!this.presetDarkTheme) {
      const customJSON = safeLocalStorage.getItem(CUSTOM_THEME_STORAGE_KEY);
      if (customJSON) {
        try {
          const parsed = JSON.parse(customJSON);
          this.customTheme = parseVSCodeTheme(parsed);
        } catch {
          safeLocalStorage.removeItem(CUSTOM_THEME_STORAGE_KEY);
          this.activePresetId = null;
          safeLocalStorage.removeItem(PRESET_ID_STORAGE_KEY);
        }
      }
    }

    this.applyTheme();
  }

  private setupListeners() {
    // Listen for system theme changes
    if (this.mediaQuery) {
      this.mediaQuery.addEventListener('change', this.handleSystemThemeChange);
    }
  }

  dispose(): void {
    this.mediaQuery?.removeEventListener('change', this.handleSystemThemeChange);
    this.mediaQuery = null;
  }

  setTheme(theme: Theme, options: SetThemeOptions = {}) {
    if (!isBrowser) return;
    const { persist = true } = options;
    this.currentTheme = theme;
    if (persist) {
      safeLocalStorage.setItem('theme', theme);
    }
    this.applyTheme();
  }

  getTheme(): Theme {
    return this.currentTheme;
  }

  /**
   * Parse and apply a VS Code theme JSON as a custom theme overlay.
   * Persists the raw JSON to localStorage so it survives page reloads.
   * This is for user-imported themes (single variant, not a preset set).
   */
  setCustomTheme(json: unknown): void {
    if (!isBrowser) return;

    const parsed = parseVSCodeTheme(json);
    this.customTheme = parsed;

    // Clear any preset set association
    this.activePresetId = null;
    this.presetDarkTheme = null;
    this.presetLightTheme = null;
    safeLocalStorage.removeItem(PRESET_ID_STORAGE_KEY);
    safeLocalStorage.removeItem(PRESET_SET_STORAGE_KEY);

    // Persist the raw JSON
    safeLocalStorage.setJSON(CUSTOM_THEME_STORAGE_KEY, json);

    this.applyTheme();
  }

  /**
   * Apply a preset theme set by ID. Stores both dark and light variants
   * so the active variant follows the user's light/dark/system preference.
   */
  setPresetTheme(presetId: string, darkJSON: unknown, lightJSON: unknown): void {
    if (!isBrowser) return;

    this.presetDarkTheme = parseVSCodeTheme(darkJSON);
    this.presetLightTheme = parseVSCodeTheme(lightJSON);
    this.activePresetId = presetId;

    // Clear single custom theme
    this.customTheme = null;
    safeLocalStorage.removeItem(CUSTOM_THEME_STORAGE_KEY);

    safeLocalStorage.setItem(PRESET_ID_STORAGE_KEY, presetId);
    safeLocalStorage.setJSON(PRESET_SET_STORAGE_KEY, { dark: darkJSON, light: lightJSON });

    this.applyTheme();
  }

  /**
   * Remove the custom theme overlay and revert to the base theme.
   */
  clearCustomTheme(): void {
    if (!isBrowser) return;

    this.customTheme = null;
    this.presetDarkTheme = null;
    this.presetLightTheme = null;
    this.activePresetId = null;
    safeLocalStorage.removeItem(CUSTOM_THEME_STORAGE_KEY);
    safeLocalStorage.removeItem(PRESET_ID_STORAGE_KEY);
    safeLocalStorage.removeItem(PRESET_SET_STORAGE_KEY);

    // Remove CSS variable overrides that were set by the custom theme
    this.removeCSSVariableOverrides();

    this.applyTheme();
  }

  /**
   * Returns true if any custom/preset theme is currently active.
   */
  hasCustomTheme(): boolean {
    return this.customTheme !== null || this.presetDarkTheme !== null;
  }

  /**
   * Returns the name of the active custom theme, or null if none.
   */
  getCustomThemeName(): string | null {
    const active = this.getActiveTheme();
    return active?.name ?? null;
  }

  /**
   * Returns the active preset ID, or null if using default or a user-imported theme.
   */
  getActivePresetId(): string | null {
    return this.activePresetId;
  }

  /**
   * Resolve whether the current mode should be dark, based on the user's
   * base theme preference (light/dark/system) — ignoring custom theme type.
   */
  private resolveIsDark(): boolean {
    const systemIsDark = this.mediaQuery?.matches ?? false;
    if (this.currentTheme === 'system') return systemIsDark;
    return this.currentTheme === 'dark';
  }

  /**
   * Get the active parsed theme to apply. For preset sets, picks the variant
   * matching the resolved dark/light mode. For user-imported themes, returns
   * the single custom theme. Returns null if no custom/preset theme is active.
   */
  private getActiveTheme(): ParsedVSCodeTheme | null {
    if (this.presetDarkTheme && this.presetLightTheme) {
      return this.resolveIsDark() ? this.presetDarkTheme : this.presetLightTheme;
    }
    return this.customTheme;
  }

  private applyTheme() {
    // Skip if not in browser
    if (!isBrowser) return;

    const root = document.documentElement;
    const systemIsDark = this.mediaQuery?.matches ?? false;
    const activeTheme = this.getActiveTheme();

    let isDark: boolean;
    if (this.customTheme) {
      // User-imported single theme determines dark/light
      isDark = this.customTheme.type === 'dark';
    } else {
      // Preset sets or no custom theme: follow user's base preference
      isDark = this.resolveIsDark();
    }

    // Remove both classes first to ensure clean state
    root.classList.remove('dark', 'light');
    root.classList.add(isDark ? 'dark' : 'light');
    root.style.setProperty('color-scheme', isDark ? 'dark' : 'light');

    // Apply or remove custom CSS variable overrides
    if (activeTheme) {
      this.applyCSSVariableOverrides(activeTheme.cssVariables);
    } else {
      this.removeCSSVariableOverrides();
    }

    // Set data attribute when user wants dark theme but system is light
    const darkOnLightSystem = this.currentTheme === 'dark' && !systemIsDark && !activeTheme;
    if (darkOnLightSystem) {
      root.setAttribute('data-theme-override', 'true');
    } else {
      root.removeAttribute('data-theme-override');
    }

    // Update meta theme-color
    const metaThemeColor = document.querySelector('meta[name="theme-color"]');
    if (metaThemeColor) {
      metaThemeColor.setAttribute('content', isDark ? '#0a0a0a' : '#ffffff');
    }

    // Apply Monaco theme
    if (activeTheme) {
      applyCustomMonacoTheme(activeTheme.monacoTheme);
    } else {
      revertMonacoTheme(isDark);
    }

    // Dispatch custom event for components to react
    dispatchWindowEvent('theme-changed', {
      theme: this.currentTheme,
      isDark,
      customThemeName: activeTheme?.name ?? null,
      activePresetId: this.activePresetId,
      terminalColors: activeTheme?.terminalColors ?? null,
    });
  }

  /**
   * Set CSS variable overrides on document.documentElement.style.
   */
  private applyCSSVariableOverrides(cssVariables: Record<string, string>): void {
    const root = document.documentElement;

    // Remove any previously applied overrides first
    this.removeCSSVariableOverrides();

    const keys: string[] = [];
    for (const [varName, value] of Object.entries(cssVariables)) {
      root.style.setProperty(varName, value);
      keys.push(varName);
    }
    this.appliedCSSVariableKeys = keys;
  }

  /**
   * Remove all CSS variable overrides that were set by the custom theme.
   */
  private removeCSSVariableOverrides(): void {
    const root = document.documentElement;
    for (const key of this.appliedCSSVariableKeys) {
      root.style.removeProperty(key);
    }
    this.appliedCSSVariableKeys = [];
  }

  toggleTheme() {
    if (!isBrowser) return;
    const themes: Theme[] = ['light', 'dark', 'system'];
    const currentIndex = themes.indexOf(this.currentTheme);
    const nextIndex = (currentIndex + 1) % themes.length;
    this.setTheme(themes[nextIndex]);
  }

  isDark(): boolean {
    if (this.customTheme) {
      // User-imported single theme: its type determines dark/light
      return this.customTheme.type === 'dark';
    }
    // Preset sets or no custom theme: follow user's base preference
    return this.resolveIsDark();
  }
}

// Lazy compatibility facade. Importing this module should not construct the singleton;
// the Redux theme saga is the app-level owner that initializes ThemeManager at startup.
export const themeManager = {
  setTheme: (...args: Parameters<ThemeManager['setTheme']>) => ThemeManager.getInstance().setTheme(...args),
  getTheme: () => ThemeManager.getInstance().getTheme(),
  setCustomTheme: (...args: Parameters<ThemeManager['setCustomTheme']>) =>
    ThemeManager.getInstance().setCustomTheme(...args),
  setPresetTheme: (...args: Parameters<ThemeManager['setPresetTheme']>) =>
    ThemeManager.getInstance().setPresetTheme(...args),
  clearCustomTheme: () => ThemeManager.getInstance().clearCustomTheme(),
  hasCustomTheme: () => ThemeManager.getInstance().hasCustomTheme(),
  getCustomThemeName: () => ThemeManager.getInstance().getCustomThemeName(),
  getActivePresetId: () => ThemeManager.getInstance().getActivePresetId(),
  toggleTheme: () => ThemeManager.getInstance().toggleTheme(),
  isDark: () => ThemeManager.getInstance().isDark(),
};
