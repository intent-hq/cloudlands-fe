const DOCK_HOVER_CARD_WIDTH = 560;
export const DOCK_RAIL_WIDTH = 32;
export const DOCK_ISLAND_WIDTH = 32;
export const DOCK_PREVIEW_GAP = 6;
/** Covers the dark overlay's 32px blur at the CSS 1.5x clipping extent. */
export const DOCK_PREVIEW_SHADOW_INSET = 48;
export const DOCK_WINDOW_WIDTH =
  DOCK_PREVIEW_SHADOW_INSET + DOCK_HOVER_CARD_WIDTH + DOCK_ISLAND_WIDTH + DOCK_PREVIEW_GAP;

export interface DockPointerRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function isPointInDockPointerRegions(
  point: { x: number; y: number },
  regions: readonly DockPointerRect[],
): boolean {
  return regions.some(
    (region) =>
      point.x >= region.x &&
      point.x < region.x + region.width &&
      point.y >= region.y &&
      point.y < region.y + region.height,
  );
}

interface DockHorizontalRegion {
  x: number;
  width: number;
}

export interface DockHorizontalLayout {
  preview: DockHorizontalRegion;
  rail: DockHorizontalRegion;
}

interface DockPreviewVerticalLayout {
  itemTop: number;
  itemHeight: number;
  previewHeight: number;
  viewportHeight: number;
  shadowInset?: number;
}

/** Places the rail at the right edge and uses the available space to its left for preview. */
export function getDockHorizontalLayout(width: number = DOCK_WINDOW_WIDTH): DockHorizontalLayout {
  const availableWidth = Math.max(0, width);
  const railWidth = Math.min(DOCK_RAIL_WIDTH, availableWidth);
  const railX = availableWidth - railWidth;
  const islandWidth = Math.min(DOCK_ISLAND_WIDTH, availableWidth);
  const previewRight = Math.max(0, availableWidth - islandWidth - DOCK_PREVIEW_GAP);
  const previewWidth = Math.min(
    DOCK_HOVER_CARD_WIDTH,
    Math.max(0, previewRight - DOCK_PREVIEW_SHADOW_INSET),
  );
  const previewX = previewRight - previewWidth;

  return {
    preview: { x: previewX, width: previewWidth },
    rail: { x: railX, width: railWidth },
  };
}

/** Centers a preview on its item, then aligns their bottom edges when centering would overflow. */
export function getDockPreviewTop({
  itemTop,
  itemHeight,
  previewHeight,
  viewportHeight,
  shadowInset = DOCK_PREVIEW_SHADOW_INSET,
}: DockPreviewVerticalLayout): number {
  const cardHeight = Math.max(0, previewHeight);
  const viewport = Math.max(0, viewportHeight);
  const maximumInsideTop = Math.max(0, viewport - cardHeight);
  const minimumTop = Math.min(Math.max(0, shadowInset), maximumInsideTop);
  const maximumTop = Math.max(minimumTop, maximumInsideTop - Math.max(0, shadowInset));
  const centeredTop = itemTop + (itemHeight - cardHeight) / 2;
  if (centeredTop <= maximumTop) return Math.max(minimumTop, centeredTop);

  const bottomAlignedTop = itemTop + itemHeight - cardHeight;
  return Math.max(minimumTop, Math.min(bottomAlignedTop, maximumTop));
}
