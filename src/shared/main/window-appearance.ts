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
    return { titleBarStyle: 'default', frame: true };
  }

  return {
    titleBarStyle: 'hiddenInset',
    frame: false,
    trafficLightPosition: { x: 12, y: 13 },
    tabbingIdentifier: 'intent',
  };
}
