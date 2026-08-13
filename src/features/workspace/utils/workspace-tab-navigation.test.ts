import { describe, expect, it, vi } from 'vitest';
import { createCollection } from '@augmentcode/themis/utils/collections/collection-utils';
import type { StoreState } from '$store/renderer/types';
import type { Workspace } from '$shared/types';
import { initialState as workspaceInitialState } from '$store/renderer/slices/workspace/workspace-slice';
import { tabStateReducer, type TabState } from '$store/renderer/slices/tab-state/tab-state-slice';
import { selectWorkspaceTabOrder } from '$store/renderer/slices/tab-state/tab-state-selectors';
import {
  panelLayoutReducer,
  initialState as panelLayoutInitialState,
} from '$store/renderer/slices/panel-layout/panel-layout-slice';
import type {
  PanelLayoutSliceState,
  PanelState,
  RecentlyClosedTab,
} from '$store/renderer/slices/panel-layout/panel-layout-types';
import type { KeyboardShortcut } from '$lib/utils/keyboardShortcuts';
import {
  closeActiveWorkspaceTab,
  closePanelOrWorkspaceTab,
  cycleWorkspaceTab,
  findAdjacentWorkspaceColumnId,
  openNewPanel,
  registerWorkspaceTabShortcuts,
  reopenPanelOrWorkspaceTab,
  reopenWorkspaceTab,
  selectWorkspaceTabByPosition,
} from './workspace-tab-navigation';

const makeTabState = (
  currentTabId: string | null = 'ws-1',
  viewMode: TabState['viewMode'] = 'single',
): TabState => ({
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
  viewMode,
  version: 0,
});

