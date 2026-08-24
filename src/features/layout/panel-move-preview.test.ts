import { describe, expect, it } from 'vitest';
import {
  getPaneDropPreview,
  getPanelMovePreview,
  getPanelMovePreviewWidthRatio,
  getPanelRootEdgeMovePreview,
  PANE_DROP_PREVIEW_PANEL_ID,
} from './panel-move-preview';
import type { PaneDropPlacement } from '$lib/components/layout/panel-system/panel-drag';
import type {
  PanelColumnCount,
  PanelLayoutSliceState,
  PanelState,
  WorkspacePanelLayout,
} from '$store/renderer/slices/panel-layout/panel-layout-types';
import { getPanelOrder } from '$store/renderer/slices/panel-layout/panel-layout-tabless';
import {
  emptyWorkspaceState,
  moveTabToPanel,
  moveTabToSplit,
  panelLayoutReducer,
} from '$store/renderer/slices/panel-layout/panel-layout-slice';

function makeLayout(
  stacks: Record<string, string[]>,
  sizes = Object.keys(stacks).map(() => 100 / Object.keys(stacks).length),
): Pick<WorkspacePanelLayout, 'root' | 'panels'> {
  const panelIds = Object.keys(stacks);
  const panels = Object.fromEntries(
    Object.entries(stacks).map(([panelId, tabIds]) => [
      panelId,
      {
        id: panelId,
        tabs: tabIds.map((id) => ({ id, type: 'note' as const, title: id, closable: true })),
        activeTabId: tabIds[0] ?? null,
      } satisfies PanelState,
    ]),
  );
  return {
    root: {
      type: 'split',
      direction: 'horizontal',
      sizes,
      children: panelIds.map((panelId) => ({ type: 'panel', panelId })),
    },
    panels,
  };
}

function project(
  layout: Pick<WorkspacePanelLayout, 'root' | 'panels'>,
  placement: PaneDropPlacement,
  canvasWidth = 1000,
) {
  const result = getPaneDropPreview(
    layout,
    { panelId: 'source', tabId: 'drag' },
    placement,
    canvasWidth,
  );
  if (!result) throw new Error('Expected pane move projection');
  return result;
}

function countPane(result: ReturnType<typeof project>, tabId: string): number {
  return Object.values(result.panels).reduce(
    (count, panel) => count + panel.tabs.filter((tab) => tab.id === tabId).length,
    0,
  );
}

function drop(
  layout: Pick<WorkspacePanelLayout, 'root' | 'panels'>,
  action: ReturnType<typeof moveTabToPanel> | ReturnType<typeof moveTabToSplit>,
) {
  const state: PanelLayoutSliceState = {
    byWorkspaceId: {
      ws: {
        ...emptyWorkspaceState,
        ...layout,
        canvasWidth: 1000,
        columnCount: Object.keys(layout.panels).length as PanelColumnCount,
      },
    },
  };
  return panelLayoutReducer(state, action).byWorkspaceId.ws;
}

