import type { BrowserWindowConstructorOptions } from 'electron';

const DARK_WINDOW_BACKGROUND = '#0a0a0a';
const LIGHT_WINDOW_BACKGROUND = '#ffffff';

export function getWindowBackgroundColor(
  isDarkMode: boolean,
  _platform: NodeJS.Platform = process.platform,
): string {
  return isDarkMode ? DARK_WINDOW_BACKGROUND : LIGHT_WINDOW_BACKGROUND;
}

export function getWindowAppearanceOptions(
  isDarkMode: boolean,
  platform: NodeJS.Platform = process.platform,
): BrowserWindowConstructorOptions {
  return { backgroundColor: getWindowBackgroundColor(isDarkMode, platform) };
}

export function getWindowTitleBarOptions(
  isDevelopment: boolean,
  platform: NodeJS.Platform = process.platform,
): BrowserWindowConstructorOptions {
  if (platform !== 'darwin') {
    return { titleBarStyle: 'default', frame: true };
  }

  if (isDevelopment) {
    return { titleBarStyle: 'default', frame: true, tabbingIdentifier: 'intent' };
  }

  return {
    titleBarStyle: 'hiddenInset',
    frame: false,
    trafficLightPosition: { x: 9, y: 11 },
    tabbingIdentifier: 'intent',
  };
}
