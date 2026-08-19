export const DEFAULT_PANEL_WIDTH = 500;
export const DEFAULT_CHAT_PANEL_WIDTH = DEFAULT_PANEL_WIDTH + 200;
export const DEFAULT_MEDIUM_PANEL_WIDTH = 720;
export const DEFAULT_BROWSER_PANEL_WIDTH = 900;
export const MIN_PANEL_CANVAS_WIDTH = 280;
export const MIN_PANEL_SIZE_PERCENT = 10;
export const PANEL_SPLIT_GUTTER_WIDTH = 8;
export const CONTAINED_PANEL_INLINE_INSET = 8;
export const CONTAINED_PANEL_INLINE_CHROME = CONTAINED_PANEL_INLINE_INSET * 2;
export const PANEL_COLUMN_RAIL_WIDTH = 100;
export const FIRST_CHAT_PREFERRED_WIDTH = DEFAULT_CHAT_PANEL_WIDTH;
export const FIRST_CHAT_MIN_LAUNCHER_WIDTH = DEFAULT_PANEL_WIDTH;
export const MAX_VISIBLE_ROOT_PANEL_RESIZE_COUNT = 3;

export type PanelDefaultWidthTier = 'narrow' | 'chat' | 'medium' | 'wide';

const MEDIUM_PANEL_VIEWPORT_SHARE = 0.6;
const WIDE_PANEL_VIEWPORT_SHARE = 0.8;

/** Resolve a declared width tier against the usable panel viewport. */
export function getPanelDefaultWidth(tier: PanelDefaultWidthTier, viewportWidth = 0): number {
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) {
    if (tier === 'wide') return DEFAULT_BROWSER_PANEL_WIDTH;
    if (tier === 'medium') return DEFAULT_MEDIUM_PANEL_WIDTH;
    if (tier === 'chat') return DEFAULT_CHAT_PANEL_WIDTH;
    return DEFAULT_PANEL_WIDTH;
  }
  if (tier === 'wide') {
    return Math.max(DEFAULT_BROWSER_PANEL_WIDTH, viewportWidth * WIDE_PANEL_VIEWPORT_SHARE);
  }
  if (tier === 'medium') {
    return Math.max(DEFAULT_PANEL_WIDTH, viewportWidth * MEDIUM_PANEL_VIEWPORT_SHARE);
  }
  if (tier === 'chat') return Math.min(DEFAULT_CHAT_PANEL_WIDTH, viewportWidth);
  return DEFAULT_PANEL_WIDTH;
}

/** Keep root dividers visible only while the workspace has room for safe independent resizing. */
export function shouldShowRootPanelResizeHandles(panelCount: number): boolean {
  return (
    Number.isInteger(panelCount) &&
    panelCount > 1 &&
    panelCount <= MAX_VISIBLE_ROOT_PANEL_RESIZE_COUNT
  );
}

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

export function canUseWideFirstChatLayout(availableCanvasWidth: number): boolean {
  return (
    Number.isFinite(availableCanvasWidth) &&
    !allocatePanelWidths([DEFAULT_CHAT_PANEL_WIDTH, DEFAULT_PANEL_WIDTH], availableCanvasWidth)
      .overflows
  );
}

export function getWideFirstChatSizes(availableCanvasWidth: number): [number, number] {
  const widths = allocatePanelWidths(
    [DEFAULT_CHAT_PANEL_WIDTH, DEFAULT_PANEL_WIDTH],
    availableCanvasWidth,
  ).panelWidths;
  const total = Math.max(1, widths[0] + widths[1]);
  return [(widths[0] / total) * 100, (widths[1] / total) * 100];
}

export type PanelCanvasSizing = 'viewport' | 'content';

function isUsableWidth(width: number | null | undefined): width is number {
  return width !== null && width !== undefined && Number.isFinite(width) && width > 0;
}

export interface PanelWidthAllocation {
  panelWidths: number[];
  canvasWidth: number;
  availablePanelWidth: number;
  overflows: boolean;
}

/**
 * Allocate one non-wrapping horizontal row from its preferred panel widths.
 * `availableCanvasWidth` includes canonical inter-panel gaps; the returned
 * `availablePanelWidth` excludes them.
 */
export function allocatePanelWidths(
  preferredWidths: readonly number[],
  availableCanvasWidth = 0,
  gapWidth = PANEL_SPLIT_GUTTER_WIDTH,
): PanelWidthAllocation {
  const panelWidths = preferredWidths.map((width) =>
    isUsableWidth(width) ? width : DEFAULT_PANEL_WIDTH,
  );
  if (panelWidths.length === 0) {
    return { panelWidths: [], canvasWidth: 0, availablePanelWidth: 0, overflows: false };
  }

  const safeGapWidth = Number.isFinite(gapWidth) ? Math.max(0, gapWidth) : 0;
  const totalGapWidth = safeGapWidth * Math.max(0, panelWidths.length - 1);
  const safeAvailableCanvasWidth =
    Number.isFinite(availableCanvasWidth) && availableCanvasWidth > 0 ? availableCanvasWidth : 0;
  const availablePanelWidth = Math.max(0, safeAvailableCanvasWidth - totalGapWidth);
  const preferredPanelWidth = panelWidths.reduce((sum, width) => sum + width, 0);
  const fits = safeAvailableCanvasWidth > 0 && preferredPanelWidth <= availablePanelWidth;
  const allocatedPanelWidths = fits
    ? panelWidths.map(() => availablePanelWidth / panelWidths.length)
    : panelWidths;

  return {
    panelWidths: allocatedPanelWidths,
    canvasWidth: allocatedPanelWidths.reduce((sum, width) => sum + width, 0) + totalGapWidth,
    availablePanelWidth,
    overflows: safeAvailableCanvasWidth > 0 && !fits,
  };
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
  panelColumns: number | readonly number[],
  sizing: PanelCanvasSizing,
  viewportWidth = 0,
): number {
  const preferredWidths = Array.isArray(panelColumns)
    ? panelColumns
    : Array.from({ length: Math.max(1, panelColumns as number) }, () => DEFAULT_PANEL_WIDTH);
  return allocatePanelWidths(preferredWidths, sizing === 'viewport' ? viewportWidth : 0)
    .canvasWidth;
}

/**
 * Resolve the rendered canvas width from its intrinsic persisted width and the
 * current view policy. Tab view may stretch an intrinsic canvas to fill its
 * viewport, but deck view always preserves the content width.
 */
export function getResolvedPanelCanvasWidth(
  panelColumns: number | readonly number[],
  sizing: PanelCanvasSizing,
  viewportWidth: number,
  persistedWidth: number | null | undefined,
): number {
  if (isUsableWidth(persistedWidth)) return persistedWidth;
  const intrinsicWidth = getAutomaticPanelCanvasWidth(panelColumns, 'content');
  return sizing === 'viewport' && viewportWidth > 0
    ? Math.max(viewportWidth, intrinsicWidth)
    : intrinsicWidth;
}
