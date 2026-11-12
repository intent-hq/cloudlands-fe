import {
  dockMediaGeometryRect,
  layoutDockMediaText,
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
  measurement.textAlign = 'left';
  measurement.textBaseline = 'top';
  measurement.letterSpacing = '0px';
  measurement.wordSpacing = '0px';
  let left = Infinity,
    top = Infinity,
    right = -Infinity,
    bottom = -Infinity;
  const { lines, lineHeight } = layoutDockMediaText(geometry);
  for (const [index, line] of lines.entries()) {
    if (!line.trim()) continue;
    const ink = measurement.measureText(line);
    const lineTop = index * lineHeight;
    const values = [
      -ink.actualBoundingBoxLeft,
      lineTop - ink.actualBoundingBoxAscent,
      ink.actualBoundingBoxRight,
      lineTop + ink.actualBoundingBoxDescent,
    ];
    if (!values.every(Number.isFinite)) return bounds;
    left = Math.min(left, values[0]);
    top = Math.min(top, values[1]);
    right = Math.max(right, values[2]);
    bottom = Math.max(bottom, values[3]);
  }
  if (!(right > left && bottom > top)) return bounds;
  // Equal breathing room around actual ink, rather than the font's line box.
  const padding = Math.max(1, geometry.fontSize / 24);
  return {
    x: geometry.x + left - padding,
    y: geometry.y + top - padding,
    w: right - left + 2 * padding,
    h: bottom - top + 2 * padding,
  };
}
