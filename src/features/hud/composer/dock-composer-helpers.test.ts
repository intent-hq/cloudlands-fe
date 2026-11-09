import { describe, expect, it } from 'vitest';
import type { DockMark } from '$shared/dock-evidence';
import { layoutDockBurn } from './dock-evidence-render';

describe('dock evidence burn layout', () => {
  const mark = (geometry: DockMark['geometry'], bounds: DockMark['bounds']): DockMark => ({
    id: 'm',
    imageId: 'a',
    tool: 'box',
    geometry,
    bounds,
    element: null,
    createdAt: 0,
  });

  it('scales geometry to the output and keeps every badge inside the image', () => {
    const image = { width: 2880, height: 1800, displayScale: 2 };
    const ops = layoutDockBurn(
      image,
      [
        {
          n: 1,
          mark: mark(
            { kind: 'rect', x: 1240, y: 912, w: 224, h: 72 },
            { x: 1240, y: 912, w: 224, h: 72 },
          ),
        },
        {
          n: 12,
          mark: mark(
            { kind: 'rect', x: 2800, y: 0, w: 80, h: 30 },
            { x: 2800, y: 0, w: 80, h: 30 },
          ),
        },
      ],
      0.5,
    );
    expect(ops[0]).toEqual({ kind: 'rect', x: 620, y: 456, w: 112, h: 36, width: 2 });
    const badges = ops.filter((op) => op.kind === 'badge');
    expect(badges.map((op) => op.label)).toEqual(['1', '12']);
    for (const badge of badges) {
      if (badge.kind !== 'badge') continue;
      expect(badge.x + badge.radius).toBeLessThanOrEqual(1440);
      expect(badge.y - badge.radius).toBeGreaterThanOrEqual(0);
    }
    // Small previews keep a legible numeral regardless of output scale.
    const tiny = { x: 0, y: 0, w: 10, h: 10 };
    const preview = layoutDockBurn(
      image,
      [{ n: 1, mark: mark({ kind: 'rect', ...tiny }, tiny) }],
      0.05,
      6,
    );
    expect(preview.find((op) => op.kind === 'badge')).toMatchObject({ radius: 6 });
  });
});
