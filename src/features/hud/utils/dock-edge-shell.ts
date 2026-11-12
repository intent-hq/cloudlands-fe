import type { DockPointerRect } from '$shared/dock-layout';

/**
 * Where a clicked side entry's conversation box comes from and returns to (window-local
 * DIP): the entry's hover card (its rect and corner radius, or where that card would
 * be when none was showing) and the entry's vertical centre, which anchors the box.
 */
export interface DockEdgeOpenOrigin {
  workspaceId: string;
  card: DockPointerRect;
  radius: number;
  entryCentre: number;
}

/** Linear blend of two rects (0 = `from`, 1 = `to`). */
export function dockLerpRect(
  from: DockPointerRect,
  to: DockPointerRect,
  t: number,
): DockPointerRect {
  const k = Math.max(0, Math.min(1, t));
  const lerp = (a: number, b: number) => a + (b - a) * k;
  return {
    x: lerp(from.x, to.x),
    y: lerp(from.y, to.y),
    width: lerp(from.width, to.width),
    height: lerp(from.height, to.height),
  };
}
