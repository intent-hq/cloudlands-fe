import { describe, expect, it } from 'vitest';
import {
  getWindowAppearanceOptions,
  getWindowBackgroundColor,
  getWindowTitleBarOptions,
} from '../../shared/main/window-appearance';

describe('window appearance', () => {
  it('uses an active translucent native background on macOS', () => {
    const expected = {
      backgroundColor: '#00000000',
      transparent: true,
      vibrancy: 'under-window',
      visualEffectState: 'active',
    };
    expect(getWindowAppearanceOptions(false, 'darwin')).toEqual(expected);
    expect(getWindowAppearanceOptions(true, 'darwin')).toEqual(expected);
    expect(getWindowBackgroundColor(false, 'darwin')).toBe('#00000000');
    expect(getWindowBackgroundColor(true, 'darwin')).toBe('#00000000');
  });

  it('keeps opaque theme fallbacks on other platforms', () => {
    expect(getWindowAppearanceOptions(false, 'win32')).toEqual({ backgroundColor: '#ffffff' });
    expect(getWindowAppearanceOptions(true, 'win32')).toEqual({ backgroundColor: '#0a0a0a' });
    expect(getWindowAppearanceOptions(false, 'linux')).toEqual({ backgroundColor: '#ffffff' });
    expect(getWindowAppearanceOptions(true, 'linux')).toEqual({ backgroundColor: '#0a0a0a' });
  });

  it('keeps the hidden inset, frameless macOS window chrome in development and production', () => {
    expect(getWindowTitleBarOptions('darwin')).toEqual({
      titleBarStyle: 'hiddenInset',
      frame: false,
      trafficLightPosition: { x: 12, y: 13 },
      tabbingIdentifier: 'intent',
    });
  });

  it('keeps standard framed chrome on other platforms', () => {
    expect(getWindowTitleBarOptions('linux')).toEqual({
      titleBarStyle: 'default',
      frame: true,
    });
  });
});
