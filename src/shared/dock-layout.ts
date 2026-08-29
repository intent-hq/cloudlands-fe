export const DOCK_HOVER_CARD_WIDTH = 560;
export const DOCK_RAIL_WIDTH = 64;
export const DOCK_PREVIEW_GAP = 16;
export const DOCK_WINDOW_WIDTH = DOCK_HOVER_CARD_WIDTH + DOCK_RAIL_WIDTH + DOCK_PREVIEW_GAP;

interface DockHorizontalRegion {
  x: number;
  width: number;
}

export interface DockHorizontalLayout {
  preview: DockHorizontalRegion;
  rail: DockHorizontalRegion;
}

/** Places the rail at the right edge and uses the available space to its left for preview. */
export function getDockHorizontalLayout(width: number = DOCK_WINDOW_WIDTH): DockHorizontalLayout {
  const availableWidth = Math.max(0, width);
  const railWidth = Math.min(DOCK_RAIL_WIDTH, availableWidth);
  const railX = availableWidth - railWidth;
  const previewRight = Math.max(0, railX - DOCK_PREVIEW_GAP);
  const previewWidth = Math.min(DOCK_HOVER_CARD_WIDTH, previewRight);

  return {
    preview: { x: previewRight - previewWidth, width: previewWidth },
    rail: { x: railX, width: railWidth },
  };
}
