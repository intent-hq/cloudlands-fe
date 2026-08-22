import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BROWSER_PANEL_WIDTH,
  DEFAULT_CHAT_PANEL_WIDTH,
  DEFAULT_MEDIUM_PANEL_WIDTH,
  DEFAULT_PANEL_WIDTH,
  FIRST_CHAT_PREFERRED_WIDTH,
  MAX_AUTOMATIC_PANEL_WIDTH,
  PANEL_SPLIT_GUTTER_WIDTH,
  allocateAutomaticPanelWidths,
  allocatePanelWidths,
  getAutomaticPanelCanvasWidth,
  getPanelDefaultWidth,
  getResolvedPanelCanvasWidth,
  resizePanelWidthsAtDivider,
} from './panel-layout-sizing';

describe('panel type default widths', () => {
  it('uses intentional fallback widths before the usable viewport is measured', () => {
    expect(DEFAULT_PANEL_WIDTH).toBe(500);
    expect(DEFAULT_CHAT_PANEL_WIDTH).toBe(DEFAULT_PANEL_WIDTH + 200);
    expect(DEFAULT_CHAT_PANEL_WIDTH).toBe(700);
    expect(FIRST_CHAT_PREFERRED_WIDTH).toBe(DEFAULT_CHAT_PANEL_WIDTH);
    expect(DEFAULT_MEDIUM_PANEL_WIDTH).toBe(720);
    expect(DEFAULT_BROWSER_PANEL_WIDTH).toBe(900);
    expect(getPanelDefaultWidth('narrow')).toBe(500);
    expect(getPanelDefaultWidth('chat')).toBe(700);
    expect(getPanelDefaultWidth('medium')).toBe(720);
    expect(getPanelDefaultWidth('wide')).toBe(900);
  });

  it('keeps medium panels at 60% and wide panels at 80% of usable wide viewports', () => {
    expect(getPanelDefaultWidth('narrow', 1200)).toBe(500);
    expect(getPanelDefaultWidth('chat', 1200)).toBe(700);
    expect(getPanelDefaultWidth('chat', 480)).toBe(480);
    expect(getPanelDefaultWidth('medium', 1200)).toBe(720);
    expect(getPanelDefaultWidth('wide', 1200)).toBe(960);
    expect(getPanelDefaultWidth('medium', 1600) / 1600).toBe(0.6);
  });

  it('sums per-column defaults while preserving viewport and persisted-width policies', () => {
    expect(getAutomaticPanelCanvasWidth([500, 900], 'content')).toBe(1408);
    expect(getAutomaticPanelCanvasWidth([1700], 'content', 5000)).toBe(1700);
    expect(getAutomaticPanelCanvasWidth([500, 900], 'viewport', 1600)).toBe(1600);
    expect(getAutomaticPanelCanvasWidth([500, 900], 'viewport', 1000)).toBe(1000);
    expect(getResolvedPanelCanvasWidth([500, 900], 'content', 1000, 1725)).toBe(1725);
    expect(getResolvedPanelCanvasWidth([500], 'viewport', 1600, 420)).toBe(420);
    expect(getResolvedPanelCanvasWidth([500], 'viewport', 5000, 1800)).toBe(1800);
  });
});

describe('capped equal automatic panel allocation', () => {
  it('uses a 2000px automatic per-panel maximum', () => {
    expect(MAX_AUTOMATIC_PANEL_WIDTH).toBe(2000);
  });

  it.each([1, 2, 3, 4])('fits %s equal column(s) inside a narrow viewport', (count) => {
    const allocation = allocateAutomaticPanelWidths(count, 300);
    const expectedWidth = (300 - PANEL_SPLIT_GUTTER_WIDTH * (count - 1)) / count;
    expect(allocation.panelWidths).toEqual(
      Array.from({ length: count }, () => expect.closeTo(expectedWidth, 8)),
    );
    expect(allocation.canvasWidth).toBeCloseTo(300, 8);
    expect(allocation.overflows).toBe(false);
  });

  it.each([1, 2, 3, 4])('caps %s column(s) at the exact 2000px threshold', (count) => {
    const totalGapWidth = PANEL_SPLIT_GUTTER_WIDTH * (count - 1);
    const threshold = MAX_AUTOMATIC_PANEL_WIDTH * count + totalGapWidth;
    const below = allocateAutomaticPanelWidths(count, threshold - 1);
    const exact = allocateAutomaticPanelWidths(count, threshold);
    const above = allocateAutomaticPanelWidths(count, threshold + 1);

    expect(below.panelWidths).toEqual(
      Array.from({ length: count }, () =>
        expect.closeTo((threshold - 1 - totalGapWidth) / count, 8),
      ),
    );
    expect(below.canvasWidth).toBeCloseTo(threshold - 1, 8);
    expect(exact.panelWidths).toEqual(
      Array.from({ length: count }, () => MAX_AUTOMATIC_PANEL_WIDTH),
    );
    expect(exact.canvasWidth).toBe(threshold);
    expect(above).toMatchObject({
      panelWidths: Array.from({ length: count }, () => MAX_AUTOMATIC_PANEL_WIDTH),
      canvasWidth: threshold,
      overflows: false,
    });
    expect(above.canvasWidth).toBeLessThan(threshold + 1);
  });

  it('falls back safely before measurement and for invalid counts', () => {
    expect(allocateAutomaticPanelWidths(2, Number.NaN).panelWidths).toEqual([500, 500]);
    expect(allocateAutomaticPanelWidths(Number.NaN, 800).panelWidths).toEqual([800]);
  });
});

