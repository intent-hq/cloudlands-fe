import { formatInteger } from '$lib/i18n/format';
import type { RegionGeometry } from '../layout/place';
import { traceHull } from './canvas';
import type { FocusContent, FocusEvidenceItem } from './types';

interface FocusCanvasColors {
  surface: string;
  foreground: string;
  mutedForeground: string;
}

function drawEvidenceGlyph(
  ctx: CanvasRenderingContext2D,
  item: FocusEvidenceItem,
  x: number,
  y: number,
  scale: number,
): void {
  const size = 5 / scale;
  ctx.save();
  ctx.strokeStyle = item.color;
  ctx.fillStyle = item.color;
  ctx.lineWidth = 2 / scale;
  ctx.beginPath();
  if (item.kind === 'read') ctx.arc(x, y, size, 0, Math.PI * 2);
  else if (item.kind === 'tool') {
    ctx.moveTo(x, y - size);
    ctx.lineTo(x + size, y);
    ctx.lineTo(x, y + size);
    ctx.lineTo(x - size, y);
    ctx.closePath();
  } else if (item.kind === 'thinking') {
    ctx.setLineDash([2 / scale, 2 / scale]);
    ctx.arc(x, y, size, 0, Math.PI * 2);
  } else ctx.arc(x, y, size, 0, Math.PI * 2);
  if (item.kind === 'read' || item.kind === 'thinking') ctx.stroke();
  else ctx.fill();
  if (item.kind === 'delete') {
    ctx.beginPath();
    ctx.moveTo(x - size, y + size);
    ctx.lineTo(x + size, y - size);
    ctx.stroke();
  }
  ctx.restore();
}

export function drawFocusContent(
  ctx: CanvasRenderingContext2D,
  content: FocusContent,
  region: RegionGeometry | undefined,
  scale: number,
  font: string,
  colors: FocusCanvasColors,
): void {
  if (!region) return;
  ctx.save();
  ctx.beginPath();
  traceHull(ctx, region.hull);
  ctx.clip();
  for (const item of content.items) {
    if (content.mode === 'subregions') {
      const width = 82 / scale;
      const height = 42 / scale;
      ctx.fillStyle = colors.surface;
      ctx.strokeStyle = item.color;
      ctx.lineWidth = 1.5 / scale;
      ctx.beginPath();
      ctx.roundRect(item.x - width / 2, item.y - height / 2, width, height, 13 / scale);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = colors.foreground;
      ctx.font = `600 ${12 / scale}px ${font}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(item.label, item.x, item.y - 6 / scale, width - 8 / scale);
      ctx.fillStyle = colors.mutedForeground;
      ctx.fillText(formatInteger(item.count ?? 0), item.x, item.y + 9 / scale);
    } else {
      drawEvidenceGlyph(ctx, item, item.x, item.y - 8 / scale, scale);
      ctx.fillStyle = colors.foreground;
      ctx.font = `${12 / scale}px ${font}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(item.label, item.x, item.y + 3 / scale, 94 / scale);
    }
  }
  ctx.restore();
}

function wrapCanvasText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maximumWidth: number,
): string[] {
  const lines = [''];
  for (const word of text.split(' ')) {
    const index = lines.length - 1;
    const candidate = lines[index] ? `${lines[index]} ${word}` : word;
    if (ctx.measureText(candidate).width > maximumWidth && lines[index]) lines.push(word);
    else lines[index] = candidate;
  }
  return lines.slice(0, 7);
}

export function drawFocusedResponsibility(
  ctx: CanvasRenderingContext2D,
  text: string,
  region: RegionGeometry | undefined,
  scale: number,
  font: string,
  color: string,
): void {
  if (!region) return;
  ctx.save();
  ctx.beginPath();
  traceHull(ctx, region.hull);
  ctx.clip();
  ctx.fillStyle = color;
  ctx.font = `${12 / scale}px ${font}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const lineHeight = 16 / scale;
  const lines = wrapCanvasText(ctx, text, region.radius * 1.35);
  lines.forEach((line, index) => {
    ctx.fillText(line, region.x, region.y + 2 / scale + index * lineHeight);
  });
  ctx.restore();
}
