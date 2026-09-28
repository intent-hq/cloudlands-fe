import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  PanelColumnCount,
  PanelLayoutSliceState,
  PanelState,
} from '$store/renderer/slices/panel-layout/panel-layout-types';
import {
  emptyWorkspaceState,
  panelLayoutReducer,
} from '$store/renderer/slices/panel-layout/panel-layout-slice';
import { getPanelOrder } from '$store/renderer/slices/panel-layout/panel-layout-tabless';

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  state: { panelLayout: { byWorkspaceId: {} } } as { panelLayout: PanelLayoutSliceState },
}));

vi.mock('$store/renderer/store', () => ({
  store: {
    dispatch: mocks.dispatch,
    get state() {
      return mocks.state;
    },
  },
}));
vi.mock('$store/renderer/slices/panel-layout/panel-layout-selectors', () => ({
  selectFocusedPanelId: { select: vi.fn() },
  selectPanels: { select: vi.fn() },
  selectAllTabs: { select: vi.fn() },
  selectLastPanelClose: { select: vi.fn() },
  selectPanelIds: {
    select: (_state: unknown, wsId: string) =>
      getPanelOrder(mocks.state.panelLayout.byWorkspaceId[wsId].root),
  },
  selectPanel: {
    select: (_state: unknown, wsId: string, panelId: string) =>
      mocks.state.panelLayout.byWorkspaceId[wsId].panels[panelId],
  },
}));

import { PanelLayoutAdapter } from './panel-layout-adapter';
import { resolvePaneColumnMove } from './panel-pane-column-move';

const WS = 'movement-workspace';
const adapter = new PanelLayoutAdapter(WS);
const movedPane = {
  id: 'move',
  type: 'note' as const,
  title: 'Plan',
  noteId: 'spec',
  closable: true,
};

function workspace() {
  return mocks.state.panelLayout.byWorkspaceId[WS];
}

function setup(stacks: Record<string, string[]>) {
  const ids = Object.keys(stacks);
  const panels = Object.fromEntries(
    Object.entries(stacks).map(([id, tabs]) => [
      id,
      {
        id,
        tabs: tabs.map((tabId) =>
          tabId === 'move' ? movedPane : { id: tabId, type: 'note' as const, title: tabId },
        ),
        activeTabId: tabs.includes('move') ? 'move' : (tabs[0] ?? null),
      } satisfies PanelState,
    ]),
  );
  mocks.state.panelLayout = {
    byWorkspaceId: {
      [WS]: {
        ...emptyWorkspaceState,
        root:
          ids.length === 1
            ? { type: 'panel', panelId: ids[0] }
            : {
                type: 'split',
                direction: 'horizontal',
                sizes: ids.map(() => 100 / ids.length),
                children: ids.map((panelId) => ({ type: 'panel', panelId })),
              },
        panels,
        focusedPanelId: 'source',
        columnCount: ids.length as PanelColumnCount,
        columnCountInitialized: true,
      },
    },
  };
}

beforeEach(() => {
  mocks.dispatch.mockReset();
  mocks.dispatch.mockImplementation((action) => {
    mocks.state.panelLayout = panelLayoutReducer(mocks.state.panelLayout, action);
  });
});

