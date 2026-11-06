import { recordedMarkProgress } from '$shared/dock-media-animation';
import { gestureGeometryAt } from '$shared/dock-gesture-progress';
/** One raster display list for capture-editor preview, screenshot output and video overlays. */
import {
  numberDockMediaMarks,
  dockMediaGeometryRect,
  DOCK_MEDIA_POINT_RADIUS,
  DOCK_MEDIA_BLUR_RADIUS,
  layoutDockMediaText,
  planDockMediaOutput,
  type DockMediaEdit,
  type DockMediaSource,
  type DockMediaGeometry,
} from '$shared/dock-media-edit';
import { arrayBufferToBase64 } from '$features/voice/utils/wav-encoder';

export const DOCK_MEDIA_PAINT = {
  accent: '#DDEC61',
  ink: '#080808',
  stroke: 3,
  pen: 3.5,
  badgeRadius: 11,
  arrowHead: 16,
  halo: 'rgba(8, 8, 8, 0.55)',
  textLineHeight: 1.4,
  fontFamily: 'system-ui, sans-serif',
  blurRadius: DOCK_MEDIA_BLUR_RADIUS,
} as const;
export type DockMediaPaintOp =
  | { kind: 'geometry'; geometry: DockMediaGeometry; unit?: number }
  | { kind: 'badge'; x: number; y: number; radius: number; label: string; unit?: number };
