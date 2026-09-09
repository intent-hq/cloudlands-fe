import { describe, expect, it } from 'vitest';
import { polygonContains } from 'd3';
import type { Manifest, Route } from '../core/types';
import { computeBudget, FOCUS_BUDGET_SHARE, LABELED_PEBBLE_BUDGET } from './budget';
import { capFocusGeometry, lerpGeometry } from './interpolate';
import { COLLISION_GAP, FOCUS_CONTEXT_MIN_RADIUS, placeRegions } from './place';

const manifest: Manifest = {
  version: 1,
  regions: [
    { id: 'one', label: 'One', responsibility: 'One', anchor: [0.2, 0.25], paths: ['a/**'] },
    { id: 'two', label: 'Two', responsibility: 'Two', anchor: [0.5, 0.5], paths: ['b/**', 'c/**'] },
    {
      id: 'three',
      label: 'Three',
      responsibility: 'Three',
      anchor: [0.8, 0.72],
      paths: Array.from({ length: 100 }, (_, index) => `p${index}/**`),
    },
    { id: 'four', label: 'Four', responsibility: 'Four', anchor: [0.22, 0.75], paths: ['d/**'] },
    {
      id: 'Unsorted',
      label: 'Unsorted',
      responsibility: 'Unsorted',
      anchor: [0.52, 0.9],
      paths: ['**'],
    },
  ],
};
const viewport = { width: 1_000, height: 700 };

function polygonArea(points: [number, number][]): number {
  return (
    Math.abs(
      points.reduce((sum, [x, y], index) => {
        const [nextX, nextY] = points[(index + 1) % points.length];
        return sum + x * nextY - nextX * y;
      }, 0),
    ) / 2
  );
}

function pointSegmentDistance(
  point: [number, number],
  start: [number, number],
  end: [number, number],
) {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const lengthSquared = dx * dx + dy * dy;
  const progress = Math.max(
    0,
    Math.min(
      1,
      ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / Math.max(1e-9, lengthSquared),
    ),
  );
  return Math.hypot(point[0] - start[0] - progress * dx, point[1] - start[1] - progress * dy);
}

function segmentsIntersect(
  firstStart: [number, number],
  firstEnd: [number, number],
  secondStart: [number, number],
  secondEnd: [number, number],
): boolean {
  const side = (start: [number, number], end: [number, number], point: [number, number]) =>
    (end[0] - start[0]) * (point[1] - start[1]) - (end[1] - start[1]) * (point[0] - start[0]);
  return (
    side(firstStart, firstEnd, secondStart) * side(firstStart, firstEnd, secondEnd) < 0 &&
    side(secondStart, secondEnd, firstStart) * side(secondStart, secondEnd, firstEnd) < 0
  );
}

function polygonDistance(left: [number, number][], right: [number, number][]): number {
  if (polygonContains(left, right[0]) || polygonContains(right, left[0])) return 0;
  let distance = Infinity;
  for (let leftIndex = 0; leftIndex < left.length; leftIndex += 1) {
    const leftStart = left[leftIndex];
    const leftEnd = left[(leftIndex + 1) % left.length];
    for (let rightIndex = 0; rightIndex < right.length; rightIndex += 1) {
      const rightStart = right[rightIndex];
      const rightEnd = right[(rightIndex + 1) % right.length];
      if (segmentsIntersect(leftStart, leftEnd, rightStart, rightEnd)) return 0;
      distance = Math.min(
        distance,
        pointSegmentDistance(leftStart, rightStart, rightEnd),
        pointSegmentDistance(leftEnd, rightStart, rightEnd),
        pointSegmentDistance(rightStart, leftStart, leftEnd),
        pointSegmentDistance(rightEnd, leftStart, leftEnd),
      );
    }
  }
  return distance;
}

describe('semantic map attention budget', () => {
  it('keeps rest weights near uniform despite extreme path counts', () => {
    const budget = computeBudget(manifest);
    const sorted = Object.values(budget).sort((a, b) => a - b);
    const median = (sorted[1] + sorted[2]) / 2;
    expect(sorted[0]).toBeGreaterThanOrEqual(median * 0.4);
    expect(sorted.at(-1)).toBeLessThanOrEqual(median * 2.5);
    expect(sorted.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1);
  });

  it('gives selected and routed regions 70 percent while retaining labeled pebbles', () => {
    const route: Route = {
      visits: ['two'],
      transitions: [{ from: 'two', to: 'three', count: 1, evidence: [] }],
    };
    const budget = computeBudget(manifest, { regionIds: ['one'], route });
    expect(budget.one + budget.two + budget.three).toBeCloseTo(FOCUS_BUDGET_SHARE);
    expect(budget.four).toBeGreaterThanOrEqual(LABELED_PEBBLE_BUDGET);
  });
});

