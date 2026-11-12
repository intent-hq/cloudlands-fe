/**
 * Marks on the recording's frames (Capture and recording editor spec, "Drawing on
 * frames"): where the video's picture sits in its box, and the geometry of a new,
 * moved or resized mark, all in source pixels.
 */
import {
  dockMediaGeometryRect,
  type DockMediaEditMark,
  type DockMediaGeometry,
  type DockMediaRect,
} from '$shared/dock-media-edit';
import { moveScreenshotGeometry } from '../screenshot/screenshot-geometry';

export interface FrameBox {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Source pixels per CSS pixel. */
  scale: number;
}

/** The picture of a `sourceWidth`×`sourceHeight` video fitted (contain) into a box. */
export function frameBox(
  boxWidth: number,
  boxHeight: number,
  sourceWidth: number,
  sourceHeight: number,
): FrameBox | null {
  if (boxWidth <= 0 || boxHeight <= 0 || sourceWidth <= 0 || sourceHeight <= 0) return null;
  const fit = Math.min(boxWidth / sourceWidth, boxHeight / sourceHeight);
  const width = sourceWidth * fit;
  const height = sourceHeight * fit;
  return { x: (boxWidth - width) / 2, y: (boxHeight - height) / 2, width, height, scale: 1 / fit };
}

export type FrameTool = 'box' | 'pen' | 'arrow' | 'text';

/** The geometry a drag from `from` to `to` (source pixels) draws with `tool`. */
export function dragGeometry(
  tool: Exclude<FrameTool, 'text'>,
  points: readonly { x: number; y: number }[],
): DockMediaGeometry | null {
  const first = points[0];
  const last = points.at(-1);
  if (!first || !last) return null;
  if (tool === 'box') {
    const w = Math.abs(last.x - first.x);
    const h = Math.abs(last.y - first.y);
    if (w < 2 || h < 2) return null;
    return { kind: 'rect', x: Math.min(first.x, last.x), y: Math.min(first.y, last.y), w, h };
  }
  if (tool === 'arrow') {
    if (Math.hypot(last.x - first.x, last.y - first.y) < 4) return null;
    return { kind: 'arrow', from: { ...first }, to: { ...last } };
  }
  return points.length > 1
    ? { kind: 'path', points: points.slice(0, 4096).map((p) => ({ ...p })) }
    : null;
}

/** The source's whole picture, the bounds every frame mark stays inside. */
function frameOf(width: number, height: number): DockMediaRect {
  return { x: 0, y: 0, w: width, h: height };
}

/**
 * The same geometry moved by `dx`, `dy` (source pixels), kept inside the picture.
 * Boxes, strokes and arrows use the screenshot editor's move; points and text, which
 * it does not have, are clamped the same way by their bounds.
 */
export function moveFrameGeometry(
  geometry: DockMediaGeometry,
  dx: number,
  dy: number,
  width: number,
  height: number,
): DockMediaGeometry {
  if (geometry.kind === 'rect' || geometry.kind === 'path' || geometry.kind === 'arrow')
    return moveScreenshotGeometry(geometry, { x: dx, y: dy }, frameOf(width, height));
  const bounds = dockMediaGeometryRect(geometry);
  const x = Math.max(-bounds.x, Math.min(dx, width - bounds.x - bounds.w));
  const y = Math.max(-bounds.y, Math.min(dy, height - bounds.y - bounds.h));
  return { ...geometry, x: geometry.x + x, y: geometry.y + y };
}

/** The mark kind a frame tool draws. */
export function frameToolKind(tool: FrameTool): DockMediaEditMark['kind'] {
  return tool === 'pen' ? 'draw' : tool === 'box' ? 'box' : tool;
}
