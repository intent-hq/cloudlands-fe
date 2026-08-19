export type PanelCanvasWidthSource = 'explicit' | 'intrinsic';

export interface ResolvedPanelCanvasWidthState {
  canvasWidth: number | null;
  canvasWidthSource: PanelCanvasWidthSource | null;
}

function isUsableCanvasWidth(width: number | null | undefined): width is number {
  return typeof width === 'number' && Number.isFinite(width) && width > 0;
}

/** Legacy unprovenanced widths are automatic; only proven widths survive restore. */
export function migratePanelCanvasWidth(
  width: number | null | undefined,
  source: PanelCanvasWidthSource | null | undefined,
): ResolvedPanelCanvasWidthState {
  if ((source !== 'explicit' && source !== 'intrinsic') || !isUsableCanvasWidth(width)) {
    return { canvasWidth: null, canvasWidthSource: null };
  }
  return { canvasWidth: width, canvasWidthSource: source };
}

/** Keep a product-defined content width responsive without treating it as a user resize. */
export function resolveIntrinsicPanelCanvasWidth(width: number): ResolvedPanelCanvasWidthState {
  return isUsableCanvasWidth(width)
    ? { canvasWidth: width, canvasWidthSource: 'intrinsic' }
    : { canvasWidth: null, canvasWidthSource: null };
}

/** Direct initialization is explicit by default; storage restore migrates before dispatch. */
export function initializePanelCanvasWidth(
  width: number | null | undefined,
  source: PanelCanvasWidthSource | null | undefined,
): ResolvedPanelCanvasWidthState {
  if (!isUsableCanvasWidth(width)) return { canvasWidth: null, canvasWidthSource: null };
  return {
    canvasWidth: width,
    canvasWidthSource: source === undefined ? 'explicit' : source,
  };
}

/** Only an explicit reset gesture clears provenance; ordinary drags are always explicit. */
export function resolveUserPanelCanvasResize(
  width: number,
  automaticWidth: number,
  resetToAutomatic = false,
): ResolvedPanelCanvasWidthState {
  if (resetToAutomatic && width === automaticWidth) {
    return { canvasWidth: null, canvasWidthSource: null };
  }
  return { canvasWidth: width, canvasWidthSource: 'explicit' };
}
