const DEFAULT_PANEL_COLUMN_WIDTH = 480;

/**
 * Compute default and minimum widths for the horizontal panel canvas.
 *
 * The default width fills the viewport when it is at least
 * `panelColumnCount * DEFAULT_PANEL_COLUMN_WIDTH`, and otherwise falls back to
 * that preferred pixel width so panels do not fall below their default column
 * width. The result is: single-panel layouts stretch to fill a wide viewport,
 * and multi-panel layouts overflow the viewport horizontally when necessary
 * (the canvas is horizontally scrollable in tab mode).
 */
export function getPanelCanvasWidths(viewportWidth: number, panelColumnCount: number) {
  const preferredWidth = Math.max(1, panelColumnCount) * DEFAULT_PANEL_COLUMN_WIDTH;
  if (viewportWidth <= 0) {
    return { defaultWidth: preferredWidth, minWidth: 0 };
  }
  return {
    defaultWidth: Math.max(viewportWidth, preferredWidth),
    minWidth: 0,
  };
}