/**
 * Tests for ThemeManager custom theme support
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ThemeManager } from '../theme';

// ── Test fixtures ───────────────────────────────────────────────────────────

const CATPPUCCIN_DARK = {
  name: 'Catppuccin Mocha',
  type: 'dark',
  colors: {
    'editor.background': '#1e1e2e',
    'editor.foreground': '#cdd6f4',
    'sideBar.background': '#181825',
    'sideBar.foreground': '#cdd6f4',
    'button.background': '#89b4fa',
    'button.foreground': '#1e1e2e',
    'focusBorder': '#89b4fa',
    'input.background': '#313244',
    'panel.border': '#45475a',
    'badge.background': '#f5c2e7',
    'list.activeSelectionBackground': '#45475a',
    'tab.inactiveBackground': '#181825',
    'descriptionForeground': '#a6adc8',
    'errorForeground': '#f38ba8',
    'terminal.background': '#1e1e2e',
    'terminal.foreground': '#cdd6f4',
    'terminal.ansiBlack': '#45475a',
    'terminal.ansiRed': '#f38ba8',
    'terminal.ansiGreen': '#a6e3a1',
    'terminal.ansiYellow': '#f9e2af',
    'terminal.ansiBlue': '#89b4fa',
    'terminal.ansiMagenta': '#f5c2e7',
    'terminal.ansiCyan': '#94e2d5',
    'terminal.ansiWhite': '#bac2de',
  },
  tokenColors: [
    { scope: 'comment', settings: { foreground: '#6c7086' } },
    { scope: 'keyword', settings: { foreground: '#cba6f7' } },
  ],
};

const SOLARIZED_LIGHT = {
  name: 'Solarized Light',
  type: 'light',
  colors: {
    'editor.background': '#fdf6e3',
    'editor.foreground': '#657b83',
    'sideBar.background': '#eee8d5',
    'button.background': '#268bd2',
    'button.foreground': '#fdf6e3',
    'terminal.background': '#fdf6e3',
    'terminal.foreground': '#657b83',
  },
  tokenColors: [
    { scope: 'comment', settings: { foreground: '#93a1a1' } },
  ],
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function getManager(): ThemeManager {
  ThemeManager.resetInstance();
  return ThemeManager.getInstance();
}

function getLocalStorageMock() {
  return localStorage as unknown as {
    getItem: ReturnType<typeof vi.fn>;
    setItem: ReturnType<typeof vi.fn>;
    removeItem: ReturnType<typeof vi.fn>;
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('ThemeManager custom theme support', () => {
  let manager: ThemeManager;
  let dispatchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset localStorage mock returns
    const ls = getLocalStorageMock();
    ls.getItem.mockReturnValue(null);
    ls.setItem.mockImplementation(() => undefined);
    ls.removeItem.mockImplementation(() => undefined);

    manager = getManager();
    dispatchSpy = vi.spyOn(window, 'dispatchEvent');
  });

  afterEach(() => {
    dispatchSpy.mockRestore();
  });

  // ── hasCustomTheme / getCustomThemeName ─────────────────────────────────

  it('has no custom theme by default', () => {
    expect(manager.hasCustomTheme()).toBe(false);
    expect(manager.getCustomThemeName()).toBeNull();
  });

  // ── setCustomTheme ──────────────────────────────────────────────────────

  it('sets a custom dark theme', () => {
    manager.setCustomTheme(CATPPUCCIN_DARK);

    expect(manager.hasCustomTheme()).toBe(true);
    expect(manager.getCustomThemeName()).toBe('Catppuccin Mocha');
    expect(manager.isDark()).toBe(true);
  });

  it('sets a custom light theme', () => {
    manager.setCustomTheme(SOLARIZED_LIGHT);

    expect(manager.hasCustomTheme()).toBe(true);
    expect(manager.getCustomThemeName()).toBe('Solarized Light');
    expect(manager.isDark()).toBe(false);
  });

  it('persists custom theme JSON to localStorage', () => {
    manager.setCustomTheme(CATPPUCCIN_DARK);

    const ls = getLocalStorageMock();
    expect(ls.setItem).toHaveBeenCalledWith(
      'custom-vscode-theme',
      JSON.stringify(CATPPUCCIN_DARK),
    );
  });


  it('sets dark class on html element for dark custom theme', () => {
    manager.setCustomTheme(CATPPUCCIN_DARK);

    const root = document.documentElement;
    expect(root.classList.contains('dark')).toBe(true);
    expect(root.classList.contains('light')).toBe(false);
  });

  it('sets light class on html element for light custom theme', () => {
    manager.setCustomTheme(SOLARIZED_LIGHT);

    const root = document.documentElement;
    expect(root.classList.contains('light')).toBe(true);
    expect(root.classList.contains('dark')).toBe(false);
  });

  it('dispatches theme-changed event with customThemeName', () => {
    manager.setCustomTheme(CATPPUCCIN_DARK);

    const lastCall = dispatchSpy.mock.calls[dispatchSpy.mock.calls.length - 1];
    const event = lastCall[0] as CustomEvent;
    expect(event.type).toBe('theme-changed');
    expect(event.detail.customThemeName).toBe('Catppuccin Mocha');
    expect(event.detail.isDark).toBe(true);
  });

  it('dispatches theme-changed event with terminalColors', () => {
    manager.setCustomTheme(CATPPUCCIN_DARK);

    const lastCall = dispatchSpy.mock.calls[dispatchSpy.mock.calls.length - 1];
    const event = lastCall[0] as CustomEvent;
    expect(event.detail.terminalColors).toBeDefined();
    expect(event.detail.terminalColors.background).toBe('#1e1e2e');
  });

  it('throws on invalid theme JSON', () => {
    expect(() => manager.setCustomTheme(null)).toThrow();
    expect(() => manager.setCustomTheme('not an object')).toThrow();
    expect(() => manager.setCustomTheme({ name: 'Empty' })).toThrow();
  });

  // ── clearCustomTheme ────────────────────────────────────────────────────

  it('clears the custom theme', () => {
    manager.setCustomTheme(CATPPUCCIN_DARK);
    expect(manager.hasCustomTheme()).toBe(true);

    manager.clearCustomTheme();
    expect(manager.hasCustomTheme()).toBe(false);
    expect(manager.getCustomThemeName()).toBeNull();
  });

  it('removes custom theme from localStorage', () => {
    manager.setCustomTheme(CATPPUCCIN_DARK);
    manager.clearCustomTheme();

    const ls = getLocalStorageMock();
    expect(ls.removeItem).toHaveBeenCalledWith('custom-vscode-theme');
  });

  it('removes CSS variable overrides when clearing', () => {
    manager.setCustomTheme(CATPPUCCIN_DARK);

    const root = document.documentElement;
    // Verify CSS variable was set
    expect(root.style.getPropertyValue('--background')).toBeTruthy();

    manager.clearCustomTheme();

    // CSS variable override should be removed (empty string from inline style)
    expect(root.style.getPropertyValue('--background')).toBe('');
  });

  it('dispatches theme-changed with null customThemeName after clearing', () => {
    manager.setCustomTheme(CATPPUCCIN_DARK);
    manager.clearCustomTheme();

    const lastCall = dispatchSpy.mock.calls[dispatchSpy.mock.calls.length - 1];
    const event = lastCall[0] as CustomEvent;
    expect(event.detail.customThemeName).toBeNull();
    expect(event.detail.terminalColors).toBeNull();
  });

  // ── Base theme toggle still works ───────────────────────────────────────

  it('base theme toggle works without custom theme', () => {
    manager.setTheme('dark');
    expect(manager.isDark()).toBe(true);
    expect(document.documentElement.classList.contains('dark')).toBe(true);

    manager.setTheme('light');
    expect(manager.isDark()).toBe(false);
    expect(document.documentElement.classList.contains('light')).toBe(true);
  });

  it('custom theme takes precedence over base theme', () => {
    // Set base to light
    manager.setTheme('light');
    expect(manager.isDark()).toBe(false);

    // Apply dark custom theme — should override
    manager.setCustomTheme(CATPPUCCIN_DARK);
    expect(manager.isDark()).toBe(true);
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('base theme change while custom theme is active keeps custom theme', () => {
    manager.setCustomTheme(CATPPUCCIN_DARK);
    expect(manager.isDark()).toBe(true);

    // Toggle base theme — custom theme should still be active
    manager.setTheme('light');
    expect(manager.hasCustomTheme()).toBe(true);
    // isDark should still reflect the custom theme
    expect(manager.isDark()).toBe(true);
  });

  it('clearing custom theme reverts to current base theme', () => {
    manager.setTheme('light');
    manager.setCustomTheme(CATPPUCCIN_DARK);
    expect(manager.isDark()).toBe(true);

    manager.clearCustomTheme();
    // Should revert to the base 'light' theme
    expect(manager.isDark()).toBe(false);
    expect(document.documentElement.classList.contains('light')).toBe(true);
  });

  // ── Persistence on reload ───────────────────────────────────────────────

  it('restores custom theme from localStorage on init', () => {
    const ls = getLocalStorageMock();
    ls.getItem.mockImplementation((key: string) => {
      if (key === 'custom-vscode-theme') return JSON.stringify(CATPPUCCIN_DARK);
      if (key === 'theme') return 'light';
      return null;
    });

    const restored = getManager();
    expect(restored.hasCustomTheme()).toBe(true);
    expect(restored.getCustomThemeName()).toBe('Catppuccin Mocha');
    expect(restored.isDark()).toBe(true);
  });

  it('handles corrupt localStorage gracefully', () => {
    const ls = getLocalStorageMock();
    ls.getItem.mockImplementation((key: string) => {
      if (key === 'custom-vscode-theme') return 'not valid json{{{';
      return null;
    });

    const restored = getManager();
    expect(restored.hasCustomTheme()).toBe(false);
    // Should have cleaned up the corrupt entry
    expect(ls.removeItem).toHaveBeenCalledWith('custom-vscode-theme');
  });

  it('handles localStorage read failures during init', () => {
    const ls = getLocalStorageMock();
    ls.getItem.mockImplementation(() => {
      throw new Error('localStorage unavailable');
    });

    expect(() => getManager()).not.toThrow();
    expect(getManager().hasCustomTheme()).toBe(false);
  });

  it('handles localStorage write and remove failures when updating themes', () => {
    const ls = getLocalStorageMock();
    ls.setItem.mockImplementation(() => {
      throw new Error('quota exceeded');
    });
    ls.removeItem.mockImplementation(() => {
      throw new Error('localStorage unavailable');
    });

    expect(() => manager.setCustomTheme(CATPPUCCIN_DARK)).not.toThrow();
    expect(manager.hasCustomTheme()).toBe(true);
    expect(() => manager.clearCustomTheme()).not.toThrow();
    expect(manager.hasCustomTheme()).toBe(false);
  });

  // ── Replacing one custom theme with another ─────────────────────────────

  it('replaces one custom theme with another', () => {
    manager.setCustomTheme(CATPPUCCIN_DARK);
    expect(manager.getCustomThemeName()).toBe('Catppuccin Mocha');
    expect(manager.isDark()).toBe(true);

    manager.setCustomTheme(SOLARIZED_LIGHT);
    expect(manager.getCustomThemeName()).toBe('Solarized Light');
    expect(manager.isDark()).toBe(false);
  });
});
