import { describe, expect, it } from 'vitest';
import type { PanelLayoutNode } from '$features/layout/panel-layout-adapter';
import { getDominantPanelChildWidth } from '../panel-dominant-flex';

const panel = (panelId: string): PanelLayoutNode => ({ type: 'panel', panelId });

describe('dominant panel live flex geometry', () => {
  it('reserves a 280px sibling and gives the target the exact 1600px remainder', () => {
    const root: PanelLayoutNode = {
      type: 'split',
      direction: 'horizontal',
      children: [panel('target'), panel('sibling')],
      sizes: [71.774, 28.226],
    };

    expect(getDominantPanelChildWidth(root, 0, 'target', 1592)).toBe(1312);
    expect(getDominantPanelChildWidth(root, 1, 'target', 1592)).toBe(280);
  });

  it('keeps every panel compact when a sibling subtree does not contain the target', () => {
    const sibling: PanelLayoutNode = {
      type: 'split',
      direction: 'horizontal',
      children: [panel('sibling-1'), panel('sibling-2')],
      sizes: [30, 70],
    };
    expect(getDominantPanelChildWidth(sibling, 0, 'target', 560)).toBe(280);
    expect(getDominantPanelChildWidth(sibling, 1, 'target', 560)).toBe(280);
  });

  it('reserves internal gutters inside a compact horizontal sibling subtree', () => {
    const sibling: PanelLayoutNode = {
      type: 'split',
      direction: 'horizontal',
      children: [panel('sibling-1'), panel('sibling-2')],
      sizes: [50, 50],
    };
    const root: PanelLayoutNode = {
      type: 'split',
      direction: 'horizontal',
      children: [panel('target'), sibling],
      sizes: [65, 35],
    };

    expect(getDominantPanelChildWidth(root, 0, 'target', 1592)).toBe(1024);
    expect(getDominantPanelChildWidth(root, 1, 'target', 1592)).toBe(568);
  });

  it('uses compact overflow widths when the live reference cannot fit all minimums', () => {
    const root: PanelLayoutNode = {
      type: 'split',
      direction: 'horizontal',
      children: [panel('target'), panel('sibling-1'), panel('sibling-2')],
      sizes: [60, 20, 20],
    };
    expect(
      [0, 1, 2].map((index) => getDominantPanelChildWidth(root, index, 'target', 700)),
    ).toEqual([280, 280, 280]);
  });

  it('leaves vertical geometry on its saved percentages', () => {
    const root: PanelLayoutNode = {
      type: 'split',
      direction: 'vertical',
      children: [panel('target'), panel('sibling')],
      sizes: [40, 60],
    };
    expect(getDominantPanelChildWidth(root, 0, 'target', 1000)).toBeNull();
  });
});