describe('active pane column movement', () => {
  it.each(['prev', 'next'] as const)(
    'creates a new %s edge column and moves only the selected pane',
    (direction) => {
      setup(
        direction === 'prev'
          ? { source: ['stay', 'move'], other: ['other-pane'] }
          : { other: ['other-pane'], source: ['stay', 'move'] },
      );
      const other = workspace().panels.other;

      expect(adapter.moveActivePaneToColumn('source', direction)).toBe(true);

      const result = workspace();
      const destination = result.focusedPanelId!;
      expect(destination).not.toBe('source');
      expect(result.panels[destination].tabs).toEqual([movedPane]);
      expect(result.panels[destination].activeTabId).toBe('move');
      expect(result.panels.source.tabs.map((tab) => tab.id)).toEqual(['stay']);
      expect(result.panels.source.activeTabId).toBe('stay');
      expect(result.panels.other).toEqual(other);
      expect(getPanelOrder(result.root)).toEqual(
        direction === 'prev' ? [destination, 'source', 'other'] : ['other', 'source', destination],
      );
      expect(result.columnCount).toBe(3);
      expect(mocks.dispatch).toHaveBeenCalledOnce();
      expect(mocks.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'panelLayout/moveTabToSplitLevel',
          payload: expect.objectContaining({
            wsId: WS,
            tabId: 'move',
            fromPanelId: 'source',
            splitPath: [],
            position: direction === 'prev' ? 'before' : 'after',
            direction: 'horizontal',
          }),
        }),
      );
    },
  );

  it.each(['prev', 'next'] as const)('splits a single multi-pane column toward %s', (direction) => {
    setup({ source: ['stay', 'move'] });
    expect(resolvePaneColumnMove(['source'], workspace().panels.source, direction)).not.toBeNull();
    expect(adapter.moveActivePaneToColumn('source', direction)).toBe(true);
    const result = workspace();
    expect(result.columnCount).toBe(2);
    expect(getPanelOrder(result.root)).toEqual(
      direction === 'prev' ? [result.focusedPanelId, 'source'] : ['source', result.focusedPanelId],
    );
    expect(result.panels[result.focusedPanelId!].tabs).toEqual([movedPane]);
  });

  it.each(['prev', 'next'] as const)(
    'uses an existing %s neighbor even at four columns',
    (direction) => {
      setup({
        left: ['left-pane'],
        source: ['stay', 'move'],
        right: ['right-pane'],
        last: ['last-pane'],
      });
      expect(adapter.moveActivePaneToColumn('source', direction)).toBe(true);
      const destination = direction === 'prev' ? 'left' : 'right';
      const result = workspace();
      expect(getPanelOrder(result.root)).toEqual(['left', 'source', 'right', 'last']);
      expect(result.columnCount).toBe(4);
      expect(result.focusedPanelId).toBe(destination);
      expect(result.panels[destination].activeTabId).toBe('move');
      expect(result.panels[destination].tabs).toEqual([
        { id: `${destination}-pane`, type: 'note', title: `${destination}-pane` },
        movedPane,
      ]);
      expect(result.panels.source.tabs.map((tab) => tab.id)).toEqual(['stay']);
      expect(mocks.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'panelLayout/moveTabToPanel' }),
      );
    },
  );

  it('removes an emptied source column after moving to its neighbor', () => {
    setup({ source: ['move'], destination: ['existing'] });
    expect(adapter.moveActivePaneToColumn('source', 'next')).toBe(true);
    const result = workspace();
    expect(getPanelOrder(result.root)).toEqual(['destination']);
    expect(result.panels.source).toBeUndefined();
    expect(result.columnCount).toBe(1);
    expect(result.focusedPanelId).toBe('destination');
    expect(result.panels.destination.activeTabId).toBe('move');
    expect(result.panels.destination.tabs.map((tab) => tab.id)).toEqual(['existing', 'move']);
  });

  it('allows the fourth column but blocks a fifth without dispatching', () => {
    setup({ first: ['one'], second: ['two'], source: ['stay', 'move'] });
    expect(adapter.moveActivePaneToColumn('source', 'next')).toBe(true);
    expect(workspace().columnCount).toBe(4);
    setup({
      source: ['stay', 'move'],
      second: ['two'],
      third: ['three'],
      last: ['stay-last', 'four'],
    });
    mocks.dispatch.mockClear();
    const before = workspace();
    expect(
      resolvePaneColumnMove(getPanelOrder(before.root), before.panels.source, 'prev'),
    ).toBeNull();
    expect(
      resolvePaneColumnMove(getPanelOrder(before.root), before.panels.last, 'next'),
    ).toBeNull();
    expect(adapter.moveActivePaneToColumn('source', 'prev')).toBe(false);
    expect(adapter.moveActivePaneToColumn('last', 'next')).toBe(false);
    expect(workspace()).toBe(before);
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it.each(['prev', 'next'] as const)(
    'does not create an empty column when the only pane is already at the %s edge',
    (direction) => {
      setup({ source: ['move'] });
      expect(resolvePaneColumnMove(['source'], workspace().panels.source, direction)).toBeNull();
      expect(adapter.moveActivePaneToColumn('source', direction)).toBe(false);
      expect(mocks.dispatch).not.toHaveBeenCalled();
    },
  );

  it('ignores missing, detached, empty, and stale active panes', () => {
    setup({ source: ['stay', 'move'], destination: ['existing'] });
    const source = workspace().panels.source;
    expect(resolvePaneColumnMove(['destination'], source, 'next')).toBeNull();
    expect(adapter.moveActivePaneToColumn('missing', 'next')).toBe(false);
    source.activeTabId = null;
    expect(adapter.moveActivePaneToColumn('source', 'next')).toBe(false);
    source.activeTabId = 'missing';
    expect(adapter.moveActivePaneToColumn('source', 'next')).toBe(false);
    source.tabs = [];
    expect(adapter.moveActivePaneToColumn('source', 'prev')).toBe(false);
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });
});
