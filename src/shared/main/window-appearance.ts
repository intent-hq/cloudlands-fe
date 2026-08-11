import type { BrowserWindowConstructorOptions } from 'electron';

// Chromium requires native view backgrounds to be fully transparent or fully opaque.
// Intermediate alpha values can crash macOS during navigation fallback transfer.
export const MACOS_WINDOW_BACKGROUND = '#00000000';

export function getWindowBackgroundColor(
  isDarkMode: boolean,
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform === 'darwin') return MACOS_WINDOW_BACKGROUND;
  return isDarkMode ? '#0a0a0a' : '#ffffff';
}

export function getWindowAppearanceOptions(
  isDarkMode: boolean,
  platform: NodeJS.Platform = process.platform,
): BrowserWindowConstructorOptions {
  if (platform !== 'darwin') {
    return { backgroundColor: getWindowBackgroundColor(isDarkMode, platform) };
  }

  return {
    backgroundColor: MACOS_WINDOW_BACKGROUND,
    transparent: true,
    vibrancy: 'under-window',
    visualEffectState: 'active',
  };
}