describe('getPaneDropPreview', () => {
  it.each<[string, PaneDropPlacement, string[], number[]]>([
    [
      'before at the outer left edge',
      { kind: 'edge', position: 'before' },
      ['source', 'left', 'right'],
      [30, 20, 50],
    ],
    [
      'before a target panel',
      { kind: 'panel', targetPanelId: 'left', zone: 'left' },
      ['source', 'left', 'right'],
      [30, 20, 50],
    ],
    [
      'between existing columns',
      { kind: 'panel', targetPanelId: 'right', zone: 'left' },
      ['left', 'source', 'right'],
      [20, 30, 50],
    ],
    [
      'after a target panel',
      { kind: 'panel', targetPanelId: 'right', zone: 'right' },
      ['left', 'right', 'source'],
      [20, 50, 30],
    ],
    [
      'after at the outer right edge',
      { kind: 'edge', position: 'after' },
      ['left', 'right', 'source'],
      [20, 50, 30],
    ],
  ])('moves a one-pane source column %s with its width', (_, placement, order, sizes) => {
    const layout = makeLayout(
      { left: ['left-pane'], source: ['drag'], right: ['right-pane'] },
      [20, 30, 50],
    );
    const preview = project(layout, placement);

    expect(getPanelOrder(preview.root)).toEqual(order);
    expect(preview.root).toMatchObject({ sizes });
    expect(preview.destinationPanelId).toBe('source');
    expect(countPane(preview, 'drag')).toBe(1);
    expect(getPanelMovePreviewWidthRatio(layout.root, preview.root)).toBe(1);
  });

  it.each<[string, PaneDropPlacement, string[]]>([
    [
      'before',
      { kind: 'edge', position: 'before' },
      [PANE_DROP_PREVIEW_PANEL_ID, 'source', 'middle', 'right'],
    ],
    [
      'between',
      { kind: 'panel', targetPanelId: 'middle', zone: 'left' },
      ['source', PANE_DROP_PREVIEW_PANEL_ID, 'middle', 'right'],
    ],
    [
      'after',
      { kind: 'edge', position: 'after' },
      ['source', 'middle', 'right', PANE_DROP_PREVIEW_PANEL_ID],
    ],
  ])('moves one pane from a multi-pane source to a new column %s', (_, placement, order) => {
    const preview = project(
      makeLayout({ source: ['drag', 'under'], middle: ['middle-pane'], right: ['right-pane'] }),
      placement,
    );

    expect(getPanelOrder(preview.root)).toEqual(order);
    expect(preview.panels.source.tabs.map((tab) => tab.id)).toEqual(['under']);
    expect(preview.panels.source.activeTabId).toBe('under');
    expect(preview.panels[PANE_DROP_PREVIEW_PANEL_ID].tabs.map((tab) => tab.id)).toEqual(['drag']);
    expect(countPane(preview, 'drag')).toBe(1);
  });

  it('merges into the target stack and removes a one-pane source column', () => {
    const layout = makeLayout(
      { left: ['left-pane'], source: ['drag'], target: ['target-pane'] },
      [20, 30, 50],
    );
    const preview = project(layout, {
      kind: 'panel',
      targetPanelId: 'target',
      zone: 'center',
    });

    expect(getPanelOrder(preview.root)).toEqual(['left', 'target']);
    expect(preview.root).toMatchObject({
      sizes: [expect.closeTo((2 / 7) * 100), expect.closeTo((5 / 7) * 100)],
    });
    expect(preview.panels.source).toBeUndefined();
    expect(preview.panels.target.tabs.map((tab) => tab.id)).toEqual(['target-pane', 'drag']);
    expect(preview.panels.target.activeTabId).toBe('drag');
    expect(countPane(preview, 'drag')).toBe(1);
    expect(
      getPanelMovePreviewWidthRatio(layout.root, preview.root, 1000, preview.canvasWidth),
    ).toBeCloseTo(0.6968);
  });

  it('reveals the next underlying pane when merging from a multi-pane source', () => {
    const layout = makeLayout({ source: ['before', 'drag', 'after'], target: ['target-pane'] });
    layout.panels.source.activeTabId = 'drag';
    const preview = project(layout, {
      kind: 'panel',
      targetPanelId: 'target',
      zone: 'center',
    });

    expect(preview.root).toBe(layout.root);
    expect(preview.panels.source.tabs.map((tab) => tab.id)).toEqual(['before', 'after']);
    expect(preview.panels.source.activeTabId).toBe('after');
    expect(preview.panels.target.activeTabId).toBe('drag');
    expect(countPane(preview, 'drag')).toBe(1);
  });

  it('keeps self and already-placed targets stable', () => {
    const layout = makeLayout({ source: ['drag'], target: ['target-pane'] }, [35, 65]);
    const self = project(layout, { kind: 'panel', targetPanelId: 'source', zone: 'center' });
    const edge = project(layout, { kind: 'edge', position: 'before' });

    expect(self).toMatchObject({ root: layout.root, panels: layout.panels, changed: false });
    expect(edge).toMatchObject({ root: layout.root, panels: layout.panels, changed: false });
    expect(countPane(self, 'drag')).toBe(1);
  });

  it('blocks a fifth destination column but permits a real-column reorder at the cap', () => {
    const multi = makeLayout({
      source: ['drag', 'under'],
      two: ['two'],
      three: ['three'],
      four: ['four'],
    });
    const blocked = project(multi, { kind: 'edge', position: 'after' });
    const single = makeLayout({ source: ['drag'], two: ['two'], three: ['three'], four: ['four'] });
    const reordered = project(single, { kind: 'edge', position: 'after' });

    expect(blocked).toMatchObject({ root: multi.root, panels: multi.panels, changed: false });
    expect(getPanelOrder(reordered.root)).toEqual(['two', 'three', 'four', 'source']);
    expect(countPane(reordered, 'drag')).toBe(1);
  });
});

