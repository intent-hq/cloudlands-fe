import { describe, expect, it, vi } from 'vitest';
import { createCollection } from '@augmentcode/themis/utils/collections/collection-utils';
import type { StoreState } from '$store/renderer/types';
import type { Workspace } from '$shared/types';
import { initialState as workspaceInitialState } from '$store/renderer/slices/workspace/workspace-slice';
import { tabStateReducer, type TabState } from '$store/renderer/slices/tab-state/tab-state-slice';
import { selectWorkspaceTabOrder } from '$store/renderer/slices/tab-state/tab-state-selectors';
import {
  closeFocusedPanelTab,
  closePanel,
  panelLayoutReducer,
  initialState as panelLayoutInitialState,
} from '$store/renderer/slices/panel-layout/panel-layout-slice';
import type {
  PanelLayoutSliceState,
  PanelState,
  RecentlyClosedTab,
} from '$store/renderer/slices/panel-layout/panel-layout-types';
import type { KeyboardShortcut } from '$lib/utils/keyboardShortcuts';
import { SHORTCUTS } from '$lib/utils/shortcuts';
import {
  closeActivePanelTab,
  closeActiveWorkspaceTab,
  cycleWorkspaceTab,
  moveActiveWorkspaceTab,
  openNewPanel,
  registerWorkspaceTabShortcuts,
  reopenPanelOrWorkspaceTab,
  reopenWorkspaceTab,
  selectWorkspaceTabByPosition,
} from './workspace-tab-navigation';

const makeTabState = (currentTabId: string | null = 'ws-1'): TabState => ({
  isDragging: false,
  activeHandleDrop: null,
  scrollPositions: {},
  openTabs: { 'ws-1': true, 'ws-2': true, 'ws-3': true },
  currentTabId,
  pinnedTabs: {},
  unsavedTabs: {},
  optimisticTabs: {},
  workspaceStacks: [['ws-1'], ['ws-2'], ['ws-3']],
  recentlyClosedTabIds: [],
  recentlyClosedTabAt: {},
  version: 0,
  hydratedBackendId: null,
});

function makeStore(
  currentTabId?: string | null,
  panelLayout?: PanelLayoutSliceState,
  workspaces: Array<{ id: string; status?: string }> = [],
) {
  const actions: Array<{ type: string }> = [];
  let state = {
    tabState: makeTabState(currentTabId),
    panelLayout: panelLayout ?? panelLayoutInitialState,
    workspace: {
      ...workspaceInitialState,
      workspaces: createCollection('id', workspaces as unknown as Workspace[]),
    },
  } as StoreState;
  return {
    actions,
    get state() {
      return state;
    },
    dispatch(action: Parameters<typeof tabStateReducer>[1]) {
      actions.push(action);
      state = {
        ...state,
        tabState: tabStateReducer(state.tabState, action),
        panelLayout: panelLayoutReducer(state.panelLayout, action),
      };
    },
  };
}

