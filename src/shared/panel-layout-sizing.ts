export const DEFAULT_PANEL_WIDTH = 480;

export type PanelCanvasSizing = 'viewport' | 'content';

function isUsableWidth(width: number | null | undefined): width is number {
  return width !== null && width !== undefined && Number.isFinite(width) && width > 0;
}

/**
 * Resolve an automatic horizontal panel-canvas width.
 *
 * Tab view uses `viewport` sizing: panels share the available width until their
 * preferred widths no longer fit, then the canvas overflows horizontally.
 * Deck view uses `content` sizing: each workspace is exactly as wide as its
 * panel content.
 */
export function getAutomaticPanelCanvasWidth(
  panelColumnCount: number,
  sizing: PanelCanvasSizing,
  viewportWidth = 0,
): number {
  const preferredWidth = Math.max(1, panelColumnCount) * DEFAULT_PANEL_WIDTH;
  return sizing === 'viewport' && viewportWidth > 0
    ? Math.max(viewportWidth, preferredWidth)
    : preferredWidth;
}

/**
 * Resolve the rendered canvas width from its intrinsic persisted width and the
 * current view policy. Tab view may stretch an intrinsic canvas to fill its
 * viewport, but deck view always preserves the content width.
 */
export function getResolvedPanelCanvasWidth(
  panelColumnCount: number,
  sizing: PanelCanvasSizing,
  viewportWidth: number,
  persistedWidth: number | null | undefined,
): number {
  const intrinsicWidth = isUsableWidth(persistedWidth)
    ? persistedWidth
    : getAutomaticPanelCanvasWidth(panelColumnCount, 'content');
  return sizing === 'viewport' && viewportWidth > 0
    ? Math.max(viewportWidth, intrinsicWidth)
    : intrinsicWidth;
}
