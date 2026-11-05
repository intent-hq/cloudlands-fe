/**
 * Marks on the recording's frames (Capture and recording editor spec, "Drawing on
 * frames"): where the video's picture sits in its box, which marks are on screen at a
 * time, and the geometry of a new or moved mark, all in source pixels.
 */
import type { DockMediaBatch, DockMediaEditMark, DockMediaGeometry } from '$shared/dock-media-edit';

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

/**
 * Marks on screen at `ms`: drawn at or before it, until the Clear that ended their
 * batch (the end of the recording if none), as the person saw them while recording.
 */
export function marksOnFrame(
  marks: readonly DockMediaEditMark[],
  batches: readonly DockMediaBatch[],
  ms: number,
  durationMs: number,
): DockMediaEditMark[] {
  return marks.filter((mark) => {
    const until = batches.find((batch) => batch.id === mark.batchId)?.clearAtMs ?? durationMs;
    return mark.atMs <= ms && ms < Math.max(until, mark.atMs + 1);
  });
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

/** The same geometry moved by `dx`, `dy` (source pixels). */
export function moveGeometry(
  geometry: DockMediaGeometry,
  dx: number,
  dy: number,
): DockMediaGeometry {
  const at = (p: { x: number; y: number }) => ({ x: p.x + dx, y: p.y + dy });
  switch (geometry.kind) {
    case 'rect':
    case 'point':
    case 'text':
      return { ...geometry, x: geometry.x + dx, y: geometry.y + dy };
    case 'path':
      return { ...geometry, points: geometry.points.map(at) };
    case 'arrow':
      return { ...geometry, from: at(geometry.from), to: at(geometry.to) };
  }
}

/** The mark kind a frame tool draws. */
export function frameToolKind(tool: FrameTool): DockMediaEditMark['kind'] {
  return tool === 'pen' ? 'draw' : tool === 'box' ? 'box' : tool;
}
