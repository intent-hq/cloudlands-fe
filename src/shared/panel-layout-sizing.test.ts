import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BROWSER_PANEL_WIDTH,
  DEFAULT_MEDIUM_PANEL_WIDTH,
  DEFAULT_PANEL_WIDTH,
  MAX_VISIBLE_ROOT_PANEL_RESIZE_COUNT,
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
    expect(DEFAULT_MEDIUM_PANEL_WIDTH).toBe(720);
    expect(DEFAULT_BROWSER_PANEL_WIDTH).toBe(900);
    expect(getPanelDefaultWidth('narrow')).toBe(500);
    expect(getPanelDefaultWidth('medium')).toBe(720);
    expect(getPanelDefaultWidth('wide')).toBe(900);
  });

  it('keeps medium panels at 60% and wide panels at 80% of usable wide viewports', () => {
    expect(getPanelDefaultWidth('narrow', 1200)).toBe(500);
    expect(getPanelDefaultWidth('medium', 1200)).toBe(720);
    expect(getPanelDefaultWidth('wide', 1200)).toBe(960);
    expect(getPanelDefaultWidth('medium', 1600) / 1600).toBe(0.6);
  });

  it('sums per-column defaults while preserving viewport and persisted-width policies', () => {
    expect(getAutomaticPanelCanvasWidth([500, 900], 'content')).toBe(1400);
    expect(getAutomaticPanelCanvasWidth([500, 900], 'viewport', 1600)).toBe(1600);
    expect(getAutomaticPanelCanvasWidth([500, 900], 'viewport', 1000)).toBe(1400);
    expect(getResolvedPanelCanvasWidth([500, 900], 'content', 1000, 1725)).toBe(1725);
    expect(getResolvedPanelCanvasWidth([500], 'viewport', 1600, 420)).toBe(420);
  });
});