export function layoutDockMediaMarks(
  edit: DockMediaEdit,
  source: DockMediaSource,
  atMs = 0,
): DockMediaPaintOp[] {
  const crop = edit.crop ?? { x: 0, y: 0, w: source.width, h: source.height };
  const unit = Math.max(1, Math.max(source.width, source.height) / 1440);
  const r = Math.min(DOCK_MEDIA_PAINT.badgeRadius * unit, crop.w / 2, crop.h / 2);
  return numberDockMediaMarks(edit, source)
    .filter(
      (row) =>
        source.kind === 'screenshot' || (atMs >= row.mark.atMs && atMs < row.visibleUntilMs),
    )
    .flatMap(({ n, mark }): DockMediaPaintOp[] => {
      const geometry = source.kind === 'recording' ? gestureGeometryAt(mark.geometry, recordedMarkProgress(source, mark), atMs) : mark.geometry;
      if (!geometry) return [];
      const box = dockMediaGeometryRect(geometry);
      return [
        { kind: 'geometry', geometry, unit },
        {
          kind: 'badge',
          x: Math.min(crop.x + crop.w - r, Math.max(crop.x + r, box.x + box.w)),
          y: Math.min(crop.y + crop.h - r, Math.max(crop.y + r, box.y)),
          radius: r,
          label: String(n),
          unit,
        },
      ];
    });
}
type Painter = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
export function paintDockMediaMarks(context: Painter, ops: readonly DockMediaPaintOp[]): void {
  context.save();
  context.strokeStyle = DOCK_MEDIA_PAINT.accent;
  context.fillStyle = DOCK_MEDIA_PAINT.accent;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  for (const op of ops) {
    const unit = op.unit ?? 1;
    const visibleStroke = (width: number) => {
      context.strokeStyle = DOCK_MEDIA_PAINT.halo; context.lineWidth = width + 2 * unit; context.stroke();
      context.strokeStyle = DOCK_MEDIA_PAINT.accent; context.lineWidth = width; context.stroke();
    };
    if (op.kind === 'badge') {
      context.fillStyle = DOCK_MEDIA_PAINT.accent;
      context.beginPath();
      context.arc(op.x, op.y, op.radius, 0, Math.PI * 2);
      context.strokeStyle = DOCK_MEDIA_PAINT.halo; context.lineWidth = 2 * unit; context.stroke();
      context.fill();
      context.fillStyle = DOCK_MEDIA_PAINT.ink;
      context.font = `600 ${op.radius * 1.2}px ${DOCK_MEDIA_PAINT.fontFamily}`;
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText(op.label, op.x, op.y);
      continue;
    }
    const g = op.geometry;
    context.fillStyle = DOCK_MEDIA_PAINT.accent;
    const width = (g.kind === 'path' ? DOCK_MEDIA_PAINT.pen : DOCK_MEDIA_PAINT.stroke) * unit;
    if (g.kind === 'rect') {
      context.beginPath(); context.rect(g.x, g.y, g.w, g.h); visibleStroke(width);
    }
    else if (g.kind === 'text') {
      const text = layoutDockMediaText(g);
      if (g.style === 'sticky') {
        const radius = Math.min(6, text.width / 2, text.height / 2);
        context.fillStyle = DOCK_MEDIA_PAINT.accent;
        context.beginPath();
        context.moveTo(g.x + radius, g.y);
        context.lineTo(g.x + text.width - radius, g.y);
        context.quadraticCurveTo(g.x + text.width, g.y, g.x + text.width, g.y + radius);
        context.lineTo(g.x + text.width, g.y + text.height - radius);
        context.quadraticCurveTo(g.x + text.width, g.y + text.height, g.x + text.width - radius, g.y + text.height);
        context.lineTo(g.x + radius, g.y + text.height);
        context.quadraticCurveTo(g.x, g.y + text.height, g.x, g.y + text.height - radius);
        context.lineTo(g.x, g.y + radius);
        context.quadraticCurveTo(g.x, g.y, g.x + radius, g.y);
        context.closePath();
        context.strokeStyle = DOCK_MEDIA_PAINT.halo; context.lineWidth = 2 * unit; context.stroke();
        context.fill();
      }
      context.fillStyle = g.style === 'sticky' ? DOCK_MEDIA_PAINT.ink : DOCK_MEDIA_PAINT.accent;
      context.textAlign = 'left'; context.textBaseline = 'top';
      context.font = `${g.fontSize}px ${DOCK_MEDIA_PAINT.fontFamily}`;
      text.lines.forEach((line, index) => {
        const x = g.x + text.padding, y = g.y + text.padding + index * text.lineHeight;
        if (g.style === 'sticky') context.fillText(line, x, y, text.width - 2 * text.padding);
        else {
          context.strokeStyle = DOCK_MEDIA_PAINT.halo; context.lineWidth = 2 * unit;
          context.strokeText(line, x, y); context.fillText(line, x, y);
        }
      });
    } else if (g.kind === 'point') {
      context.beginPath();
      context.arc(g.x, g.y, DOCK_MEDIA_POINT_RADIUS, 0, Math.PI * 2);
      visibleStroke(width);
    } else {
      const points = g.kind === 'path' ? g.points : [g.from, g.to];
      context.beginPath();
      points.forEach((p, index) =>
        index ? context.lineTo(p.x, p.y) : context.moveTo(p.x, p.y),
      );
      if (g.kind === 'arrow') {
        const angle = Math.atan2(g.to.y - g.from.y, g.to.x - g.from.x),
          head = DOCK_MEDIA_PAINT.arrowHead * unit;
        context.moveTo(
          g.to.x - head * Math.cos(angle - Math.PI / 6),
          g.to.y - head * Math.sin(angle - Math.PI / 6),
        );
        context.lineTo(g.to.x, g.to.y);
        context.lineTo(
          g.to.x - head * Math.cos(angle + Math.PI / 6),
          g.to.y - head * Math.sin(angle + Math.PI / 6),
        );
      }
      visibleStroke(width);
    }
  }
  context.restore();
}
function canvas(width: number, height: number) {
  const image = new OffscreenCanvas(
    Math.max(1, Math.round(width)),
    Math.max(1, Math.round(height)),
  );
  const context = image.getContext('2d');
  if (!context) throw new Error('capture-render-unavailable');
  return { image, context };
}
/** Transparent source-sized raster used by the offline exporter over a clean frame. */
export async function renderDockMediaOverlay(
  source: DockMediaSource,
  edit: DockMediaEdit,
  atMs: number,
): Promise<string> {
  if (source.visuals !== 'clean') throw new Error('legacy-baked-marks');
  const { image, context } = canvas(source.width, source.height);
  paintDockMediaMarks(context, layoutDockMediaMarks(edit, source, atMs));
  return arrayBufferToBase64(
    await (await image.convertToBlob({ type: 'image/png' })).arrayBuffer(),
  );
}
/** Actual image bytes: crop, blur source pixels, then paint included numbered marks. */
export async function renderDockMediaImage(
  source: DockMediaSource,
  edit: DockMediaEdit,
  pixels: { base64: string; mimeType: string },
): Promise<{ data: string; mimeType: string; width: number; height: number }> {
  const plan = planDockMediaOutput(edit, source, null);
  if (source.kind !== 'screenshot' || plan.errors.length)
    throw new Error(plan.errors[0] ?? 'not-a-screenshot');
  if (source.visuals !== 'clean') throw new Error('legacy-baked-marks');
  const bytes = Uint8Array.from(atob(pixels.base64), (c) => c.charCodeAt(0));
  const bitmap = await createImageBitmap(new Blob([bytes], { type: pixels.mimeType }));
  try {
    if (bitmap.width !== source.width || bitmap.height !== source.height)
      throw new Error('stale-source-pixels');
    const original = canvas(source.width, source.height);
    original.context.drawImage(bitmap, 0, 0);
    if (edit.blurRegions.length || edit.blurStrokes?.length) {
      const blurred = canvas(source.width, source.height);
      // An opaque backing prevents filtered edge alpha from exposing sharp source pixels.
      blurred.context.fillStyle = '#000000';
      blurred.context.fillRect(0, 0, source.width, source.height);
      const filter = `blur(${DOCK_MEDIA_PAINT.blurRadius}px)`;
      blurred.context.filter = filter;
      if (blurred.context.filter !== filter) throw new Error('capture-blur-unavailable');
      blurred.context.drawImage(bitmap, 0, 0);
      const mask = canvas(source.width, source.height);
      mask.context.fillStyle = '#ffffff'; mask.context.strokeStyle = '#ffffff';
      mask.context.lineCap = 'round'; mask.context.lineJoin = 'round';
      for (const region of edit.blurRegions) mask.context.fillRect(region.x, region.y, region.w, region.h);
      for (const stroke of edit.blurStrokes ?? []) {
        const points = stroke.points.filter((p, index) => index === 0 || p.x !== stroke.points[index - 1].x || p.y !== stroke.points[index - 1].y);
        mask.context.beginPath();
        if (points.length === 1) {
          const p = points[0];
          mask.context.arc(p.x, p.y, stroke.radius, 0, Math.PI * 2); mask.context.fill();
        } else {
          mask.context.lineWidth = stroke.radius * 2;
          mask.context.moveTo(points[0].x, points[0].y);
          for (const p of points.slice(1)) mask.context.lineTo(p.x, p.y);
          mask.context.stroke();
        }
      }
      // Alpha-zero coverage leaves the original source pixel unchanged. Opaque
      // blurred pixels replace only the actual circular/rectangular mask union.
      const masked = canvas(source.width, source.height);
      masked.context.drawImage(blurred.image, 0, 0);
      masked.context.globalCompositeOperation = 'destination-in';
      masked.context.drawImage(mask.image, 0, 0);
      original.context.drawImage(masked.image, 0, 0);
    }
    const crop = edit.crop ?? { x: 0, y: 0, w: source.width, h: source.height };
    const output = canvas(crop.w, crop.h);
    output.context.drawImage(
      original.image,
      crop.x,
      crop.y,
      crop.w,
      crop.h,
      0,
      0,
      output.image.width,
      output.image.height,
    );
    output.context.scale(output.image.width / crop.w, output.image.height / crop.h);
    output.context.translate(-crop.x, -crop.y);
    paintDockMediaMarks(output.context, layoutDockMediaMarks(edit, source));
    const png = await output.image.convertToBlob({ type: 'image/png' });
    return {
      data: arrayBufferToBase64(await png.arrayBuffer()),
      mimeType: 'image/png',
      width: output.image.width,
      height: output.image.height,
    };
  } finally {
    bitmap.close();
  }
}
