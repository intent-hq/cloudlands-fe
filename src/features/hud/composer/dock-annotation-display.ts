import {
  dockMediaGeometryRect,
  type DockMediaGeometry,
  type DockMediaRect,
} from '$shared/dock-media-edit';
import { dockAnnotationFontFamily } from './dock-annotation-font';

let measurement: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null;
/** Presentation only: model admission, crop and fixed-width wrapping retain their contract. */
export function dockAnnotationDisplayBounds(geometry: DockMediaGeometry): DockMediaRect {
  const bounds = dockMediaGeometryRect(geometry);
  if (geometry.kind !== 'text' || geometry.style === 'sticky') return bounds;
  if (!measurement) {
    measurement =
      typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(1, 1).getContext('2d')
        : typeof document !== 'undefined'
          ? document.createElement('canvas').getContext('2d')
          : null;
  }
  if (!measurement) return bounds;
  measurement.font = `${geometry.fontSize}px ${dockAnnotationFontFamily()}`;
  return {
    ...bounds,
    w: Math.max(
      1,
      ...geometry.text.split('\n').map((line) => measurement!.measureText(line).width),
    ),
  };
}