describe('semantic map region placement', () => {
  it.each([
    { width: 1_200, height: 620 },
    { width: 960, height: 620 },
    { width: 420, height: 620 },
    { width: 320, height: 620 },
  ])('tessellates at least 97 percent of the $width px land with a uniform gutter', (land) => {
    const budget = computeBudget(manifest);
    const first = placeRegions(manifest, budget, land);
    expect(placeRegions(manifest, budget, land)).toEqual(first);
    expect(first.every((geometry) => geometry.hull.length === 96)).toBe(true);
    expect(
      first.reduce((area, geometry) => area + polygonArea(geometry.hull), 0),
    ).toBeGreaterThanOrEqual(land.width * land.height * 0.97);
    first.forEach((geometry, index) =>
      expect(
        polygonContains(
          geometry.hull,
          manifest.regions[index].anchor.map(
            (value, axis) => value * (axis === 0 ? land.width : land.height),
          ) as [number, number],
        ),
      ).toBe(true),
    );
    for (let left = 0; left < first.length; left += 1) {
      for (let right = left + 1; right < first.length; right += 1) {
        expect(
          polygonDistance(first[left].hull, first[right].hull),
          `${first[left].id} to ${first[right].id}`,
        ).toBeGreaterThanOrEqual(COLLISION_GAP - 1);
      }
    }
  });

  it('keeps region centers stable between rest and focus layouts', () => {
    const rest = placeRegions(manifest, computeBudget(manifest), viewport);
    const focus = placeRegions(manifest, computeBudget(manifest, { regionIds: ['two'] }), viewport);
    for (const geometry of rest) {
      const target = focus.find(({ id }) => id === geometry.id)!;
      expect(Math.hypot(target.x - geometry.x, target.y - geometry.y)).toBeLessThan(
        Math.min(viewport.width, viewport.height) * 0.05,
      );
    }
  });

  it.each([
    { width: 320, height: 620 },
    { width: 420, height: 620 },
    { width: 960, height: 620 },
    { width: 1_440, height: 900 },
  ])('keeps focus context scannable at $width px', (focusViewport) => {
    const focusId = 'two';
    const focus = placeRegions(
      manifest,
      computeBudget(manifest, { regionIds: [focusId] }),
      focusViewport,
    );
    const selected = focus.find(({ id }) => id === focusId)!;
    const context = focus.filter(({ id }) => id !== focusId);

    for (const geometry of context) {
      expect(geometry.radius).toBeGreaterThanOrEqual(FOCUS_CONTEXT_MIN_RADIUS);
      expect(geometry.radius * 2).toBeGreaterThanOrEqual(36 + 2 * 12);
    }

    const largestContextArea = Math.max(...context.map(({ hull }) => polygonArea(hull)));
    expect(polygonArea(selected.hull)).toBeGreaterThan(largestContextArea);
  });

  it('interpolates smoothly without mutating either endpoint', () => {
    const [start] = placeRegions(manifest, computeBudget(manifest), viewport);
    const [end] = placeRegions(manifest, computeBudget(manifest, { regionIds: ['one'] }), viewport);
    const midpoint = lerpGeometry(start, end, 0.5);
    expect(midpoint.radius).toBeCloseTo((start.radius + end.radius) / 2);
    expect(midpoint.hull).toHaveLength(96);
    expect(lerpGeometry(start, end, 0.5)).toEqual(midpoint);
    expect(lerpGeometry(start, end, 0)).toEqual(start);
    expect(lerpGeometry(start, end, 1)).toEqual(end);
  });

  it('caps an idle focus at 1.6 times its rest radius without drifting from interpolation', () => {
    const rest = placeRegions(manifest, computeBudget(manifest), viewport);
    const focus = rest.map((region) =>
      region.id === 'one'
        ? {
            ...region,
            x: region.x + 10,
            y: region.y + 10,
            radius: region.radius * 2,
            hull: region.hull.map(([x, y]) => [x + 10, y + 10] as [number, number]),
          }
        : region,
    );
    const capped = capFocusGeometry(rest, focus, new Set(['one']));
    const start = rest.find(({ id }) => id === 'one')!;
    const target = focus.find(({ id }) => id === 'one')!;
    const result = capped.find(({ id }) => id === 'one')!;

    expect(result.radius / start.radius).toBeCloseTo(1.6);
    expect(result.x).toBeGreaterThanOrEqual(Math.min(start.x, target.x));
    expect(result.x).toBeLessThanOrEqual(Math.max(start.x, target.x));
    expect(result.y).toBeGreaterThanOrEqual(Math.min(start.y, target.y));
    expect(result.y).toBeLessThanOrEqual(Math.max(start.y, target.y));
  });
});
