/** Capture metadata adaptation only; this never guesses a missing file or clean original. */
import type { DockComposerEvidence, DockMark } from './dock-evidence';
import type {
  DockMediaBatch,
  DockMediaEditMark,
  DockMediaGeometry,
  DockMediaSource,
} from './dock-media-edit';
export function dockMediaCaptureBatches(
  clearAtMs: readonly number[],
  durationMs: number,
): DockMediaBatch[] {
  const boundaries = [
    0,
    ...new Set(clearAtMs.filter((at) => Number.isFinite(at) && at > 0 && at < durationMs)),
  ].sort((a, b) => a - b);
  return boundaries.map((atMs, index) => ({
    id: `batch-${index}`,
    atMs,
    clearAtMs: boundaries[index + 1] ?? null,
  }));
}
function geometry(mark: DockMark, sx: number, sy: number): DockMediaGeometry {
  const g = mark.geometry,
    point = (p: { x: number; y: number }) => ({ x: p.x * sx, y: p.y * sy });
  if (g.kind === 'rect') return { kind: 'rect', ...point(g), w: g.w * sx, h: g.h * sy };
  if (g.kind === 'path') return { kind: 'path', points: g.points.map(point) };
  return { kind: 'arrow', from: point(g.from), to: point(g.to) };
}
export function dockMediaCapturedMarks(
  evidence: DockComposerEvidence,
  source: DockMediaSource,
  logicalId: string,
): DockMediaEditMark[] {
  const archive =
    source.kind === 'recording'
      ? evidence.clips.find((clip) => clip.id === logicalId)?.captureHistory
      : undefined;
  const marks =
    archive?.map((entry) => entry.mark) ??
    evidence.marks.filter((mark) =>
      source.kind === 'recording' ? mark.clipId === logicalId : mark.imageId === logicalId,
    );
  return marks.map<DockMediaEditMark>((mark) => {
    const entry = archive?.find((row) => row.mark.id === mark.id);
    const image = entry?.image ?? evidence.images.find((row) => row.id === mark.imageId);
    if (!image || image.width <= 0 || image.height <= 0)
      throw new Error('capture-mark-source-unavailable');
    const atMs = source.kind === 'recording' ? mark.clipMs : 0;
    if (atMs === undefined || !Number.isFinite(atMs))
      throw new Error('capture-mark-timing-unavailable');
    const batch = [...source.batches].reverse().find((batch) => batch.atMs <= atMs);
    if (!batch) throw new Error('capture-batch-unavailable');
    const url = mark.element?.source;
    return {
      id: mark.id,
      atMs,
      batchId: batch.id,
      source: 'recording',
      ...(mark.gestureProgress && mark.gestureProgress.completedAtMs <= source.durationMs
        ? {
            gestureProgress: {
              ...mark.gestureProgress,
              samples: mark.gestureProgress.samples.map((sample) => ({
                ...sample,
                end: {
                  x: (sample.end.x * source.width) / image.width,
                  y: (sample.end.y * source.height) / image.height,
                },
              })),
            },
          }
        : {}),
      kind: mark.tool === 'pick' ? 'element' : mark.tool === 'pen' ? 'draw' : mark.tool,
      included: entry?.included ?? true,
      geometry: geometry(mark, source.width / image.width, source.height / image.height),
      label: mark.element?.name ?? '',
      note: '',
      context: {
        selector: mark.element?.path ?? null,
        text: mark.element?.name ?? null,
        url: url && /^https?:\/\//.test(url) ? url : null,
      },
    };
  });
}
