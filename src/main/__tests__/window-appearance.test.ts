import { describe, expect, it } from 'vitest';
import {
  getWindowAppearanceOptions,
  getWindowBackgroundColor,
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
});
