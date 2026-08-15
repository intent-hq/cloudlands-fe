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
