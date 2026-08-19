export const DEFAULT_PANEL_WIDTH = 500;
export const DEFAULT_CHAT_PANEL_WIDTH = DEFAULT_PANEL_WIDTH + 200;
export const DEFAULT_MEDIUM_PANEL_WIDTH = 720;
export const DEFAULT_BROWSER_PANEL_WIDTH = 900;
export const MAX_AUTOMATIC_PANEL_WIDTH = 1200;
export const MIN_PANEL_CANVAS_WIDTH = 280;
export const MIN_PANEL_SIZE_PERCENT = 10;
export const PANEL_SPLIT_GUTTER_WIDTH = 8;
export const CONTAINED_PANEL_INLINE_INSET = 8;
export const CONTAINED_PANEL_INLINE_CHROME = CONTAINED_PANEL_INLINE_INSET * 2;
export const FIRST_CHAT_PREFERRED_WIDTH = DEFAULT_CHAT_PANEL_WIDTH;
export const FIRST_CHAT_MIN_LAUNCHER_WIDTH = DEFAULT_PANEL_WIDTH;

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

export interface ProportionalPanelResize {
  panelWidths: number[];
  acceptedDelta: number;
}

function allocateWidthsWithMinimum(
  weights: readonly number[],
  totalWidth: number,
  minimumWidth: number,
): number[] {
  if (weights.length === 0) return [];
  if (totalWidth <= 0) return weights.map(() => 0);

  const nextWidths = weights.map(() => 0);
  let remainingWidth = totalWidth;
  let active = weights.map((width, index) => ({ width: Math.max(0, width), index }));
  while (active.length > 0) {
    const activeTotal = active.reduce((sum, item) => sum + item.width, 0);
    if (activeTotal <= 0) {
      const equalWidth = remainingWidth / active.length;
      active.forEach((item) => {
        nextWidths[item.index] = equalWidth;
      });
      break;
    }
    const saturated = active.filter(
      (item) => (item.width / activeTotal) * remainingWidth < minimumWidth,
    );
    if (saturated.length === 0) {
      active.forEach((item) => {
        nextWidths[item.index] = (item.width / activeTotal) * remainingWidth;
      });
      break;
    }
    saturated.forEach((item) => {
      nextWidths[item.index] = minimumWidth;
    });
    remainingWidth -= minimumWidth * saturated.length;
    const saturatedIndexes = new Set(saturated.map((item) => item.index));
    active = active.filter((item) => !saturatedIndexes.has(item.index));
  }
  return nextWidths;
}

/**
 * Resize the panel before a root divider and distribute the opposite delta
 * proportionally across every panel to its right. The total width is fixed.
 */
export function resizePanelWidthsAtDivider(
  panelWidths: readonly number[],
  dividerIndex: number,
  requestedDelta: number,
): ProportionalPanelResize {
  const finiteTotal = panelWidths.reduce(
    (sum, width) => sum + (Number.isFinite(width) ? width : 0),
    0,
  );
  const positiveWidths = panelWidths.map((width) =>
    Number.isFinite(width) ? Math.max(0, width) : 0,
  );
  const positiveTotal = positiveWidths.reduce((sum, width) => sum + width, 0);
  const totalWidth = finiteTotal > 0 ? finiteTotal : positiveTotal;
  const minimumWidth =
    panelWidths.length > 0
      ? Math.min(totalWidth / panelWidths.length, (totalWidth * MIN_PANEL_SIZE_PERCENT) / 100)
      : 0;
  if (panelWidths.some((width) => !isUsableWidth(width) || width < minimumWidth)) {
    return {
      panelWidths: allocateWidthsWithMinimum(positiveWidths, totalWidth, minimumWidth),
      acceptedDelta: 0,
    };
  }

  if (
    panelWidths.length < 2 ||
    !Number.isInteger(dividerIndex) ||
    dividerIndex < 0 ||
    dividerIndex >= panelWidths.length - 1 ||
    !Number.isFinite(requestedDelta)
  ) {
    return { panelWidths: [...panelWidths], acceptedDelta: 0 };
  }

  const referenceWidth = panelWidths[dividerIndex];
  const rightWidths = panelWidths.slice(dividerIndex + 1);
  const maximumGrowth = rightWidths.reduce(
    (sum, width) => sum + Math.max(0, width - minimumWidth),
    0,
  );
  const acceptedDelta = Math.min(
    maximumGrowth,
    Math.max(minimumWidth - referenceWidth, requestedDelta),
  );
  if (acceptedDelta === 0) return { panelWidths: [...panelWidths], acceptedDelta: 0 };

  const nextWidths = [...panelWidths];
  nextWidths[dividerIndex] = referenceWidth + acceptedDelta;
  const targetRightWidth = rightWidths.reduce((sum, width) => sum + width, 0) - acceptedDelta;

  if (acceptedDelta < 0) {
    const scale = targetRightWidth / rightWidths.reduce((sum, width) => sum + width, 0);
    rightWidths.forEach((width, index) => {
      nextWidths[dividerIndex + 1 + index] = width * scale;
    });
    return { panelWidths: nextWidths, acceptedDelta };
  }

  const resizedRightWidths = allocateWidthsWithMinimum(rightWidths, targetRightWidth, minimumWidth);
  resizedRightWidths.forEach((width, index) => {
    nextWidths[dividerIndex + 1 + index] = width;
  });

  return { panelWidths: nextWidths, acceptedDelta };
}

/** Equal automatic root columns fit the viewport until every panel reaches its cap. */
export function allocateAutomaticPanelWidths(
  panelCount: number,
  availableCanvasWidth: number,
  gapWidth = PANEL_SPLIT_GUTTER_WIDTH,
): PanelWidthAllocation {
  const count = Number.isInteger(panelCount) && panelCount > 0 ? panelCount : 1;
  if (!isUsableWidth(availableCanvasWidth)) {
    return allocatePanelWidths(
      Array.from({ length: count }, () => DEFAULT_PANEL_WIDTH),
      0,
      gapWidth,
    );
  }
  const safeGapWidth = Number.isFinite(gapWidth) ? Math.max(0, gapWidth) : 0;
  const totalGapWidth = safeGapWidth * Math.max(0, count - 1);
  const availablePanelWidth = Math.max(0, availableCanvasWidth - totalGapWidth);
  const panelWidth = Math.min(MAX_AUTOMATIC_PANEL_WIDTH, availablePanelWidth / count);
  const panelWidths = Array.from({ length: count }, () => panelWidth);
  return {
    panelWidths,
    canvasWidth: panelWidth * count + totalGapWidth,
    availablePanelWidth,
    overflows: false,
  };
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
  return sizing === 'viewport'
    ? allocateAutomaticPanelWidths(preferredWidths.length, viewportWidth).canvasWidth
    : allocatePanelWidths(preferredWidths, 0).canvasWidth;
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
  return getAutomaticPanelCanvasWidth(panelColumns, sizing, viewportWidth);
}
