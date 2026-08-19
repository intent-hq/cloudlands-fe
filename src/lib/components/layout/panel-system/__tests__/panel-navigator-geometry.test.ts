import { describe, expect, it } from 'vitest';
import { getPanelNavigatorGeometry } from '../panel-navigator-geometry';

describe('panel navigator geometry', () => {
  it('maps mixed rendered widths and the visible viewport to exact proportions', () => {
    expect(
      getPanelNavigatorGeometry(
        [
          { id: 'chat', left: 100, right: 500 },
          { id: 'note', left: 508, right: 1008 },
          { id: 'browser', left: 1016, right: 1916 },
        ],
        { left: 450, right: 1050 },
      ),
    ).toEqual({
      segments: [
        { id: 'chat', start: 0, size: 400 / 1816 },
        { id: 'note', start: 408 / 1816, size: 500 / 1816 },
        { id: 'browser', start: 916 / 1816, size: 900 / 1816 },
      ],
      thumbStart: 350 / 1816,
      thumbSize: 600 / 1816,
    });
  });

  it('uses a full thumb when the row fits and preserves the supplied order', () => {
    const result = getPanelNavigatorGeometry(
      [
        { id: 'second', left: 400, right: 700 },
        { id: 'first', left: 100, right: 400 },
      ],
      { left: 0, right: 800 },
    );
    expect(result.segments.map((segment) => segment.id)).toEqual(['second', 'first']);
    expect(result.thumbStart).toBe(0);
    expect(result.thumbSize).toBe(1);
  });

  it('clamps offscreen and invalid ranges without stale geometry', () => {
    expect(
      getPanelNavigatorGeometry(
        [
          { id: 'bad', left: 10, right: 10 },
          { id: 'panel', left: 100, right: 500 },
        ],
        { left: 600, right: 900 },
      ),
    ).toEqual({
      segments: [{ id: 'panel', start: 0, size: 1 }],
      thumbStart: 1,
      thumbSize: 0,
    });
    expect(getPanelNavigatorGeometry([], { left: 0, right: 100 })).toEqual({
      segments: [],
      thumbStart: 0,
      thumbSize: 0,
    });
  });
});
