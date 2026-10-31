import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyWindowTranslucency,
  getWindowAppearanceOptions,
  getWindowBackgroundColor,
  getWindowTitleBarOptions,
  isWindowTranslucencyEnabled,
  setWindowTranslucencyEnabled,
} from '../../shared/main/window-appearance';

function fakeWindow() {
  return { setVibrancy: vi.fn(), setBackgroundColor: vi.fn() };
}

describe('window appearance', () => {
  afterEach(() => setWindowTranslucencyEnabled(true));

  it('uses a translucent native background on macOS that follows window focus', () => {
    const expected = {
      backgroundColor: '#00000000',
      transparent: true,
      vibrancy: 'under-window',
      visualEffectState: 'followWindow',
    };
    expect(getWindowAppearanceOptions(false, 'darwin')).toEqual(expected);
    expect(getWindowAppearanceOptions(true, 'darwin')).toEqual(expected);
    expect(getWindowBackgroundColor(false, 'darwin')).toBe('#00000000');
    expect(getWindowBackgroundColor(true, 'darwin')).toBe('#00000000');
  });

  it('never keeps the native blur active while the window is unfocused', () => {
    expect(getWindowAppearanceOptions(false, 'darwin', true).visualEffectState).not.toBe('active');
  });

  it('drops the native blur and uses an opaque theme background when translucency is off', () => {
    expect(getWindowAppearanceOptions(false, 'darwin', false)).toEqual({
      backgroundColor: '#ffffff',
      transparent: true,
    });
    expect(getWindowAppearanceOptions(true, 'darwin', false)).toEqual({
      backgroundColor: '#0a0a0a',
      transparent: true,
    });
    expect(getWindowBackgroundColor(true, 'darwin', false)).toBe('#0a0a0a');
  });

  it('creates later windows from the last reported translucency preference', () => {
    expect(isWindowTranslucencyEnabled()).toBe(true);
    setWindowTranslucencyEnabled(false);
    expect(isWindowTranslucencyEnabled()).toBe(false);
    expect(getWindowAppearanceOptions(true, 'darwin')).not.toHaveProperty('vibrancy');
    expect(getWindowBackgroundColor(false, 'darwin')).toBe('#ffffff');
  });

  it('removes and restores the native blur on an open macOS window', () => {
    const window = fakeWindow();
    applyWindowTranslucency(window, true, false, 'darwin');
    expect(window.setVibrancy).toHaveBeenLastCalledWith(null);
    expect(window.setBackgroundColor).toHaveBeenLastCalledWith('#0a0a0a');

    applyWindowTranslucency(window, true, true, 'darwin');
    expect(window.setVibrancy).toHaveBeenLastCalledWith('under-window');
    expect(window.setBackgroundColor).toHaveBeenLastCalledWith('#00000000');
  });

  it('leaves open windows untouched on other platforms', () => {
    const window = fakeWindow();
    applyWindowTranslucency(window, false, false, 'win32');
    expect(window.setVibrancy).not.toHaveBeenCalled();
    expect(window.setBackgroundColor).not.toHaveBeenCalled();
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
