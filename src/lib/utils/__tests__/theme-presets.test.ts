import { describe, expect, it } from 'vitest';
import { THEME_PRESET_MANIFEST } from '../../../shared/theme-presets-manifest';
import { themePresets } from '../theme-presets';

describe('theme preset manifest', () => {
  it('matches the selectable renderer theme presets', () => {
    const manifestEntries = THEME_PRESET_MANIFEST.map(({ id, label }) => ({ id, label }));
    const presetEntries = themePresets.map(({ id, label }) => ({ id, label }));

    expect(presetEntries).toEqual(manifestEntries);
  });
});