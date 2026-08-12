import { describe, expect, it } from 'vitest';
import {
  appendHorizontalColumn,
  countHorizontalPanelColumns,
  getPanelOrder,
  insertHorizontalPanelInLayout,
  insertHorizontalPanel,
  normalizeTablessPanelLayout,
  removeForeignWorkspaceTabs,
  findRootHorizontalPanelIndex,
  removePanelPreservingHorizontalWidths,
  resizePanelTreeAtHorizontalIndex,
  resizePanelTreeRightEdge,
} from './panel-layout-tabless';

describe('tabless panel layout', () => {
  it('removes foreign workspace tabs and collapses panels they exclusively occupied', () => {
    const result = removeForeignWorkspaceTabs(
      {
        root: {
          type: 'split',
          direction: 'horizontal',
          children: [
            { type: 'panel', panelId: 'owned' },
            { type: 'panel', panelId: 'foreign' },
          ],
          sizes: [50, 50],
        },
        panels: {
          owned: {
            id: 'owned',
            tabs: [
              {
                id: 'owned-tab',
                type: 'agent',
                title: 'Owned',
                closable: true,
                workspaceId: 'ws-1',
              },
            ],
            activeTabId: 'owned-tab',
          },
          foreign: {
            id: 'foreign',
            tabs: [
              {
                id: 'foreign-tab',
                type: 'agent',
                title: 'Foreign',
                closable: true,
                workspaceId: 'ws-2',
              },
            ],
            activeTabId: 'foreign-tab',
          },
        },
        focusedPanelId: 'foreign',
        canvasWidth: 1200,
      },
      'ws-1',
    );

    expect(result.root).toEqual({ type: 'panel', panelId: 'owned' });
    expect(Object.keys(result.panels)).toEqual(['owned']);
    expect(result.focusedPanelId).toBe('owned');
    expect(result.canvasWidth).toBe(1200);
  });

  it('keeps global tabs and repairs active selection in mixed panels', () => {
    const result = removeForeignWorkspaceTabs(
      {
        root: { type: 'panel', panelId: 'p1' },
        panels: {
          p1: {
            id: 'p1',
            tabs: [
              { id: 'global', type: 'settings', title: 'Settings', closable: true },
              {
                id: 'foreign',
                type: 'agent',
                title: 'Foreign',
                closable: true,
                workspaceId: 'ws-2',
              },
            ],
            activeTabId: 'foreign',
          },
        },
        focusedPanelId: 'p1',
      },
      'ws-1',
    );

    expect(result.panels.p1.tabs.map((tab) => tab.id)).toEqual(['global']);
    expect(result.panels.p1.activeTabId).toBe('global');
  });

  it('preserves nested splits while creating one panel per tab', () => {
    const result = normalizeTablessPanelLayout({
      root: {
        type: 'split',
        direction: 'vertical',
        sizes: [50, 50],
        children: [
          { type: 'panel', panelId: 'p1' },
          { type: 'panel', panelId: 'p2' },
        ],
      },
      panels: {
        p1: {
          id: 'p1',
          tabs: [
            { id: 't1', type: 'agent', title: 'Agent', closable: true },
            { id: 't2', type: 'note', title: 'Spec', closable: true },
          ],
          activeTabId: 't2',
        },
        p2: { id: 'p2', tabs: [], activeTabId: null },
      },
      focusedPanelId: 'p1',
    });

    expect(result.root.type).toBe('split');
    expect(result.root.type === 'split' && result.root.direction).toBe('vertical');
    expect(getPanelOrder(result.root)).toEqual(['p1', 'p1--t2', 'p2']);
    expect(
      result.root.type === 'split' &&
        result.root.children[0].type === 'split' &&
        result.root.children[0].direction,
    ).toBe('horizontal');
    expect(Object.values(result.panels).every((panel) => panel.tabs.length <= 1)).toBe(true);
    expect(result.focusedPanelId).toBe('p1--t2');
  });

  it('inserts new content directly after its source panel', () => {
    const panel = {
      id: 'p3',
      tabs: [{ id: 't3', type: 'file' as const, title: 'file.ts', closable: true }],
      activeTabId: 't3',
    };
    const result = insertHorizontalPanel(
      {
        root: { type: 'panel', panelId: 'p1' },
        panels: { p1: { id: 'p1', tabs: [], activeTabId: null } },
        focusedPanelId: 'p1',
      },
      panel,
      'p1',
    );

    expect(getPanelOrder(result.root)).toEqual(['p1', 'p3']);
    expect(result.panels.p3).toEqual(panel);
    expect(result.focusedPanelId).toBe('p3');
  });

  it('adds a horizontal panel without changing existing column pixels', () => {
    const result = insertHorizontalPanelInLayout(
      {
        type: 'split',
        direction: 'horizontal',
        children: [
          { type: 'panel', panelId: 'p1' },
          { type: 'panel', panelId: 'p2' },
        ],
        sizes: [60, 40],
      },
      'p3',
      'p1',
    );

    expect(result).toMatchObject({
      type: 'split',
      children: [{ panelId: 'p1' }, { panelId: 'p3' }, { panelId: 'p2' }],
    });
    if (result?.type === 'split') {
      expect(result.sizes[0]).toBeCloseTo(40);
      expect(result.sizes[1]).toBeCloseTo(100 / 3);
      expect(result.sizes[2]).toBeCloseTo(80 / 3);
    }
  });

  it('uses the resized canvas when preserving pixels during horizontal insertion', () => {
    const result = insertHorizontalPanelInLayout(
      {
        type: 'split',
        direction: 'horizontal',
        children: [
          { type: 'panel', panelId: 'p1' },
          { type: 'panel', panelId: 'p2' },
        ],
        sizes: [60, 40],
      },
      'p3',
      'p1',
      1000,
    );

    if (result?.type !== 'split') throw new Error('Expected horizontal split');
    expect(result.sizes[0]).toBeCloseTo((600 / 1480) * 100);
    expect(result.sizes[1]).toBeCloseTo((480 / 1480) * 100);
    expect(result.sizes[2]).toBeCloseTo((400 / 1480) * 100);
  });

  it('removes a horizontal panel without changing surviving column pixels', () => {
    const result = removePanelPreservingHorizontalWidths(
      {
        type: 'split',
        direction: 'horizontal',
        children: [
          { type: 'panel', panelId: 'p1' },
          { type: 'panel', panelId: 'p2' },
          { type: 'panel', panelId: 'p3' },
        ],
        sizes: [25, 30, 45],
      },
      'p1',
    );

    expect(result.remainingWidthRatio).toBeCloseTo(0.75);
    expect(result.node).toMatchObject({
      type: 'split',
      children: [{ panelId: 'p2' }, { panelId: 'p3' }],
    });
    if (result.node?.type === 'split') {
      expect(result.node.sizes).toEqual([40, 60]);
    }
  });

  it('inserts a full-height column after the focused vertical stack', () => {
    const panel = {
      id: 'p4',
      tabs: [{ id: 't4', type: 'file' as const, title: 'file.ts', closable: true }],
      activeTabId: 't4',
    };
    const focusedColumn = {
      type: 'split' as const,
      direction: 'vertical' as const,
      children: [
        { type: 'panel' as const, panelId: 'p1' },
        { type: 'panel' as const, panelId: 'p2' },
      ],
      sizes: [50, 50],
    };
    const result = insertHorizontalPanel(
      {
        root: {
          type: 'split',
          direction: 'horizontal',
          children: [focusedColumn, { type: 'panel', panelId: 'p3' }],
          sizes: [60, 40],
        },
        panels: {
          p1: { id: 'p1', tabs: [], activeTabId: null },
          p2: { id: 'p2', tabs: [], activeTabId: null },
          p3: { id: 'p3', tabs: [], activeTabId: null },
        },
        focusedPanelId: 'p2',
      },
      panel,
      'p2',
    );

    expect(result.root).toMatchObject({
      type: 'split',
      direction: 'horizontal',
      children: [focusedColumn, { type: 'panel', panelId: 'p4' }, { panelId: 'p3' }],
    });
    expect(result.root.type).toBe('split');
    if (result.root.type === 'split') {
      expect(result.root.sizes[0]).toBeCloseTo(40);
      expect(result.root.sizes[1]).toBeCloseTo(100 / 3);
      expect(result.root.sizes[2]).toBeCloseTo(80 / 3);
    }
  });

  it('appends a full-height column beside a vertical stack', () => {
    const panel = {
      id: 'p3',
      tabs: [{ id: 't3', type: 'agent' as const, title: 'Agent 3', closable: true }],
      activeTabId: 't3',
    };
    const verticalRoot = {
      type: 'split' as const,
      direction: 'vertical' as const,
      children: [
        { type: 'panel' as const, panelId: 'p1' },
        { type: 'panel' as const, panelId: 'p2' },
      ],
      sizes: [50, 50],
    };
    const result = appendHorizontalColumn(
      {
        root: verticalRoot,
        panels: {
          p1: { id: 'p1', tabs: [], activeTabId: null },
          p2: { id: 'p2', tabs: [], activeTabId: null },
        },
        focusedPanelId: 'p1',
      },
      panel,
    );

    expect(result.root).toEqual({
      type: 'split',
      direction: 'horizontal',
      children: [verticalRoot, { type: 'panel', panelId: 'p3' }],
      sizes: [50, 50],
    });
    expect(result.panels.p3).toEqual(panel);
    expect(result.focusedPanelId).toBe('p3');
  });

  it('counts horizontal columns without widening for vertical stacks', () => {
    expect(
      countHorizontalPanelColumns({
        type: 'split',
        direction: 'horizontal',
        sizes: [50, 50],
        children: [
          {
            type: 'split',
            direction: 'vertical',
            sizes: [50, 50],
            children: [
              { type: 'panel', panelId: 'p1' },
              { type: 'panel', panelId: 'p2' },
            ],
          },
          { type: 'panel', panelId: 'p3' },
        ],
      }),
    ).toBe(2);
  });

  it('resizes only the rightmost panel branch when the workspace edge moves', () => {
    const root = {
      type: 'split' as const,
      direction: 'horizontal' as const,
      sizes: [50, 50],
      children: [
        { type: 'panel' as const, panelId: 'p1' },
        { type: 'panel' as const, panelId: 'p2' },
      ],
    };

    const result = resizePanelTreeRightEdge(root, 960, 1080);

    expect(result.type).toBe('split');
    if (result.type === 'split') {
      expect(result.sizes[0]).toBeCloseTo((480 / 1080) * 100);
      expect(result.sizes[1]).toBeCloseTo((600 / 1080) * 100);
    }
  });

  it('passes the edge delta through nested rightmost horizontal branches', () => {
    const result = resizePanelTreeRightEdge(
      {
        type: 'split',
        direction: 'horizontal',
        sizes: [50, 50],
        children: [
          { type: 'panel', panelId: 'p1' },
          {
            type: 'split',
            direction: 'horizontal',
            sizes: [50, 50],
            children: [
              { type: 'panel', panelId: 'p2' },
              { type: 'panel', panelId: 'p3' },
            ],
          },
        ],
      },
      960,
      1080,
    );

    expect(result.type).toBe('split');
    if (result.type === 'split') {
      const right = result.children[1];
      expect(right.type).toBe('split');
      if (right.type === 'split') {
        expect(right.sizes[0]).toBeCloseTo(40);
        expect(right.sizes[1]).toBeCloseTo(60);
      }
    }
  });

  it('grows a middle horizontal panel while preserving sibling pixel widths', () => {
    // 3 equal panels at 900px canvas => 300px each. Grow the middle panel to
    // absorb a 120px delta -> canvas becomes 1020px, siblings stay at 300px.
    const root = {
      type: 'split' as const,
      direction: 'horizontal' as const,
      sizes: [100 / 3, 100 / 3, 100 / 3],
      children: [
        { type: 'panel' as const, panelId: 'p1' },
        { type: 'panel' as const, panelId: 'p2' },
        { type: 'panel' as const, panelId: 'p3' },
      ],
    };

    const result = resizePanelTreeAtHorizontalIndex(root, 900, 1020, 1);

    expect(result.type).toBe('split');
    if (result.type === 'split') {
      expect(result.sizes[0]).toBeCloseTo((300 / 1020) * 100);
      expect(result.sizes[1]).toBeCloseTo((420 / 1020) * 100);
      expect(result.sizes[2]).toBeCloseTo((300 / 1020) * 100);
    }
  });

  it('falls back to the last panel when the target index is out of range', () => {
    const root = {
      type: 'split' as const,
      direction: 'horizontal' as const,
      sizes: [50, 50],
      children: [
        { type: 'panel' as const, panelId: 'p1' },
        { type: 'panel' as const, panelId: 'p2' },
      ],
    };

    const viaLastIndex = resizePanelTreeRightEdge(root, 960, 1080);
    const viaOutOfRange = resizePanelTreeAtHorizontalIndex(root, 960, 1080, 99);

    expect(viaOutOfRange).toEqual(viaLastIndex);
  });

  describe('findRootHorizontalPanelIndex', () => {
    it('returns the root-level index containing the panel', () => {
      const root = {
        type: 'split' as const,
        direction: 'horizontal' as const,
        sizes: [40, 30, 30],
        children: [
          { type: 'panel' as const, panelId: 'p1' },
          {
            type: 'split' as const,
            direction: 'vertical' as const,
            sizes: [50, 50],
            children: [
              { type: 'panel' as const, panelId: 'p2' },
              { type: 'panel' as const, panelId: 'p3' },
            ],
          },
          { type: 'panel' as const, panelId: 'p4' },
        ],
      };

      expect(findRootHorizontalPanelIndex(root, 'p1')).toBe(0);
      expect(findRootHorizontalPanelIndex(root, 'p2')).toBe(1);
      expect(findRootHorizontalPanelIndex(root, 'p3')).toBe(1);
      expect(findRootHorizontalPanelIndex(root, 'p4')).toBe(2);
      expect(findRootHorizontalPanelIndex(root, 'missing')).toBe(-1);
    });

    it('returns 0 for a bare panel root that matches, else -1', () => {
      const root = { type: 'panel' as const, panelId: 'only' };
      expect(findRootHorizontalPanelIndex(root, 'only')).toBe(0);
      expect(findRootHorizontalPanelIndex(root, 'other')).toBe(-1);
    });

    it('returns -1 for a vertical root split (no horizontal children)', () => {
      const root = {
        type: 'split' as const,
        direction: 'vertical' as const,
        sizes: [50, 50],
        children: [
          { type: 'panel' as const, panelId: 'top' },
          { type: 'panel' as const, panelId: 'bottom' },
        ],
      };
      expect(findRootHorizontalPanelIndex(root, 'top')).toBe(-1);
    });
  });
});
