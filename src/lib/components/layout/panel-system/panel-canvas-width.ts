import { getResolvedPanelCanvasWidth, type PanelCanvasSizing } from '$shared/panel-layout-sizing';

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
 * The default width resolves one intrinsic canvas through the active mode:
 * tab view fills at least the viewport and overflows when content is wider;
 * deck view always hugs the intrinsic content width.
 */
export function getPanelCanvasWidths(
  viewportWidth: number,
  panelColumnCount: number,
  sizing: PanelCanvasSizing,
  persistedWidth: number | null,
) {
  const defaultWidth = getResolvedPanelCanvasWidth(
    panelColumnCount,
    sizing,
    viewportWidth,
    persistedWidth,
  );
  return {
    defaultWidth,
    minWidth: sizing === 'viewport' ? Math.max(1, viewportWidth) : 1,
  };
}
