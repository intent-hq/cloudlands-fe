import {
  allocateAutomaticPanelWidths,
  allocatePanelWidths,
  allocateViewportPanelWidths,
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
 * Automatic viewport canvases use equal capped columns. Explicit canvases
 * preserve saved ratios, while content canvases keep their intrinsic policy.
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
  const explicitCanvasWidth =
    persistedWidthSource === 'explicit' &&
    persistedWidth !== null &&
    Number.isFinite(persistedWidth) &&
    persistedWidth > 0
      ? persistedWidth
      : null;
  const intrinsicCanvasWidth =
    persistedWidthSource === 'intrinsic' &&
    persistedWidth !== null &&
    Number.isFinite(persistedWidth) &&
    persistedWidth > 0
      ? persistedWidth
      : null;
  const gapWidth = PANEL_SPLIT_GUTTER_WIDTH * Math.max(0, preferredWidths.length - 1);
  let allocation =
    sizing === 'viewport'
      ? explicitCanvasWidth === null
        ? allocateAutomaticPanelWidths(preferredWidths.length, viewportWidth)
        : allocateViewportPanelWidths(preferredWidths, viewportWidth)
      : allocatePanelWidths(preferredWidths, 0);
  if (explicitCanvasWidth !== null && sizing === 'content') {
    const preferredTotal = preferredWidths.reduce((sum, width) => sum + width, 0);
    const contentWidth = Math.max(0, explicitCanvasWidth - gapWidth);
    const scale = preferredTotal > 0 ? contentWidth / preferredTotal : 0;
    allocation = {
      panelWidths: preferredWidths.map((width) => width * scale),
      canvasWidth: explicitCanvasWidth,
      availablePanelWidth: contentWidth,
      overflows: false,
    };
  } else if (intrinsicCanvasWidth !== null && sizing === 'content') {
    const targetWidth = intrinsicCanvasWidth;
    const preferredTotal = preferredWidths.reduce((sum, width) => sum + width, 0);
    const scale = preferredTotal > 0 ? Math.max(0, targetWidth - gapWidth) / preferredTotal : 0;
    allocation = {
      panelWidths: preferredWidths.map((width) => width * scale),
      canvasWidth: targetWidth,
      availablePanelWidth: Math.max(0, targetWidth - gapWidth),
      overflows: false,
    };
  }
  const resetPreferredWidths =
    typeof resetPanelColumns === 'number'
      ? Array.from({ length: Math.max(1, resetPanelColumns) }, () => DEFAULT_PANEL_WIDTH)
      : resetPanelColumns;
  return {
    defaultWidth: allocation.canvasWidth,
    resetWidth: getAutomaticPanelCanvasWidth(resetPreferredWidths, sizing, viewportWidth),
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
