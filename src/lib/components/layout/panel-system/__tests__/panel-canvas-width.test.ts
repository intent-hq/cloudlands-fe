import { describe, expect, it } from 'vitest';
import { getPanelCanvasWidths, getPanelViewportContentWidth } from '../panel-canvas-width';

describe('panel viewport width', () => {
  it('excludes scroll-container padding from the usable canvas width', () => {
    expect(getPanelViewportContentWidth(1055, 0, 12)).toBe(1043);
  });
});

describe('panel canvas width', () => {
  it.each([
    { viewport: 1600, columns: 1, expected: { defaultWidth: 1600, minWidth: 1600 } },
    // Viewport wide enough for two columns stretches to fill the viewport.
    { viewport: 1600, columns: 2, expected: { defaultWidth: 1600, minWidth: 1600 } },
    // Viewport narrower than preferred: canvas overflows to preferred width
    // (horizontally scrollable in tab mode).
    { viewport: 800, columns: 2, expected: { defaultWidth: 960, minWidth: 800 } },
    // Very narrow viewport still resolves to the preferred intrinsic width.
    { viewport: 360, columns: 2, expected: { defaultWidth: 960, minWidth: 360 } },
    // Zero-viewport (pre-measurement) falls back to preferred width.
    { viewport: 0, columns: 2, expected: { defaultWidth: 960, minWidth: 1 } },
  ])(
    'resolves $columns tab-view column(s) within a $viewport px viewport',
    ({ viewport, columns, expected }) => {
      expect(getPanelCanvasWidths(viewport, columns, 'viewport', null)).toEqual(expected);
    },
  );

  it('hugs intrinsic content width in deck view regardless of viewport width', () => {
    expect(getPanelCanvasWidths(1600, 2, 'content', null)).toEqual({
      defaultWidth: 960,
      minWidth: 1,
    });
  });

  it('resolves a persisted intrinsic width according to the active view policy', () => {
    expect(getPanelCanvasWidths(1200, 2, 'viewport', 1080)).toEqual({
      defaultWidth: 1200,
      minWidth: 1200,
    });
    expect(getPanelCanvasWidths(1200, 2, 'content', 1080)).toEqual({
      defaultWidth: 1080,
      minWidth: 1,
    });
  });
});
