import { describe, expect, it } from 'vitest';
import type { Manifest, Route } from '../core/types';
import { computeBudget, FOCUS_BUDGET_SHARE, LABELED_PEBBLE_BUDGET } from './budget';
import { lerpGeometry } from './interpolate';
import { FOCUS_CONTEXT_MIN_RADIUS, placeRegions } from './place';

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
  it('is deterministic, produces hulls, and leaves no circle overlaps', () => {
    const budget = computeBudget(manifest);
    const first = placeRegions(manifest, budget, viewport);
    expect(placeRegions(manifest, budget, viewport)).toEqual(first);
    expect(first.every((geometry) => geometry.hull.length > 3)).toBe(true);
    for (const geometry of first) {
      const centroid = geometry.hull.reduce(
        ([sumX, sumY], [x, y]) => [
          sumX + x / geometry.hull.length,
          sumY + y / geometry.hull.length,
        ],
        [0, 0],
      );
      const distances = geometry.hull.map(([x, y]) => Math.hypot(x - centroid[0], y - centroid[1]));
      const maximumDistance = Math.max(...distances);
      expect(maximumDistance / Math.min(...distances)).toBeGreaterThanOrEqual(1.35);
      expect(polygonArea(geometry.hull)).toBeLessThanOrEqual(Math.PI * maximumDistance ** 2 * 0.85);
      expect(
        Math.max(...geometry.hull.map(([x, y]) => Math.hypot(x - geometry.x, y - geometry.y))),
      ).toBeLessThanOrEqual(geometry.radius + 0.001);
    }
    for (let left = 0; left < first.length; left += 1) {
      for (let right = left + 1; right < first.length; right += 1) {
        const dx = first[left].x - first[right].x;
        const dy = first[left].y - first[right].y;
        expect(Math.hypot(dx, dy)).toBeGreaterThanOrEqual(first[left].radius + first[right].radius);
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

    const largestContextArea = Math.max(...context.map(({ radius }) => radius ** 2));
    expect(selected.radius ** 2 / largestContextArea).toBeGreaterThanOrEqual(3.5);
  });

  it('interpolates smoothly without mutating either endpoint', () => {
    const [start] = placeRegions(manifest, computeBudget(manifest), viewport);
    const [end] = placeRegions(manifest, computeBudget(manifest, { regionIds: ['one'] }), viewport);
    const midpoint = lerpGeometry(start, end, 0.5);
    expect(midpoint.radius).toBeCloseTo((start.radius + end.radius) / 2);
    expect(lerpGeometry(start, end, 0)).toEqual(start);
    expect(lerpGeometry(start, end, 1)).toEqual(end);
  });
});
