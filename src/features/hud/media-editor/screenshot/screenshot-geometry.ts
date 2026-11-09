import { dockFreehandPath } from '$features/hud/composer/dock-freehand-path';
import { dockGeometryRect, mapDockGeometry } from '$shared/dock-annotation';
import type { DockImagePoint, DockImageRect, DockMarkGeometry } from '$shared/dock-evidence';

/** All coordinates are immutable-source image pixels, independent of canvas zoom. */
export function screenshotPoint(
  client: DockImagePoint,
  viewport: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
  frame: DockImageRect,
): DockImagePoint {
  return {
    x:
      frame.x +
      Math.max(0, Math.min(1, (client.x - viewport.left) / Math.max(1, viewport.width))) * frame.w,
    y:
      frame.y +
      Math.max(0, Math.min(1, (client.y - viewport.top) / Math.max(1, viewport.height))) * frame.h,
  };
}

export function screenshotRect(a: DockImagePoint, b: DockImagePoint): DockImageRect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(b.x - a.x),
    h: Math.abs(b.y - a.y),
  };
}

export function screenshotContains(frame: DockImageRect, bounds: DockImageRect): boolean {
  return (
    bounds.x >= frame.x &&
    bounds.y >= frame.y &&
    bounds.x + bounds.w <= frame.x + frame.w &&
    bounds.y + bounds.h <= frame.y + frame.h
  );
}

/** Preserve every point and its proportions when moving or resizing a mark. */
export function fitScreenshotGeometry(
  geometry: DockMarkGeometry,
  target: DockImageRect,
): DockMarkGeometry {
  const bounds = dockGeometryRect(geometry);
  return mapDockGeometry(geometry, (point) => ({
    x: target.x + (bounds.w ? (point.x - bounds.x) / bounds.w : 0.5) * target.w,
    y: target.y + (bounds.h ? (point.y - bounds.y) / bounds.h : 0.5) * target.h,
  }));
}

export function moveScreenshotGeometry(
  geometry: DockMarkGeometry,
  delta: DockImagePoint,
  frame: DockImageRect,
): DockMarkGeometry {
  const bounds = dockGeometryRect(geometry);
  const dx = Math.max(
    frame.x - bounds.x,
    Math.min(delta.x, frame.x + frame.w - bounds.x - bounds.w),
  );
  const dy = Math.max(
    frame.y - bounds.y,
    Math.min(delta.y, frame.y + frame.h - bounds.y - bounds.h),
  );
  return mapDockGeometry(geometry, (point) => ({ x: point.x + dx, y: point.y + dy }));
}

export function screenshotPath(geometry: DockMarkGeometry, smoothInk = false): string {
  if (smoothInk && geometry.kind === 'path') return dockFreehandPath(geometry.points);
  const points =
    geometry.kind === 'path'
      ? geometry.points
      : geometry.kind === 'arrow'
        ? [geometry.from, geometry.to]
        : [];
  return points.map((point, i) => `${i ? 'L' : 'M'}${point.x},${point.y}`).join(' ');
}
