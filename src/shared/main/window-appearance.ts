import type { BrowserWindowConstructorOptions } from 'electron';

const TRANSPARENT_WINDOW_BACKGROUND = '#00000000';
const DARK_WINDOW_BACKGROUND = '#0a0a0a';
const LIGHT_WINDOW_BACKGROUND = '#ffffff';
const MAC_WINDOW_VIBRANCY = 'under-window' as const;

/**
 * Main-process mirror of the renderer's "Translucent window" preference. The
 * preference itself lives in renderer storage; the renderer reports it over
 * `window:set-translucency` so windows created afterwards start in the right
 * state instead of flashing the native blur on.
 */
let windowTranslucencyEnabled = true;

export function isWindowTranslucencyEnabled(): boolean {
  return windowTranslucencyEnabled;
}

export function setWindowTranslucencyEnabled(enabled: boolean): void {
  windowTranslucencyEnabled = enabled;
}

/**
 * Main-process mirror of the "Auto-hide menu bar" preference (Linux and
 * Windows). Seeded from local prefs before the first window opens and kept
 * current by `window:set-menu-bar-auto-hide`.
 */
let menuBarAutoHideEnabled = false;

export function isMenuBarAutoHideEnabled(): boolean {
  return menuBarAutoHideEnabled;
}

export function setMenuBarAutoHideEnabled(enabled: boolean): void {
  menuBarAutoHideEnabled = enabled;
}

type MenuBarCapableWindow = {
  setAutoHideMenuBar(hide: boolean): void;
  setMenuBarVisibility(visible: boolean): void;
};

/** Applies the auto-hide preference to an open window; the menu bar returns with Alt. */
export function applyMenuBarAutoHide(
  window: MenuBarCapableWindow,
  enabled: boolean,
  platform: NodeJS.Platform = process.platform,
): void {
  if (platform === 'darwin') return;
  window.setAutoHideMenuBar(enabled);
  window.setMenuBarVisibility(!enabled);
}

function opaqueBackground(isDarkMode: boolean): string {
  return isDarkMode ? DARK_WINDOW_BACKGROUND : LIGHT_WINDOW_BACKGROUND;
}

export function getWindowBackgroundColor(
  isDarkMode: boolean,
  platform: NodeJS.Platform = process.platform,
  translucent: boolean = windowTranslucencyEnabled,
): string {
  if (platform === 'darwin' && translucent) return TRANSPARENT_WINDOW_BACKGROUND;
  return opaqueBackground(isDarkMode);
}

/**
 * macOS windows stay `transparent` because that cannot change after creation,
 * which keeps the translucency toggle live. The costly part is the native
 * blur (NSVisualEffectView): WindowServer re-blends the desktop behind it on
 * every frame. It is omitted when translucency is off, and it follows the
 * window's focus (macOS's default) so background windows stop blurring.
 */
export function getWindowAppearanceOptions(
  isDarkMode: boolean,
  platform: NodeJS.Platform = process.platform,
  translucent: boolean = windowTranslucencyEnabled,
): BrowserWindowConstructorOptions {
  if (platform !== 'darwin') return { backgroundColor: opaqueBackground(isDarkMode) };
  if (!translucent) {
    return { backgroundColor: opaqueBackground(isDarkMode), transparent: true };
  }
  return {
    backgroundColor: TRANSPARENT_WINDOW_BACKGROUND,
    transparent: true,
    vibrancy: MAC_WINDOW_VIBRANCY,
    visualEffectState: 'followWindow',
  };
}

type VibrancyCapableWindow = {
  setVibrancy(type: typeof MAC_WINDOW_VIBRANCY | null): void;
  setBackgroundColor(color: string): void;
};

/** Applies the translucency preference to an already-open window. */
export function applyWindowTranslucency(
  window: VibrancyCapableWindow,
  isDarkMode: boolean,
  translucent: boolean,
  platform: NodeJS.Platform = process.platform,
): void {
  if (platform !== 'darwin') return;
  window.setVibrancy(translucent ? MAC_WINDOW_VIBRANCY : null);
  window.setBackgroundColor(getWindowBackgroundColor(isDarkMode, platform, translucent));
}

export function getWindowTitleBarOptions(
  platform: NodeJS.Platform = process.platform,
): BrowserWindowConstructorOptions {
  if (platform !== 'darwin') {
    return {
      titleBarStyle: 'default',
      frame: true,
      ...(menuBarAutoHideEnabled && { autoHideMenuBar: true }),
    };
  }

  return {
    titleBarStyle: 'hiddenInset',
    frame: false,
    trafficLightPosition: { x: 12, y: 13 },
    tabbingIdentifier: 'intent',
  };
}
