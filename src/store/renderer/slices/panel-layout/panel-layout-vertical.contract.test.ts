import { describe, expect, it } from 'vitest';
import {
  resolvePaneColumnMove,
  resolvePaneVerticalMove,
} from '$features/layout/panel-pane-column-move';
import { migratePanelLayoutForWorkspace } from './panel-layout-migration';
import {
  closePanel,
  emptyWorkspaceState,
  goBack,
  goForward,
  moveActivePaneVertically,
  moveTabToPanel,
  moveTabToSplitLevel,
  openTabInAdjacentOrSplit,
  panelLayoutReducer as rawReducer,
  reconcilePanelColumnCount,
  reopenClosedPanelColumn,
  setPanelColumnCount,
  updateSplitSizes,
} from './panel-layout-slice';
import { countHorizontalPanelColumns, getPanelOrder } from './panel-layout-tabless';
import {
  PANEL_LAYOUT_PERSISTENCE_VERSION,
  type PanelLayoutSliceState,
  type PanelTab,
} from './panel-layout-types';
import { withPanelLayoutInvariants } from './panel-layout-invariants.test-helpers';

const WS = 'vertical-workspace';
const reduce = withPanelLayoutInvariants(rawReducer);
const note = (id: string): PanelTab => ({
  id,
  type: 'note',
  noteId: id,
  title: id,
  closable: true,
  workspaceId: WS,
});
function initial(): PanelLayoutSliceState {
  return {
    byWorkspaceId: {
      [WS]: {
        ...emptyWorkspaceState,
        root: {
          type: 'split',
          direction: 'horizontal',
          children: [
            { type: 'panel', panelId: 'left' },
            { type: 'panel', panelId: 'right' },
          ],
          sizes: [35, 65],
        },
        panels: {
          left: { id: 'left', tabs: [note('a'), note('b'), note('c')], activeTabId: 'b' },
          right: { id: 'right', tabs: [note('d')], activeTabId: 'd' },
        },
        focusedPanelId: 'left',
        columnCount: 2,
        columnCountInitialized: true,
        canvasWidth: 1400,
        canvasWidthSource: 'explicit',
      },
    },
  };
}
function move(
  state: PanelLayoutSliceState,
  panelId = 'left',
  direction: 'up' | 'down' = 'down',
  id = 'row',
) {
  return reduce(state, moveActivePaneVertically(WS, panelId, direction, id, 100));
}
function tabs(state: PanelLayoutSliceState) {
  return Object.values(state.byWorkspaceId[WS].panels)
    .flatMap((p) => p.tabs.map((t) => t.id))
    .sort();
}

