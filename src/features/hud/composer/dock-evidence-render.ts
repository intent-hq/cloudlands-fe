/**
 * Burns numbered marks into a screenshot so a vision model sees the numbers the
 * text references. Layout is a pure display list (testable); painting is a thin
 * canvas pass. Output goes through the canonical agent image optimizer.
 */
import type { DockEvidenceImage, DockMark } from '$shared/dock-evidence';
import { resizeImageForAgent } from '$lib/utils/image-resize';
import { arrayBufferToBase64 } from '$features/voice/utils/wav-encoder';

/**
 * Raster burn colors mirror the dock mark specification (citrus mark, near-black
 * numeral). They are pixels in the sent image, not UI tokens.
 */
const DOCK_MARK_BURN_STYLE = {
  accent: '#DDEC61',
  ink: '#080808',
  /** Badge diameter and stroke widths in display points; scaled by displayScale. */
  badge: 18,
  stroke: 2,
  pen: 2.5,
  arrowHead: 14,
} as const;

export type DockBurnOp =
  | { kind: 'rect'; x: number; y: number; w: number; h: number; width: number }
  | { kind: 'path'; points: { x: number; y: number }[]; width: number }
  | {
      kind: 'arrow';
      from: { x: number; y: number };
      to: { x: number; y: number };
      head: { left: { x: number; y: number }; right: { x: number; y: number } };
      width: number;
    }
  | { kind: 'badge'; x: number; y: number; radius: number; label: string; font: number };

/**
 * Display list in output pixels. `scale` maps image pixels to output pixels;
 * stroke and badge sizes follow the capture's display scale so they read the
 * same as on screen, then shrink with the output.
 */
export function layoutDockBurn(
  image: Pick<DockEvidenceImage, 'width' | 'height' | 'displayScale'>,
  marks: readonly { n: number; mark: DockMark }[],
  scale = 1,
  /** Keeps numbers legible on small previews. */
  minBadgeRadius = 0,
): DockBurnOp[] {
  const unit = Math.max(1, image.displayScale) * scale;
  const ops: DockBurnOp[] = [];
  const at = (value: number) => value * scale;
  for (const { n, mark } of marks) {
    const g = mark.geometry;
    if (g.kind === 'rect')
      ops.push({
        kind: 'rect',
        x: at(g.x),
        y: at(g.y),
        w: at(g.w),
        h: at(g.h),
        width: DOCK_MARK_BURN_STYLE.stroke * unit,
      });
    else if (g.kind === 'path')
      ops.push({
        kind: 'path',
        points: g.points.map((p) => ({ x: at(p.x), y: at(p.y) })),
        width: DOCK_MARK_BURN_STYLE.pen * unit,
      });
    else {
      const from = { x: at(g.from.x), y: at(g.from.y) };
      const to = { x: at(g.to.x), y: at(g.to.y) };
      ops.push({
        kind: 'arrow',
        from,
        to,
        head: arrowHeadPoints(from, to, DOCK_MARK_BURN_STYLE.arrowHead * unit),
        width: DOCK_MARK_BURN_STYLE.stroke * unit,
      });
    }
    // Badge at the mark's top-right, kept fully inside the image.
    const radius = Math.max(minBadgeRadius, (DOCK_MARK_BURN_STYLE.badge / 2) * unit);
    const right = at(mark.bounds.x + mark.bounds.w);
    const top = at(mark.bounds.y);
    ops.push({
      kind: 'badge',
      x: Math.min(at(image.width) - radius, Math.max(radius, right)),
      y: Math.min(at(image.height) - radius, Math.max(radius, top)),
      radius,
      label: String(n),
      font: radius * 1.2,
    });
  }
  return ops;
}

interface Painter {
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  lineCap: CanvasLineCap;
  lineJoin: CanvasLineJoin;
  font: string;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  closePath(): void;
  arc(x: number, y: number, r: number, start: number, end: number): void;
  stroke(): void;
  fill(): void;
  strokeRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number): void;
}

