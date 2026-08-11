import { describe, expect, it } from 'vitest';
import { getPanelFlexValue, getPanelReferenceSize, resizeAdjacentPanels } from '../panel-resize';

describe('resizeAdjacentPanels', () => {
  it('resizes the two panels adjacent to a gutter without changing the total', () => {
    const sizes = [30, 30, 40];

    expect(resizeAdjacentPanels(sizes, 0, 8)).toEqual([38, 22, 40]);
    expect(sizes).toEqual([30, 30, 40]);
  });

  it('resizes the last panel through the final gutter', () => {
    expect(resizeAdjacentPanels([30, 30, 40], 1, 8)).toEqual([30, 38, 32]);
  });

  it('clamps both adjacent panels to the size bounds', () => {
    expect(resizeAdjacentPanels([50, 25, 25], 0, -100)).toEqual([10, 65, 25]);
    expect(resizeAdjacentPanels([50, 25, 25], 0, 100)).toEqual([65, 10, 25]);
    expect(resizeAdjacentPanels([100, 25, 25], 0, -100)).toEqual([25, 100, 25]);
  });
});

describe('getPanelReferenceSize', () => {
  it('uses the panel minimums when they exceed the viewport', () => {
    expect(getPanelReferenceSize(1350, 3, 450, 16)).toBe(1350);
  });

  it('uses available panel space when the viewport is wider than the minimums', () => {
    expect(getPanelReferenceSize(1600, 3, 450, 16)).toBe(1584);
  });
});

describe('getPanelFlexValue', () => {
  it('uses percentages in contained layouts and stable pixel bases in overflowing layouts', () => {
    expect(getPanelFlexValue(40, 1200, true)).toBe('40 1 0%');
    expect(getPanelFlexValue(40, 1200, false)).toBe('0 0 480px');
  });

  it('retains a measured singleton width when a split collapses', () => {
    expect(getPanelFlexValue(100, 1062, true, 450)).toBe('0 0 450px');
  });
});
