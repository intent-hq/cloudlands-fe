import { describe, expect, it } from 'vitest';

import { WindowUpdateDockPlacementSchema } from '../ipc-schemas';
import { getDockCompactNotchSize } from '../../shared/dock-placement';

// The glyph-only header asks for its own wing: 12 inset + one 12px glyph + 4 = 28.
const ONE_GLYPH_WING = 12 + 12 + 4;
const resize = { action: 'resize', revision: 3, width: 240, height: 32 } as const;

describe('WindowUpdateDockPlacementSchema compact wing', () => {
  it('accepts a one-glyph wing narrower than the minimum, which main clamps', () => {
    const parsed = WindowUpdateDockPlacementSchema.parse({
      ...resize,
      compactNotchWingWidth: ONE_GLYPH_WING,
    });
    expect(parsed).toMatchObject({ compactNotchWingWidth: ONE_GLYPH_WING });
    // The controller hands the raw wing to the shared geometry, which keeps the minimum.
    expect(getDockCompactNotchSize({ width: 180, height: 32 }, ONE_GLYPH_WING)).toEqual(
      getDockCompactNotchSize({ width: 180, height: 32 }),
    );
    expect(getDockCompactNotchSize(null, ONE_GLYPH_WING)).toEqual(getDockCompactNotchSize(null));
  });

  it('still rejects negative, non-finite and oversized wings', () => {
    for (const compactNotchWingWidth of [-1, Number.NaN, Number.POSITIVE_INFINITY, 257])
      expect(
        WindowUpdateDockPlacementSchema.safeParse({ ...resize, compactNotchWingWidth }).success,
      ).toBe(false);
  });
});

describe('WindowUpdateDockPlacementSchema side conversation anchor', () => {
  it('accepts an entry anchor or null, and rejects negative, non-finite and huge values', () => {
    for (const sidePanelAnchor of [0, 132.5, null])
      expect(WindowUpdateDockPlacementSchema.parse({ ...resize, sidePanelAnchor })).toMatchObject({
        sidePanelAnchor,
      });
    for (const sidePanelAnchor of [-1, Number.NaN, Number.POSITIVE_INFINITY, 16385])
      expect(
        WindowUpdateDockPlacementSchema.safeParse({ ...resize, sidePanelAnchor }).success,
      ).toBe(false);
  });
});
