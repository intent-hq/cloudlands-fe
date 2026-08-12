import { describe, expect, it, vi } from 'vitest';
import {
  panelLayoutReducer,
  emptyWorkspaceState,
  initializeLayout,
  setRestoreStatus,
  openTab,
  openTabInAdjacentOrSplit,
  splitPanel,
  closeTab,
  closeActiveTab,
  closePanel,
  setActiveTab,
  selectNextTab,
  selectPreviousTab,
  reorderTabs,
  focusPanel,
  closeOtherTabs,
  closeAllTabs,
  closeTabsByType,
  reopenClosedTab,
  pruneRecentlyClosed,
  resizePanelLayoutAtHorizontalPanel,
  resizePanelLayoutRightEdge,
  setDeferSpecTab,
  updateTabTitle,
  clearPanelLayout,
} from './panel-layout-slice';
import { removeTerminal } from '../terminals/terminals-slice';
import { workspaceUnmounted } from '../workspace-lifecycle/workspace-lifecycle-slice';
import type { PanelLayoutSliceState } from './panel-layout-types';

const WS = 'test-ws';

function emptyState(): PanelLayoutSliceState {
  return { byWorkspaceId: {} };
}

/** Create state with a single panel containing some tabs */
function stateWithPanel(
  panelId = 'p1',
  tabs: Array<{ id: string; type: string; title: string }> = [],
) {
  const state = emptyState();
  state.byWorkspaceId[WS] = {
    ...emptyWorkspaceState,
    root: { type: 'panel', panelId },
    panels: {
      [panelId]: {
        id: panelId,
        tabs: tabs.map((t) => ({ ...t, closable: true }) as any),
        activeTabId: tabs.length > 0 ? tabs[0].id : null,
      },
    },
    focusedPanelId: panelId,
  };
  return state;
}