function makeStore(
  currentTabId?: string | null,
  panelLayout?: PanelLayoutSliceState,
  viewMode?: TabState['viewMode'],
  workspaces: Array<{ id: string; status?: string }> = [],
) {
  let state = {
    tabState: makeTabState(currentTabId, viewMode),
    panelLayout: panelLayout ?? panelLayoutInitialState,
    workspace: {
      ...workspaceInitialState,
      workspaces: createCollection('id', workspaces as unknown as Workspace[]),
    },
  } as StoreState;
  return {
    get state() {
      return state;
    },
    dispatch(action: Parameters<typeof tabStateReducer>[1]) {
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

describe('findAdjacentWorkspaceColumnId', () => {
  const stacks = [['ws-1', 'ws-4'], ['ws-2'], ['ws-3', 'ws-5']];

  it('preserves the vertical row when possible and clamps shorter stacks', () => {
    expect(findAdjacentWorkspaceColumnId(stacks, 'ws-4', 'next')).toBe('ws-2');
    expect(findAdjacentWorkspaceColumnId(stacks, 'ws-5', 'previous')).toBe('ws-2');
  });

  it('wraps across the first and last horizontal edges', () => {
    expect(findAdjacentWorkspaceColumnId(stacks, 'ws-1', 'previous')).toBe('ws-3');
    expect(findAdjacentWorkspaceColumnId(stacks, 'ws-5', 'next')).toBe('ws-4');
    expect(findAdjacentWorkspaceColumnId([['ws-1']], 'ws-1', 'next')).toBeNull();
  });

  it('skips the synthetic workspace creation column', () => {
    const stacksWithCreation = [['ws-1'], ['new'], ['ws-2'], ['ws-3']];

    expect(findAdjacentWorkspaceColumnId(stacksWithCreation, 'ws-1', 'next')).toBe('ws-2');
    expect(findAdjacentWorkspaceColumnId(stacksWithCreation, 'ws-3', 'next')).toBe('ws-1');
    expect(findAdjacentWorkspaceColumnId(stacksWithCreation, 'ws-1', 'previous')).toBe('ws-3');
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
    const store = makeStore('ws-1', undefined, undefined, [{ id: 'ws-other', status: 'Active' }]);
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

  describe('closePanelOrWorkspaceTab', () => {
    it('closes the focused panel when multiple panels are open', () => {
      const store = makeStore(
        'ws-2',
        layoutWith([makePanel('p1', ['t1']), makePanel('p2', ['t2'])], 'p2'),
      );
      const navigate = vi.fn();

      expect(closePanelOrWorkspaceTab(store, '/workspace/ws-2', navigate)).toBe('panel');
      expect(Object.keys(store.state.panelLayout.byWorkspaceId['ws-2'].panels)).toEqual(['p1']);
      expect(selectWorkspaceTabOrder.select(store.state)).toEqual(['ws-1', 'ws-2', 'ws-3']);
      expect(navigate).not.toHaveBeenCalled();
    });

    it('closes the active tab when only one panel remains with tabs', () => {
      const store = makeStore('ws-2', layoutWith([makePanel('p1', ['t1', 't2'])], 'p1'));
      const navigate = vi.fn();

      expect(closePanelOrWorkspaceTab(store, '/workspace/ws-2', navigate)).toBe('tab');
      expect(store.state.panelLayout.byWorkspaceId['ws-2'].panels.p1.tabs.map((t) => t.id)).toEqual(
        ['t2'],
      );
      expect(selectWorkspaceTabOrder.select(store.state)).toEqual(['ws-1', 'ws-2', 'ws-3']);
      expect(navigate).not.toHaveBeenCalled();
    });

    it('closes the workspace tab once nothing is open', () => {
      const store = makeStore('ws-2', layoutWith([makePanel('p1')], 'p1'));
      const navigate = vi.fn();

      expect(closePanelOrWorkspaceTab(store, '/workspace/ws-2', navigate)).toBe('workspace');
      expect(selectWorkspaceTabOrder.select(store.state)).toEqual(['ws-1', 'ws-3']);
      expect(navigate).toHaveBeenCalledWith('/workspace/ws-3');
    });

    it('closes the workspace tab when no panel layout exists for the workspace', () => {
      const store = makeStore('ws-2');
      const navigate = vi.fn();

      expect(closePanelOrWorkspaceTab(store, '/workspace/ws-2', navigate)).toBe('workspace');
      expect(selectWorkspaceTabOrder.select(store.state)).toEqual(['ws-1', 'ws-3']);
    });

    it('returns null outside workspace routes', () => {
      const store = makeStore('ws-2');
      const navigate = vi.fn();

      expect(closePanelOrWorkspaceTab(store, '/', navigate)).toBeNull();
      expect(closePanelOrWorkspaceTab(store, '/workspace/new', navigate)).toBeNull();
      expect(navigate).not.toHaveBeenCalled();
    });

    it('closes the focused column panel from columns state instead of the route', () => {
      const store = makeStore(
        'ws-3',
        layoutWith([makePanel('p1', ['t1']), makePanel('p2', ['t2'])], 'p2', [], 'ws-3'),
        'columns',
      );
      const navigate = vi.fn();

      expect(closePanelOrWorkspaceTab(store, '/', navigate)).toBe('panel');
      expect(Object.keys(store.state.panelLayout.byWorkspaceId['ws-3'].panels)).toEqual(['p1']);
      expect(selectWorkspaceTabOrder.select(store.state)).toEqual(['ws-1', 'ws-2', 'ws-3']);
      expect(navigate).not.toHaveBeenCalled();
    });

    it('closes the active column workspace once its column layout is empty', () => {
      const store = makeStore('ws-3', undefined, 'columns');
      const navigate = vi.fn();

      expect(closePanelOrWorkspaceTab(store, '/', navigate)).toBe('workspace');
      expect(selectWorkspaceTabOrder.select(store.state)).toEqual(['ws-1', 'ws-2']);
      expect(store.state.tabState.recentlyClosedTabIds).toEqual(['ws-3']);
      expect(navigate).toHaveBeenCalledWith('/workspace/ws-2');
    });
  });

  describe('reopenPanelOrWorkspaceTab', () => {
    const closedPanelTab = (tabId: string, closedAt: number): RecentlyClosedTab => ({
      tab: { id: tabId, type: 'note' as const, title: tabId, closable: true },
      panelId: 'p1',
      closedAt,
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
    it('splits the focused panel into a new empty panel and focuses it', () => {
      const store = makeStore('ws-2', layoutWith([makePanel('p1', ['t1'])], 'p1'));

      const newPanelId = openNewPanel(store, '/workspace/ws-2');
      expect(newPanelId).not.toBeNull();

      const ws = store.state.panelLayout.byWorkspaceId['ws-2'];
      expect(Object.keys(ws.panels)).toHaveLength(2);
      expect(ws.panels[newPanelId as string].tabs).toEqual([]);
      expect(ws.focusedPanelId).toBe(newPanelId);
    });

    it('splits the last panel when none is focused', () => {
      const store = makeStore(
        'ws-2',
        layoutWith([makePanel('p1', ['t1']), makePanel('p2', ['t2'])], null),
      );

      expect(openNewPanel(store, '/workspace/ws-2')).not.toBeNull();
      expect(Object.keys(store.state.panelLayout.byWorkspaceId['ws-2'].panels)).toHaveLength(3);
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

    registerWorkspaceTabShortcuts({
      isMac: true,
      register: (shortcut) => shortcuts.push(shortcut),
      store: makeStore(),
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
      'meta+t',
      'meta+w',
      'meta+shift+t',
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
  });
});
