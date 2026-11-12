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

  it('scales visible geometry without numbered paint badges', () => {
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
    expect(ops[0]).toEqual({ kind: 'rect', x: 620, y: 456, w: 112, h: 36, width: 1.8 });
    expect(ops.map((op) => op.kind)).toEqual(['rect', 'rect']);
    // Small previews keep the same ink-only presentation.
    const tiny = { x: 0, y: 0, w: 10, h: 10 };
    const preview = layoutDockBurn(
      image,
      [{ n: 1, mark: mark({ kind: 'rect', ...tiny }, tiny) }],
      0.05,
      6,
    );
    expect(preview.map((op) => op.kind)).toEqual(['rect']);
  });
});