describe('panelLayoutReducer', () => {
  it('returns the initial state', () => {
    const result = panelLayoutReducer(undefined, { type: '@@INIT' });
    expect(result).toEqual({ byWorkspaceId: {} });
  });

  describe('initializeLayout', () => {
    it('sets root, panels, and focusedPanelId', () => {
      const layout = {
        root: { type: 'panel' as const, panelId: 'p1' },
        panels: { p1: { id: 'p1', tabs: [], activeTabId: null } },
        focusedPanelId: 'p1',
      };
      const result = panelLayoutReducer(emptyState(), initializeLayout(WS, layout));
      expect(result.byWorkspaceId[WS].root).toEqual(layout.root);
      expect(result.byWorkspaceId[WS].panels.p1).toBeDefined();
      expect(result.byWorkspaceId[WS].focusedPanelId).toBe('p1');
    });
  });

  describe('setRestoreStatus', () => {
    it('defaults restoreStatus to idle', () => {
      expect(emptyWorkspaceState.restoreStatus).toBe('idle');
    });

    it('updates restoreStatus for the workspace', () => {
      const result = panelLayoutReducer(emptyState(), setRestoreStatus(WS, 'pending'));
      expect(result.byWorkspaceId[WS].restoreStatus).toBe('pending');
    });
  });

  describe('openTab', () => {
    it('rejects a tab owned by another workspace without changing state', () => {
      const state = stateWithPanel('p1');
      const result = panelLayoutReducer(
        state,
        openTab(WS, {
          type: 'agent',
          title: 'Foreign agent',
          agentId: 'agent-2',
          workspaceId: 'ws-2',
          closable: true,
        }),
      );

      expect(result).toBe(state);
    });

    it('adds a tab to the focused panel', () => {
      const state = stateWithPanel('p1');
      const result = panelLayoutReducer(
        state,
        openTab(
          WS,
          { type: 'note', title: 'Test Note', noteId: 'n1', closable: true },
          undefined,
          'tab1',
        ),
      );
      const panel = result.byWorkspaceId[WS].panels.p1;
      expect(panel.tabs).toHaveLength(1);
      expect(panel.tabs[0].noteId).toBe('n1');
      expect(panel.activeTabId).toBe('tab1');
    });

    it('blocks spec note when deferSpecTab is true', () => {
      const state = stateWithPanel('p1');
      state.byWorkspaceId[WS].deferSpecTab = true;
      const result = panelLayoutReducer(
        state,
        openTab(WS, { type: 'note', title: 'Spec', noteId: 'spec', closable: true }),
      );
      expect(result.byWorkspaceId[WS].panels.p1.tabs).toHaveLength(0);
    });

    it('reuses existing singleton tab (agent-overview)', () => {
      const state = stateWithPanel('p1', [{ id: 't1', type: 'agent-overview', title: 'Agents' }]);
      const result = panelLayoutReducer(
        state,
        openTab(WS, { type: 'agent-overview', title: 'Agents v2', closable: true }),
      );
      // Should not add a second tab — reuse existing
      expect(result.byWorkspaceId[WS].panels.p1.tabs).toHaveLength(1);
      expect(result.byWorkspaceId[WS].panels.p1.activeTabId).toBe('t1');
    });

    it('opens a browser tab with browserUrl', () => {
      const state = stateWithPanel('p1');
      const result = panelLayoutReducer(
        state,
        openTab(
          WS,
          { type: 'browser', title: 'Browser', browserUrl: 'about:blank', closable: true },
          undefined,
          'tab1',
        ),
      );
      const panel = result.byWorkspaceId[WS].panels.p1;
      expect(panel.tabs).toHaveLength(1);
      expect(panel.tabs[0].type).toBe('browser');
      expect(panel.tabs[0].browserUrl).toBe('about:blank');
      expect(panel.activeTabId).toBe('tab1');
    });

    it('uses the action timestamp for layout and focus history', () => {
      const state = stateWithPanel('p1');
      const action = openTab(
        WS,
        { type: 'note', title: 'Test Note', noteId: 'n1', closable: true },
        undefined,
        'tab1',
        false,
        1234,
      );
      const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => {
        throw new Error('Date.now must not run inside panelLayoutReducer');
      });

      try {
        const result = panelLayoutReducer(state, action);
        const ws = result.byWorkspaceId[WS];
        expect(ws.layoutHistory[0].timestamp).toBe(1234);
        expect(ws.focusHistory[0].timestamp).toBe(1234);
      } finally {
        nowSpy.mockRestore();
      }
    });
  });

  describe('openTabInAdjacentOrSplit', () => {
    it('does not split for a tab owned by another workspace', () => {
      const state = stateWithPanel('p1', [{ id: 'existing', type: 'file', title: 'Existing' }]);
      const result = panelLayoutReducer(
        state,
        openTabInAdjacentOrSplit(WS, {
          type: 'agent',
          title: 'Foreign agent',
          agentId: 'agent-2',
          workspaceId: 'ws-2',
          closable: true,
        }),
      );

      expect(result).toBe(state);
    });

    it('splits a populated focused panel and preserves its active tab', () => {
      const state = stateWithPanel('p1', [{ id: 'existing', type: 'file', title: 'Existing' }]);
      const result = panelLayoutReducer(
        state,
        openTabInAdjacentOrSplit(
          WS,
          { type: 'note', title: 'Plan', noteId: 'spec', closable: true },
          undefined,
          undefined,
          1234,
        ),
      );
      const panels = Object.values(result.byWorkspaceId[WS].panels);

      expect(panels).toHaveLength(2);
      expect(result.byWorkspaceId[WS].panels.p1.activeTabId).toBe('existing');
      expect(panels.find((panel) => panel.id !== 'p1')?.tabs[0]).toMatchObject({
        type: 'note',
        noteId: 'spec',
      });
    });

    it('fills an empty focused panel instead of creating another empty shell', () => {
      const result = panelLayoutReducer(
        stateWithPanel('p1'),
        openTabInAdjacentOrSplit(
          WS,
          { type: 'note', title: 'Plan', noteId: 'spec', closable: true },
          undefined,
          undefined,
          1234,
        ),
      );

      expect(Object.keys(result.byWorkspaceId[WS].panels)).toEqual(['p1']);
      expect(result.byWorkspaceId[WS].panels.p1.tabs[0]).toMatchObject({
        type: 'note',
        noteId: 'spec',
      });
    });

    it('creates a third adjacent panel instead of reusing an existing neighbor', () => {
      const state = emptyState();
      state.byWorkspaceId[WS] = {
        ...emptyWorkspaceState,
        root: {
          type: 'split',
          direction: 'horizontal',
          children: [
            { type: 'panel', panelId: 'p1' },
            { type: 'panel', panelId: 'p2' },
          ],
          sizes: [50, 50],
        },
        panels: {
          p1: {
            id: 'p1',
            tabs: [{ id: 'source', type: 'note', title: 'Source', closable: true }],
            activeTabId: 'source',
          },
          p2: {
            id: 'p2',
            tabs: [{ id: 'neighbor', type: 'agent', title: 'Neighbor', closable: true }],
            activeTabId: 'neighbor',
          },
        },
        focusedPanelId: 'p1',
      };

      const result = panelLayoutReducer(
        state,
        openTabInAdjacentOrSplit(
          WS,
          { type: 'note', title: 'Linked', noteId: 'linked', closable: true },
          'p1',
          undefined,
          1234,
        ),
      );
      const panels = Object.values(result.byWorkspaceId[WS].panels);
      const root = result.byWorkspaceId[WS].root;

      expect(panels).toHaveLength(3);
      expect(root).toMatchObject({ type: 'split', direction: 'horizontal' });
      expect(root.type === 'split' ? root.children : []).toHaveLength(3);
      expect(result.byWorkspaceId[WS].panels.p2.tabs).toHaveLength(1);
      expect(
        panels.find((panel) => panel.tabs.some((tab) => tab.noteId === 'linked')),
      ).toBeDefined();
    });
  });

  describe('splitPanel', () => {
    it('adds a root horizontal column without resizing existing columns', () => {
      const state = emptyState();
      state.byWorkspaceId[WS] = {
        ...emptyWorkspaceState,
        root: {
          type: 'split',
          direction: 'horizontal',
          children: [
            { type: 'panel', panelId: 'p1' },
            { type: 'panel', panelId: 'p2' },
          ],
          sizes: [60, 40],
        },
        panels: {
          p1: { id: 'p1', tabs: [], activeTabId: null },
          p2: { id: 'p2', tabs: [], activeTabId: null },
        },
        focusedPanelId: 'p1',
      };

      const result = panelLayoutReducer(state, splitPanel(WS, 'p1', 'horizontal', undefined, 1234));
      const root = result.byWorkspaceId[WS].root;

      expect(root).toMatchObject({
        type: 'split',
        children: [{ panelId: 'p1' }, {}, { panelId: 'p2' }],
      });
      if (root.type === 'split') {
        expect(root.sizes[0]).toBeCloseTo(40);
        expect(root.sizes[1]).toBeCloseTo(100 / 3);
        expect(root.sizes[2]).toBeCloseTo(80 / 3);
      }
      expect(result.byWorkspaceId[WS].canvasWidth).toBe(1440);
    });

    it('preserves sibling pixels when adding a column after a manual edge resize', () => {
      const state = emptyState();
      state.byWorkspaceId[WS] = {
        ...emptyWorkspaceState,
        root: {
          type: 'split',
          direction: 'horizontal',
          children: [
            { type: 'panel', panelId: 'p1' },
            { type: 'panel', panelId: 'p2' },
          ],
          sizes: [60, 40],
        },
        panels: {
          p1: { id: 'p1', tabs: [], activeTabId: null },
          p2: { id: 'p2', tabs: [], activeTabId: null },
        },
        focusedPanelId: 'p1',
      };

      const resized = panelLayoutReducer(state, resizePanelLayoutRightEdge(WS, 960, 1000, 1000));
      expect(resized.byWorkspaceId[WS].canvasWidth).toBe(1000);
      const result = panelLayoutReducer(
        resized,
        splitPanel(WS, 'p1', 'horizontal', undefined, 1234),
      );
      const workspace = result.byWorkspaceId[WS];

      expect(workspace.canvasWidth).toBe(1480);
      if (workspace.root.type !== 'split') throw new Error('Expected horizontal split');
      expect(workspace.root.sizes[0]).toBeCloseTo((576 / 1480) * 100);
      expect(workspace.root.sizes[1]).toBeCloseTo((480 / 1480) * 100);
      expect(workspace.root.sizes[2]).toBeCloseTo((424 / 1480) * 100);
    });
  });

  describe('closeTab', () => {
    it('removes the tab and adds to recentlyClosed', () => {
      const state = stateWithPanel('p1', [
        { id: 't1', type: 'note', title: 'Note 1' },
        { id: 't2', type: 'file', title: 'File 1' },
      ]);
      const result = panelLayoutReducer(state, closeTab(WS, 't1', 'p1', 1000));
      const panel = result.byWorkspaceId[WS].panels.p1;
      expect(panel.tabs).toHaveLength(1);
      expect(panel.tabs[0].id).toBe('t2');
      expect(result.byWorkspaceId[WS].recentlyClosed).toHaveLength(1);
    });

    it('sets next tab as active when closing active tab', () => {
      const state = stateWithPanel('p1', [
        { id: 't1', type: 'note', title: 'A' },
        { id: 't2', type: 'file', title: 'B' },
      ]);
      const result = panelLayoutReducer(state, closeTab(WS, 't1', 'p1', 1000));
      expect(result.byWorkspaceId[WS].panels.p1.activeTabId).toBe('t2');
    });

    it('shrinks the canvas by the closed panel width without stretching its sibling', () => {
      const state = emptyState();
      state.byWorkspaceId[WS] = {
        ...emptyWorkspaceState,
        root: {
          type: 'split',
          direction: 'horizontal',
          children: [
            { type: 'panel', panelId: 'p1' },
            { type: 'panel', panelId: 'p2' },
          ],
          sizes: [25, 75],
        },
        panels: {
          p1: {
            id: 'p1',
            tabs: [{ id: 't1', type: 'note', title: 'A', closable: true }],
            activeTabId: 't1',
          },
          p2: {
            id: 'p2',
            tabs: [{ id: 't2', type: 'note', title: 'B', closable: true }],
            activeTabId: 't2',
          },
        },
        focusedPanelId: 'p1',
        canvasWidth: 1000,
      };

      const result = panelLayoutReducer(state, closeTab(WS, 't1', 'p1', 1000));
      const workspace = result.byWorkspaceId[WS];

      expect(workspace.root).toEqual({ type: 'panel', panelId: 'p2' });
      expect(workspace.canvasWidth).toBe(750);
    });

    it('threads closeActiveTab action timestamp through internal dispatch', () => {
      const state = stateWithPanel('p1', [
        { id: 't1', type: 'note', title: 'A' },
        { id: 't2', type: 'file', title: 'B' },
      ]);
      const action = closeActiveTab(WS, 'p1', 2222);
      const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => {
        throw new Error('Date.now must not run inside panelLayoutReducer');
      });

      try {
        const result = panelLayoutReducer(state, action);
        const ws = result.byWorkspaceId[WS];
        expect(ws.layoutHistory[0].timestamp).toBe(2222);
        expect(ws.recentlyClosed[0].closedAt).toBe(2222);
      } finally {
        nowSpy.mockRestore();
      }
    });
  });

  describe('setActiveTab', () => {
    it('changes the active tab', () => {
      const state = stateWithPanel('p1', [
        { id: 't1', type: 'note', title: 'A' },
        { id: 't2', type: 'file', title: 'B' },
      ]);
      const result = panelLayoutReducer(state, setActiveTab(WS, 't2', 'p1'));
      expect(result.byWorkspaceId[WS].panels.p1.activeTabId).toBe('t2');
    });
  });

  describe('selectNextTab / selectPreviousTab', () => {
    it('cycles through tabs forward', () => {
      const state = stateWithPanel('p1', [
        { id: 't1', type: 'note', title: 'A' },
        { id: 't2', type: 'file', title: 'B' },
      ]);
      const result = panelLayoutReducer(state, selectNextTab(WS, 'p1'));
      expect(result.byWorkspaceId[WS].panels.p1.activeTabId).toBe('t2');
    });

    it('threads selectNextTab action timestamp through focus history dispatch', () => {
      const state = stateWithPanel('p1', [
        { id: 't1', type: 'note', title: 'A' },
        { id: 't2', type: 'file', title: 'B' },
      ]);
      const action = selectNextTab(WS, 'p1', 3333);
      const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => {
        throw new Error('Date.now must not run inside panelLayoutReducer');
      });

      try {
        const result = panelLayoutReducer(state, action);
        const ws = result.byWorkspaceId[WS];
        expect(ws.layoutHistory[0].timestamp).toBe(3333);
        expect(ws.focusHistory[0].timestamp).toBe(3333);
      } finally {
        nowSpy.mockRestore();
      }
    });

    it('wraps around to first tab when at end', () => {
      const state = stateWithPanel('p1', [
        { id: 't1', type: 'note', title: 'A' },
        { id: 't2', type: 'file', title: 'B' },
      ]);
      state.byWorkspaceId[WS].panels.p1.activeTabId = 't2';
      const result = panelLayoutReducer(state, selectNextTab(WS, 'p1'));
      expect(result.byWorkspaceId[WS].panels.p1.activeTabId).toBe('t1');
    });

    it('cycles through tabs backward', () => {
      const state = stateWithPanel('p1', [
        { id: 't1', type: 'note', title: 'A' },
        { id: 't2', type: 'file', title: 'B' },
      ]);
      const result = panelLayoutReducer(state, selectPreviousTab(WS, 'p1'));
      expect(result.byWorkspaceId[WS].panels.p1.activeTabId).toBe('t2');
    });
  });

  describe('reorderTabs', () => {
    it('moves a tab from one index to another', () => {
      const state = stateWithPanel('p1', [
        { id: 't1', type: 'note', title: 'A' },
        { id: 't2', type: 'file', title: 'B' },
        { id: 't3', type: 'file', title: 'C' },
      ]);
      const result = panelLayoutReducer(state, reorderTabs(WS, 'p1', 0, 2));
      const tabs = result.byWorkspaceId[WS].panels.p1.tabs;
      expect(tabs[0].id).toBe('t2');
      expect(tabs[1].id).toBe('t3');
      expect(tabs[2].id).toBe('t1');
    });
  });

  describe('focusPanel', () => {
    it('changes focused panel ID', () => {
      const state = stateWithPanel('p1');
      state.byWorkspaceId[WS].panels.p2 = { id: 'p2', tabs: [], activeTabId: null };
      const result = panelLayoutReducer(state, focusPanel(WS, 'p2'));
      expect(result.byWorkspaceId[WS].focusedPanelId).toBe('p2');
    });
  });

  describe('closeOtherTabs', () => {
    it('keeps only the specified tab', () => {
      const state = stateWithPanel('p1', [
        { id: 't1', type: 'note', title: 'A' },
        { id: 't2', type: 'file', title: 'B' },
        { id: 't3', type: 'file', title: 'C' },
      ]);
      const result = panelLayoutReducer(state, closeOtherTabs(WS, 't2', 'p1'));
      const panel = result.byWorkspaceId[WS].panels.p1;
      expect(panel.tabs).toHaveLength(1);
      expect(panel.tabs[0].id).toBe('t2');
      expect(panel.activeTabId).toBe('t2');
    });
  });

  describe('closeAllTabs', () => {
    it('removes all tabs from a panel', () => {
      const state = stateWithPanel('p1', [
        { id: 't1', type: 'note', title: 'A' },
        { id: 't2', type: 'file', title: 'B' },
      ]);
      const result = panelLayoutReducer(state, closeAllTabs(WS, 'p1'));
      const panel = result.byWorkspaceId[WS].panels.p1;
      expect(panel.tabs).toHaveLength(0);
      expect(panel.activeTabId).toBeNull();
    });
  });

  describe('closeTabsByType', () => {
    it('removes all tabs of a given type', () => {
      const state = stateWithPanel('p1', [
        { id: 't1', type: 'note', title: 'A' },
        { id: 't2', type: 'file', title: 'B' },
        { id: 't3', type: 'note', title: 'C' },
      ]);
      const result = panelLayoutReducer(state, closeTabsByType(WS, 'note'));
      const panel = result.byWorkspaceId[WS].panels.p1;
      expect(panel.tabs).toHaveLength(1);
      expect(panel.tabs[0].id).toBe('t2');
    });
  });

  describe('setDeferSpecTab', () => {
    it('sets deferSpecTab flag', () => {
      const state = stateWithPanel('p1');
      const result = panelLayoutReducer(state, setDeferSpecTab(WS, true));
      expect(result.byWorkspaceId[WS].deferSpecTab).toBe(true);
    });
  });

  describe('updateTabTitle', () => {
    it('updates the title of a tab across panels', () => {
      const state = stateWithPanel('p1', [{ id: 't1', type: 'note', title: 'Old Title' }]);
      const result = panelLayoutReducer(state, updateTabTitle(WS, 't1', 'New Title'));
      expect(result.byWorkspaceId[WS].panels.p1.tabs[0].title).toBe('New Title');
    });
  });

  describe('clearPanelLayout', () => {
    it('resets workspace to empty state', () => {
      const state = stateWithPanel('p1', [{ id: 't1', type: 'note', title: 'A' }]);
      const result = panelLayoutReducer(state, clearPanelLayout(WS));
      expect(result.byWorkspaceId[WS]).toBeUndefined();
    });
  });

  describe('workspaceUnmounted', () => {
    it('does NOT clear panel layout state (state persists for workspace switch)', () => {
      const state = stateWithPanel('p1', [{ id: 't1', type: 'note', title: 'A' }]);
      const result = panelLayoutReducer(state, workspaceUnmounted(WS));
      // State should be preserved — not cleared
      expect(result.byWorkspaceId[WS]).toBeDefined();
      expect(result.byWorkspaceId[WS].panels.p1.tabs).toHaveLength(1);
    });
  });

  describe('reopenClosedTab', () => {
    it('restores the most recently closed tab', () => {
      const state = stateWithPanel('p1', [
        { id: 't1', type: 'note', title: 'A' },
        { id: 't2', type: 'file', title: 'B' },
      ]);
      // Close tab t1
      const afterClose = panelLayoutReducer(state, closeTab(WS, 't1', 'p1', 1000));
      expect(afterClose.byWorkspaceId[WS].recentlyClosed).toHaveLength(1);
      // Reopen
      const afterReopen = panelLayoutReducer(afterClose, reopenClosedTab(WS));
      const panel = afterReopen.byWorkspaceId[WS].panels.p1;
      expect(panel.tabs).toHaveLength(2);
      expect(afterReopen.byWorkspaceId[WS].recentlyClosed).toHaveLength(0);
    });
  });

  describe('closePanel', () => {
    it('adds closable removed tabs to recentlyClosed with timestamps', () => {
      const state = emptyState();
      const timestamp = 2000;
      state.byWorkspaceId[WS] = {
        ...emptyWorkspaceState,
        root: {
          type: 'split',
          direction: 'horizontal',
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
              { id: 't1', type: 'note', title: 'Note', closable: true } as any,
              { id: 't2', type: 'file', title: 'File', closable: true } as any,
            ],
            activeTabId: 't1',
          },
          p2: { id: 'p2', tabs: [], activeTabId: null },
        },
        focusedPanelId: 'p1',
      };

      const result = panelLayoutReducer(state, closePanel(WS, 'p1', timestamp));

      expect(result.byWorkspaceId[WS].panels.p1).toBeUndefined();
      expect(result.byWorkspaceId[WS].recentlyClosed).toHaveLength(2);
      expect(result.byWorkspaceId[WS].recentlyClosed[0].tab.id).toBe('t1');
      expect(result.byWorkspaceId[WS].recentlyClosed[0].closedAt).toBe(timestamp);
      expect(result.byWorkspaceId[WS].recentlyClosed[1].tab.id).toBe('t2');
      expect(result.byWorkspaceId[WS].recentlyClosed[1].closedAt).toBe(timestamp);
    });

    it('is a no-op when panel contains non-closable tabs, preserving state and history', () => {
      const state = emptyState();
      const timestamp = 2000;
      state.byWorkspaceId[WS] = {
        ...emptyWorkspaceState,
        root: {
          type: 'split',
          direction: 'horizontal',
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
              { id: 't1', type: 'note', title: 'Note', closable: false } as any,
              { id: 't2', type: 'file', title: 'File', closable: true } as any,
            ],
            activeTabId: 't1',
          },
          p2: { id: 'p2', tabs: [], activeTabId: null },
        },
        focusedPanelId: 'p1',
        layoutHistory: [],
        historyIndex: 0,
      };

      const result = panelLayoutReducer(state, closePanel(WS, 'p1', timestamp));

      // State identity preserved - no mutation occurred
      expect(result).toBe(state);
      // Panel still exists with all tabs
      expect(result.byWorkspaceId[WS].panels.p1).toBeDefined();
      expect(result.byWorkspaceId[WS].panels.p1.tabs).toHaveLength(2);
      // No history entry added
      expect(result.byWorkspaceId[WS].layoutHistory).toHaveLength(0);
      // No recentlyClosed entries
      expect(result.byWorkspaceId[WS].recentlyClosed).toHaveLength(0);
    });
  });

  describe('pruneRecentlyClosed', () => {
    it('removes recentlyClosed entries matching the given agentId', () => {
      const state = stateWithPanel('p1', [
        { id: 't-agent', type: 'agent', title: 'Agent A', agentId: 'agent-1' } as any,
        { id: 't-note', type: 'note', title: 'Note', noteId: 'n1' },
      ]);
      let s = panelLayoutReducer(state, closeTab(WS, 't-agent', 'p1', 1000));
      s = panelLayoutReducer(s, closeTab(WS, 't-note', 'p1', 1001));
      expect(s.byWorkspaceId[WS].recentlyClosed).toHaveLength(2);

      const pruned = panelLayoutReducer(s, pruneRecentlyClosed(WS, { agentId: 'agent-1' }));
      expect(pruned.byWorkspaceId[WS].recentlyClosed).toHaveLength(1);
      expect(pruned.byWorkspaceId[WS].recentlyClosed[0].tab.type).toBe('note');
    });

    it('removes recentlyClosed entries matching the given terminalId', () => {
      const state = stateWithPanel('p1', [
        { id: 't-term', type: 'terminal', title: 'Terminal', terminalId: 'term-1' } as any,
        { id: 't-note', type: 'note', title: 'Note', noteId: 'n1' },
      ]);
      let s = panelLayoutReducer(state, closeTab(WS, 't-term', 'p1', 1000));
      s = panelLayoutReducer(s, closeTab(WS, 't-note', 'p1', 1001));
      expect(s.byWorkspaceId[WS].recentlyClosed).toHaveLength(2);

      const pruned = panelLayoutReducer(s, pruneRecentlyClosed(WS, { terminalId: 'term-1' }));
      expect(pruned.byWorkspaceId[WS].recentlyClosed).toHaveLength(1);
      expect(pruned.byWorkspaceId[WS].recentlyClosed[0].tab.type).toBe('note');
    });

    it('does not touch non-agent/non-terminal recents when pruning by agentId', () => {
      const state = stateWithPanel('p1', [
        { id: 't-file', type: 'file', title: 'File' },
        { id: 't-browser', type: 'browser', title: 'Browser' },
      ]);
      let s = panelLayoutReducer(state, closeTab(WS, 't-file', 'p1', 1000));
      s = panelLayoutReducer(s, closeTab(WS, 't-browser', 'p1', 1001));
      const pruned = panelLayoutReducer(s, pruneRecentlyClosed(WS, { agentId: 'agent-anything' }));
      expect(pruned.byWorkspaceId[WS].recentlyClosed).toHaveLength(2);
    });

    it('is a no-op when no match is provided', () => {
      const state = stateWithPanel('p1', [
        { id: 't-agent', type: 'agent', title: 'Agent A', agentId: 'agent-1' } as any,
      ]);
      const closed = panelLayoutReducer(state, closeTab(WS, 't-agent', 'p1', 1000));
      const pruned = panelLayoutReducer(closed, pruneRecentlyClosed(WS, {}));
      expect(pruned).toBe(closed);
    });

    it('reopenClosedTab does not restore a pruned agent entry', () => {
      const state = stateWithPanel('p1', [
        { id: 't-agent', type: 'agent', title: 'Agent A', agentId: 'agent-1' } as any,
      ]);
      const closed = panelLayoutReducer(state, closeTab(WS, 't-agent', 'p1', 1000));
      const pruned = panelLayoutReducer(closed, pruneRecentlyClosed(WS, { agentId: 'agent-1' }));
      expect(pruned.byWorkspaceId[WS].recentlyClosed).toHaveLength(0);
      const afterReopen = panelLayoutReducer(pruned, reopenClosedTab(WS));
      // No entry to restore, panel remains empty
      expect(afterReopen.byWorkspaceId[WS].panels.p1.tabs).toHaveLength(0);
    });
  });

  describe('resizePanelLayoutRightEdge', () => {
    it('preserves the rightmost panel width while the workspace edge expands', () => {
      const state = stateWithPanel('p1');
      state.byWorkspaceId[WS] = {
        ...state.byWorkspaceId[WS],
        root: {
          type: 'split',
          direction: 'horizontal',
          children: [
            { type: 'panel', panelId: 'p1' },
            { type: 'panel', panelId: 'p2' },
          ],
          sizes: [50, 50],
        },
        panels: {
          ...state.byWorkspaceId[WS].panels,
          p2: { id: 'p2', tabs: [], activeTabId: null },
        },
      };

      const result = panelLayoutReducer(state, resizePanelLayoutRightEdge(WS, 1000, 1200, 1200));
      const root = result.byWorkspaceId[WS].root;

      expect(root.type).toBe('split');
      if (root.type === 'split') {
        expect(root.sizes[0]).toBeCloseTo(41.67, 1);
        expect(root.sizes[1]).toBeCloseTo(58.33, 1);
      }
      expect(result.byWorkspaceId[WS].canvasWidth).toBe(1200);
      expect(panelLayoutReducer(state, resizePanelLayoutRightEdge(WS, 0, 1200, 1200))).toBe(state);
    });

    it('grows only the selected root column and includes its width in later snapshots', () => {
      const state = stateWithPanel('p1');
      state.byWorkspaceId[WS] = {
        ...state.byWorkspaceId[WS],
        root: {
          type: 'split',
          direction: 'horizontal',
          children: [
            { type: 'panel', panelId: 'p1' },
            { type: 'panel', panelId: 'p2' },
            { type: 'panel', panelId: 'p3' },
          ],
          sizes: [30, 40, 30],
        },
        panels: {
          p1: { id: 'p1', tabs: [], activeTabId: null },
          p2: { id: 'p2', tabs: [], activeTabId: null },
          p3: { id: 'p3', tabs: [], activeTabId: null },
        },
        canvasWidth: 1000,
      };

      const resized = panelLayoutReducer(
        state,
        resizePanelLayoutAtHorizontalPanel(WS, 1000, 1200, 1, 1200),
      );

      expect(resized.byWorkspaceId[WS].canvasWidth).toBe(1200);
      expect(resized.byWorkspaceId[WS].root).toMatchObject({ sizes: [25, 50, 25] });
      const snapshotted = panelLayoutReducer(
        resized,
        splitPanel(WS, 'p1', 'vertical', undefined, 1234),
      );
      expect(snapshotted.byWorkspaceId[WS].layoutHistory[0].canvasWidth).toBe(1200);
    });

    it('persists the full canvas width without folding gutters into sibling sizes', () => {
      const state = stateWithPanel('p1');
      state.byWorkspaceId[WS] = {
        ...state.byWorkspaceId[WS],
        root: {
          type: 'split',
          direction: 'horizontal',
          children: [
            { type: 'panel', panelId: 'p1' },
            { type: 'panel', panelId: 'p2' },
          ],
          sizes: [(645 / 1042) * 100, (397 / 1042) * 100],
        },
        panels: {
          p1: { id: 'p1', tabs: [], activeTabId: null },
          p2: { id: 'p2', tabs: [], activeTabId: null },
        },
        canvasWidth: 1050,
      };

      const result = panelLayoutReducer(
        state,
        resizePanelLayoutAtHorizontalPanel(WS, 1042, 1142, 0, 1150),
      );
      const root = result.byWorkspaceId[WS].root;

      expect(result.byWorkspaceId[WS].canvasWidth).toBe(1150);
      if (root.type !== 'split') throw new Error('Expected horizontal split');
      expect((root.sizes[0] / 100) * 1142).toBeCloseTo(745);
      expect((root.sizes[1] / 100) * 1142).toBeCloseTo(397);
    });
  });

  describe('cross-slice: removeTerminal prunes recentlyClosed', () => {
    it('removes matching terminal recents when terminals/removeTerminal is dispatched', () => {
      const state = stateWithPanel('p1', [
        { id: 't-term', type: 'terminal', title: 'Terminal', terminalId: 'term-1' } as any,
        { id: 't-note', type: 'note', title: 'Note', noteId: 'n1' },
      ]);
      let s = panelLayoutReducer(state, closeTab(WS, 't-term', 'p1', 1000));
      s = panelLayoutReducer(s, closeTab(WS, 't-note', 'p1', 1001));
      const after = panelLayoutReducer(s, removeTerminal(WS, 'term-1'));
      expect(after.byWorkspaceId[WS].recentlyClosed).toHaveLength(1);
      expect(after.byWorkspaceId[WS].recentlyClosed[0].tab.type).toBe('note');
    });

    it('is a no-op when no recentlyClosed terminal entries match', () => {
      const state = stateWithPanel('p1', [
        { id: 't-note', type: 'note', title: 'Note', noteId: 'n1' },
      ]);
      const closed = panelLayoutReducer(state, closeTab(WS, 't-note', 'p1', 1000));
      const after = panelLayoutReducer(closed, removeTerminal(WS, 'term-nope'));
      expect(after).toBe(closed);
    });

    it('reopenClosedTab does not restore a terminal removed via removeTerminal', () => {
      const state = stateWithPanel('p1', [
        { id: 't-term', type: 'terminal', title: 'Terminal', terminalId: 'term-1' } as any,
      ]);
      const closed = panelLayoutReducer(state, closeTab(WS, 't-term', 'p1', 1000));
      const after = panelLayoutReducer(closed, removeTerminal(WS, 'term-1'));
      expect(after.byWorkspaceId[WS].recentlyClosed).toHaveLength(0);
      const afterReopen = panelLayoutReducer(after, reopenClosedTab(WS));
      expect(afterReopen.byWorkspaceId[WS].panels.p1.tabs).toHaveLength(0);
    });
  });
});
