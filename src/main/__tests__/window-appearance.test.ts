import { describe, expect, it } from 'vitest';
import {
  getWindowAppearanceOptions,
  getWindowBackgroundColor,
  MACOS_WINDOW_BACKGROUND,
} from '../../shared/main/window-appearance';

describe('window appearance', () => {
  it('uses a fully transparent native background with glass on macOS', () => {
    expect(MACOS_WINDOW_BACKGROUND).toBe('#00000000');
    expect(getWindowAppearanceOptions(false, 'darwin')).toEqual({
      backgroundColor: MACOS_WINDOW_BACKGROUND,
      transparent: true,
      vibrancy: 'under-window',
      visualEffectState: 'active',
    });
    expect(getWindowBackgroundColor(false, 'darwin')).toBe(MACOS_WINDOW_BACKGROUND);
    expect(getWindowBackgroundColor(true, 'darwin')).toBe(MACOS_WINDOW_BACKGROUND);
  });

  it('keeps opaque theme fallbacks on other platforms', () => {
    expect(getWindowAppearanceOptions(false, 'win32')).toEqual({ backgroundColor: '#ffffff' });
    expect(getWindowAppearanceOptions(true, 'linux')).toEqual({ backgroundColor: '#0a0a0a' });
  });
});
