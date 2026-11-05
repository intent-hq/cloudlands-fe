/** One raster display list for capture-editor preview, screenshot output and video overlays. */
import {
  numberDockMediaMarks,
  dockMediaGeometryRect,
  planDockMediaOutput,
  type DockMediaEdit,
  type DockMediaSource,
  type DockMediaGeometry,
} from '$shared/dock-media-edit';
import { arrayBufferToBase64 } from '$features/voice/utils/wav-encoder';

export const DOCK_MEDIA_PAINT = {
  accent: '#DDEC61',
  ink: '#080808',
  stroke: 2,
  pen: 2.5,
  badgeRadius: 9,
  textLineHeight: 1.4,
  fontFamily: 'system-ui, sans-serif',
  blurRadius: 16,
} as const;
export type DockMediaPaintOp =
  | { kind: 'geometry'; geometry: DockMediaGeometry }
  | { kind: 'badge'; x: number; y: number; radius: number; label: string };
export function layoutDockMediaMarks(
  edit: DockMediaEdit,
  source: DockMediaSource,
  atMs = 0,
): DockMediaPaintOp[] {
  const crop = edit.crop ?? { x: 0, y: 0, w: source.width, h: source.height };
  const r = Math.min(DOCK_MEDIA_PAINT.badgeRadius, crop.w / 2, crop.h / 2);
  return numberDockMediaMarks(edit, source)
    .filter(
      (row) =>
        source.kind === 'screenshot' || (atMs >= row.mark.atMs && atMs < row.visibleUntilMs),
    )
    .flatMap(({ n, mark }): DockMediaPaintOp[] => {
      const box = dockMediaGeometryRect(mark.geometry);
      return [
        { kind: 'geometry', geometry: mark.geometry },
        {
          kind: 'badge',
          x: Math.min(crop.x + crop.w - r, Math.max(crop.x + r, box.x + box.w)),
          y: Math.min(crop.y + crop.h - r, Math.max(crop.y + r, box.y)),
          radius: r,
          label: String(n),
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
    if (op.kind === 'badge') {
      context.fillStyle = DOCK_MEDIA_PAINT.accent;
      context.beginPath();
      context.arc(op.x, op.y, op.radius, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = DOCK_MEDIA_PAINT.ink;
      context.font = `600 ${op.radius * 1.2}px ${DOCK_MEDIA_PAINT.fontFamily}`;
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText(op.label, op.x, op.y);
      continue;
    }
    const g = op.geometry;
    context.lineWidth = g.kind === 'path' ? DOCK_MEDIA_PAINT.pen : DOCK_MEDIA_PAINT.stroke;
    if (g.kind === 'rect') context.strokeRect(g.x, g.y, g.w, g.h);
    else if (g.kind === 'text') {
      context.fillStyle = DOCK_MEDIA_PAINT.accent;
      context.textAlign = 'left';
      context.textBaseline = 'top';
      context.font = `${g.fontSize}px ${DOCK_MEDIA_PAINT.fontFamily}`;
      g.text
        .split('\n')
        .forEach((line, index) =>
          context.fillText(
            line,
            g.x,
            g.y + index * g.fontSize * DOCK_MEDIA_PAINT.textLineHeight,
          ),
        );
    } else if (g.kind === 'point') {
      context.beginPath();
      context.arc(g.x, g.y, 6, 0, Math.PI * 2);
      context.stroke();
    } else {
      const points = g.kind === 'path' ? g.points : [g.from, g.to];
      context.beginPath();
      points.forEach((p, index) =>
        index ? context.lineTo(p.x, p.y) : context.moveTo(p.x, p.y),
      );
      if (g.kind === 'arrow') {
        const angle = Math.atan2(g.to.y - g.from.y, g.to.x - g.from.x),
          head = 14;
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
      context.stroke();
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
    if (edit.blurRegions.length) {
      const blurred = canvas(source.width, source.height);
      // An opaque backing prevents filtered edge alpha from exposing sharp source pixels.
      blurred.context.fillStyle = '#000000';
      blurred.context.fillRect(0, 0, source.width, source.height);
      const filter = `blur(${DOCK_MEDIA_PAINT.blurRadius}px)`;
      blurred.context.filter = filter;
      if (blurred.context.filter !== filter) throw new Error('capture-blur-unavailable');
      blurred.context.drawImage(bitmap, 0, 0);
      for (const region of edit.blurRegions) {
        original.context.save();
        original.context.beginPath();
        original.context.rect(region.x, region.y, region.w, region.h);
        original.context.clip();
        original.context.drawImage(blurred.image, 0, 0);
        original.context.restore();
      }
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
