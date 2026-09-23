import { describe, expect, it } from 'vitest';
import { freeLabelFractions } from '../diagram-label-placement';

describe('free on-edge label intervals', () => {
  const start = { x: 60, y: 60 };
  const end = { x: 60, y: 1060 };
  const label = { width: 112, height: 22 };
  const obstacles = [
    { x: 100, y: 80, width: 120, height: 385, padding: 8 },
    { x: 110, y: 505, width: 120, height: 535, padding: 8 },
  ];

  it('finds the narrow clear corridor missed by fixed percentage samples', () => {
    const fractions = freeLabelFractions(start, end, label, obstacles, 8);
    expect(fractions).toHaveLength(1);
    const center = start.y + (end.y - start.y) * fractions[0];
    expect(center - label.height / 2).toBeGreaterThan(465 + 8);
    expect(center + label.height / 2).toBeLessThan(505 - 8);
  });

  it('preserves direction without moving a candidate off its edge', () => {
    const forward = freeLabelFractions(start, end, label, obstacles, 8);
    const reverse = freeLabelFractions(end, start, label, obstacles, 8);
    expect(reverse).toHaveLength(1);
    expect(end.y + (start.y - end.y) * reverse[0]).toBeCloseTo(start.y + 1000 * forward[0]);
  });

  it('returns the center of an unobstructed segment', () => {
    expect(freeLabelFractions(start, end, label, [], 8)).toEqual([0.5]);
  });

  it('does not claim a position when the readable box cannot fit', () => {
    expect(freeLabelFractions(start, end, { ...label, height: 40 }, obstacles, 8)).toEqual([]);
  });

  it('ignores rectangles whose perpendicular extent cannot touch the label', () => {
    expect(
      freeLabelFractions(
        start,
        end,
        label,
        [{ x: 130, y: 0, width: 40, height: 1200, padding: 8 }],
        8,
      ),
    ).toEqual([0.5]);
  });

  it('handles horizontal segments and merges overlapping blocked intervals', () => {
    const fractions = freeLabelFractions(
      { x: 0, y: 30 },
      { x: 400, y: 30 },
      { width: 40, height: 20 },
      [
        { x: 80, y: 20, width: 70, height: 20 },
        { x: 120, y: 20, width: 80, height: 20 },
      ],
      8,
    );
    expect(fractions).toHaveLength(2);
    for (const fraction of fractions) {
      const x = fraction * 400;
      expect(x - 20 > 200 || x + 20 < 80).toBe(true);
      expect(Math.min(x, 400 - x)).toBeGreaterThan(28);
    }
  });

  it('clips diagonal segments against both rectangle axes', () => {
    const fractions = freeLabelFractions(
      { x: 0, y: 0 },
      { x: 200, y: 200 },
      { width: 20, height: 20 },
      [{ x: 80, y: 80, width: 40, height: 40 }],
      8,
    );
    expect(fractions).toHaveLength(2);
    for (const fraction of fractions)
      expect(fraction * 200 < 70 || fraction * 200 > 130).toBe(true);
  });

  it('does not shorten terminal clearance on short or zero-length segments', () => {
    expect(freeLabelFractions(start, { x: 60, y: 90 }, label, [], 8)).toEqual([]);
    expect(freeLabelFractions(start, start, label, [], 8)).toEqual([]);
  });
});
