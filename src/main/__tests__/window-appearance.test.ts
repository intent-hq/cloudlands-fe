import { describe, expect, it } from 'vitest';
import {
  getWindowAppearanceOptions,
  getWindowBackgroundColor,
  getWindowTitleBarOptions,
} from '../../shared/main/window-appearance';

describe('window appearance', () => {
  it('uses opaque light and dark native backgrounds on macOS', () => {
    expect(getWindowAppearanceOptions(false, 'darwin')).toEqual({ backgroundColor: '#ffffff' });
    expect(getWindowAppearanceOptions(true, 'darwin')).toEqual({ backgroundColor: '#0a0a0a' });
    expect(getWindowBackgroundColor(false, 'darwin')).toBe('#ffffff');
    expect(getWindowBackgroundColor(true, 'darwin')).toBe('#0a0a0a');
  });

  it('keeps opaque theme fallbacks on other platforms', () => {
    expect(getWindowAppearanceOptions(false, 'win32')).toEqual({ backgroundColor: '#ffffff' });
    expect(getWindowAppearanceOptions(true, 'linux')).toEqual({ backgroundColor: '#0a0a0a' });
  });

  it('shows the native macOS title bar in development', () => {
    expect(getWindowTitleBarOptions(true, 'darwin')).toEqual({
      titleBarStyle: 'default',
      frame: true,
      tabbingIdentifier: 'intent',
    });
  });

  it('keeps the frameless macOS title bar in production', () => {
    expect(getWindowTitleBarOptions(false, 'darwin')).toEqual({
      titleBarStyle: 'hiddenInset',
      frame: false,
      trafficLightPosition: { x: 9, y: 11 },
      tabbingIdentifier: 'intent',
    });
  });

  it('keeps standard framed title bars on other platforms', () => {
    expect(getWindowTitleBarOptions(true, 'linux')).toEqual({
      titleBarStyle: 'default',
      frame: true,
    });
    expect(getWindowTitleBarOptions(false, 'win32')).toEqual({
      titleBarStyle: 'default',
      frame: true,
    });
  });
});
