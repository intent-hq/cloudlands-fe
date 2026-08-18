import { describe, expect, it, vi } from 'vitest';
import {
  panelLayoutReducer,
  emptyWorkspaceState,
  initializeLayout,
  setRestoreStatus,
  openTab,
  openTabInAdjacentOrSplit,
  openTabInNewRootColumn,
  openBlankWorkingPanel,
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
  toggleExpandPanel,
  updateTabTitle,
  updateFileTabPath,
  clearPanelLayout,
  bootstrapNewWorkspaceLayout,
  markPanelTouched,
  observeDeferredSpecGeneration,
  resolveNewWorkspaceInitialAgent,
  revealDeferredSpecTab,
  resetLayout,
  collapseToReusablePanel,
  goBack,
  setPanelPinned,
} from './panel-layout-slice';
import { removeTerminal } from '../terminals/terminals-slice';
import { workspaceUnmounted } from '../workspace-lifecycle/workspace-lifecycle-slice';
import type { PanelLayoutSliceState } from './panel-layout-types';
import {
  DEFAULT_CHAT_PANEL_WIDTH,
  DEFAULT_MEDIUM_PANEL_WIDTH,
  PANEL_SPLIT_GUTTER_WIDTH,
} from '../../../../shared/panel-layout-sizing';

const WS = 'test-ws';

function emptyState(): PanelLayoutSliceState {
  return { byWorkspaceId: {} };
}

