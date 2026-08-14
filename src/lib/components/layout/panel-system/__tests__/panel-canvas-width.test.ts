import { describe, expect, it } from 'vitest';
import { getPanelCanvasWidths, getPanelViewportContentWidth } from '../panel-canvas-width';

describe('panel viewport width', () => {
  it('excludes scroll-container padding from the usable canvas width', () => {
    expect(getPanelViewportContentWidth(1055, 0, 12)).toBe(1043);
  });
});

describe('panel canvas width', () => {
  it.each([
    {
      viewport: 1600,
      columns: 1,
      expected: { defaultWidth: 500, resetWidth: 500, minWidth: 280 },
    },
    // A wide viewport does not inflate the intrinsic canvas.
    {
      viewport: 1600,
      columns: 2,
      expected: { defaultWidth: 1000, resetWidth: 1000, minWidth: 280 },
    },
    // Viewport narrower than preferred: canvas overflows to preferred width
    // (horizontally scrollable in tab mode).
    {
      viewport: 800,
      columns: 2,
      expected: { defaultWidth: 1000, resetWidth: 1000, minWidth: 280 },
    },
    // Very narrow viewport still resolves to the preferred intrinsic width.
    {
      viewport: 360,
      columns: 2,
      expected: { defaultWidth: 1000, resetWidth: 1000, minWidth: 280 },
    },
    // Zero-viewport (pre-measurement) falls back to preferred width.
    {
      viewport: 0,
      columns: 2,
      expected: { defaultWidth: 1000, resetWidth: 1000, minWidth: 280 },
    },
  ])(
    'resolves $columns tab-view column(s) within a $viewport px viewport',
    ({ viewport, columns, expected }) => {
      expect(getPanelCanvasWidths(viewport, columns, 'viewport', null)).toEqual(expected);
    },
  );

  it('hugs intrinsic content width in deck view regardless of viewport width', () => {
    expect(getPanelCanvasWidths(1600, 2, 'content', null)).toEqual({
      defaultWidth: 1000,
      resetWidth: 1000,
      minWidth: 280,
    });
  });

  it('preserves an explicit persisted width across view policies', () => {
    expect(getPanelCanvasWidths(1200, 2, 'viewport', 1080)).toEqual({
      defaultWidth: 1080,
      resetWidth: 1000,
      minWidth: 280,
    });
    expect(getPanelCanvasWidths(1200, 2, 'content', 1080)).toEqual({
      defaultWidth: 1080,
      resetWidth: 1000,
      minWidth: 280,
    });
  });

  it('recomputes automatic widths while preserving explicit width provenance', () => {
    expect(getPanelCanvasWidths(1200, [720], 'viewport', 500, null).defaultWidth).toBe(720);
    expect(getPanelCanvasWidths(1200, [720], 'viewport', 500, 'explicit').defaultWidth).toBe(500);
  });

  it('uses per-column intrinsic widths for browser and non-browser panels', () => {
    expect(getPanelCanvasWidths(800, [500, 900], 'viewport', null)).toEqual({
      defaultWidth: 1400,
      resetWidth: 1400,
      minWidth: 280,
    });
  });

  it('keeps ordinary and browser defaults stable when switching views', () => {
    expect(getPanelCanvasWidths(1600, [500], 'viewport', null).defaultWidth).toBe(500);
    expect(getPanelCanvasWidths(1600, [500], 'content', null).defaultWidth).toBe(500);
    expect(getPanelCanvasWidths(1600, [900], 'viewport', null).defaultWidth).toBe(900);
    expect(getPanelCanvasWidths(1600, [900], 'content', null).defaultWidth).toBe(900);
  });
});