function paintDockBurn(context: Painter, ops: readonly DockBurnOp[]): void {
  context.strokeStyle = DOCK_MARK_BURN_STYLE.accent;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  for (const op of ops) {
    if (op.kind === 'rect') {
      context.lineWidth = op.width;
      context.strokeRect(op.x, op.y, op.w, op.h);
    } else if (op.kind === 'path' || op.kind === 'arrow') {
      context.lineWidth = op.width;
      context.beginPath();
      const points = op.kind === 'path' ? op.points : [op.from, op.to];
      points.forEach((p, i) => (i ? context.lineTo(p.x, p.y) : context.moveTo(p.x, p.y)));
      if (op.kind === 'arrow') {
        context.moveTo(op.head.left.x, op.head.left.y);
        context.lineTo(op.to.x, op.to.y);
        context.lineTo(op.head.right.x, op.head.right.y);
      }
      context.stroke();
    } else {
      context.fillStyle = DOCK_MARK_BURN_STYLE.accent;
      context.beginPath();
      context.arc(op.x, op.y, op.radius, 0, Math.PI * 2);
      context.closePath();
      context.fill();
      context.fillStyle = DOCK_MARK_BURN_STYLE.ink;
      context.font = `600 ${op.font}px system-ui, sans-serif`;
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText(op.label, op.x, op.y);
    }
  }
}

async function decode(base64: string, mimeType: string): Promise<ImageBitmap> {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return createImageBitmap(new Blob([bytes], { type: mimeType }));
}

async function encode(canvas: OffscreenCanvas): Promise<string> {
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  return arrayBufferToBase64(await blob.arrayBuffer());
}

async function burn(
  source: { base64: string; mimeType: string },
  image: DockEvidenceImage,
  marks: readonly { n: number; mark: DockMark }[],
  longEdge: number,
  minBadgeRadius = 0,
): Promise<OffscreenCanvas> {
  const bitmap = await decode(source.base64, source.mimeType);
  try {
    const scale = Math.min(1, longEdge / Math.max(image.width, image.height));
    const canvas = new OffscreenCanvas(
      Math.max(1, Math.round(image.width * scale)),
      Math.max(1, Math.round(image.height * scale)),
    );
    const context = canvas.getContext('2d');
    if (!context) throw new Error('dock-evidence-canvas-unavailable');
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    paintDockBurn(context, layoutDockBurn(image, marks, scale, minBadgeRadius));
    return canvas;
  } finally {
    bitmap.close();
  }
}

/**
 * Send-time composite: full-resolution burn, then the canonical agent optimizer
 * (bounded dimensions, JPEG for opaque screenshots) to stay inside wire caps.
 */
export async function burnDockEvidenceImage(
  source: { base64: string; mimeType: string },
  image: DockEvidenceImage,
  marks: readonly { n: number; mark: DockMark }[],
): Promise<{ base64: string; mimeType: string }> {
  const canvas = await burn(source, image, marks, Math.max(image.width, image.height));
  return resizeImageForAgent(await encode(canvas), 'image/png');
}

/** Tile preview as an object URL; the caller owns `URL.revokeObjectURL`. */
export async function createDockEvidencePreviewUrl(
  source: { base64: string; mimeType: string },
  image: DockEvidenceImage,
  marks: readonly { n: number; mark: DockMark }[],
  longEdge = 384,
): Promise<string> {
  // A 96px tile still needs a readable numeral.
  const canvas = await burn(source, image, marks, longEdge, longEdge / 32);
  return URL.createObjectURL(await canvas.convertToBlob({ type: 'image/png' }));
}

/** Arrow head wing points at `end`, 30° either side of the shaft. */
function arrowHeadPoints(
  origin: { x: number; y: number },
  end: { x: number; y: number },
  headLength = 14,
) {
  const angle = Math.atan2(end.y - origin.y, end.x - origin.x);
  const spread = Math.PI / 6;
  return {
    left: {
      x: end.x - headLength * Math.cos(angle - spread),
      y: end.y - headLength * Math.sin(angle - spread),
    },
    right: {
      x: end.x - headLength * Math.cos(angle + spread),
      y: end.y - headLength * Math.sin(angle + spread),
    },
  };
}
