import {
  getAutomaticPanelCanvasWidth,
  getResolvedPanelCanvasWidth,
  MIN_PANEL_CANVAS_WIDTH,
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
 * Automatic canvases start at their intrinsic panel-type widths in both views.
 * An explicit Redux width remains authoritative across view changes and viewport
 * measurements, while generic automatic viewport fill remains a separate policy.
 */
export function getPanelCanvasWidths(
  viewportWidth: number,
  panelColumns: number | readonly number[],
  sizing: PanelCanvasSizing,
  persistedWidth: number | null,
  persistedWidthSource: PanelCanvasWidthSource | null = 'explicit',
) {
  const authoritativeWidth =
    persistedWidthSource === 'explicit' || sizing === 'content' ? persistedWidth : null;
  const hasPersistedWidth = authoritativeWidth !== null;
  const defaultWidth = getResolvedPanelCanvasWidth(
    panelColumns,
    hasPersistedWidth ? sizing : 'content',
    viewportWidth,
    authoritativeWidth,
  );
  return {
    defaultWidth,
    resetWidth: getAutomaticPanelCanvasWidth(panelColumns, 'content'),
    minWidth: MIN_PANEL_CANVAS_WIDTH,
  };
}
