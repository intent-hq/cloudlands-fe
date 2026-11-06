import { describe, it, expect } from 'vitest';
import { DockGestureProgressSchema, gestureGeometryAt } from './dock-gesture-progress';
const geometry = { kind: 'path' as const, points: [{ x: 1, y: 2 }, { x: 4, y: 5 }, { x: 8, y: 9 }] };
const progress = { completedAtMs: 300, samples: [{ atMs: 100, pointCount: 1, end: geometry.points[0] }, { atMs: 200, pointCount: 2, end: geometry.points[1] }] };
describe('recorded gesture timing', () => {
  it('shows only observed prefixes and exact final geometry, without interpolation', () => {
    expect(gestureGeometryAt(geometry, progress, 99)).toBeNull();
    expect(gestureGeometryAt(geometry, progress, 150)).toEqual({ kind: 'path', points: geometry.points.slice(0, 1) });
    expect(gestureGeometryAt(geometry, progress, 250)).toEqual({ kind: 'path', points: geometry.points.slice(0, 2) });
    expect(gestureGeometryAt(geometry, progress, 300)).toEqual(geometry);
  });
  it('retains static geometry when no timing was captured', () => {
    expect(gestureGeometryAt(geometry, undefined, 150)).toEqual(geometry);
  });
  it('rejects unbounded or reversed times rather than manufacturing timing', () => {
    expect(DockGestureProgressSchema.safeParse({ ...progress, completedAtMs: 150 }).success).toBe(false);
    expect(DockGestureProgressSchema.safeParse({ ...progress, samples: Array(65).fill(progress.samples[0]) }).success).toBe(false);
  });
});
