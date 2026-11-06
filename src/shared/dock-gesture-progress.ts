/** Internal capture timing only; never included in agent-facing capture JSON. */
import { z } from 'zod';
import type { DockMediaGeometry } from './dock-media-edit';
const time = z.number().finite().nonnegative();
export const DockGestureProgressSchema = z.object({
  completedAtMs: time,
  samples: z.array(z.object({ atMs: time, pointCount: z.number().int().min(0).max(2048),
    end: z.object({ x: z.number().finite(), y: z.number().finite() }).strict() }).strict()).min(1).max(64),
}).strict().refine((p) => p.samples.every((s, i) => s.atMs <= p.completedAtMs && (!i || s.atMs >= p.samples[i - 1].atMs)), 'Invalid gesture clock');
export type DockGestureProgress = z.infer<typeof DockGestureProgressSchema>;
/** Latest observed sample, never an interpolated or backdated shape. */
export function gestureGeometryAt(final: DockMediaGeometry, progress: DockGestureProgress | undefined, atMs: number): DockMediaGeometry | null {
  if (!progress || atMs >= progress.completedAtMs) return final;
  const sample = [...progress.samples].reverse().find((s) => s.atMs <= atMs);
  if (!sample) return null;
  if (final.kind === 'path') return sample.pointCount ? { kind: 'path', points: final.points.slice(0, sample.pointCount) } : null;
  if (final.kind === 'arrow') return { kind: 'arrow', from: final.from, to: sample.end };
  // Rectangle origin is carried by the first observed sample, including reverse drags.
  if (final.kind === 'rect') {
    const origin = progress.samples[0].end;
    const w = Math.abs(sample.end.x - origin.x), h = Math.abs(sample.end.y - origin.y);
    return w > 0 && h > 0 ? { kind: 'rect', x: Math.min(origin.x, sample.end.x), y: Math.min(origin.y, sample.end.y), w, h } : null;
  }
  return final;
}
