import type { DockMediaEdit, DockMediaSource } from './dock-media-edit';
import { planDockMediaOutput, recordedMarkProgress } from './dock-media-edit';
export { recordedMarkProgress } from './dock-media-edit';
export function dockMediaOverlaySpans(source: DockMediaSource, edit: DockMediaEdit) {
  const plan = planDockMediaOutput(edit, source, null);
  const mandatory = new Set([
    0,
    source.durationMs,
    ...source.batches.flatMap((b) => (b.clearAtMs === null ? [] : [b.clearAtMs])),
    ...plan.marks.flatMap((entry) => [
      entry.frameAtMs,
      entry.visibleUntilMs,
      ...(recordedMarkProgress(source, entry.mark)
        ? [recordedMarkProgress(source, entry.mark)!.completedAtMs]
        : []),
    ]),
  ]);
  const observations = [
    ...new Set(
      plan.marks.flatMap((entry) => {
        const progress = recordedMarkProgress(source, entry.mark);
        return progress?.samples.map((sample) => sample.atMs) ?? [];
      }),
    ),
  ]
    .filter((at) => !mandatory.has(at) && at >= 0 && at <= source.durationMs)
    .sort((a, b) => a - b);
  // Only actual observations are thinned. Starts, completions and Clear never move.
  const budget = Math.max(0, 1001 - mandatory.size);
  const selected =
    budget >= observations.length
      ? observations
      : Array.from(
          { length: budget },
          (_, i) => observations[Math.floor((i * observations.length) / budget)],
        );
  const boundaries = [...new Set([...mandatory, ...selected])]
    .filter((at) => at >= 0 && at <= source.durationMs)
    .sort((a, b) => a - b);
  return boundaries
    .slice(0, -1)
    .map((atMs, i) => ({ atMs, endMs: boundaries[i + 1] }))
    .filter(
      (span) =>
        span.endMs > span.atMs &&
        plan.marks.some(
          (entry) => span.atMs >= entry.frameAtMs && span.atMs < entry.visibleUntilMs,
        ),
    );
}

/** A mark frame always comes from an exported, visible source interval. Cuts can
 * exclude completion; then the frame truthfully shows the retained partial state. */
export function dockMediaFrameAt(
  source: DockMediaSource,
  plan: ReturnType<typeof planDockMediaOutput>,
  entry: ReturnType<typeof planDockMediaOutput>['marks'][number],
): number | null {
  const desired = recordedMarkProgress(source, entry.mark)?.completedAtMs ?? entry.frameAtMs;
  const spans = plan.clips
    .map((range) => ({
      start: Math.max(range.startMs, entry.frameAtMs),
      end: Math.min(range.endMs, entry.visibleUntilMs, source.durationMs),
    }))
    .filter((r) => r.end > r.start);
  const after = spans.find((r) => r.end > desired) ?? spans.at(-1);
  return after
    ? Math.max(
        after.start,
        Math.min(desired, after.end - Math.min(1, (after.end - after.start) / 2)),
      )
    : null;
}

/** Partial captured strokes are painted but cannot edit invisible future geometry. */
export function dockMediaMarkEditableAt(
  source: DockMediaSource,
  mark: DockMediaEdit['marks'][number],
  atMs: number,
): boolean {
  const progress = recordedMarkProgress(source, mark);
  return !progress || atMs >= progress.completedAtMs;
}