describe('proportional fixed-canvas divider resizing', () => {
  it.each([
    { delta: 100, expected: [300, 262.5, 437.5] },
    { delta: -100, expected: [100, 337.5, 562.5] },
  ])('preserves asymmetric right-side ratios for delta $delta', ({ delta, expected }) => {
    const result = resizePanelWidthsAtDivider([200, 300, 500], 0, delta);
    expect(result.acceptedDelta).toBe(delta);
    expect(result.panelWidths).toEqual(expected);
  });

  it('leaves every panel left of the divider reference unchanged', () => {
    expect(resizePanelWidthsAtDivider([200, 300, 500], 1, 100).panelWidths).toEqual([
      200, 400, 400,
    ]);
  });

  it('water-fills minimums and reports only the accepted delta', () => {
    expect(resizePanelWidthsAtDivider([400, 120, 480], 0, 500)).toEqual({
      panelWidths: [800, 100, 100],
      acceptedDelta: 400,
    });
    expect(resizePanelWidthsAtDivider([200, 300, 500], 0, -1000)).toEqual({
      panelWidths: [100, 337.5, 562.5],
      acceptedDelta: -100,
    });
  });

  it('rejects and repairs restored widths below the global minimum', () => {
    const result = resizePanelWidthsAtDivider([800, 50, 150], 0, 10);
    expect(result.acceptedDelta).toBe(0);
    expect(result.panelWidths.reduce((sum, width) => sum + width, 0)).toBeCloseTo(1000, 8);
    result.panelWidths.forEach((width) => {
      expect(Number.isFinite(width)).toBe(true);
      expect(width).toBeGreaterThanOrEqual(100);
    });
  });

  it('rejects negative widths with finite non-negative fixed-total geometry', () => {
    const result = resizePanelWidthsAtDivider([200, -1], 0, 10);
    expect(result.acceptedDelta).toBe(0);
    expect(result.panelWidths.reduce((sum, width) => sum + width, 0)).toBeCloseTo(199, 8);
    expect(result.panelWidths.every((width) => Number.isFinite(width) && width >= 0)).toBe(true);
  });

  it('keeps totals, minimums, and the unaffected left side valid across a table', () => {
    for (const widths of [
      [500, 500],
      [240, 360, 600],
      [180, 270, 450, 900],
    ]) {
      const total = widths.reduce((sum, width) => sum + width, 0);
      const minimum = total * 0.1;
      for (let divider = 0; divider < widths.length - 1; divider += 1) {
        for (const delta of [-2000, -75, 75, 2000]) {
          const result = resizePanelWidthsAtDivider(widths, divider, delta);
          expect(result.panelWidths.reduce((sum, width) => sum + width, 0)).toBeCloseTo(total, 8);
          result.panelWidths.forEach((width) => {
            expect(Number.isFinite(width)).toBe(true);
            expect(width).toBeGreaterThanOrEqual(minimum);
          });
          expect(result.panelWidths.slice(0, divider)).toEqual(widths.slice(0, divider));
        }
      }
    }
  });

  it.each([
    { widths: [200], index: 0, delta: 10 },
    { widths: [200, 300], index: -1, delta: 10 },
    { widths: [200, 300], index: 0, delta: Number.NaN },
  ])('rejects invalid input %#', ({ widths, index, delta }) => {
    expect(resizePanelWidthsAtDivider(widths, index, delta)).toEqual({
      panelWidths: widths,
      acceptedDelta: 0,
    });
  });

  it('rejects non-finite widths without returning non-finite geometry', () => {
    const result = resizePanelWidthsAtDivider([200, Number.NaN], 0, 10);
    expect(result.acceptedDelta).toBe(0);
    expect(result.panelWidths.reduce((sum, width) => sum + width, 0)).toBeCloseTo(200, 8);
    expect(result.panelWidths.every((width) => Number.isFinite(width) && width >= 0)).toBe(true);
  });
});

describe('elastic panel width allocation', () => {
  it('gives one panel all available width', () => {
    expect(allocatePanelWidths([500], 1200)).toEqual({
      panelWidths: [1200],
      canvasWidth: 1200,
      availablePanelWidth: 1200,
      overflows: false,
    });
  });

  it('equalizes mixed preferred widths when they fit', () => {
    const allocation = allocatePanelWidths([500, 700, 900], 2400);
    expect(allocation.panelWidths).toEqual([
      794.6666666666666, 794.6666666666666, 794.6666666666666,
    ]);
    expect(allocation.canvasWidth).toBe(2400);
    expect(allocation.overflows).toBe(false);
  });

  it('changes from equal widths to preferred widths one pixel below the threshold', () => {
    const gap = PANEL_SPLIT_GUTTER_WIDTH;
    expect(allocatePanelWidths([500, 700], 1200 + gap)).toMatchObject({
      panelWidths: [600, 600],
      canvasWidth: 1200 + gap,
      overflows: false,
    });
    expect(allocatePanelWidths([500, 700], 1200 + gap - 1)).toMatchObject({
      panelWidths: [500, 700],
      canvasWidth: 1200 + gap,
      overflows: true,
    });
    expect(allocatePanelWidths([500, 700], 1200 + gap + 1)).toMatchObject({
      panelWidths: [600.5, 600.5],
      canvasWidth: 1200 + gap + 1,
      overflows: false,
    });
  });
});
