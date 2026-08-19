export interface PanelNavigatorRange {
  id: string;
  left: number;
  right: number;
}

export interface PanelNavigatorSegmentGeometry {
  id: string;
  start: number;
  size: number;
}

export interface PanelNavigatorGeometry {
  segments: PanelNavigatorSegmentGeometry[];
  thumbStart: number;
  thumbSize: number;
}

const EMPTY_GEOMETRY: PanelNavigatorGeometry = {
  segments: [],
  thumbStart: 0,
  thumbSize: 0,
};

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function getPanelNavigatorGeometry(
  ranges: readonly PanelNavigatorRange[],
  viewport: { left: number; right: number },
): PanelNavigatorGeometry {
  const validRanges = ranges.filter(
    (range) =>
      Number.isFinite(range.left) && Number.isFinite(range.right) && range.right > range.left,
  );
  if (validRanges.length === 0 || viewport.right <= viewport.left) return EMPTY_GEOMETRY;

  const contentLeft = Math.min(...validRanges.map((range) => range.left));
  const contentRight = Math.max(...validRanges.map((range) => range.right));
  const contentWidth = contentRight - contentLeft;
  if (contentWidth <= 0) return EMPTY_GEOMETRY;

  const visibleLeft = Math.max(contentLeft, viewport.left);
  const visibleRight = Math.min(contentRight, viewport.right);
  const thumbStart = clampUnit((visibleLeft - contentLeft) / contentWidth);
  const thumbSize = clampUnit(Math.max(0, visibleRight - visibleLeft) / contentWidth);

  return {
    segments: validRanges.map((range) => ({
      id: range.id,
      start: clampUnit((range.left - contentLeft) / contentWidth),
      size: clampUnit((range.right - range.left) / contentWidth),
    })),
    thumbStart,
    thumbSize,
  };
}
