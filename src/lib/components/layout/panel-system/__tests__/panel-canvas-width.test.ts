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
    // Viewport narrower than preferred: canvas overflows to preferred width
    // (horizontally scrollable in tab mode).
    {
      viewport: 800,
      columns: 2,
      expected: { defaultWidth: 1008, panelWidths: [500, 500], overflows: true },
    },
    // Very narrow viewport still resolves to the preferred intrinsic width.
    {
      viewport: 360,
      columns: 2,
      expected: { defaultWidth: 1008, panelWidths: [500, 500], overflows: true },
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

  it('uses explicit widths as preferences and equalizes them when they fit', () => {
    expect(getPanelCanvasWidths(1200, 2, 'viewport', 1080)).toEqual({
      defaultWidth: 1200,
      resetWidth: 1008,
      minWidth: 280,
      panelWidths: [596, 596],
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
    expect(getPanelCanvasWidths(1200, [720], 'viewport', 500, 'explicit').defaultWidth).toBe(1200);
    expect(getPanelCanvasWidths(480, [720], 'viewport', 500, 'explicit').defaultWidth).toBe(500);
  });

  it('uses per-column intrinsic widths for browser and non-browser panels', () => {
    expect(getPanelCanvasWidths(800, [500, 900], 'viewport', null)).toEqual({
      defaultWidth: 1408,
      resetWidth: 1408,
      minWidth: 280,
      panelWidths: [500, 900],
      overflows: true,
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

  it('keeps panel-type defaults as the reset target after explicit resizing', () => {
    expect(
      getPanelCanvasWidths(800, [300, 900], 'viewport', null, null, [500, 700]).resetWidth,
    ).toBe(1208);
  });
});
