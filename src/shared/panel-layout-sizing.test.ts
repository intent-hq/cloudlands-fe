import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BROWSER_PANEL_WIDTH,
  DEFAULT_CHAT_PANEL_WIDTH,
  DEFAULT_MEDIUM_PANEL_WIDTH,
  DEFAULT_PANEL_WIDTH,
  MAX_VISIBLE_ROOT_PANEL_RESIZE_COUNT,
  PANEL_SPLIT_GUTTER_WIDTH,
  allocatePanelWidths,
  getAutomaticPanelCanvasWidth,
  getPanelDefaultWidth,
  getResolvedPanelCanvasWidth,
  shouldShowRootPanelResizeHandles,
} from './panel-layout-sizing';

describe('root panel resize handle visibility', () => {
  it.each([
    [1, false],
    [2, true],
    [3, true],
    [4, false],
  ])('returns %s panels => %s', (panelCount, expected) => {
    expect(shouldShowRootPanelResizeHandles(panelCount)).toBe(expected);
  });

  it('defines the sparse workspace threshold explicitly', () => {
    expect(MAX_VISIBLE_ROOT_PANEL_RESIZE_COUNT).toBe(3);
    expect(shouldShowRootPanelResizeHandles(Number.NaN)).toBe(false);
    expect(shouldShowRootPanelResizeHandles(2.5)).toBe(false);
  });
});

describe('panel type default widths', () => {
  it('uses intentional fallback widths before the usable viewport is measured', () => {
    expect(DEFAULT_PANEL_WIDTH).toBe(500);
    expect(DEFAULT_CHAT_PANEL_WIDTH).toBe(DEFAULT_PANEL_WIDTH + 200);
    expect(DEFAULT_CHAT_PANEL_WIDTH).toBe(700);
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
    expect(getAutomaticPanelCanvasWidth([500, 900], 'viewport', 1600)).toBe(1600);
    expect(getAutomaticPanelCanvasWidth([500, 900], 'viewport', 1000)).toBe(1408);
    expect(getResolvedPanelCanvasWidth([500, 900], 'content', 1000, 1725)).toBe(1725);
    expect(getResolvedPanelCanvasWidth([500], 'viewport', 1600, 420)).toBe(420);
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