describe('cycleWorkspaceTab', () => {
  it('cycles forward and navigates to the selected workspace route', () => {
    const store = makeStore();
    const navigate = vi.fn();

    expect(cycleWorkspaceTab(store, 'next', '/workspace/ws-1', navigate)).toBe('ws-2');
    expect(store.state.tabState.currentTabId).toBe('ws-2');
    expect(navigate).toHaveBeenCalledWith('/workspace/ws-2');
  });

  it('cycles backward with wraparound', () => {
    const store = makeStore('ws-1');
    const navigate = vi.fn();

    expect(cycleWorkspaceTab(store, 'previous', '/workspace/ws-1', navigate)).toBe('ws-3');
    expect(navigate).toHaveBeenCalledWith('/workspace/ws-3');
  });

  it('avoids redundant navigation when the route is already selected', () => {
    const store = makeStore('ws-2');
    const navigate = vi.fn();

    cycleWorkspaceTab(store, 'next', '/workspace/ws-3', navigate);
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe('global workspace tab navigation', () => {
  it('closes only the routed workspace tab and navigates to its successor', () => {
    const store = makeStore('ws-2');
    const navigate = vi.fn();

    expect(closeActiveWorkspaceTab(store, '/workspace/ws-2', navigate)).toBe('ws-2');
    expect(selectWorkspaceTabOrder.select(store.state)).toEqual(['ws-1', 'ws-3']);
    expect(store.state.tabState.recentlyClosedTabIds).toEqual(['ws-2']);
    expect(navigate).toHaveBeenCalledWith('/workspace/ws-3');

    navigate.mockClear();
    expect(closeActiveWorkspaceTab(store, '/', navigate)).toBeNull();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("routes to '/' when the last tab closes and other workspaces exist", () => {
    const store = makeStore('ws-1', undefined, [{ id: 'ws-other', status: 'Active' }]);
    const navigate = vi.fn();

    closeActiveWorkspaceTab(store, '/workspace/ws-1', navigate);
    closeActiveWorkspaceTab(store, '/workspace/ws-2', navigate);
    navigate.mockClear();

    expect(closeActiveWorkspaceTab(store, '/workspace/ws-3', navigate)).toBe('ws-3');
    expect(navigate).toHaveBeenCalledWith('/');
  });

  it('routes to workspace creation when the last tab closes and no workspaces remain', () => {
    const store = makeStore('ws-1');
    const navigate = vi.fn();

    closeActiveWorkspaceTab(store, '/workspace/ws-1', navigate);
    closeActiveWorkspaceTab(store, '/workspace/ws-2', navigate);
    navigate.mockClear();

    expect(closeActiveWorkspaceTab(store, '/workspace/ws-3', navigate)).toBe('ws-3');
    expect(navigate).toHaveBeenCalledWith('/workspace/new');
  });

  it('reopens the last closed workspace and selects tabs by position', () => {
    const store = makeStore('ws-2');
    const navigate = vi.fn();
    closeActiveWorkspaceTab(store, '/workspace/ws-2', navigate);

    navigate.mockClear();
    expect(reopenWorkspaceTab(store, '/workspace/ws-3', navigate)).toBe('ws-2');
    expect(navigate).toHaveBeenCalledWith('/workspace/ws-2');

    navigate.mockClear();
    expect(selectWorkspaceTabByPosition(store, 0, '/workspace/ws-2', navigate)).toBe('ws-1');
    expect(navigate).toHaveBeenCalledWith('/workspace/ws-1');

    navigate.mockClear();
    expect(selectWorkspaceTabByPosition(store, 'last', '/workspace/ws-1', navigate)).toBe('ws-2');
    expect(navigate).toHaveBeenCalledWith('/workspace/ws-2');
  });

  it('moves the active workspace one ordered position without changing selection', () => {
    const store = makeStore('ws-2');

    expect(moveActiveWorkspaceTab(store, 'left')).toBe('ws-2');
    expect(selectWorkspaceTabOrder.select(store.state)).toEqual(['ws-2', 'ws-1', 'ws-3']);
    expect(store.state.tabState.currentTabId).toBe('ws-2');
    expect(moveActiveWorkspaceTab(store, 'left')).toBeNull();

    expect(moveActiveWorkspaceTab(store, 'right')).toBe('ws-2');
    expect(selectWorkspaceTabOrder.select(store.state)).toEqual(['ws-1', 'ws-2', 'ws-3']);
    expect(store.state.tabState.currentTabId).toBe('ws-2');
  });

  it('does not move a missing, sole, or boundary workspace tab', () => {
    expect(moveActiveWorkspaceTab(makeStore(undefined), 'left')).toBeNull();
    const sole = makeStore('ws-1');
    sole.state.tabState.openTabs = { 'ws-1': true };
    sole.state.tabState.workspaceStacks = [['ws-1']];
    expect(moveActiveWorkspaceTab(sole, 'left')).toBeNull();
    expect(moveActiveWorkspaceTab(sole, 'right')).toBeNull();
    expect(moveActiveWorkspaceTab(makeStore('ws-1'), 'left')).toBeNull();
    expect(moveActiveWorkspaceTab(makeStore('ws-3'), 'right')).toBeNull();
  });

  const makePanel = (id: string, tabIds: string[] = []): PanelState => ({
    id,
    tabs: tabIds.map((tabId) => ({
      id: tabId,
      type: 'note' as const,
      title: tabId,
      closable: true,
    })),
    activeTabId: tabIds[0] ?? null,
  });

  const layoutWith = (
    panels: PanelState[],
    focusedPanelId: string | null,
    recentlyClosed: RecentlyClosedTab[] = [],
    layoutId = 'ws-2',
  ): PanelLayoutSliceState => ({
    byWorkspaceId: {
      [layoutId]: {
        root:
          panels.length === 1
            ? { type: 'panel', panelId: panels[0].id }
            : {
                type: 'split',
                direction: 'horizontal',
                children: panels.map((panel) => ({ type: 'panel' as const, panelId: panel.id })),
                sizes: panels.map(() => 100 / panels.length),
              },
        panels: Object.fromEntries(panels.map((panel) => [panel.id, panel])),
        focusedPanelId,
        canvasWidth: null,
        canvasWidthSource: null,
        columnCount: panels.length as 1 | 2 | 3 | 4,
        restoreStatus: 'idle',
        pendingFocusTabId: null,
        recentlyClosed,
        layoutHistory: [],
        historyIndex: 0,
        historyLoaded: false,
        focusHistory: [],
        focusHistoryIndex: -1,
        expandedPanelId: null,
        savedSizesBeforeExpand: [],
        deferSpecTab: false,
      },
    },
  });

  describe('closeActiveWorkspaceTab', () => {
    it('closes the routed workspace without closing its panels or panel tabs', () => {
      const store = makeStore(
        'ws-2',
        layoutWith([makePanel('p1', ['t1']), makePanel('p2', ['t2'])], 'p2'),
      );
      const navigate = vi.fn();

      expect(closeActiveWorkspaceTab(store, '/workspace/ws-2', navigate)).toBe('ws-2');
      expect(Object.keys(store.state.panelLayout.byWorkspaceId['ws-2'].panels)).toEqual([
        'p1',
        'p2',
      ]);
      expect(store.state.panelLayout.byWorkspaceId['ws-2'].panels.p2.tabs).toHaveLength(1);
      expect(selectWorkspaceTabOrder.select(store.state)).toEqual(['ws-1', 'ws-3']);
      expect(store.actions.map((action) => action.type)).not.toContain('panelLayout/closePanel');
      expect(store.actions.map((action) => action.type)).not.toContain(
        'panelLayout/closeActiveTab',
      );
      expect(navigate).toHaveBeenCalledWith('/workspace/ws-3');
    });

    it('uses the routed workspace instead of the Redux-current workspace', () => {
      const store = makeStore('ws-1');
      const navigate = vi.fn();

      expect(closeActiveWorkspaceTab(store, '/workspace/ws-2', navigate)).toBe('ws-2');
      expect(selectWorkspaceTabOrder.select(store.state)).toEqual(['ws-1', 'ws-3']);
      expect(store.state.tabState.currentTabId).toBe('ws-1');
      expect(navigate).toHaveBeenCalledWith('/workspace/ws-1');
    });

    it.each(['/settings', '/workspace/new', '/agent/agent-1', '/'])(
      'does nothing on the non-workspace route %s',
      (path) => {
        const store = makeStore('ws-2');
        const navigate = vi.fn();

        expect(closeActiveWorkspaceTab(store, path, navigate)).toBeNull();
        expect(store.actions).toEqual([]);
        expect(navigate).not.toHaveBeenCalled();
      },
    );
  });

  describe('closeActivePanelTab', () => {
    it('uses the routed workspace and its focused panel instead of the Redux-active workspace', () => {
      const ws1Panel = makePanel('ws1-panel', ['ws1-tab']);
      const ws2Left = makePanel('ws2-left', ['left-tab']);
      const ws2Right = makePanel('ws2-right', ['right-tab']);
      const ws1 = layoutWith([ws1Panel], 'ws1-panel', [], 'ws-1').byWorkspaceId['ws-1'];
      const ws2 = layoutWith([ws2Left, ws2Right], 'ws2-right', [], 'ws-2').byWorkspaceId['ws-2'];
      const store = makeStore('ws-1', { byWorkspaceId: { 'ws-1': ws1, 'ws-2': ws2 } });

      expect(closeActivePanelTab(store, '/workspace/ws-2')).toBe('right-tab');
      expect(store.state.panelLayout.byWorkspaceId['ws-1'].panels['ws1-panel'].tabs).toHaveLength(
        1,
      );
      expect(store.state.panelLayout.byWorkspaceId['ws-2'].panels['ws2-left'].tabs).toHaveLength(1);
      expect(store.state.panelLayout.byWorkspaceId['ws-2'].panels['ws2-right']).toMatchObject({
        tabs: [],
        activeTabId: null,
      });
      expect(store.state.tabState.currentTabId).toBe('ws-1');
      expect(store.actions.map((action) => action.type)).toEqual([
        'panelLayout/closeFocusedPanelTab',
      ]);
    });

    it.each([1, 2, 3, 4] as const)(
      'retains every structural invariant when closing the final tab in a %i-column layout',
      (columnCount) => {
        const panels = Array.from({ length: columnCount }, (_, index) =>
          makePanel(`p${index + 1}`, [`t${index + 1}`]),
        );
        const layout = layoutWith(panels, `p${columnCount}`);
        const workspace = layout.byWorkspaceId['ws-2'];
        workspace.canvasWidth = 1600;
        workspace.canvasWidthSource = 'explicit';
        if (workspace.root.type === 'split') {
          workspace.root.sizes = Array.from(
            { length: columnCount },
            (_, index) => ((index + 1) / ((columnCount * (columnCount + 1)) / 2)) * 100,
          );
        }
        const rootBefore = structuredClone(workspace.root);
        const panelsBefore = Object.keys(workspace.panels);
        const store = makeStore('ws-2', layout);

        expect(closeActivePanelTab(store, '/workspace/ws-2')).toBe(`t${columnCount}`);
        const result = store.state.panelLayout.byWorkspaceId['ws-2'];
        expect(result.root).toEqual(rootBefore);
        expect(Object.keys(result.panels)).toEqual(panelsBefore);
        expect(result.columnCount).toBe(columnCount);
        expect(result.canvasWidth).toBe(1600);
        expect(result.canvasWidthSource).toBe('explicit');
        expect(result.focusedPanelId).toBe(`p${columnCount}`);
        expect(result.panels[`p${columnCount}`]).toMatchObject({
          tabs: [],
          activeTabId: null,
        });
      },
    );

    it('selects the normal replacement tab and preserves recently closed metadata', () => {
      const panel = makePanel('p1', ['t1', 't2', 't3']);
      panel.activeTabId = 't2';
      const store = makeStore('ws-2', layoutWith([panel], 'p1'));

      expect(closeActivePanelTab(store, '/workspace/ws-2')).toBe('t2');
      const workspace = store.state.panelLayout.byWorkspaceId['ws-2'];
      expect(workspace.panels.p1.tabs.map((tab) => tab.id)).toEqual(['t1', 't3']);
      expect(workspace.panels.p1.activeTabId).toBe('t3');
      expect(workspace.recentlyClosed[0]).toMatchObject({
        tab: { id: 't2' },
        panelId: 'p1',
      });
    });

    it('uses a second press to remove an already-empty focused column', () => {
      const store = makeStore(
        'ws-2',
        layoutWith([makePanel('p1', ['t1']), makePanel('p2', ['t2'])], 'p2'),
      );

      expect(closeActivePanelTab(store, '/workspace/ws-2', 1200)).toBe('t2');
      expect(closeActivePanelTab(store, '/workspace/ws-2', 1200)).toBe('p2');

      const workspace = store.state.panelLayout.byWorkspaceId['ws-2'];
      expect(workspace.root).toEqual({ type: 'panel', panelId: 'p1' });
      expect(workspace.columnCount).toBe(1);
      expect(workspace.focusedPanelId).toBe('p1');
      expect(workspace.canvasWidth).toBe(1200);
      expect(store.actions.map((action) => action.type)).toEqual([
        'panelLayout/closeFocusedPanelTab',
        'panelLayout/closeFocusedPanelTab',
      ]);
    });

    it('no-ops for empty, non-closable, and excluded route targets', () => {
      const nonClosable = makePanel('locked', ['locked-tab']);
      nonClosable.tabs[0].closable = false;

      for (const [layout, path] of [
        [layoutWith([makePanel('empty')], 'empty'), '/workspace/ws-2'],
        [layoutWith([nonClosable], 'locked'), '/workspace/ws-2'],
        [layoutWith([makePanel('p1', ['t1'])], 'p1'), '/workspace/new'],
        [layoutWith([makePanel('p1', ['t1'])], 'p1'), '/settings'],
        [layoutWith([makePanel('p1', ['t1'])], 'p1'), '/'],
        [layoutWith([makePanel('p1', ['t1'])], 'p1'), '/workspace'],
      ] as const) {
        const store = makeStore('ws-2', layout);
        expect(closeActivePanelTab(store, path)).toBeNull();
        expect(store.actions).toEqual([]);
      }
    });

    it('reopens final-tab content into the retained panel with contextual Mod+Shift+T', () => {
      const store = makeStore('ws-2', layoutWith([makePanel('p1', ['t1'])], 'p1'));
      const navigate = vi.fn();

      closeActivePanelTab(store, '/workspace/ws-2');
      expect(reopenPanelOrWorkspaceTab(store, '/workspace/ws-2', navigate)).toBe('tab');
      expect(store.state.panelLayout.byWorkspaceId['ws-2'].panels.p1.tabs).toMatchObject([
        { title: 't1', closable: true },
      ]);
      expect(store.state.panelLayout.byWorkspaceId['ws-2'].recentlyClosed).toEqual([]);
      expect(navigate).not.toHaveBeenCalled();
    });
  });

  it.each([
    ['macOS', true, true, false],
    ['Windows', false, false, true],
    ['Linux', false, false, true],
  ])(
    'registers Mod+W as a global focused-panel content close on %s',
    (_platform, isMac, meta, ctrl) => {
      const shortcuts: KeyboardShortcut[] = [];
      const store = makeStore(
        'ws-2',
        layoutWith([makePanel('p1', ['t1']), makePanel('p2', ['t2'])], 'p2'),
      );
      const navigate = vi.fn();

      registerWorkspaceTabShortcuts({
        isMac,
        register: (shortcut) => shortcuts.push(shortcut),
        store,
        getCurrentPath: () => '/workspace/ws-2',
        navigate,
        openNewWorkspace: vi.fn(),
      });

      const shortcut = shortcuts.find((candidate) => candidate.key.toLowerCase() === 'w')!;
      expect(shortcut).toMatchObject({
        key: 'w',
        global: true,
        description: 'Close Active Pane',
      });
      expect(Boolean(shortcut.meta)).toBe(meta);
      expect(Boolean(shortcut.ctrl)).toBe(ctrl);
      expect(shortcut.shift).toBeUndefined();
      expect(shortcut.alt).toBeUndefined();
      expect(shortcut.ignoreRepeat).toBeUndefined();
      expect(shortcut.skipInEditableElements).toBeUndefined();

      shortcut.action();
      expect(store.actions.map((action) => action.type)).toEqual([
        'panelLayout/closeFocusedPanelTab',
      ]);
      expect(store.actions.map((action) => action.type)).not.toContain(
        'tabState/closeWorkspaceTab',
      );
      expect(store.actions.map((action) => action.type)).not.toContain('panelLayout/closePanel');
      expect(store.actions.map((action) => action.type)).not.toContain(
        'panelLayout/closeActiveTab',
      );
      expect(store.state.panelLayout.byWorkspaceId['ws-2'].panels.p2).toMatchObject({
        tabs: [],
        activeTabId: null,
      });
      expect(navigate).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['macOS', true, true, false],
    ['Windows', false, false, true],
    ['Linux', false, false, true],
  ])(
    'registers Mod+Shift+W as the global active workspace-tab close on %s',
    (_platform, isMac, meta, ctrl) => {
      const shortcuts: KeyboardShortcut[] = [];
      const store = makeStore(
        'ws-2',
        layoutWith([makePanel('p1', ['t1']), makePanel('p2', ['t2'])], 'p2'),
      );
      const navigate = vi.fn();

      registerWorkspaceTabShortcuts({
        isMac,
        register: (shortcut) => shortcuts.push(shortcut),
        store,
        getCurrentPath: () => '/workspace/ws-2',
        navigate,
        openNewWorkspace: vi.fn(),
      });

      const shortcut = shortcuts.find(
        (candidate) => candidate.key.toLowerCase() === 'w' && candidate.shift,
      )!;
      expect(shortcut).toMatchObject({
        key: 'w',
        shift: true,
        global: true,
      });
      expect(Boolean(shortcut.meta)).toBe(meta);
      expect(Boolean(shortcut.ctrl)).toBe(ctrl);
      expect(shortcut.alt).toBeUndefined();
      expect(shortcut.skipInEditableElements).toBeUndefined();

      shortcut.action();
      expect(store.actions.map((action) => action.type)).toEqual(['tabState/closeWorkspaceTab']);
      expect(store.actions.map((action) => action.type)).not.toContain(
        'panelLayout/closeFocusedPanelTab',
      );
      expect(selectWorkspaceTabOrder.select(store.state)).toEqual(['ws-1', 'ws-3']);
      expect(store.state.panelLayout.byWorkspaceId['ws-2'].panels.p2.tabs).toHaveLength(1);
      expect(navigate).toHaveBeenCalledWith('/workspace/ws-3');
    },
  );

  describe('reopenPanelOrWorkspaceTab', () => {
    const closedPanelTab = (tabId: string, closedAt: number): RecentlyClosedTab => ({
      tab: { id: tabId, type: 'note' as const, title: tabId, closable: true },
      panelId: 'p1',
      closedAt,
    });

    it('restores column, workspace tab, and panel tab in exact close-time order', () => {
      const layout = layoutWith([makePanel('p1', ['t1']), makePanel('p2', ['t2'])], 'p2');
      layout.byWorkspaceId['ws-2'].root = {
        type: 'split',
        direction: 'horizontal',
        children: [
          { type: 'panel', panelId: 'p1' },
          { type: 'panel', panelId: 'p2' },
        ],
        sizes: [35, 65],
      };
      layout.byWorkspaceId['ws-2'].canvasWidth = 1800;
      layout.byWorkspaceId['ws-2'].canvasWidthSource = 'explicit';
      const store = makeStore('ws-2', layout);
      const navigate = vi.fn();

      store.dispatch(closeFocusedPanelTab('ws-2', 1000, 1200));
      store.state.tabState.recentlyClosedTabIds.push('ws-4');
      store.state.tabState.recentlyClosedTabAt['ws-4'] = 2000;
      store.dispatch(closeFocusedPanelTab('ws-2', 3000, 1200));

      expect(reopenPanelOrWorkspaceTab(store, '/workspace/ws-2', navigate)).toBe('column');
      expect(store.state.panelLayout.byWorkspaceId['ws-2'].root).toEqual({
        type: 'split',
        direction: 'horizontal',
        children: [
          { type: 'panel', panelId: 'p1' },
          { type: 'panel', panelId: 'p2' },
        ],
        sizes: [35, 65],
      });
      expect(store.state.panelLayout.byWorkspaceId['ws-2']).toMatchObject({
        focusedPanelId: 'p2',
        columnCount: 2,
        canvasWidth: 1800,
        canvasWidthSource: 'explicit',
      });

      expect(reopenPanelOrWorkspaceTab(store, '/workspace/ws-2', navigate)).toBe('workspace');
      expect(store.state.tabState.openTabs['ws-4']).toBe(true);

      expect(reopenPanelOrWorkspaceTab(store, '/workspace/ws-2', navigate)).toBe('tab');
      expect(store.state.panelLayout.byWorkspaceId['ws-2'].panels.p2.tabs).toEqual([
        expect.objectContaining({ title: 't2' }),
      ]);
      expect(store.state.panelLayout.byWorkspaceId['ws-2'].recentlyClosed).toEqual([]);
    });

    it('restores a populated column before its same-action tab entries without duplicates', () => {
      const first = makePanel('p1', ['t1', 't2']);
      first.activeTabId = 't2';
      const store = makeStore('ws-2', layoutWith([first, makePanel('p2')], 'p1'));
      const navigate = vi.fn();

      store.dispatch(closePanel('ws-2', 'p1', 4000));
      expect(store.state.panelLayout.byWorkspaceId['ws-2'].recentlyClosed).toHaveLength(2);

      expect(reopenPanelOrWorkspaceTab(store, '/workspace/ws-2', navigate)).toBe('column');
      expect(store.state.panelLayout.byWorkspaceId['ws-2'].panels.p1).toMatchObject({
        activeTabId: 't2',
        tabs: [{ id: 't1' }, { id: 't2' }],
      });
      expect(store.state.panelLayout.byWorkspaceId['ws-2'].recentlyClosed).toEqual([]);
      expect(reopenPanelOrWorkspaceTab(store, '/workspace/ws-2', navigate)).toBeNull();
    });

    it('reopens the panel tab when it closed after the workspace tab', () => {
      const store = makeStore(
        'ws-2',
        layoutWith([makePanel('p1', ['t1'])], 'p1', [closedPanelTab('t-closed', 2000)]),
      );
      const navigate = vi.fn();
      store.state.tabState.recentlyClosedTabIds.push('ws-4');
      store.state.tabState.recentlyClosedTabAt['ws-4'] = 1000;

      expect(reopenPanelOrWorkspaceTab(store, '/workspace/ws-2', navigate)).toBe('tab');
      expect(store.state.panelLayout.byWorkspaceId['ws-2'].recentlyClosed).toEqual([]);
      const allTabs = Object.values(store.state.panelLayout.byWorkspaceId['ws-2'].panels)
        .flatMap((panel) => panel.tabs.map((t) => t.title))
        .sort();
      expect(allTabs).toEqual(['t-closed', 't1']);
      expect(store.state.tabState.recentlyClosedTabIds).toEqual(['ws-4']);
      expect(navigate).not.toHaveBeenCalled();
    });

    it('reopens the workspace tab when it closed after the panel tab', () => {
      const store = makeStore(
        'ws-2',
        layoutWith([makePanel('p1', ['t1'])], 'p1', [closedPanelTab('t-closed', 1000)]),
      );
      const navigate = vi.fn();
      store.state.tabState.recentlyClosedTabIds.push('ws-4');
      store.state.tabState.recentlyClosedTabAt['ws-4'] = 2000;

      expect(reopenPanelOrWorkspaceTab(store, '/workspace/ws-2', navigate)).toBe('workspace');
      expect(store.state.tabState.openTabs['ws-4']).toBe(true);
      expect(store.state.panelLayout.byWorkspaceId['ws-2'].recentlyClosed).toHaveLength(1);
      expect(navigate).toHaveBeenCalledWith('/workspace/ws-4');
    });

    it('falls back to the workspace tab when no panel tab was closed', () => {
      const store = makeStore('ws-2', layoutWith([makePanel('p1', ['t1'])], 'p1'));
      const navigate = vi.fn();
      store.state.tabState.recentlyClosedTabIds.push('ws-4');
      store.state.tabState.recentlyClosedTabAt['ws-4'] = 1000;

      expect(reopenPanelOrWorkspaceTab(store, '/workspace/ws-2', navigate)).toBe('workspace');
      expect(store.state.tabState.openTabs['ws-4']).toBe(true);
    });

    it('reopens closed workspace tabs even outside workspace routes', () => {
      const store = makeStore('ws-2');
      const navigate = vi.fn();
      store.state.tabState.recentlyClosedTabIds.push('ws-4');
      store.state.tabState.recentlyClosedTabAt['ws-4'] = 1000;

      expect(reopenPanelOrWorkspaceTab(store, '/', navigate)).toBe('workspace');
      expect(navigate).toHaveBeenCalledWith('/workspace/ws-4');
    });

    it('returns null when nothing was closed', () => {
      const store = makeStore('ws-2', layoutWith([makePanel('p1', ['t1'])], 'p1'));
      const navigate = vi.fn();

      expect(reopenPanelOrWorkspaceTab(store, '/workspace/ws-2', navigate)).toBeNull();
      expect(navigate).not.toHaveBeenCalled();
    });
  });

  describe('openNewPanel', () => {
    it('inserts a pristine blank column to the right of a focused single column', () => {
      const store = makeStore('ws-2', layoutWith([makePanel('p1', ['t1'])], 'p1'));

      const newPanelId = openNewPanel(store, '/workspace/ws-2')!;

      const ws = store.state.panelLayout.byWorkspaceId['ws-2'];
      expect(ws.root).toMatchObject({
        type: 'split',
        children: [{ panelId: 'p1' }, { panelId: newPanelId }],
      });
      expect(ws.panels.p1.tabs.map((tab) => tab.id)).toEqual(['t1']);
      expect(ws.panels[newPanelId]).toMatchObject({ tabs: [], activeTabId: null, pristine: true });
      expect(ws.focusedPanelId).toBe(newPanelId);
      expect(ws.layoutHistory).toHaveLength(1);
    });

    it.each([
      ['left', 'p1', ['p1', 'new', 'p2', 'p3']],
      ['middle', 'p2', ['p1', 'p2', 'new', 'p3']],
      ['right', 'p3', ['p1', 'p2', 'p3', 'new']],
    ] as const)('inserts immediately right of the focused %s column', (_name, focused, order) => {
      const panels = ['p1', 'p2', 'p3'].map((id) => makePanel(id, [`${id}-tab`]));
      const store = makeStore('ws-2', layoutWith(panels, focused));

      const newPanelId = openNewPanel(store, '/workspace/ws-2')!;
      const workspace = store.state.panelLayout.byWorkspaceId['ws-2'];
      expect(workspace.root).toMatchObject({
        children: order.map((id) => ({ panelId: id === 'new' ? newPanelId : id })),
      });
      expect(workspace.focusedPanelId).toBe(newPanelId);
      expect(workspace.panels[newPanelId]).toMatchObject({ tabs: [], pristine: true });
      expect(workspace.panels.p1.tabs).toHaveLength(1);
      expect(workspace.panels.p2.tabs).toHaveLength(1);
      expect(workspace.panels.p3.tabs).toHaveLength(1);
    });

    it('does not reuse pristine columns or clear protected panels', () => {
      const pristinePanel = makePanel('p2');
      pristinePanel.pristine = true;
      const protectedPanel = makePanel('p3', ['protected']);
      protectedPanel.tabs[0].closable = false;
      const store = makeStore(
        'ws-2',
        layoutWith([makePanel('p1', ['t1']), pristinePanel, protectedPanel], 'p1'),
      );

      const newPanelId = openNewPanel(store, '/workspace/ws-2')!;
      const workspace = store.state.panelLayout.byWorkspaceId['ws-2'];
      expect(workspace.panels.p2).toMatchObject({ tabs: [], pristine: true });
      expect(workspace.panels.p3.tabs.map((tab) => tab.id)).toEqual(['protected']);
      expect(workspace.panels[newPanelId]).toMatchObject({ tabs: [], pristine: true });
    });

    it('leaves a four-column layout and focus unchanged', () => {
      const panels = ['p1', 'p2', 'p3', 'p4'].map((id) => makePanel(id, [`${id}-tab`]));
      const store = makeStore('ws-2', layoutWith(panels, 'p2'));
      const before = store.state.panelLayout.byWorkspaceId['ws-2'];

      expect(openNewPanel(store, '/workspace/ws-2')).toBe('p2');
      expect(store.state.panelLayout.byWorkspaceId['ws-2']).toBe(before);
    });

    it('returns null outside workspace routes', () => {
      const store = makeStore('ws-2', layoutWith([makePanel('p1', ['t1'])], 'p1'));

      expect(openNewPanel(store, '/')).toBeNull();
      expect(openNewPanel(store, '/workspace/new')).toBeNull();
    });
  });

  it('registers the conventional macOS global-tab shortcut set', () => {
    const shortcuts: KeyboardShortcut[] = [];
    const openNewWorkspace = vi.fn();
    const store = makeStore();

    registerWorkspaceTabShortcuts({
      isMac: true,
      register: (shortcut) => shortcuts.push(shortcut),
      store,
      getCurrentPath: () => '/workspace/ws-1',
      navigate: vi.fn(),
      openNewWorkspace,
    });

    const chord = (shortcut: KeyboardShortcut) =>
      [
        shortcut.meta && 'meta',
        shortcut.ctrl && 'ctrl',
        shortcut.shift && 'shift',
        shortcut.alt && 'alt',
        shortcut.key.toLowerCase(),
      ]
        .filter(Boolean)
        .join('+');
    expect(shortcuts.map(chord)).toEqual([
      'meta+n',
      'meta+b',
      'meta+t',
      'meta+w',
      'meta+shift+w',
      'meta+shift+t',
      'meta+shift+alt+arrowleft',
      'meta+shift+alt+arrowright',
      'ctrl+tab',
      'ctrl+shift+tab',
      'meta+1',
      'meta+2',
      'meta+3',
      'meta+4',
      'meta+5',
      'meta+6',
      'meta+7',
      'meta+8',
      'meta+9',
    ]);

    shortcuts[0].action();
    expect(openNewWorkspace).toHaveBeenCalledOnce();

    const sidebarShortcut = shortcuts.find((shortcut) => chord(shortcut) === 'meta+b')!;
    expect(sidebarShortcut).toMatchObject({
      global: true,
      description: SHORTCUTS.TOGGLE_SIDEBAR.label,
    });
    sidebarShortcut.action();
    expect(store.actions.at(-1)?.type).toBe('uiLayout/toggleSidebar');
  });

  it('registers global non-macOS workspace movement chords', () => {
    const shortcuts: KeyboardShortcut[] = [];
    const store = makeStore('ws-2');
    const onWorkspaceTabMoved = vi.fn();
    registerWorkspaceTabShortcuts({
      isMac: false,
      register: (shortcut) => shortcuts.push(shortcut),
      store,
      getCurrentPath: () => '/workspace/ws-2',
      navigate: vi.fn(),
      openNewWorkspace: vi.fn(),
      onWorkspaceTabMoved,
    });

    expect(
      shortcuts.filter((shortcut) => shortcut.description.startsWith('Move Space Tab')),
    ).toEqual([
      expect.objectContaining({
        key: 'ArrowLeft',
        ctrl: true,
        alt: true,
        shift: true,
        global: true,
      }),
      expect.objectContaining({
        key: 'ArrowRight',
        ctrl: true,
        alt: true,
        shift: true,
        global: true,
      }),
    ]);

    shortcuts.find((shortcut) => shortcut.key === 'ArrowLeft')!.action();
    expect(onWorkspaceTabMoved).toHaveBeenLastCalledWith({ workspaceId: 'ws-2', position: 1 });
    shortcuts.find((shortcut) => shortcut.key === 'ArrowLeft')!.action();
    expect(onWorkspaceTabMoved).toHaveBeenCalledTimes(1);
  });

  it('retains all nine indexed bindings after the tab range modifier is edited', () => {
    const shortcuts: KeyboardShortcut[] = [];
    registerWorkspaceTabShortcuts({
      isMac: true,
      register: (shortcut) => shortcuts.push(shortcut),
      store: makeStore(),
      getCurrentPath: () => '/workspace/ws-1',
      navigate: vi.fn(),
      openNewWorkspace: vi.fn(),
      resolveBinding: (id) => (id === 'navigation.go-to-tab' ? 'alt+1-9' : ''),
    });

    expect(shortcuts.slice(-9).map((shortcut) => shortcut.binding?.())).toEqual(
      Array.from({ length: 9 }, (_, index) => `alt+${index + 1}`),
    );
  });
});
