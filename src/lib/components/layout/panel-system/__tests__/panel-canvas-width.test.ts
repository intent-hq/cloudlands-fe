import { describe, expect, it } from 'vitest';
import {
  getPanelCanvasWidths,
  getPanelPreferredWidths,
  getPanelViewportContentWidth,
} from '../panel-canvas-width';

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
      expected: { defaultWidth: 1600, panelWidths: [1600], overflows: false },
    },
    // A wide viewport does not inflate the intrinsic canvas.
    {
      viewport: 1600,
      columns: 2,
      expected: { defaultWidth: 1600, panelWidths: [796, 796], overflows: false },
    },
    // Narrow viewports keep every selected column onscreen.
    {
      viewport: 800,
      columns: 2,
      expected: { defaultWidth: 800, panelWidths: [396, 396], overflows: false },
    },
    // Very narrow viewports still divide the gutter-exclusive width equally.
    {
      viewport: 360,
      columns: 2,
      expected: { defaultWidth: 360, panelWidths: [176, 176], overflows: false },
    },
    // Zero-viewport (pre-measurement) falls back to preferred width.
    {
      viewport: 0,
      columns: 2,
      expected: { defaultWidth: 1008, panelWidths: [500, 500], overflows: false },
    },
  ])(
    'resolves $columns tab-view column(s) within a $viewport px viewport',
    ({ viewport, columns, expected }) => {
      expect(getPanelCanvasWidths(viewport, columns, 'viewport', null)).toMatchObject(expected);
    },
  );

  it('hugs intrinsic content width in deck view regardless of viewport width', () => {
    expect(getPanelCanvasWidths(1600, 2, 'content', null)).toEqual({
      defaultWidth: 1008,
      resetWidth: 1008,
      minWidth: 280,
      panelWidths: [500, 500],
      overflows: false,
    });
  });

  it('preserves explicit widths in viewport and content sizing', () => {
    expect(getPanelCanvasWidths(1200, 2, 'viewport', 1080)).toEqual({
      defaultWidth: 1080,
      resetWidth: 1200,
      minWidth: 280,
      panelWidths: [536, 536],
      overflows: false,
    });
    expect(getPanelCanvasWidths(1200, 2, 'content', 1080)).toEqual({
      defaultWidth: 1080,
      resetWidth: 1008,
      minWidth: 280,
      panelWidths: [536, 536],
      overflows: false,
    });
  });

  it('recomputes automatic widths while preserving explicit width provenance', () => {
    expect(getPanelCanvasWidths(1200, [720], 'viewport', 500, null).defaultWidth).toBe(1200);
    expect(getPanelCanvasWidths(1200, [720], 'viewport', 500, 'explicit').defaultWidth).toBe(500);
    expect(getPanelCanvasWidths(480, [720], 'viewport', 500, 'explicit').defaultWidth).toBe(500);
  });

  it('bypasses intrinsic tiers in automatic viewport mode', () => {
    expect(getPanelCanvasWidths(3440, [720, 700], 'viewport', 1428, 'intrinsic')).toMatchObject({
      defaultWidth: 3440,
      panelWidths: [1716, 1716],
      overflows: false,
    });
    expect(getPanelCanvasWidths(1000, [720, 700], 'viewport', 1428, 'intrinsic')).toMatchObject({
      defaultWidth: 1000,
      panelWidths: [496, 496],
      overflows: false,
    });
  });

  it('ignores per-content tiers for automatic viewport columns', () => {
    expect(getPanelCanvasWidths(800, [500, 900], 'viewport', null)).toEqual({
      defaultWidth: 800,
      resetWidth: 800,
      minWidth: 280,
      panelWidths: [396, 396],
      overflows: false,
    });
  });

  it('keeps ordinary and browser defaults stable when switching views', () => {
    expect(getPanelCanvasWidths(1600, [500], 'viewport', null).defaultWidth).toBe(1600);
    expect(getPanelCanvasWidths(1600, [500], 'content', null).defaultWidth).toBe(500);
    expect(getPanelCanvasWidths(1600, [900], 'viewport', null).defaultWidth).toBe(1600);
    expect(getPanelCanvasWidths(1600, [900], 'content', null).defaultWidth).toBe(900);
  });

  it('resolves persisted root ratios to explicit preferred panel widths', () => {
    expect(getPanelPreferredWidths([500, 700], [25, 75], 1208, 'explicit')).toEqual([300, 900]);
    expect(getPanelPreferredWidths([500, 700], [25, 75], 1208, null)).toEqual([500, 700]);
  });

  it('resets explicit viewport sizing to the current automatic canvas', () => {
    expect(
      getPanelCanvasWidths(800, [300, 900], 'viewport', null, null, [500, 700]).resetWidth,
    ).toBe(800);
  });
});
