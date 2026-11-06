import type {
  DockMediaEdit,
  DockMediaSource,
  DockMediaGeometry,
  DockMediaRect,
} from '$shared/dock-media-edit';
import {
  DockMediaRectSchema,
  dockMediaGeometryRect,
  transformDockMediaBlurStroke,
  transformDockMediaText,
} from '$shared/dock-media-edit';

/** Explicit old-source to candidate-source mapping supplied by the capture owner. */
export interface ScreenshotFrameMapping {
  scaleX: number;
  scaleY: number;
  offsetX: number;
  offsetY: number;
}
function intersection(a: DockMediaRect, b: DockMediaRect): DockMediaRect | null {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.w, b.x + b.w), bottom = Math.min(a.y + a.h, b.y + b.h);
  return right > x && bottom > y ? { x, y, w: right - x, h: bottom - y } : null;
}
function contains(outer: DockMediaRect, inner: DockMediaRect): boolean {
  return inner.x >= outer.x && inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;
}
export function cropScreenshotEdit(edit: DockMediaEdit, crop: DockMediaRect): DockMediaEdit {
  const frame = DockMediaRectSchema.parse(crop);
  return {
    ...edit,
    crop: frame,
    marks: edit.marks.filter((mark) => contains(frame, dockMediaGeometryRect(mark.geometry))),
    // Keep every covered pixel that intersects the crop, including crossing rectangles.
    blurRegions: edit.blurRegions.flatMap((region) => {
      const clipped = intersection(region, frame);
      return clipped ? [{ id: region.id, ...clipped }] : [];
    }),
    // Crop is a viewport, not a path edit. Removing outside points would join
    // unrelated segments or erase the part of a disk that crosses the edge.
    ...(edit.blurStrokes ? { blurStrokes: edit.blurStrokes } : {}),
  };
}
/** Pure candidate projection. Failure leaves the original transaction untouched. */
export function retakeScreenshotEdit(
  edit: DockMediaEdit,
  source: DockMediaSource,
  map: ScreenshotFrameMapping,
): DockMediaEdit {
  if (
    source.kind !== 'screenshot' || edit.kind !== 'screenshot' ||
    ![map.scaleX, map.scaleY, map.offsetX, map.offsetY, source.width, source.height].every(Number.isFinite) ||
    source.width <= 0 || source.height <= 0 || map.scaleX <= 0 || map.scaleY <= 0
  ) throw new Error('Invalid screenshot candidate mapping');
  const point = (p: { x: number; y: number }) => ({
    x: p.x * map.scaleX + map.offsetX, y: p.y * map.scaleY + map.offsetY,
  });
  const rect = (r: DockMediaRect): DockMediaRect => ({ ...point(r), w: r.w * map.scaleX, h: r.h * map.scaleY });
  const geometry = (g: DockMediaGeometry): DockMediaGeometry =>
    g.kind === 'rect' ? { kind: 'rect', ...rect(g) }
      : g.kind === 'path' ? { ...g, points: g.points.map(point) }
        : g.kind === 'arrow' ? { ...g, from: point(g.from), to: point(g.to) }
          : g.kind === 'text' ? transformDockMediaText(g, map) : { ...g, ...point(g) };
  const bounds = { x: 0, y: 0, w: source.width, h: source.height };
  const strokes = edit.blurStrokes?.map((stroke) => transformDockMediaBlurStroke(stroke, map));
  // The canonical brush validator admits source-contained centers. Never prune
  // or reconnect a mapped path to make it valid: refuse the candidate instead.
  if (strokes?.some((stroke) => stroke.points.some((p) =>
    p.x < 0 || p.y < 0 || p.x > source.width || p.y > source.height)))
    throw new Error('Retake cannot preserve blur coverage in the candidate frame');
  const projected: DockMediaEdit = {
    ...edit,
    sourceId: source.id,
    sourceRevision: source.revision,
    marks: edit.marks.map((mark) => ({ ...mark, geometry: geometry(mark.geometry) }))
      .filter((mark) => contains(bounds, dockMediaGeometryRect(mark.geometry))),
    blurRegions: edit.blurRegions.flatMap((region) => {
      const clipped = intersection(rect(region), bounds);
      return clipped ? [{ id: region.id, ...clipped }] : [];
    }),
    ...(strokes ? { blurStrokes: strokes } : {}),
    crop: null,
  };
  if (!edit.crop) return projected;
  const crop = intersection(rect(edit.crop), bounds);
  if (!crop) throw new Error('Retake cannot preserve the crop in the candidate frame');
  return cropScreenshotEdit(projected, crop);
}
