import { describe, expect, it } from 'vitest';
import {
  getElementContentBoxSize,
  getPanelFlexValue,
  getPanelReferenceSize,
  resizeAdjacentPanels,
} from '../panel-resize';

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

describe('getElementContentBoxSize', () => {
  function makeElement(clientWidth: number, clientHeight: number, padding: string): HTMLElement {
    const element = document.createElement('div');
    Object.defineProperty(element, 'clientWidth', { value: clientWidth });
    Object.defineProperty(element, 'clientHeight', { value: clientHeight });
    element.style.padding = padding;
    return element;
  }

  it('excludes padding from the measured axis (the padded inset viewport)', () => {
    const element = makeElement(800, 384, '8px');

    expect(getElementContentBoxSize(element, 'horizontal')).toBe(784);
    expect(getElementContentBoxSize(element, 'vertical')).toBe(368);
  });

  it('returns the client size unchanged for unpadded elements', () => {
    const element = makeElement(800, 384, '0px');

    expect(getElementContentBoxSize(element, 'horizontal')).toBe(800);
    expect(getElementContentBoxSize(element, 'vertical')).toBe(384);
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
