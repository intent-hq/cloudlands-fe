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
  it('subtracts the total gutter width from the available size', () => {
    expect(getPanelReferenceSize(1350, 16)).toBe(1334);
  });

  it('never returns a non-positive reference size', () => {
    expect(getPanelReferenceSize(8, 16)).toBe(1);
  });
});

describe('getPanelFlexValue', () => {
  it('uses percentages before measurement and stable pixel bases afterward', () => {
    expect(getPanelFlexValue(40, null)).toBe('40 1 0%');
    expect(getPanelFlexValue(40, 1200)).toBe('0 0 480px');
  });

  it('retains a measured singleton width when a split collapses', () => {
    expect(getPanelFlexValue(100, 1062, 450)).toBe('0 0 450px');
  });
});
