import { describe, expect, it } from 'vitest';
import type { PanelLayoutNode, PanelState } from './panel-layout-types';
import {
  getAutomaticPanelLayoutCanvasWidth,
  getHorizontalPanelColumnDefaultWidthTiers,
  getHorizontalPanelColumnDefaultWidths,
} from './panel-layout-tabless';

function horizontalRoot(left: string, right: string): PanelLayoutNode {
  return {
    type: 'split',
    direction: 'horizontal',
    children: [
      { type: 'panel', panelId: left },
      { type: 'panel', panelId: right },
    ],
    sizes: [50, 50],
  };
}

function panels(left: 'agent' | 'browser', right: 'note'): Record<string, PanelState> {
  return {
    [left]: {
      id: left,
      tabs: [{ id: `${left}-tab`, type: left, title: left, closable: true }],
      activeTabId: `${left}-tab`,
    },
    [right]: {
      id: right,
      tabs: [{ id: `${right}-tab`, type: right, title: right, closable: true }],
      activeTabId: `${right}-tab`,
    },
  };
}

describe('panel layout default width tiers', () => {
  it('uses the usable viewport when resolving a responsive note column', () => {
    const root = horizontalRoot('agent', 'note');
    const layoutPanels = panels('agent', 'note');

    expect(getHorizontalPanelColumnDefaultWidthTiers(root, layoutPanels)).toEqual([
      'chat',
      'medium',
    ]);
    expect(getHorizontalPanelColumnDefaultWidths(root, layoutPanels, 1200)).toEqual([700, 720]);
    expect(getAutomaticPanelLayoutCanvasWidth(root, layoutPanels, 'content', 1200)).toBe(1428);
  });

  it('clamps only chat defaults to a narrow usable viewport', () => {
    const root = horizontalRoot('agent', 'note');
    const layoutPanels = panels('agent', 'note');

    expect(getHorizontalPanelColumnDefaultWidths(root, layoutPanels, 480)).toEqual([480, 500]);
  });

  it('resolves adjacent browser and note panels to responsive defaults', () => {
    const root = horizontalRoot('browser', 'note');
    const layoutPanels = panels('browser', 'note');

    expect(getHorizontalPanelColumnDefaultWidthTiers(root, layoutPanels)).toEqual([
      'wide',
      'medium',
    ]);
    expect(getHorizontalPanelColumnDefaultWidths(root, layoutPanels, 1200)).toEqual([960, 720]);
  });
});
