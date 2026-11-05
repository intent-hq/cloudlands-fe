import type {
  DockMediaEdit,
  DockMediaSource,
  DockMediaGeometry,
  DockMediaRect,
} from '$shared/dock-media-edit';
import { screenshotContains } from './screenshot-geometry';

/** Explicit old-source to candidate-source mapping supplied by the capture owner. */
export interface ScreenshotFrameMapping {
  scaleX: number;
  scaleY: number;
  offsetX: number;
  offsetY: number;
}
export function screenshotMediaBounds(g: DockMediaGeometry): DockMediaRect {
  if (g.kind === 'rect') return { x: g.x, y: g.y, w: g.w, h: g.h };
  if (g.kind === 'text')
    return {
      x: g.x,
      y: g.y,
      w: Math.max(g.fontSize, g.text.length * g.fontSize * 0.6),
      h: g.fontSize * 1.4,
    };
  if (g.kind === 'point') return { x: g.x, y: g.y, w: 0, h: 0 };
  const points = g.kind === 'path' ? g.points : [g.from, g.to];
  const x = Math.min(...points.map((p) => p.x)),
    y = Math.min(...points.map((p) => p.y));
  return {
    x,
    y,
    w: Math.max(...points.map((p) => p.x)) - x,
    h: Math.max(...points.map((p) => p.y)) - y,
  };
}
export function cropScreenshotEdit(edit: DockMediaEdit, crop: DockMediaRect): DockMediaEdit {
  return {
    ...edit,
    crop,
    marks: edit.marks.filter((mark) =>
      screenshotContains(crop, screenshotMediaBounds(mark.geometry)),
    ),
    blurRegions: edit.blurRegions.filter((region) => screenshotContains(crop, region)),
  };
}
/** Pure candidate projection. It never reads, replaces, or discards original pixels. */
export function retakeScreenshotEdit(
  edit: DockMediaEdit,
  source: DockMediaSource,
  map: ScreenshotFrameMapping,
): DockMediaEdit {
  if (
    source.kind !== 'screenshot' ||
    edit.kind !== 'screenshot' ||
    ![map.scaleX, map.scaleY, map.offsetX, map.offsetY, source.width, source.height].every(
      Number.isFinite,
    ) ||
    map.scaleX <= 0 ||
    map.scaleY <= 0
  )
    throw new Error('Invalid screenshot candidate mapping');
  const point = (p: { x: number; y: number }) => ({
    x: p.x * map.scaleX + map.offsetX,
    y: p.y * map.scaleY + map.offsetY,
  });
  const rect = (r: DockMediaRect) => ({ ...point(r), w: r.w * map.scaleX, h: r.h * map.scaleY });
  const geometry = (g: DockMediaGeometry): DockMediaGeometry =>
    g.kind === 'rect'
      ? { kind: 'rect', ...rect(g) }
      : g.kind === 'path'
        ? { ...g, points: g.points.map(point) }
        : g.kind === 'arrow'
          ? { ...g, from: point(g.from), to: point(g.to) }
          : g.kind === 'text'
            ? { ...g, ...point(g), fontSize: g.fontSize * map.scaleY }
            : { ...g, ...point(g) };
  const bounds = { x: 0, y: 0, w: source.width, h: source.height };
  const projected = {
    ...edit,
    sourceId: source.id,
    sourceRevision: source.revision,
    marks: edit.marks
      .map((mark) => ({ ...mark, geometry: geometry(mark.geometry) }))
      .filter((mark) => screenshotContains(bounds, screenshotMediaBounds(mark.geometry))),
    blurRegions: edit.blurRegions
      .map((region) => ({ id: region.id, ...rect(region) }))
      .filter((region) => screenshotContains(bounds, region)),
    crop: null,
  };
  if (!edit.crop) return projected;
  const mapped = rect(edit.crop),
    x = Math.max(0, mapped.x),
    y = Math.max(0, mapped.y),
    right = Math.min(source.width, mapped.x + mapped.w),
    bottom = Math.min(source.height, mapped.y + mapped.h);
  return right > x && bottom > y
    ? cropScreenshotEdit(projected, { x, y, w: right - x, h: bottom - y })
    : projected;
}