describe('preview and drop parity', () => {
  it('matches a final-pane center merge', () => {
    const layout = makeLayout({ source: ['drag'], target: ['target-pane'] }, [35, 65]);
    const preview = project(layout, {
      kind: 'panel',
      targetPanelId: 'target',
      zone: 'center',
    });
    const dropped = drop(layout, moveTabToPanel('ws', 'drag', 'source', 'target', undefined, 1));

    expect(dropped.root).toEqual(preview.root);
    expect(dropped.panels).toEqual(preview.panels);
    expect(dropped.canvasWidth).toBeCloseTo(preview.canvasWidth ?? 0);
  });

  it('matches a multi-pane side move apart from the generated destination ID', () => {
    const layout = makeLayout({ source: ['drag', 'under'], target: ['target-pane'] }, [35, 65]);
    const preview = project(layout, {
      kind: 'panel',
      targetPanelId: 'target',
      zone: 'right',
    });
    const action = moveTabToSplit('ws', 'drag', 'source', 'target', 'right', 1);
    const dropped = drop(layout, action);
    const expectedOrder = getPanelOrder(preview.root).map((panelId) =>
      panelId === PANE_DROP_PREVIEW_PANEL_ID ? action.payload.newPanelId : panelId,
    );

    expect(getPanelOrder(dropped.root)).toEqual(expectedOrder);
    expect(dropped.root).toMatchObject({
      sizes: preview.root.type === 'split' ? preview.root.sizes : [],
    });
    expect(dropped.panels.source).toEqual(preview.panels.source);
    expect(dropped.panels[action.payload.newPanelId].tabs).toEqual(
      preview.panels[PANE_DROP_PREVIEW_PANEL_ID].tabs,
    );
    expect(dropped.canvasWidth).toBe(preview.canvasWidth);
  });
});

describe('getPanelMovePreview', () => {
  it('projects the same nested end state without mutating the live tree', () => {
    const root = {
      type: 'split' as const,
      direction: 'horizontal' as const,
      sizes: [40, 60],
      children: [
        { type: 'panel' as const, panelId: 'source' },
        { type: 'panel' as const, panelId: 'target' },
      ],
    };

    expect(getPanelMovePreview(root, 'source', 'target', 'above')).toEqual({
      type: 'split',
      direction: 'vertical',
      sizes: [50, 50],
      children: [
        { type: 'panel', panelId: 'source' },
        { type: 'panel', panelId: 'target' },
      ],
    });
    expect(root).toEqual({
      type: 'split',
      direction: 'horizontal',
      sizes: [40, 60],
      children: [
        { type: 'panel', panelId: 'source' },
        { type: 'panel', panelId: 'target' },
      ],
    });
  });

  it('promotes a nested panel into a true root-level left column', () => {
    const root = {
      type: 'split' as const,
      direction: 'horizontal' as const,
      sizes: [40, 60],
      children: [
        {
          type: 'split' as const,
          direction: 'vertical' as const,
          sizes: [50, 50],
          children: [
            { type: 'panel' as const, panelId: 'source' },
            { type: 'panel' as const, panelId: 'stack-mate' },
          ],
        },
        { type: 'panel' as const, panelId: 'right' },
      ],
    };

    const preview = getPanelRootEdgeMovePreview(root, 'source', 'before');
    expect(preview).toMatchObject({
      type: 'split',
      direction: 'horizontal',
      children: [
        { type: 'panel', panelId: 'source' },
        { type: 'panel', panelId: 'stack-mate' },
        { type: 'panel', panelId: 'right' },
      ],
    });
    expect(preview.type).toBe('split');
    if (preview.type === 'split') {
      expect(preview.sizes[0]).toBeCloseTo(100 / 3);
      expect(preview.sizes[1]).toBeCloseTo((40 * 2) / 3);
      expect(preview.sizes[2]).toBeCloseTo(40);
    }
    expect(getPanelMovePreviewWidthRatio(root, preview)).toBe(1.5);
    expect(root.children[0].type).toBe('split');
  });

  it('uses a default column share when promoting a stacked panel beside a target', () => {
    const root = {
      type: 'split' as const,
      direction: 'horizontal' as const,
      sizes: [40, 60],
      children: [
        {
          type: 'split' as const,
          direction: 'vertical' as const,
          sizes: [50, 50],
          children: [
            { type: 'panel' as const, panelId: 'source' },
            { type: 'panel' as const, panelId: 'stack-mate' },
          ],
        },
        { type: 'panel' as const, panelId: 'target' },
      ],
    };

    const preview = getPanelMovePreview(root, 'source', 'target', 'before');
    expect(preview.type).toBe('split');
    if (preview.type === 'split') {
      expect(preview.sizes[0]).toBeCloseTo((40 * 2) / 3);
      expect(preview.sizes[1]).toBeCloseTo(100 / 3);
      expect(preview.sizes[2]).toBeCloseTo(40);
    }
  });
});
