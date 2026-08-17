import {
  allocatePanelWidths,
  DEFAULT_PANEL_WIDTH,
  getAutomaticPanelCanvasWidth,
  MIN_PANEL_CANVAS_WIDTH,
  PANEL_SPLIT_GUTTER_WIDTH,
  type PanelCanvasSizing,
} from '$shared/panel-layout-sizing';
import type { PanelCanvasWidthSource } from '$store/renderer/slices/panel-layout/panel-layout-width-provenance';

/** Convert a padding-inclusive DOM client width to the usable canvas viewport. */
export function getPanelViewportContentWidth(
  clientWidth: number,
  paddingLeft: number,
  paddingRight: number,
): number {
  return Math.max(0, clientWidth - paddingLeft - paddingRight);
}

/**
 * Compute default and minimum widths for the horizontal panel canvas.
 *
 * Viewport canvases equalize panels when their preferences fit and preserve
 * preferred widths when they overflow. Content canvases always hug preferences.
 */
export function getPanelCanvasWidths(
  viewportWidth: number,
  panelColumns: number | readonly number[],
  sizing: PanelCanvasSizing,
  persistedWidth: number | null,
  persistedWidthSource: PanelCanvasWidthSource | null = 'explicit',
  resetPanelColumns: number | readonly number[] = panelColumns,
) {
  const defaultPreferredWidths =
    typeof panelColumns === 'number'
      ? Array.from({ length: Math.max(1, panelColumns) }, () => DEFAULT_PANEL_WIDTH)
      : panelColumns;
  const preferredWidths = getPanelPreferredWidths(
    defaultPreferredWidths,
    null,
    persistedWidth,
    persistedWidthSource,
  );
  const allocation = allocatePanelWidths(
    preferredWidths,
    sizing === 'viewport' ? viewportWidth : 0,
  );
  const resetPreferredWidths =
    typeof resetPanelColumns === 'number'
      ? Array.from({ length: Math.max(1, resetPanelColumns) }, () => DEFAULT_PANEL_WIDTH)
      : resetPanelColumns;
  return {
    defaultWidth: allocation.canvasWidth,
    resetWidth: getAutomaticPanelCanvasWidth(resetPreferredWidths, 'content'),
    minWidth: MIN_PANEL_CANVAS_WIDTH,
    panelWidths: allocation.panelWidths,
    overflows: allocation.overflows,
  };
}

/** Resolve explicit saved root percentages to per-panel preferred pixel widths. */
export function getPanelPreferredWidths(
  defaultWidths: readonly number[],
  rootSizes: readonly number[] | null,
  persistedCanvasWidth: number | null,
  persistedWidthSource: PanelCanvasWidthSource | null,
): number[] {
  if (
    persistedWidthSource !== 'explicit' ||
    persistedCanvasWidth === null ||
    !Number.isFinite(persistedCanvasWidth) ||
    persistedCanvasWidth <= 0
  ) {
    return [...defaultWidths];
  }

  const gapWidth = PANEL_SPLIT_GUTTER_WIDTH * Math.max(0, defaultWidths.length - 1);
  const contentWidth = Math.max(1, persistedCanvasWidth - gapWidth);
  const candidateSizes = rootSizes?.length === defaultWidths.length ? rootSizes : defaultWidths;
  const sizeTotal = candidateSizes.reduce(
    (sum, size) => sum + (Number.isFinite(size) && size > 0 ? size : 0),
    0,
  );
  if (sizeTotal <= 0) return defaultWidths.map(() => contentWidth / defaultWidths.length);
  return candidateSizes.map((size) => (Math.max(0, size) / sizeTotal) * contentWidth);
}
