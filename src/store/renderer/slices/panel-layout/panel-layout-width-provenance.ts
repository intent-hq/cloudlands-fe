export type PanelCanvasWidthSource = 'explicit';

export interface ResolvedPanelCanvasWidthState {
  canvasWidth: number | null;
  canvasWidthSource: PanelCanvasWidthSource | null;
}

function isUsableCanvasWidth(width: number | null | undefined): width is number {
  return typeof width === 'number' && Number.isFinite(width) && width > 0;
}

/** Legacy unprovenanced widths are automatic; only proven user widths survive restore. */
export function migratePanelCanvasWidth(
  width: number | null | undefined,
  source: PanelCanvasWidthSource | null | undefined,
): ResolvedPanelCanvasWidthState {
  if (source !== 'explicit' || !isUsableCanvasWidth(width)) {
    return { canvasWidth: null, canvasWidthSource: null };
  }
  return { canvasWidth: width, canvasWidthSource: source };
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
