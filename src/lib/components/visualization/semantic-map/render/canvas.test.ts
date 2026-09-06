import { describe, expect, it } from 'vitest';
import type { RegionGeometry } from '../layout/place';
import { CanvasPathCache } from './canvas';
import type { RouteEdge } from './types';

const geometry: RegionGeometry[] = [
  {
    id: 'one',
    x: 10,
    y: 10,
    radius: 5,
    budget: 1,
    hull: [
      [5, 5],
      [15, 5],
      [10, 15],
    ],
  },
  {
    id: 'two',
    x: 30,
    y: 10,
    radius: 5,
    budget: 1,
    hull: [
      [25, 5],
      [35, 5],
      [30, 15],
    ],
  },
];

const edge: RouteEdge = {
  from: 'one',
  to: 'two',
  startX: 10,
  startY: 10,
  controlX: 20,
  controlY: 15,
  endX: 30,
  endY: 10,
  count: 1,
  label: 'one file',
  evidence: ['one.ts'],
};

describe('semantic map canvas path cache', () => {
  it('allocates no hull or route paths across pure activity churn', () => {
    let allocations = 0;
    const createPath = () => {
      allocations += 1;
      return {
        moveTo() {},
        lineTo() {},
        closePath() {},
        quadraticCurveTo() {},
      } as unknown as Path2D;
    };
    const cache = new CanvasPathCache(createPath);

    cache.update(geometry, [edge]);
    expect(allocations).toBe(3);
    for (let frame = 0; frame < 240; frame += 1) {
      cache.update(geometry, [{ ...edge, count: frame + 1, label: `${frame + 1} files` }]);
    }

    expect(allocations).toBe(3);
    cache.update(
      [
        {
          ...geometry[0],
          hull: [
            [4, 5],
            [15, 5],
            [10, 15],
          ],
        },
        geometry[1],
      ],
      [edge],
    );
    expect(allocations).toBe(5);
  });
});
