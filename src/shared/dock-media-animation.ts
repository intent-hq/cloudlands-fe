import type { DockMediaEdit, DockMediaSource, DockMediaEditMark } from './dock-media-edit';
import { planDockMediaOutput } from './dock-media-edit';
import type { DockGestureProgress } from './dock-gesture-progress';
/** Edited geometry has no recorded timing of its own; only an unchanged captured gesture animates. */
export function recordedMarkProgress(source: DockMediaSource, mark: DockMediaEditMark): DockGestureProgress | undefined {
  const original = source.capturedMarks?.find((entry) => entry.id === mark.id);
  return original && JSON.stringify(original.geometry) === JSON.stringify(mark.geometry) ? original.gestureProgress : undefined;
}
export function dockMediaOverlaySpans(source: DockMediaSource, edit: DockMediaEdit) {
  const plan = planDockMediaOutput(edit, source, null);
  const boundaries = [...new Set([0, source.durationMs, ...plan.marks.flatMap((entry) => {
    const progress = recordedMarkProgress(source, entry.mark);
    return [entry.frameAtMs, entry.visibleUntilMs, ...(progress ? [progress.completedAtMs, ...progress.samples.map((s) => s.atMs)] : [])];
  })])].filter((at) => at >= 0 && at <= source.durationMs).sort((a, b) => a - b);
  return boundaries.slice(0, -1).map((atMs, i) => ({ atMs, endMs: boundaries[i + 1] }))
    .filter((span) => span.endMs > span.atMs && plan.marks.some((entry) => span.atMs >= entry.frameAtMs && span.atMs < entry.visibleUntilMs));
}
