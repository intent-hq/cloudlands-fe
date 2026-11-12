import {
  defaultDockMediaEdit,
  planDockMediaOutput,
  type DockMediaSource,
  type DockMediaEditMark,
} from './dock-media-edit';
import {
  dockMediaOverlaySpans,
  recordedMarkProgress,
  dockMediaFrameAt,
  dockMediaMarkEditableAt,
} from './dock-media-animation';
import { sanitizeDockMark } from './dock-evidence';
import { describe, it, expect } from 'vitest';
import { DockGestureProgressSchema, gestureGeometryAt } from './dock-gesture-progress';
const geometry = {
  kind: 'path' as const,
  points: [
    { x: 1, y: 2 },
    { x: 4, y: 5 },
    { x: 8, y: 9 },
  ],
};
const progress = {
  completedAtMs: 300,
  samples: [
    { atMs: 100, pointCount: 1, end: geometry.points[0] },
    { atMs: 200, pointCount: 2, end: geometry.points[1] },
  ],
};
describe('recorded gesture timing', () => {
  it('shows only observed prefixes and exact final geometry, without interpolation', () => {
    expect(gestureGeometryAt(geometry, progress, 99)).toBeNull();
    expect(gestureGeometryAt(geometry, progress, 150)).toEqual({
      kind: 'path',
      points: geometry.points.slice(0, 1),
    });
    expect(gestureGeometryAt(geometry, progress, 250)).toEqual({
      kind: 'path',
      points: geometry.points.slice(0, 2),
    });
    expect(gestureGeometryAt(geometry, progress, 300)).toEqual(geometry);
  });
  it('retains static geometry when no timing was captured', () => {
    expect(gestureGeometryAt(geometry, undefined, 150)).toEqual(geometry);
  });
  it('rejects unbounded or reversed times rather than manufacturing timing', () => {
    expect(DockGestureProgressSchema.safeParse({ ...progress, completedAtMs: 150 }).success).toBe(
      false,
    );
    expect(
      DockGestureProgressSchema.safeParse({
        ...progress,
        samples: Array(65).fill(progress.samples[0]),
      }).success,
    ).toBe(false);
  });
});

const captured: DockMediaEditMark = {
  id: 'm',
  atMs: 1000,
  batchId: 'b',
  source: 'recording',
  kind: 'draw',
  included: true,
  geometry,
  label: '',
  note: '',
  context: { selector: null, text: null, url: null },
  gestureProgress: {
    ...progress,
    completedAtMs: 7000,
    samples: progress.samples.map((s) => ({ ...s, atMs: s.atMs + 1000 })),
  },
};
const source: DockMediaSource = {
  id: 's',
  revision: 0,
  kind: 'recording',
  attachmentId: 'f',
  path: '.intent/attachments/a.mp4',
  width: 100,
  height: 100,
  durationMs: 12000,
  audio: 'none',
  visuals: 'clean',
  batches: [{ id: 'b', atMs: 0, clearAtMs: 9000 }],
  capturedMarks: [captured],
};
describe('recording animation plan', () => {
  it('keeps long gestures through completion and postroll; Clear only ends marks and frames stay in cuts/trim', () => {
    const edit = defaultDockMediaEdit(source, [captured], null);
    edit.video = 'highlights';
    const plan = planDockMediaOutput(edit, source, null);
    expect(plan.clips).toEqual([{ startMs: 0, endMs: 10000 }]);
    edit.cuts = [{ startMs: 6500, endMs: 8000 }];
    edit.trim = { startMs: 500, endMs: 8500 };
    const cutPlan = planDockMediaOutput(edit, source, null);
    const frame = dockMediaFrameAt(source, cutPlan, cutPlan.marks[0]);
    expect(cutPlan.clips.some((r) => frame !== null && frame >= r.startMs && frame < r.endMs)).toBe(
      true,
    );
    expect(frame).toBeLessThan(9000);
  });
  it('bounds intermediate layer observations globally and retains mandatory completion/Clear', () => {
    const marks = Array.from({ length: 24 }, (_, i) => ({
      ...captured,
      id: `m${i}`,
      atMs: i * 400,
      gestureProgress: {
        completedAtMs: i * 400 + 200,
        samples: Array.from({ length: 64 }, (_, n) => ({
          atMs: i * 400 + n * 3,
          pointCount: 1,
          end: { x: 1, y: 2 },
        })),
      },
    }));
    const many = {
      ...source,
      batches: [{ id: 'b', atMs: 0, clearAtMs: null }],
      capturedMarks: marks,
    };
    const edit = defaultDockMediaEdit(many, marks, null);
    edit.video = 'full';
    const spans = dockMediaOverlaySpans(many, edit);
    expect(spans.length).toBeLessThanOrEqual(1000);
    for (const mark of marks)
      expect(spans.some((s) => s.atMs === mark.gestureProgress.completedAtMs)).toBe(true);
    edit.marks[0] = { ...edit.marks[0], geometry: { kind: 'point', x: 4, y: 4 } };
    expect(recordedMarkProgress(many, edit.marks[0])).toBeUndefined();
  });
  it('maps decimated pen prefix counts to the exact retained final path', () => {
    const points = Array.from({ length: 600 }, (_, i) => ({ x: i, y: i }));
    const mark = {
      id: 'm',
      imageId: 'i',
      tool: 'pen' as const,
      geometry: { kind: 'path' as const, points },
      bounds: { x: 0, y: 0, w: 600, h: 600 },
      element: null,
      createdAt: 1,
      clipMs: 0,
      gestureProgress: {
        completedAtMs: 1000,
        samples: [{ atMs: 100, pointCount: 300, end: points[299] }],
      },
    };
    const clean = sanitizeDockMark(mark, { id: 'i', width: 1000, height: 1000 } as never)!;
    expect(clean.geometry.kind).toBe('path');
    const partial = gestureGeometryAt(clean.geometry as never, clean.gestureProgress, 200);
    expect(partial?.kind === 'path' && partial.points.every((p) => p.x < 300)).toBe(true);
    expect(gestureGeometryAt(clean.geometry as never, clean.gestureProgress, 1000)).toEqual(
      clean.geometry,
    );
  });
});

it('selection is disabled through the captured in-progress interval, but static edited shapes are editable', () => {
  expect(dockMediaMarkEditableAt(source, captured, 5000)).toBe(false);
  expect(dockMediaMarkEditableAt(source, captured, 7000)).toBe(true);
  expect(
    dockMediaMarkEditableAt(source, { ...captured, geometry: { kind: 'point', x: 4, y: 4 } }, 5000),
  ).toBe(true);
});

it('legacy highlights retain postroll after Clear without truncating video context', () => {
  const { gestureProgress: _, ...legacy } = captured;
  const s = {
    ...source,
    durationMs: 10000,
    batches: [{ id: 'b', atMs: 0, clearAtMs: 1500 }],
    capturedMarks: [legacy],
  };
  const edit = defaultDockMediaEdit(s, [legacy], null);
  edit.video = 'highlights';
  const plan = planDockMediaOutput(edit, s, null);
  expect(plan.clips).toEqual([{ startMs: 0, endMs: 4000 }]);
  expect(plan.marks[0].visibleUntilMs).toBe(1500);
});
