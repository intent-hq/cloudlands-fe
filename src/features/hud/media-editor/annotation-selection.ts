import {
  dockMediaGeometryRect,
  transformDockMediaText,
  type DockMediaGeometry,
  type DockMediaRect,
} from '$shared/dock-media-edit';
import { fitScreenshotGeometry } from './screenshot/screenshot-geometry';

export type AnnotationHandleId = 'nw' | 'ne' | 'se' | 'sw' | 'from' | 'to' | 'move';
/** UI handles only; never part of the canonical paint/export display list. */
export function annotationHandles(geometry: DockMediaGeometry) {
  if (geometry.kind === 'arrow')
    return [
      { id: 'from' as const, ...geometry.from },
      { id: 'to' as const, ...geometry.to },
    ];
  if (geometry.kind === 'point') return [{ id: 'move' as const, x: geometry.x, y: geometry.y }];
  const b = dockMediaGeometryRect(geometry);
  return [
    { id: 'nw' as const, x: b.x, y: b.y },
    { id: 'ne' as const, x: b.x + b.w, y: b.y },
    { id: 'se' as const, x: b.x + b.w, y: b.y + b.h },
    { id: 'sw' as const, x: b.x, y: b.y + b.h },
  ];
}

/** An invisible grip is larger than its paint: use deltas so its grab never snaps. */
export function resizeAnnotationGeometry<G extends DockMediaGeometry>(
  geometry: G,
  handle: AnnotationHandleId,
  dx: number,
  dy: number,
  frame: DockMediaRect,
): G {
  const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
  if (geometry.kind === 'arrow' && (handle === 'from' || handle === 'to')) {
    const p = geometry[handle],
      other = geometry[handle === 'from' ? 'to' : 'from'];
    const next = {
      x: clamp(p.x + dx, frame.x, frame.x + frame.w),
      y: clamp(p.y + dy, frame.y, frame.y + frame.h),
    };
    return Math.hypot(next.x - other.x, next.y - other.y) < 2
      ? geometry
      : { ...geometry, [handle]: next };
  }
  if (geometry.kind === 'point' && handle === 'move') {
    const bounds = dockMediaGeometryRect(geometry);
    return {
      ...geometry,
      x: geometry.x + clamp(dx, frame.x - bounds.x, frame.x + frame.w - bounds.x - bounds.w),
      y: geometry.y + clamp(dy, frame.y - bounds.y, frame.y + frame.h - bounds.y - bounds.h),
    };
  }
  if (geometry.kind === 'point' || handle === 'move') return geometry;
  const b = dockMediaGeometryRect(geometry),
    right = b.x + b.w,
    bottom = b.y + b.h;
  const left = handle.includes('w') ? clamp(b.x + dx, frame.x, right - Math.min(2, frame.w)) : b.x;
  const top = handle.includes('n') ? clamp(b.y + dy, frame.y, bottom - Math.min(2, frame.h)) : b.y;
  const nextRight = handle.includes('e')
    ? clamp(right + dx, b.x + Math.min(2, frame.w), frame.x + frame.w)
    : right;
  const nextBottom = handle.includes('s')
    ? clamp(bottom + dy, b.y + Math.min(2, frame.h), frame.y + frame.h)
    : bottom;
  if (geometry.kind === 'text') {
    try {
      return transformDockMediaText(geometry, {
        scaleX: (nextRight - left) / Math.max(0.0001, b.w),
        scaleY: (nextBottom - top) / Math.max(0.0001, b.h),
        offsetX: left - (b.x * (nextRight - left)) / Math.max(0.0001, b.w),
        offsetY: top - (b.y * (nextBottom - top)) / Math.max(0.0001, b.h),
      }) as G;
    } catch {
      return geometry;
    } // A drag cannot manufacture an out-of-schema label.
  }
  return fitScreenshotGeometry(geometry, {
    x: left,
    y: top,
    w: nextRight - left,
    h: nextBottom - top,
  }) as G;
}
