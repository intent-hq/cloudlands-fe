import type { BrowserWindowConstructorOptions } from 'electron';

const TRANSPARENT_WINDOW_BACKGROUND = '#00000000';
const DARK_WINDOW_BACKGROUND = '#0a0a0a';
const LIGHT_WINDOW_BACKGROUND = '#ffffff';

export function getWindowBackgroundColor(
  isDarkMode: boolean,
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform === 'darwin') return TRANSPARENT_WINDOW_BACKGROUND;
  return isDarkMode ? DARK_WINDOW_BACKGROUND : LIGHT_WINDOW_BACKGROUND;
}

export function getWindowAppearanceOptions(
  isDarkMode: boolean,
  platform: NodeJS.Platform = process.platform,
): BrowserWindowConstructorOptions {
  if (platform === 'darwin') {
    return {
      backgroundColor: TRANSPARENT_WINDOW_BACKGROUND,
      transparent: true,
      vibrancy: 'under-window',
      visualEffectState: 'active',
    };
  }
  return { backgroundColor: getWindowBackgroundColor(isDarkMode, platform) };
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