describe('visible vertical movement contract', () => {
  it.each(['up', 'down'] as const)(
    'detaches the selected pane %s without changing horizontal widths',
    (direction) => {
      const before = initial();
      const after = move(before, 'left', direction).byWorkspaceId[WS];
      expect(after.root).toMatchObject({
        direction: 'horizontal',
        sizes: [35, 65],
        children: [
          {
            direction: 'vertical',
            children:
              direction === 'up'
                ? [{ panelId: 'row' }, { panelId: 'left' }]
                : [{ panelId: 'left' }, { panelId: 'row' }],
          },
          { panelId: 'right' },
        ],
      });
      expect(after.panels.left.tabs.map((t) => t.id)).toEqual(['a', 'c']);
      expect(after.panels.row.tabs).toEqual([note('b')]);
      expect(after.focusedPanelId).toBe('row');
      expect(after.pendingFocusTabId).toBe('b');
      expect(after.columnCount).toBe(2);
      expect(after.canvasWidth).toBe(1400);
    },
  );

  it.each(['up', 'down'] as const)(
    'combines into the %s row with history and persistence',
    (direction) => {
      const split = move(initial(), 'left', direction);
      const moved = move(split, 'left', direction, 'unused');
      const ws = moved.byWorkspaceId[WS];
      expect(getPanelOrder(ws.root)).toEqual(getPanelOrder(split.byWorkspaceId[WS].root));
      expect(ws.panels.row.tabs.map((t) => t.id)).toEqual(['b', 'c']);
      expect(ws.panels.row.activeTabId).toBe('c');
      expect(ws.panels.left.tabs.map((t) => t.id)).toEqual(['a']);
      expect(ws.focusedPanelId).toBe('row');
      expect(ws.pendingFocusTabId).toBe('c');
      const combined = move(moved, 'left', direction);
      const result = combined.byWorkspaceId[WS];
      expect(getPanelOrder(result.root)).toEqual(['row', 'right']);
      expect(result.panels.left).toBeUndefined();
      expect(result.panels.row.tabs.map((t) => t.id)).toEqual(['b', 'c', 'a']);
      expect(result.root).toMatchObject({ sizes: [35, 65] });
      expect(result.canvasWidth).toBe(1400);
      expect(tabs(combined)).toEqual(['a', 'b', 'c', 'd']);
      const undone = reduce(combined, goBack(WS, 200));
      expect(undone.byWorkspaceId[WS].root).toEqual(ws.root);
      expect(undone.byWorkspaceId[WS].panels).toEqual(ws.panels);
      const redone = reduce(undone, goForward(WS));
      expect(redone.byWorkspaceId[WS].root).toEqual(result.root);
      expect(redone.byWorkspaceId[WS].panels).toEqual(result.panels);
      const restored = migratePanelLayoutForWorkspace(WS, {
        ...result,
        version: PANEL_LAYOUT_PERSISTENCE_VERSION,
      });
      expect(restored.root).toEqual(result.root);
      expect(restored.panels).toEqual(result.panels);
    },
  );

  it('disables lone edge panes and rejects missing or stale active panes', () => {
    const before = initial();
    expect(move(before, 'right')).toBe(before);
    expect(move(before, 'missing')).toBe(before);
    expect(
      resolvePaneVerticalMove(
        before.byWorkspaceId[WS].root,
        before.byWorkspaceId[WS].panels.right,
        'down',
      ),
    ).toBeNull();
    const stale = initial();
    stale.byWorkspaceId[WS].panels.left.activeTabId = 'missing';
    expect(rawReducer(stale, moveActivePaneVertically(WS, 'left', 'down'))).toBe(stale);
  });

  it('preserves rows through reconciliation, persistence, resize, and undo/redo', () => {
    const split = move(initial());
    const resized = reduce(split, updateSplitSizes(WS, [30, 70], [0]));
    const reconciled = reduce(resized, reconcilePanelColumnCount(WS, 2));
    expect(reconciled.byWorkspaceId[WS].root).toEqual(resized.byWorkspaceId[WS].root);
    const ws = reconciled.byWorkspaceId[WS];
    const restored = migratePanelLayoutForWorkspace(WS, {
      root: ws.root,
      panels: ws.panels,
      focusedPanelId: ws.focusedPanelId,
      columnCount: ws.columnCount,
      canvasWidth: ws.canvasWidth,
      canvasWidthSource: ws.canvasWidthSource,
      version: PANEL_LAYOUT_PERSISTENCE_VERSION,
    });
    expect(restored.root).toEqual(ws.root);
    expect(restored.panels).toEqual(ws.panels);
    const undone = reduce(split, goBack(WS, 200));
    expect(undone.byWorkspaceId[WS].root).toEqual(initial().byWorkspaceId[WS].root);
    const redone = reduce(undone, goForward(WS));
    expect(redone.byWorkspaceId[WS].root).toEqual(split.byWorkspaceId[WS].root);
    const expanded = reduce(split, setPanelColumnCount(WS, 3));
    expect(getPanelOrder(expanded.byWorkspaceId[WS].root)).toContain('row');
    const shrunk = reduce(expanded, setPanelColumnCount(WS, 1));
    expect(countHorizontalPanelColumns(shrunk.byWorkspaceId[WS].root)).toBe(1);
    expect(getPanelOrder(shrunk.byWorkspaceId[WS].root)).toContain('row');
    expect(tabs(shrunk)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('closes and reopens one row without losing its siblings or widths', () => {
    const split = move(initial());
    const closed = reduce(split, closePanel(WS, 'row', 200, 'closed-row'));
    expect(getPanelOrder(closed.byWorkspaceId[WS].root)).toEqual(['left', 'right']);
    expect(closed.byWorkspaceId[WS].canvasWidth).toBe(1400);
    const reopened = reduce(closed, reopenClosedPanelColumn(WS));
    expect(reopened.byWorkspaceId[WS].root).toEqual(split.byWorkspaceId[WS].root);
    expect(tabs(reopened)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('routes horizontal movement and adjacent opens to columns instead of the next row', () => {
    const split = move(initial());
    const ws = split.byWorkspaceId[WS];
    expect(
      resolvePaneColumnMove(getPanelOrder(ws.root), ws.panels.left, 'next', ws.root),
    ).toMatchObject({ kind: 'neighbor', targetPanelId: 'right' });
    const moved = reduce(split, moveTabToPanel(WS, 'b', 'row', 'right'));
    expect(getPanelOrder(moved.byWorkspaceId[WS].root)).toEqual(['left', 'right']);
    expect(moved.byWorkspaceId[WS].canvasWidth).toBe(1400);
    expect(moved.byWorkspaceId[WS].panels.right.activeTabId).toBe('b');
    const opened = reduce(
      split,
      openTabInAdjacentOrSplit(WS, note('new'), 'left', { newTabId: 'new' }, 200),
    );
    expect(opened.byWorkspaceId[WS].panels.right.activeTabId).toBe('new');
    expect(opened.byWorkspaceId[WS].root).toEqual(ws.root);
    const edge = reduce(split, moveTabToSplitLevel(WS, 'a', 'left', [], 'before', 'horizontal'));
    expect(countHorizontalPanelColumns(edge.byWorkspaceId[WS].root)).toBe(3);
    expect(getPanelOrder(edge.byWorkspaceId[WS].root)).toContain('row');
    expect(tabs(edge)).toEqual(['a', 'b', 'c', 'd']);
  });
});
