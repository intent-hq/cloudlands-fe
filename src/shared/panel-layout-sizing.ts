export const DEFAULT_PANEL_WIDTH = 480;
export const MIN_PANEL_SIZE_PERCENT = 10;

/**
 * Clamp a root-panel resize so the target alone can absorb the accepted delta.
 * The minimum is expressed against the resized canvas, matching persisted
 * percentage sizing without changing any sibling pixel width.
 */
export function getAcceptedIndependentPanelResizeWidth(
  previousReferenceWidth: number,
  previousTargetWidth: number,
  requestedNextReferenceWidth: number,
): number {
  if (
    !Number.isFinite(previousReferenceWidth) ||
    !Number.isFinite(previousTargetWidth) ||
    !Number.isFinite(requestedNextReferenceWidth) ||
    previousReferenceWidth <= 0 ||
    previousTargetWidth <= 0
  ) {
    return previousReferenceWidth;
  }

  const minimumShare = MIN_PANEL_SIZE_PERCENT / 100;
  const minimumDeltaForShare =
    (minimumShare * previousReferenceWidth - previousTargetWidth) / (1 - minimumShare);
  const minimumDelta = Math.min(0, Math.max(1 - previousTargetWidth, minimumDeltaForShare));
  const requestedDelta = requestedNextReferenceWidth - previousReferenceWidth;
  return previousReferenceWidth + Math.max(minimumDelta, requestedDelta);
}

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