/** Create state with a single panel containing some tabs */
function stateWithPanel(
  panelId = 'p1',
  tabs: Array<{ id: string; type: string; title: string; filePath?: string }> = [],
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

    it('defaults direct widths to explicit while preserving an automatic source', () => {
      const layout = {
        root: { type: 'panel' as const, panelId: 'p1' },
        panels: { p1: { id: 'p1', tabs: [], activeTabId: null } },
        focusedPanelId: 'p1',
        canvasWidth: 725,
      };
      const explicit = panelLayoutReducer(emptyState(), initializeLayout(WS, layout));
      expect(explicit.byWorkspaceId[WS]).toMatchObject({
        canvasWidth: 725,
        canvasWidthSource: 'explicit',
      });

      const automatic = panelLayoutReducer(
        emptyState(),
        initializeLayout(WS, { ...layout, canvasWidthSource: null }),
      );
      expect(automatic.byWorkspaceId[WS]).toMatchObject({
        canvasWidth: 725,
        canvasWidthSource: null,
      });
    });

    it('drops stale focus and reveal work when a restored layout replaces the panel tree', () => {
      const opened = panelLayoutReducer(
        stateWithPanel('old-panel'),
        openTab(
          WS,
          { type: 'note', title: 'Old', noteId: 'old', closable: true },
          'old-panel',
          'old-tab',
        ),
      );
      opened.byWorkspaceId[WS].pendingFocusTabId = 'old-tab';

      const result = panelLayoutReducer(
        opened,
        initializeLayout(WS, {
          root: { type: 'panel', panelId: 'restored-panel' },
          panels: {
            'restored-panel': { id: 'restored-panel', tabs: [], activeTabId: null },
          },
          focusedPanelId: 'restored-panel',
        }),
      ).byWorkspaceId[WS];

      expect(result.pendingFocusTabId).toBeNull();
      expect(result.pendingPanelReveal).toBeNull();
    });
  });

  describe('new workspace canonical bootstrap', () => {
    const preferredCanvasWidth =
      DEFAULT_MEDIUM_PANEL_WIDTH + DEFAULT_CHAT_PANEL_WIDTH + PANEL_SPLIT_GUTTER_WIDTH;
    const preferredPanelWidth = DEFAULT_MEDIUM_PANEL_WIDTH + DEFAULT_CHAT_PANEL_WIDTH;

    it.each([true, false])(
      'seeds and reveals the immediate initial agent with coordinator=%s',
      (coordinator) => {
        const seeded = panelLayoutReducer(
          emptyState(),
          bootstrapNewWorkspaceLayout(WS, 'agent-1', 'Initial agent', coordinator),
        );
        const initialWorkspace = seeded.byWorkspaceId[WS];
        const initialOrder =
          initialWorkspace.root.type === 'split'
            ? initialWorkspace.root.children.map((child) =>
                child.type === 'panel' ? child.panelId : 'nested',
              )
            : [initialWorkspace.root.panelId];

        expect(initialWorkspace.root).toMatchObject({
          type: 'split',
          direction: 'horizontal',
          sizes: [
            expect.closeTo((DEFAULT_MEDIUM_PANEL_WIDTH / preferredPanelWidth) * 100, 6),
            expect.closeTo((DEFAULT_CHAT_PANEL_WIDTH / preferredPanelWidth) * 100, 6),
          ],
        });
        expect(initialWorkspace.panels[initialOrder[0]]).toMatchObject({
          tabs: [],
          pinned: false,
        });
        expect(initialWorkspace.panels[initialOrder[1]]).toMatchObject({
          pinned: true,
          tabs: [expect.objectContaining({ type: 'agent', agentId: 'agent-1' })],
        });
        expect(initialWorkspace).toMatchObject({
          canvasWidth: preferredCanvasWidth,
          canvasWidthSource: 'intrinsic',
          newWorkspaceLifecycle: { coordinator, initialAgentPending: false },
        });

        const observed = panelLayoutReducer(
          seeded,
          observeDeferredSpecGeneration(WS, 'spec:created'),
        );
        const revealed = panelLayoutReducer(
          observed,
          revealDeferredSpecTab(WS, 'spec:created', 'Spec', 10),
        );
        const duplicate = panelLayoutReducer(
          revealed,
          revealDeferredSpecTab(WS, 'spec:created', 'Spec', 20),
        );
        const workspace = revealed.byWorkspaceId[WS];
        const order =
          workspace.root.type === 'split'
            ? workspace.root.children.map((child) =>
                child.type === 'panel' ? child.panelId : 'nested',
              )
            : [workspace.root.panelId];

        expect(workspace.panels[order[0]]).toMatchObject({
          pinned: false,
          tabs: [expect.objectContaining({ type: 'note', noteId: 'spec' })],
        });
        expect(workspace.panels[order[1]]).toMatchObject({
          pinned: true,
          tabs: [expect.objectContaining({ type: 'agent', agentId: 'agent-1' })],
        });
        expect(Object.values(workspace.panels).flatMap((panel) => panel.tabs)).toHaveLength(2);
        expect(workspace.canvasWidth).toBe(preferredCanvasWidth);
        expect(workspace.canvasWidthSource).toBe('intrinsic');
        expect(duplicate).toBe(revealed);
      },
    );

    it.each([true, false])(
      'resolves the delayed initial agent and reveals the same order with coordinator=%s',
      (coordinator) => {
        const pending = panelLayoutReducer(
          emptyState(),
          bootstrapNewWorkspaceLayout(WS, null, 'Specialist', coordinator),
        );
        const resolved = panelLayoutReducer(
          pending,
          resolveNewWorkspaceInitialAgent(WS, 'agent-1', 'Specialist', 10),
        );
        const duplicateAgent = panelLayoutReducer(
          resolved,
          resolveNewWorkspaceInitialAgent(WS, 'agent-2', 'Duplicate', 20),
        );
        const observed = panelLayoutReducer(
          duplicateAgent,
          observeDeferredSpecGeneration(WS, 'spec:created'),
        );
        const revealed = panelLayoutReducer(
          observed,
          revealDeferredSpecTab(WS, 'spec:created', 'Spec', 30),
        );
        const workspace = revealed.byWorkspaceId[WS];
        const order =
          workspace.root.type === 'split'
            ? workspace.root.children.map((child) =>
                child.type === 'panel' ? child.panelId : 'nested',
              )
            : [workspace.root.panelId];

        expect(workspace.panels[order[0]]).toMatchObject({
          pinned: false,
          tabs: [expect.objectContaining({ noteId: 'spec' })],
        });
        expect(workspace.panels[order[1]]).toMatchObject({
          pinned: true,
          tabs: [expect.objectContaining({ agentId: 'agent-1' })],
        });
        expect(workspace.canvasWidth).toBe(preferredCanvasWidth);
        expect(workspace.canvasWidthSource).toBe('intrinsic');
        expect(workspace.newWorkspaceLifecycle).toMatchObject({
          coordinator,
          initialAgentId: 'agent-1',
          initialAgentPending: false,
          spec: { state: 'revealed' },
        });
      },
    );

    it('preserves an explicit saved canvas width while revealing Spec', () => {
      const seeded = panelLayoutReducer(
        emptyState(),
        bootstrapNewWorkspaceLayout(WS, 'agent-1', 'Coordinator', true),
      );
      const initial = seeded.byWorkspaceId[WS];
      const explicit = panelLayoutReducer(
        seeded,
        initializeLayout(WS, {
          root: initial.root,
          panels: initial.panels,
          focusedPanelId: initial.focusedPanelId,
          canvasWidth: 1800,
          canvasWidthSource: 'explicit',
          deferSpecTab: true,
          newWorkspaceLifecycle: initial.newWorkspaceLifecycle,
        }),
      );
      const observed = panelLayoutReducer(
        explicit,
        observeDeferredSpecGeneration(WS, 'spec:created'),
      );
      const revealed = panelLayoutReducer(
        observed,
        revealDeferredSpecTab(WS, 'spec:created', 'Spec', 10),
      ).byWorkspaceId[WS];

      expect(revealed).toMatchObject({
        canvasWidth: 1800,
        canvasWidthSource: 'explicit',
      });
    });

    it('returns to normal automatic sizing when the user opens a non-default panel', () => {
      const seeded = panelLayoutReducer(
        emptyState(),
        bootstrapNewWorkspaceLayout(WS, 'agent-1', 'Coordinator', true),
      );
      const observed = panelLayoutReducer(
        seeded,
        observeDeferredSpecGeneration(WS, 'spec:created'),
      );
      const revealed = panelLayoutReducer(
        observed,
        revealDeferredSpecTab(WS, 'spec:created', 'Spec', 10),
      );
      const opened = panelLayoutReducer(
        revealed,
        openTabInNewRootColumn(
          WS,
          { type: 'note', title: 'User note', noteId: 'user-note', closable: true },
          { force: true, newPanelId: 'user-panel', newTabId: 'user-tab' },
          20,
        ),
      ).byWorkspaceId[WS];
      const order =
        opened.root.type === 'split'
          ? opened.root.children.map((child) => (child.type === 'panel' ? child.panelId : 'nested'))
          : [opened.root.panelId];

      expect(order).toHaveLength(3);
      expect(opened.panels[order[0]]).toMatchObject({ pinned: false });
      expect(opened.panels[order[1]]).toMatchObject({ pinned: true });
      expect(opened.panels[order[2]]).toMatchObject({ activeTabId: 'user-tab' });
      expect(opened.canvasWidthSource).toBeNull();
    });

    it('adds the delayed agent without replacing user content in its reserved slot', () => {
      const pending = panelLayoutReducer(
        emptyState(),
        bootstrapNewWorkspaceLayout(WS, null, 'Specialist'),
      );
      const initialPanelId = pending.byWorkspaceId[WS].focusedPanelId!;
      const withUserTab = panelLayoutReducer(
        pending,
        openTab(
          WS,
          {
            type: 'note',
            title: 'Draft',
            noteId: 'draft',
            workspaceId: WS,
            closable: true,
          },
          initialPanelId,
          'draft-tab',
          true,
        ),
      );
      const resolved = panelLayoutReducer(
        withUserTab,
        resolveNewWorkspaceInitialAgent(WS, 'agent-1', 'Specialist', 10),
      );
      const tabs = Object.values(resolved.byWorkspaceId[WS].panels).flatMap((panel) => panel.tabs);
      expect(tabs).toEqual([
        expect.objectContaining({ noteId: 'draft' }),
        expect.objectContaining({ agentId: 'agent-1' }),
      ]);
    });

    it('reveals canonical Spec once and preserves a touched placeholder tab', () => {
      const seeded = panelLayoutReducer(
        emptyState(),
        bootstrapNewWorkspaceLayout(WS, 'agent-1', 'Coordinator', true),
      );
      const placeholder = Object.values(seeded.byWorkspaceId[WS].panels).find(
        (panel) => panel.pristine,
      )!;
      const touched = panelLayoutReducer(seeded, markPanelTouched(WS, placeholder.id));
      const withDraft = panelLayoutReducer(
        touched,
        openTab(
          WS,
          {
            type: 'note',
            title: 'Draft',
            noteId: 'draft',
            workspaceId: WS,
            closable: true,
          },
          placeholder.id,
          'draft-tab',
          true,
        ),
      );
      const observed = panelLayoutReducer(
        withDraft,
        observeDeferredSpecGeneration(WS, 'spec:created'),
      );
      const revealed = panelLayoutReducer(
        observed,
        revealDeferredSpecTab(WS, 'spec:created', 'Spec', 10),
      );
      const duplicate = panelLayoutReducer(
        revealed,
        revealDeferredSpecTab(WS, 'spec:created', 'Spec', 20),
      );
      const workspace = duplicate.byWorkspaceId[WS];

      expect(Object.values(workspace.panels)).toHaveLength(2);
      expect(workspace.panels[placeholder.id].tabs.map((tab) => tab.noteId)).toEqual([
        'draft',
        'spec',
      ]);
      expect(
        Object.values(workspace.panels)
          .flatMap((panel) => panel.tabs)
          .filter((tab) => tab.type === 'note' && tab.noteId === 'spec'),
      ).toHaveLength(1);
      expect(workspace.newWorkspaceLifecycle?.spec.state).toBe('revealed');
      expect(workspace.focusedPanelId).toBe(placeholder.id);
    });

    it('clears the one-shot lifecycle on reset', () => {
      const seeded = panelLayoutReducer(
        emptyState(),
        bootstrapNewWorkspaceLayout(WS, 'agent-1', 'Coordinator', true),
      );
      const result = panelLayoutReducer(seeded, resetLayout(WS));
      expect(result.byWorkspaceId[WS]).toMatchObject({
        deferSpecTab: false,
        newWorkspaceLifecycle: null,
      });
    });
  });

  describe('toggleExpandPanel', () => {
    it('fills the horizontal split and restores the exact saved widths on a second toggle', () => {
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
          sizes: [35, 65],
        },
        panels: {
          p1: { id: 'p1', tabs: [], activeTabId: null },
          p2: { id: 'p2', tabs: [], activeTabId: null },
        },
      };

      const expanded = panelLayoutReducer(state, toggleExpandPanel(WS, 'p1'));
      expect(expanded.byWorkspaceId[WS].root).toMatchObject({
        sizes: [expect.closeTo(72, 6), expect.closeTo(28, 6)],
      });
      expect(expanded.byWorkspaceId[WS].savedSizesBeforeExpand).toEqual([
        { nodePath: [], sizes: [35, 65] },
      ]);
      expect(expanded.byWorkspaceId[WS].savedCanvasWidthBeforeExpand).toBeNull();
      expect(expanded.byWorkspaceId[WS].savedCanvasWidthSourceBeforeExpand).toBeNull();

      const resized = panelLayoutReducer(
        expanded,
        resizePanelLayoutRightEdge(WS, 1000, 1100, 1100),
      );
      expect(resized.byWorkspaceId[WS].canvasWidthSource).toBe('explicit');
      const restored = panelLayoutReducer(resized, toggleExpandPanel(WS, 'p1'));
      expect(restored.byWorkspaceId[WS].root).toMatchObject({ sizes: [35, 65] });
      expect(restored.byWorkspaceId[WS].expandedPanelId).toBeNull();
      expect(restored.byWorkspaceId[WS].canvasWidth).toBeNull();
      expect(restored.byWorkspaceId[WS].canvasWidthSource).toBeNull();
    });

    it('expands horizontal ancestors in a nested layout without changing vertical sizing', () => {
      const state = stateWithPanel('p1');
      state.byWorkspaceId[WS] = {
        ...state.byWorkspaceId[WS],
        root: {
          type: 'split',
          direction: 'vertical',
          sizes: [40, 60],
          children: [
            {
              type: 'split',
              direction: 'horizontal',
              sizes: [25, 75],
              children: [
                { type: 'panel', panelId: 'p1' },
                { type: 'panel', panelId: 'p2' },
              ],
            },
            { type: 'panel', panelId: 'p3' },
          ],
        },
        panels: {
          p1: { id: 'p1', tabs: [], activeTabId: null },
          p2: { id: 'p2', tabs: [], activeTabId: null },
          p3: { id: 'p3', tabs: [], activeTabId: null },
        },
      };

      const expanded = panelLayoutReducer(state, toggleExpandPanel(WS, 'p2'));
      const root = expanded.byWorkspaceId[WS].root;
      expect(root).toMatchObject({ sizes: [40, 60] });
      expect(root.type === 'split' ? root.children[0] : null).toMatchObject({
        sizes: [expect.closeTo((280 / 780) * 100, 6), expect.closeTo((500 / 780) * 100, 6)],
      });
      expect(expanded.byWorkspaceId[WS].canvasWidth).toBe(788);
      expect(expanded.byWorkspaceId[WS].savedSizesBeforeExpand).toEqual([
        { nodePath: [], sizes: [40, 60] },
        { nodePath: [0], sizes: [25, 75] },
      ]);
    });

    it('restores the original widths when rapid toggles switch panels and return', () => {
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
          sizes: [30, 70],
        },
        panels: {
          p1: { id: 'p1', tabs: [], activeTabId: null },
          p2: { id: 'p2', tabs: [], activeTabId: null },
        },
      };

      const first = panelLayoutReducer(state, toggleExpandPanel(WS, 'p1'));
      const switched = panelLayoutReducer(first, toggleExpandPanel(WS, 'p2'));
      const restored = panelLayoutReducer(switched, toggleExpandPanel(WS, 'p2'));
      expect(switched.byWorkspaceId[WS].root).toMatchObject({
        sizes: [expect.closeTo(28, 6), expect.closeTo(72, 6)],
      });
      expect(restored.byWorkspaceId[WS].root).toMatchObject({ sizes: [30, 70] });
    });

    it('uses overflow for compact siblings and restores explicit canvas provenance', () => {
      const state = stateWithPanel('p1');
      const panelIds = ['p1', 'p2', 'p3', 'p4', 'p5'];
      state.byWorkspaceId[WS] = {
        ...state.byWorkspaceId[WS],
        root: {
          type: 'split',
          direction: 'horizontal',
          children: panelIds.map((panelId) => ({ type: 'panel', panelId })),
          sizes: panelIds.map(() => 20),
        },
        panels: Object.fromEntries(
          panelIds.map((panelId) => [panelId, { id: panelId, tabs: [], activeTabId: null }]),
        ),
        canvasWidth: 1000,
      };

      const expanded = panelLayoutReducer(state, toggleExpandPanel(WS, 'p3'));
      expect(expanded.byWorkspaceId[WS].canvasWidth).toBe(1652);
      expect(expanded.byWorkspaceId[WS].root).toMatchObject({
        sizes: [
          expect.closeTo((280 / 1620) * 100, 6),
          expect.closeTo((280 / 1620) * 100, 6),
          expect.closeTo((500 / 1620) * 100, 6),
          expect.closeTo((280 / 1620) * 100, 6),
          expect.closeTo((280 / 1620) * 100, 6),
        ],
      });

      const restored = panelLayoutReducer(expanded, toggleExpandPanel(WS, 'p3'));
      expect(restored.byWorkspaceId[WS].canvasWidth).toBe(1000);
      expect(restored.byWorkspaceId[WS].root).toMatchObject({ sizes: [20, 20, 20, 20, 20] });
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

    it('cancels one-shot focus and reveal work when restore starts without recreating it', () => {
      const state = stateWithPanel('p1');
      state.byWorkspaceId[WS].pendingFocusTabId = 'tab-before-restore';
      state.byWorkspaceId[WS].pendingPanelReveal = {
        panelId: 'p1',
        tabId: 'tab-before-restore',
        requestId: 'reveal-before-restore',
      };

      const pending = panelLayoutReducer(state, setRestoreStatus(WS, 'pending'));
      const restored = panelLayoutReducer(pending, setRestoreStatus(WS, 'restored'));

      expect(restored.byWorkspaceId[WS]).toMatchObject({
        restoreStatus: 'restored',
        pendingFocusTabId: null,
        pendingPanelReveal: null,
      });
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
      expect(result.byWorkspaceId[WS].pendingPanelReveal).toEqual({
        panelId: 'p1',
        tabId: 'tab1',
        requestId: 'tab1',
      });
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
      expect(result.byWorkspaceId[WS].canvasWidth).toBe(1008);
      const focusedPanelId = result.byWorkspaceId[WS].focusedPanelId!;
      expect(result.byWorkspaceId[WS].pendingPanelReveal).toMatchObject({
        panelId: focusedPanelId,
        tabId: result.byWorkspaceId[WS].panels[focusedPanelId].activeTabId,
      });
    });

    it('creates every adjacent chat at old default plus exactly 200px', () => {
      const state = stateWithPanel('p1', [{ id: 'existing', type: 'note', title: 'Existing' }]);
      const result = panelLayoutReducer(
        state,
        openTabInAdjacentOrSplit(
          WS,
          { type: 'agent', title: 'Ada', agentId: 'agent-1', closable: true },
          undefined,
          undefined,
          1234,
        ),
      ).byWorkspaceId[WS];

      expect(result.canvasWidth).toBe(1208);
      if (result.root.type !== 'split') throw new Error('Expected horizontal split');
      expect(result.root.sizes).toEqual([
        expect.closeTo((500 / 1200) * 100, 6),
        expect.closeTo((700 / 1200) * 100, 6),
      ]);
    });

    it('preserves existing explicit column pixels when adding the wider chat', () => {
      const state = stateWithPanel('p1', [{ id: 'existing', type: 'note', title: 'Existing' }]);
      state.byWorkspaceId[WS].canvasWidth = 860;
      state.byWorkspaceId[WS].canvasWidthSource = 'explicit';
      const result = panelLayoutReducer(
        state,
        openTabInAdjacentOrSplit(WS, {
          type: 'agent',
          title: 'Ada',
          agentId: 'agent-1',
          closable: true,
        }),
      ).byWorkspaceId[WS];

      expect(result.canvasWidth).toBe(1568);
      expect(result.canvasWidthSource).toBe('explicit');
      if (result.root.type !== 'split') throw new Error('Expected horizontal split');
      expect(result.root.sizes).toEqual([
        expect.closeTo((860 / 1560) * 100, 6),
        expect.closeTo((700 / 1560) * 100, 6),
      ]);
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

    it('reveals canonical equivalent content instead of filling an empty panel', () => {
      let state = stateWithPanel('p1', [
        { id: 'existing-browser', type: 'browser', title: 'Browser', browserUrl: 'about:blank' },
      ]);
      state = panelLayoutReducer(state, splitPanel(WS, 'p1', 'horizontal', undefined, 10));
      state.byWorkspaceId[WS].canvasWidth = 777;
      const emptyPanelId = state.byWorkspaceId[WS].focusedPanelId!;
      const before = state.byWorkspaceId[WS];

      const result = panelLayoutReducer(
        state,
        openTabInAdjacentOrSplit(
          WS,
          { type: 'browser', title: 'Browser', browserUrl: 'about:blank', closable: true },
          emptyPanelId,
          undefined,
          20,
        ),
      ).byWorkspaceId[WS];

      expect(result.root).toEqual(before.root);
      expect(Object.keys(result.panels)).toEqual(Object.keys(before.panels));
      expect(result.panels.p1.tabs).toEqual([
        expect.objectContaining({ id: 'existing-browser', browserUrl: 'about:blank' }),
      ]);
      expect(result.panels[emptyPanelId].tabs).toEqual([]);
      expect(result.focusedPanelId).toBe('p1');
      expect(result.pendingPanelReveal).toMatchObject({
        panelId: 'p1',
        tabId: 'existing-browser',
      });
      expect(result.canvasWidth).toBe(777);
    });

    it('allows explicit duplicate creation in an empty target panel', () => {
      let state = stateWithPanel('p1', [
        { id: 'existing', type: 'note', title: 'Plan', noteId: 'spec' },
      ]);
      state = panelLayoutReducer(state, splitPanel(WS, 'p1', 'horizontal', undefined, 10));
      const emptyPanelId = state.byWorkspaceId[WS].focusedPanelId!;

      const result = panelLayoutReducer(
        state,
        openTabInAdjacentOrSplit(
          WS,
          { type: 'note', title: 'Plan', noteId: 'spec', closable: true },
          emptyPanelId,
          { allowDuplicate: true },
          20,
        ),
      ).byWorkspaceId[WS];

      expect(result.panels[emptyPanelId].tabs).toHaveLength(1);
      expect(result.panels[emptyPanelId].tabs[0]).toMatchObject({ noteId: 'spec' });
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

  describe('openTabInNewRootColumn', () => {
    const agentTab = {
      type: 'agent' as const,
      title: 'Ada',
      agentId: 'agent-1',
      workspaceId: WS,
      closable: true,
    };

    it('uses the pristine panel for a compact first chat', () => {
      const result = panelLayoutReducer(
        stateWithPanel('p1'),
        openTabInNewRootColumn(
          WS,
          agentTab,
          { adaptiveFirstChat: true, availableCanvasWidth: 800, force: true },
          10,
        ),
      ).byWorkspaceId[WS];

      expect(result.root).toEqual({ type: 'panel', panelId: 'p1' });
      expect(result.panels.p1.tabs).toEqual([expect.objectContaining({ agentId: 'agent-1' })]);
    });

    it('keeps a launcher column beside a wide first chat', () => {
      const result = panelLayoutReducer(
        stateWithPanel('p1'),
        openTabInNewRootColumn(
          WS,
          agentTab,
          { adaptiveFirstChat: true, availableCanvasWidth: 1400, force: true },
          10,
        ),
      ).byWorkspaceId[WS];

      expect(result.root).toMatchObject({
        type: 'split',
        direction: 'horizontal',
        children: [{ panelId: 'p1' }, {}],
      });
      expect(Object.values(result.panels)).toHaveLength(2);
      expect(result.panels.p1.tabs[0]).toMatchObject({ agentId: 'agent-1' });
      expect(result.panels.p1.pristine).toBe(false);
      expect(Object.values(result.panels).find((panel) => panel.id !== 'p1')).toMatchObject({
        tabs: [],
        pristine: true,
      });
      expect(result.canvasWidth).toBe(1400);
    });

    it('appends a root column without changing existing column pixels', () => {
      const state = stateWithPanel('p1', [{ id: 'one', type: 'note', title: 'One' }]);
      state.byWorkspaceId[WS] = {
        ...state.byWorkspaceId[WS],
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
          ...state.byWorkspaceId[WS].panels,
          p2: { id: 'p2', tabs: [], activeTabId: null },
        },
        canvasWidth: 1000,
      };

      const result = panelLayoutReducer(
        state,
        openTabInNewRootColumn(WS, agentTab, { force: true }, 10),
      ).byWorkspaceId[WS];
      if (result.root.type !== 'split') throw new Error('Expected horizontal split');
      expect(result.root.children).toMatchObject([{ panelId: 'p1' }, { panelId: 'p2' }, {}]);
      expect(result.root.sizes).toEqual([
        expect.closeTo((595.2 / 1692) * 100, 6),
        expect.closeTo((396.8 / 1692) * 100, 6),
        expect.closeTo((700 / 1692) * 100, 6),
      ]);
      expect(result.canvasWidth).toBe(1708);
      expect(result.pendingPanelReveal).toMatchObject({
        panelId: result.focusedPanelId,
        tabId: result.panels[result.focusedPanelId!].activeTabId,
      });
    });

    it('reveals an existing canonical agent instead of adding a column', () => {
      let state = stateWithPanel('p1', [
        { id: 'agent-tab', type: 'agent', title: 'Ada', agentId: 'agent-1' } as any,
      ]);
      state = panelLayoutReducer(state, splitPanel(WS, 'p1', 'horizontal', undefined, 5));
      const before = state.byWorkspaceId[WS];

      const result = panelLayoutReducer(
        state,
        openTabInNewRootColumn(WS, agentTab, { force: true }, 10),
      ).byWorkspaceId[WS];

      expect(result.root).toEqual(before.root);
      expect(Object.keys(result.panels)).toEqual(Object.keys(before.panels));
      expect(result.focusedPanelId).toBe('p1');
      expect(result.pendingPanelReveal).toMatchObject({ panelId: 'p1', tabId: 'agent-tab' });
    });

    it('replaces the reusable panel and preserves pinned panels in pin mode', () => {
      const state = emptyState();
      state.byWorkspaceId[WS] = {
        ...emptyWorkspaceState,
        root: {
          type: 'split',
          direction: 'horizontal',
          children: [
            { type: 'panel', panelId: 'pinned' },
            { type: 'panel', panelId: 'reuse' },
          ],
          sizes: [50, 50],
        },
        panels: {
          pinned: {
            id: 'pinned',
            tabs: [{ id: 'keep', type: 'note', title: 'Keep', closable: true } as any],
            activeTabId: 'keep',
            pinned: true,
          },
          reuse: {
            id: 'reuse',
            tabs: [{ id: 'old', type: 'note', title: 'Old', closable: true } as any],
            activeTabId: 'old',
          },
        },
        focusedPanelId: 'reuse',
      };

      const result = panelLayoutReducer(
        state,
        openTabInNewRootColumn(WS, agentTab, { force: true, panelOpenMode: 'pin' }, 10),
      ).byWorkspaceId[WS];

      expect(Object.keys(result.panels)).toEqual(['pinned', 'reuse']);
      expect(result.root).toMatchObject({
        children: [{ panelId: 'reuse' }, { panelId: 'pinned' }],
      });
      expect(result.panels.pinned.tabs[0].id).toBe('keep');
      expect(result.panels.reuse.tabs).toEqual([
        expect.objectContaining({ type: 'agent', agentId: 'agent-1' }),
      ]);
      expect(result.recentlyClosed[0].tab.id).toBe('old');
    });
  });

  describe('reusable panel state', () => {
    it('clears and reuses the working panel as one undoable layout change', () => {
      const state = stateWithPanel('working', [
        { id: 'old', type: 'note', title: 'Old', filePath: 'old.md' },
      ]);

      const blank = panelLayoutReducer(state, openBlankWorkingPanel(WS, 10));
      const result = blank.byWorkspaceId[WS];

      expect(Object.keys(result.panels)).toEqual(['working']);
      expect(result.panels.working).toMatchObject({
        tabs: [],
        activeTabId: null,
        pinned: false,
        pristine: true,
      });
      expect(result.focusedPanelId).toBe('working');
      expect(result.recentlyClosed[0].tab.id).toBe('old');
      expect(result.layoutHistory).toHaveLength(1);
      expect(
        panelLayoutReducer(blank, goBack(WS, 11)).byWorkspaceId[WS].panels.working.tabs,
      ).toEqual([expect.objectContaining({ id: 'old' })]);
    });

    it('creates a left reusable working panel when every existing panel is pinned', () => {
      const state = stateWithPanel('pinned', [
        { id: 'keep', type: 'note', title: 'Keep', filePath: 'keep.md' },
      ]);
      state.byWorkspaceId[WS].panels.pinned.pinned = true;
      const action = openBlankWorkingPanel(WS, 10);

      const result = panelLayoutReducer(state, action).byWorkspaceId[WS];

      expect(Object.keys(result.panels)).toEqual(['pinned', action.payload.newPanelId]);
      expect(result.root).toMatchObject({
        children: [{ panelId: action.payload.newPanelId }, { panelId: 'pinned' }],
      });
      expect(result.panels[action.payload.newPanelId]).toMatchObject({
        tabs: [],
        pinned: false,
        pristine: true,
      });
      expect(result.focusedPanelId).toBe(action.payload.newPanelId);
      expect(result.layoutHistory).toHaveLength(1);
    });

    it('replaces the blank working panel with the next item in pin mode', () => {
      const blank = panelLayoutReducer(
        stateWithPanel('working', [{ id: 'old', type: 'note', title: 'Old' }]),
        openBlankWorkingPanel(WS, 10),
      );

      const result = panelLayoutReducer(
        blank,
        openTabInNewRootColumn(
          WS,
          { type: 'agent', title: 'Agent', agentId: 'agent-1', closable: true },
          { panelOpenMode: 'pin', force: true },
          11,
        ),
      ).byWorkspaceId[WS];

      expect(Object.keys(result.panels)).toEqual(['working']);
      expect(result.panels.working.tabs).toEqual([
        expect.objectContaining({ type: 'agent', agentId: 'agent-1' }),
      ]);
      expect(result.panels.working.pristine).toBe(false);
    });

    it('keeps the focused unpinned panel and closes other unpinned panels', () => {
      let state = stateWithPanel('p1', [{ id: 'one', type: 'note', title: 'One' }]);
      state = panelLayoutReducer(state, splitPanel(WS, 'p1', 'horizontal', undefined, 1));
      const p2 = state.byWorkspaceId[WS].focusedPanelId!;
      state = panelLayoutReducer(
        state,
        openTab(
          WS,
          { type: 'note', title: 'Two', noteId: 'two', closable: true },
          p2,
          'two',
          true,
          2,
        ),
      );

      const result = panelLayoutReducer(state, collapseToReusablePanel(WS, 3)).byWorkspaceId[WS];

      expect(Object.keys(result.panels)).toEqual([p2]);
      expect(result.root).toEqual({ type: 'panel', panelId: p2 });
      expect(result.panels[p2].tabs[0].id).toBe('two');
      expect(result.recentlyClosed.some((entry) => entry.tab.id === 'one')).toBe(true);
    });

    it('stores explicit pin state without changing panel content', () => {
      const result = panelLayoutReducer(
        stateWithPanel('p1', [{ id: 'one', type: 'note', title: 'One' }]),
        setPanelPinned(WS, 'p1', true, 1),
      ).byWorkspaceId[WS];

      expect(result.panels.p1).toMatchObject({ pinned: true, activeTabId: 'one' });
    });

    it('unpins the selected panel into the reusable slot and closes the previous reusable panel', () => {
      const state = emptyState();
      const targetTabs = [{ id: 'target-tab', type: 'note', title: 'Target' } as any];
      state.byWorkspaceId[WS] = {
        ...emptyWorkspaceState,
        root: {
          type: 'split',
          direction: 'horizontal',
          children: ['reuse', 'target', 'newer', 'older'].map((panelId) => ({
            type: 'panel' as const,
            panelId,
          })),
          sizes: [20, 30, 28, 22],
        },
        panels: {
          reuse: {
            id: 'reuse',
            tabs: [{ id: 'old-tab', type: 'note', title: 'Old' } as any],
            activeTabId: 'old-tab',
            pinned: false,
          },
          target: { id: 'target', tabs: targetTabs, activeTabId: 'target-tab', pinned: true },
          newer: { id: 'newer', tabs: [], activeTabId: null, pinned: true },
          older: { id: 'older', tabs: [], activeTabId: null, pinned: true },
        },
        focusedPanelId: 'reuse',
        canvasWidth: 1000,
        canvasWidthSource: 'explicit',
      };

      const result = panelLayoutReducer(state, setPanelPinned(WS, 'target', false, 10))
        .byWorkspaceId[WS];

      expect(Object.keys(result.panels)).toEqual(['target', 'newer', 'older']);
      expect(result.root).toMatchObject({
        children: [{ panelId: 'target' }, { panelId: 'newer' }, { panelId: 'older' }],
        sizes: [expect.closeTo(37.5, 6), expect.closeTo(35, 6), expect.closeTo(27.5, 6)],
      });
      expect(result.panels.target).toMatchObject({
        id: 'target',
        activeTabId: 'target-tab',
        pinned: false,
      });
      expect(result.panels.target.tabs).toBe(targetTabs);
      expect(result.focusedPanelId).toBe('target');
      expect(result.pendingPanelReveal).toMatchObject({
        panelId: 'target',
        tabId: 'target-tab',
      });
      expect(result.canvasWidth).toBeCloseTo(796.8, 6);
      expect(result.canvasWidthSource).toBe('explicit');
      expect(result.recentlyClosed[0]).toMatchObject({ panelId: 'reuse', tab: { id: 'old-tab' } });
    });

    it('keeps newer pins closer to each newly created reusable panel', () => {
      const state = emptyState();
      state.byWorkspaceId[WS] = {
        ...emptyWorkspaceState,
        root: {
          type: 'split',
          direction: 'horizontal',
          children: [
            { type: 'panel', panelId: 'reuse' },
            { type: 'panel', panelId: 'older' },
          ],
          sizes: [50, 50],
        },
        panels: {
          reuse: {
            id: 'reuse',
            tabs: [{ id: 'reuse-tab', type: 'note', title: 'Reuse' } as any],
            activeTabId: 'reuse-tab',
            pinned: false,
          },
          older: { id: 'older', tabs: [], activeTabId: null, pinned: true },
        },
        focusedPanelId: 'reuse',
      };

      const pinned = panelLayoutReducer(state, setPanelPinned(WS, 'reuse', true, 1));
      const opened = panelLayoutReducer(
        pinned,
        openTabInNewRootColumn(
          WS,
          { type: 'note', title: 'Next', noteId: 'next', closable: true },
          { panelOpenMode: 'pin', force: true, newTabId: 'next-tab' },
          2,
        ),
      ).byWorkspaceId[WS];
      const order =
        opened.root.type === 'split'
          ? opened.root.children.map((child) => (child.type === 'panel' ? child.panelId : 'split'))
          : [opened.root.panelId];

      expect(order.slice(1)).toEqual(['reuse', 'older']);
      expect(opened.panels[order[0]]).toMatchObject({ activeTabId: 'next-tab' });
      expect(opened.panels[order[0]].pinned).toBeUndefined();
      expect(new Set(order).size).toBe(order.length);
    });

    it('removes an empty reusable placeholder instead of leaving a shell', () => {
      const bootstrapped = panelLayoutReducer(
        emptyState(),
        bootstrapNewWorkspaceLayout(WS, 'agent-1', 'Coordinator', true),
      );
      const result = panelLayoutReducer(bootstrapped, collapseToReusablePanel(WS, 1)).byWorkspaceId[
        WS
      ];

      expect(Object.values(result.panels)).toEqual([
        expect.objectContaining({
          pinned: true,
          tabs: [expect.objectContaining({ agentId: 'agent-1' })],
        }),
      ]);
      expect(result.root.type).toBe('panel');
    });
  });

  describe('splitPanel', () => {
    it('preserves an explicit caller-provided panel width', () => {
      const result = panelLayoutReducer(
        stateWithPanel('p1'),
        splitPanel(WS, 'p1', 'horizontal', { panelWidth: 640 }, 1234),
      ).byWorkspaceId[WS];

      expect(result.canvasWidth).toBe(1148);
      if (result.root.type !== 'split') throw new Error('Expected horizontal split');
      expect(result.root.sizes).toEqual([
        expect.closeTo((500 / 1140) * 100, 6),
        expect.closeTo((640 / 1140) * 100, 6),
      ]);
    });

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
      expect(result.byWorkspaceId[WS].canvasWidth).toBe(1516);
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

      expect(workspace.canvasWidth).toBe(1508);
      if (workspace.root.type !== 'split') throw new Error('Expected horizontal split');
      expect(workspace.root.sizes[0]).toBeCloseTo((571.392 / 1492) * 100);
      expect(workspace.root.sizes[1]).toBeCloseTo((500 / 1492) * 100);
      expect(workspace.root.sizes[2]).toBeCloseTo((420.608 / 1492) * 100);
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

    it('shrinks the explicit canvas to the retained column when the final tab collapses a split', () => {
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
        canvasWidthSource: 'explicit',
      };

      const result = panelLayoutReducer(state, closeTab(WS, 't1', 'p1', 1000));
      const workspace = result.byWorkspaceId[WS];

      expect(workspace.root).toEqual({ type: 'panel', panelId: 'p2' });
      expect(workspace.canvasWidth).toBe(744);
      expect(workspace.canvasWidthSource).toBe('explicit');
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
    it('requests a fresh reveal even when the panel was already focused', () => {
      const state = stateWithPanel('p1');
      state.byWorkspaceId[WS].panels.p2 = { id: 'p2', tabs: [], activeTabId: null };
      const first = panelLayoutReducer(state, focusPanel(WS, 'p2'));
      const second = panelLayoutReducer(first, focusPanel(WS, 'p2'));
      expect(second.byWorkspaceId[WS].focusedPanelId).toBe('p2');
      expect(second.byWorkspaceId[WS].pendingPanelReveal).toMatchObject({
        panelId: 'p2',
        tabId: null,
      });
      expect(second.byWorkspaceId[WS].pendingPanelReveal?.requestId).not.toBe(
        first.byWorkspaceId[WS].pendingPanelReveal?.requestId,
      );
    });

    it('clears an in-flight reveal when its panel is removed', () => {
      let state = stateWithPanel('p1');
      state = panelLayoutReducer(state, splitPanel(WS, 'p1', 'horizontal', undefined, 10));
      const panelId = state.byWorkspaceId[WS].focusedPanelId!;
      expect(state.byWorkspaceId[WS].pendingPanelReveal?.panelId).toBe(panelId);

      const result = panelLayoutReducer(state, closePanel(WS, panelId, 20));
      expect(result.byWorkspaceId[WS].pendingPanelReveal).toBeNull();
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

  describe('updateFileTabPath', () => {
    const twoTabsSamePath = () =>
      stateWithPanel('p1', [
        { id: 't1', type: 'file', title: 'app.ts', filePath: 'src/app.ts' },
        { id: 't2', type: 'file', title: 'app.ts', filePath: 'src/app.ts' },
      ]);

    it('retargets only the identified tab when tabId is provided', () => {
      const result = panelLayoutReducer(
        twoTabsSamePath(),
        updateFileTabPath(WS, 'src/app.ts', 'packages/b/src/app.ts', 't2'),
      );
      const tabs = result.byWorkspaceId[WS].panels.p1.tabs;
      expect(tabs[0].filePath).toBe('src/app.ts');
      expect(tabs[0].title).toBe('app.ts');
      expect(tabs[1].filePath).toBe('packages/b/src/app.ts');
      expect(tabs[1].title).toBe('app.ts');
    });

    it('retargets every tab matching the old path when tabId is omitted', () => {
      const result = panelLayoutReducer(
        twoTabsSamePath(),
        updateFileTabPath(WS, 'src/app.ts', 'packages/b/src/app.ts'),
      );
      const tabs = result.byWorkspaceId[WS].panels.p1.tabs;
      expect(tabs[0].filePath).toBe('packages/b/src/app.ts');
      expect(tabs[1].filePath).toBe('packages/b/src/app.ts');
    });

    it('is a no-op when the identified tab does not match the old path', () => {
      const state = stateWithPanel('p1', [
        { id: 't1', type: 'file', title: 'app.ts', filePath: 'src/app.ts' },
      ]);
      const result = panelLayoutReducer(
        state,
        updateFileTabPath(WS, 'other/app.ts', 'packages/b/src/app.ts', 't1'),
      );
      expect(result).toBe(state);
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

    it('restores a selected closed tab without consuming newer history', () => {
      const state = stateWithPanel('p1', [
        { id: 't1', type: 'note', title: 'A' },
        { id: 't2', type: 'file', title: 'B' },
        { id: 't3', type: 'browser', title: 'C' },
      ]);
      const afterFirstClose = panelLayoutReducer(state, closeTab(WS, 't1', 'p1', 1000));
      const afterSecondClose = panelLayoutReducer(afterFirstClose, closeTab(WS, 't2', 'p1', 1001));

      const result = panelLayoutReducer(afterSecondClose, reopenClosedTab(WS, 1002, 't1'))
        .byWorkspaceId[WS];

      expect(result.panels.p1.tabs.at(-1)).toMatchObject({ type: 'note', title: 'A' });
      expect(result.recentlyClosed.map((entry) => entry.tab.id)).toEqual(['t2']);
    });
  });

  describe('closePanel', () => {
    it('compacts a horizontal canvas while preserving retained ratios, focus, and history', () => {
      const state = emptyState();
      state.byWorkspaceId[WS] = {
        ...emptyWorkspaceState,
        root: {
          type: 'split',
          direction: 'horizontal',
          sizes: [20, 30, 50],
          children: [
            { type: 'panel', panelId: 'p1' },
            { type: 'panel', panelId: 'p2' },
            { type: 'panel', panelId: 'p3' },
          ],
        },
        panels: {
          p1: { id: 'p1', tabs: [], activeTabId: null },
          p2: { id: 'p2', tabs: [], activeTabId: null },
          p3: { id: 'p3', tabs: [], activeTabId: null },
        },
        focusedPanelId: 'p3',
        canvasWidth: 1200,
        canvasWidthSource: 'explicit',
      };

      const workspace = panelLayoutReducer(state, closePanel(WS, 'p2', 2000)).byWorkspaceId[WS];

      expect(workspace.root).toEqual({
        type: 'split',
        direction: 'horizontal',
        children: [
          { type: 'panel', panelId: 'p1' },
          { type: 'panel', panelId: 'p3' },
        ],
        sizes: [expect.closeTo((20 / 70) * 100, 6), expect.closeTo((50 / 70) * 100, 6)],
      });
      expect(workspace.canvasWidth).toBeCloseTo(836.8, 6);
      expect(workspace.canvasWidthSource).toBe('explicit');
      expect(workspace.focusedPanelId).toBe('p3');
      expect(workspace.layoutHistory[0]).toMatchObject({
        canvasWidth: 1200,
        canvasWidthSource: 'explicit',
        timestamp: 2000,
        root: { sizes: [20, 30, 50] },
      });
    });

    it('shrinks an explicit canvas when a horizontal split collapses', () => {
      const state = emptyState();
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
          p1: { id: 'p1', tabs: [], activeTabId: null },
          p2: { id: 'p2', tabs: [], activeTabId: null },
        },
        focusedPanelId: 'p1',
        canvasWidth: 1200,
        canvasWidthSource: 'explicit',
      };

      const workspace = panelLayoutReducer(state, closePanel(WS, 'p1')).byWorkspaceId[WS];

      expect(workspace.root).toEqual({ type: 'panel', panelId: 'p2' });
      expect(workspace.canvasWidth).toBe(596);
      expect(workspace.canvasWidthSource).toBe('explicit');
    });

    it('releases intrinsic sizing when its canonical split changes', () => {
      const state = emptyState();
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
          p1: { id: 'p1', tabs: [], activeTabId: null },
          p2: { id: 'p2', tabs: [], activeTabId: null },
        },
        focusedPanelId: 'p1',
        canvasWidth: 1428,
        canvasWidthSource: 'intrinsic',
      };

      const workspace = panelLayoutReducer(state, closePanel(WS, 'p1')).byWorkspaceId[WS];

      expect(workspace.canvasWidth).toBeNull();
      expect(workspace.canvasWidthSource).toBeNull();
    });

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
