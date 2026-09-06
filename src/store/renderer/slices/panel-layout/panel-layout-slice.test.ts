import { describe, expect, it, vi } from 'vitest';
import { createCollection, getItems } from '@augmentcode/themis/utils/collections/collection-utils';
import {
  panelLayoutReducer,
  emptyWorkspaceState,
  initializeLayout,
  setRestoreStatus,
  openTab,
  openTabInRightmostColumn,
  preparePanelLayoutBackendRestore,
  openTabInAdjacentOrSplit,
  openTabInNewRootColumn,
  openBlankWorkingPanel,
  splitPanel,
  moveTabToPanel,
  moveTabToSplit,
  moveTabToSplitLevel,
  createGridLayout,
  closeTab,
  activateVisibleTab,
  closeActiveTab,
  closeFocusedPanelTab,
  closePanel,
  destroyOwnedTabsForWorkspace,
  destroyTabsByOwnerAgent,
  openHiddenTab,
  restoreHiddenTab,
  revealHiddenTabAvoidingPanel,
  setActiveTab,
  setTabOwnerAgent,
  selectNextTab,
  selectPreviousTab,
  reorderTabs,
  focusPanel,
  closeOtherTabs,
  closeTabsToRight,
  closeAllTabs,
  closeAllOthersEverywhere,
  closeTabsByType,
  reopenClosedPanelColumn,
  reopenClosedTab,
  pruneRecentlyClosed,
  resizePanelLayoutAtRootDivider,
  resizePanelLayoutRightEdge,
  setDeferSpecTab,
  toggleExpandPanel,
  updateTabTitle,
  updateTabBrowserUrl,
  updateTabViewport,
  updateFileTabPath,
  setTabOwnerAgent,
  clearPanelLayout,
  bootstrapNewWorkspaceLayout,
  seedContextLinkEmptyLayout,
  MAX_SEEDED_CONTEXT_LINK_TABS,
  markPanelTouched,
  observeDeferredSpecGeneration,
  resolveNewWorkspaceInitialAgent,
  revealDeferredSpecTab,
  resetLayout,
  reconcilePanelColumnCount,
  setPanelColumnCount,
  goBack,
  goForward,
  setPanelPinned,
} from './panel-layout-slice';
import { removeTerminal } from '../terminals/terminals-slice';
import { removeScript } from '../scripts/scripts-slice';
import {
  workspaceDeleted,
  workspaceUnmounted,
} from '../workspace-lifecycle/workspace-lifecycle-slice';
import type {
  PanelLayoutSliceState,
  RecentlyClosedPanelColumn,
  WorkspacePanelLayoutState,
} from './panel-layout-types';
import { getPanelOrder } from './panel-layout-tabless';
import type { ContextLink } from '../../../../shared/types';
import {
  DEFAULT_BROWSER_PANEL_WIDTH,
  DEFAULT_CHAT_PANEL_WIDTH,
  DEFAULT_MEDIUM_PANEL_WIDTH,
  getAutomaticPanelCanvasWidth,
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

function expectFixedColumns(workspace: WorkspacePanelLayoutState, count: number) {
  const panelIds = getPanelOrder(workspace.root);
  expect(panelIds).toHaveLength(count);
  expect(workspace.columnCount).toBe(count);
  expect(Object.keys(workspace.panels).sort()).toEqual([...panelIds].sort());
  if (count === 1) {
    expect(workspace.root.type).toBe('panel');
  } else {
    expect(workspace.root).toMatchObject({ type: 'split', direction: 'horizontal' });
    if (workspace.root.type === 'split') {
      expect(workspace.root.children.every((child) => child.type === 'panel')).toBe(true);
    }
  }
}

describe('panelLayoutReducer', () => {
  it('returns the initial state', () => {
    const result = panelLayoutReducer(undefined, { type: '@@INIT' });
    expect(result).toEqual({ byWorkspaceId: {} });
  });

  describe('initializeLayout', () => {
    it('keeps a selected workspace count when a partial refresh omits it', () => {
      const selected = panelLayoutReducer(undefined, setPanelColumnCount(WS, 2, 10));
      const refreshed = panelLayoutReducer(
        selected,
        initializeLayout(WS, {
          root: { type: 'panel', panelId: 'refreshed' },
          panels: { refreshed: { id: 'refreshed', tabs: [], activeTabId: null } },
          focusedPanelId: 'refreshed',
        }),
      );

      expect(refreshed.byWorkspaceId[WS].columnCount).toBe(2);
    });

    it('keeps a selected workspace count when a same-backend refresh has an older count', () => {
      const selected = panelLayoutReducer(undefined, setPanelColumnCount(WS, 2, 10));
      const refreshed = panelLayoutReducer(
        selected,
        initializeLayout(WS, {
          root: { type: 'panel', panelId: 'restored' },
          panels: { restored: { id: 'restored', tabs: [], activeTabId: null } },
          focusedPanelId: 'restored',
          columnCount: 1,
        }),
      );

      expect(refreshed.byWorkspaceId[WS].columnCount).toBe(2);
    });

    it('reconciles a selected count with a smaller restored tree without recording history', () => {
      const selected = panelLayoutReducer(undefined, setPanelColumnCount(WS, 2, 10));
      const restored = panelLayoutReducer(
        selected,
        initializeLayout(WS, {
          root: { type: 'panel', panelId: 'restored' },
          panels: {
            restored: {
              id: 'restored',
              tabs: [{ id: 'active', type: 'note', title: 'Active', noteId: 'active' }],
              activeTabId: 'active',
            },
          },
          focusedPanelId: 'restored',
          columnCount: 1,
        }),
      );
      const history = restored.byWorkspaceId[WS].layoutHistory;
      const action = reconcilePanelColumnCount(WS, 2, 20, false);
      const reconciled = panelLayoutReducer(restored, action).byWorkspaceId[WS];

      expect(reconciled.root).toMatchObject({
        type: 'split',
        direction: 'horizontal',
        children: [
          { type: 'panel', panelId: 'restored' },
          { type: 'panel', panelId: action.payload.newPanelIds[0] },
        ],
      });
      expect(reconciled.panels.restored).toMatchObject({
        activeTabId: 'active',
        tabs: [expect.objectContaining({ id: 'active' })],
      });
      expect(reconciled.panels[action.payload.newPanelIds[0]]).toEqual({
        id: action.payload.newPanelIds[0],
        tabs: [],
        activeTabId: null,
        pristine: true,
      });
      expect(reconciled.focusedPanelId).toBe('restored');
      expect(reconciled.layoutHistory).toBe(history);
    });

    it('accepts the persisted count after entering a new backend namespace', () => {
      let state = panelLayoutReducer(undefined, setPanelColumnCount(WS, 2, 10));
      state = panelLayoutReducer(state, preparePanelLayoutBackendRestore(WS));
      state = panelLayoutReducer(
        state,
        initializeLayout(WS, {
          root: { type: 'panel', panelId: 'incoming' },
          panels: { incoming: { id: 'incoming', tabs: [], activeTabId: null } },
          focusedPanelId: 'incoming',
          columnCount: 1,
        }),
      );

      expect(state.byWorkspaceId[WS].columnCount).toBe(1);
      expect(state.byWorkspaceId[WS].columnCountInitialized).toBe(true);
    });

    it('accepts a derived legacy count after clearing stale restore state', () => {
      let state = panelLayoutReducer(undefined, setPanelColumnCount(WS, 3, 10));
      const history = state.byWorkspaceId[WS].layoutHistory;
      state = panelLayoutReducer(state, preparePanelLayoutBackendRestore(WS));
      state = panelLayoutReducer(
        state,
        initializeLayout(WS, {
          root: { type: 'panel', panelId: 'legacy' },
          panels: { legacy: { id: 'legacy', tabs: [], activeTabId: null } },
          focusedPanelId: 'legacy',
          canvasWidth: null,
          canvasWidthSource: null,
          columnCount: 1,
        }),
      );

      expect(state.byWorkspaceId[WS]).toMatchObject({
        root: { type: 'panel', panelId: 'legacy' },
        focusedPanelId: 'legacy',
        canvasWidth: null,
        canvasWidthSource: null,
        columnCount: 1,
        columnCountInitialized: true,
      });
      expect(state.byWorkspaceId[WS].layoutHistory).toBe(history);
    });

    it('derives a fresh workspace count when no selection or snapshot count exists', () => {
      const initialized = panelLayoutReducer(
        undefined,
        initializeLayout(WS, {
          root: {
            type: 'split',
            direction: 'horizontal',
            children: [
              { type: 'panel', panelId: 'left' },
              { type: 'panel', panelId: 'right' },
            ],
            sizes: [50, 50],
          },
          panels: {
            left: { id: 'left', tabs: [], activeTabId: null },
            right: { id: 'right', tabs: [], activeTabId: null },
          },
          focusedPanelId: 'left',
        }),
      );

      expect(initialized.byWorkspaceId[WS].columnCount).toBe(2);
    });

    it('keeps independent counts through navigation, remount, hydration, and backend refresh', () => {
      const otherWorkspace = 'other-ws';
      let state = panelLayoutReducer(undefined, setPanelColumnCount(WS, 2, 10));
      state = panelLayoutReducer(state, setPanelColumnCount(otherWorkspace, 3, 20));
      state = panelLayoutReducer(
        state,
        openTabInRightmostColumn(
          WS,
          { type: 'note', title: 'Navigation', noteId: 'navigation', closable: true },
          {},
          30,
        ),
      );
      state = panelLayoutReducer(state, setRestoreStatus(WS, 'pending'));
      state = panelLayoutReducer(
        state,
        initializeLayout(WS, {
          root: { type: 'panel', panelId: 'remounted' },
          panels: { remounted: { id: 'remounted', tabs: [], activeTabId: null } },
          focusedPanelId: 'remounted',
          columnCount: 1,
        }),
      );
      state = panelLayoutReducer(
        state,
        initializeLayout(WS, {
          root: { type: 'panel', panelId: 'hydrated' },
          panels: { hydrated: { id: 'hydrated', tabs: [], activeTabId: null } },
          focusedPanelId: 'hydrated',
        }),
      );

      expect(state.byWorkspaceId[WS].columnCount).toBe(2);
      expect(state.byWorkspaceId[otherWorkspace].columnCount).toBe(3);
    });
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

  describe.skip('legacy two-panel workspace bootstrap', () => {
    const preferredCanvasWidth =
      DEFAULT_MEDIUM_PANEL_WIDTH + DEFAULT_CHAT_PANEL_WIDTH + PANEL_SPLIT_GUTTER_WIDTH;

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

        expect(initialWorkspace.root).toMatchObject({ type: 'panel' });
        expect(initialOrder).toHaveLength(1);
        expect(initialWorkspace.panels[initialOrder[0]]).toMatchObject({
          pinned: true,
          tabs: [expect.objectContaining({ type: 'agent', agentId: 'agent-1' })],
        });
        expect(initialWorkspace).toMatchObject({
          canvasWidth: null,
          canvasWidthSource: null,
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

    it('reveals canonical Spec once and preserves a user tab in the initial agent panel', () => {
      const seeded = panelLayoutReducer(
        emptyState(),
        bootstrapNewWorkspaceLayout(WS, 'agent-1', 'Coordinator', true),
      );
      const agentPanel = Object.values(seeded.byWorkspaceId[WS].panels)[0];
      const touched = panelLayoutReducer(seeded, markPanelTouched(WS, agentPanel.id));
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
          agentPanel.id,
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
      expect(workspace.panels[agentPanel.id].tabs.map((tab) => tab.noteId)).toEqual([
        undefined,
        'draft',
      ]);
      expect(
        Object.values(workspace.panels)
          .flatMap((panel) => panel.tabs)
          .filter((tab) => tab.type === 'note' && tab.noteId === 'spec'),
      ).toHaveLength(1);
      expect(workspace.newWorkspaceLifecycle?.spec.state).toBe('revealed');
      expect(workspace.focusedPanelId).not.toBe(agentPanel.id);
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

  describe('fixed-column Spec reveal', () => {
    it('switches a coordinator once to agent-left and Spec-right', () => {
      const seeded = panelLayoutReducer(
        emptyState(),
        bootstrapNewWorkspaceLayout(WS, 'agent-1', 'Coordinator', true, 1),
      );
      const revealed = panelLayoutReducer(
        seeded,
        revealDeferredSpecTab(WS, 'spec:created', 'Spec', 10),
      );
      const repeated = panelLayoutReducer(
        revealed,
        revealDeferredSpecTab(WS, 'spec:updated', 'Spec', 20),
      );
      const workspace = revealed.byWorkspaceId[WS];
      const order = workspace.root.type === 'split' ? workspace.root.children : [];

      expect(order).toHaveLength(2);
      expect(workspace.panels[order[0].type === 'panel' ? order[0].panelId : '']).toMatchObject({
        tabs: [expect.objectContaining({ type: 'agent', agentId: 'agent-1' })],
      });
      expect(workspace.panels[order[1].type === 'panel' ? order[1].panelId : '']).toMatchObject({
        tabs: [expect.objectContaining({ type: 'note', noteId: 'spec' })],
      });
      expect(workspace.newWorkspaceLifecycle?.spec.state).toBe('revealed');
      expect(repeated).toBe(revealed);
    });

    it('does not auto-reveal Spec for a non-coordinator workspace', () => {
      const seeded = panelLayoutReducer(
        emptyState(),
        bootstrapNewWorkspaceLayout(WS, 'agent-1', 'Initial agent', false, 1),
      );

      expect(
        panelLayoutReducer(seeded, revealDeferredSpecTab(WS, 'spec:created', 'Spec', 10)),
      ).toBe(seeded);
    });
  });

  describe('context-link split bootstrap', () => {
    const issueLink = (number: number): ContextLink => ({
      kind: 'issue',
      url: `https://github.com/acme/widgets/issues/${number}`,
      owner: 'acme',
      repo: 'widgets',
      number,
    });

    it('seeds agent-left and one browser panel right with a tab per link', () => {
      const prLink: ContextLink = {
        kind: 'pr',
        url: 'https://github.com/acme/widgets/pull/9',
        owner: 'acme',
        repo: 'widgets',
        number: 9,
      };
      const seeded = panelLayoutReducer(
        emptyState(),
        bootstrapNewWorkspaceLayout(WS, 'agent-1', 'Initial agent', false, 1, [
          issueLink(7),
          prLink,
        ]),
      ).byWorkspaceId[WS];

      expect(seeded.root.type).toBe('split');
      const order = seeded.root.type === 'split' ? seeded.root.children : [];
      expect(order).toHaveLength(2);
      expect(seeded.root.type === 'split' ? seeded.root.direction : null).toBe('horizontal');

      const agentPanelId = order[0].type === 'panel' ? order[0].panelId : '';
      const browserPanelId = order[1].type === 'panel' ? order[1].panelId : '';
      expect(seeded.panels[agentPanelId].tabs).toEqual([
        expect.objectContaining({ type: 'agent', agentId: 'agent-1' }),
      ]);
      expect(seeded.panels[browserPanelId].tabs).toEqual([
        expect.objectContaining({ type: 'browser', browserUrl: issueLink(7).url }),
        expect.objectContaining({ type: 'browser', browserUrl: prLink.url }),
      ]);
      expect(seeded.panels[browserPanelId].activeTabId).toBe(
        seeded.panels[browserPanelId].tabs[0].id,
      );
      expect(seeded.focusedPanelId).toBe(agentPanelId);
      expect(seeded.columnCount).toBe(2);
      expect(seeded.canvasWidthSource).toBe('intrinsic');
      expect(seeded.canvasWidth).toBe(
        DEFAULT_CHAT_PANEL_WIDTH + DEFAULT_BROWSER_PANEL_WIDTH + PANEL_SPLIT_GUTTER_WIDTH,
      );
    });

    it('caps seeded browser tabs at the limit', () => {
      const links = Array.from({ length: MAX_SEEDED_CONTEXT_LINK_TABS + 3 }, (_, i) =>
        issueLink(i + 1),
      );
      const seeded = panelLayoutReducer(
        emptyState(),
        bootstrapNewWorkspaceLayout(WS, 'agent-1', 'Initial agent', false, 1, links),
      ).byWorkspaceId[WS];
      const order = seeded.root.type === 'split' ? seeded.root.children : [];
      const browserPanelId = order[1]?.type === 'panel' ? order[1].panelId : '';

      expect(seeded.panels[browserPanelId].tabs).toHaveLength(MAX_SEEDED_CONTEXT_LINK_TABS);
    });

    it('keeps the single-panel bootstrap when there are no context links', () => {
      const withEmpty = panelLayoutReducer(
        emptyState(),
        bootstrapNewWorkspaceLayout(WS, 'agent-1', 'Initial agent', false, 1, []),
      ).byWorkspaceId[WS];
      const withOmitted = panelLayoutReducer(
        emptyState(),
        bootstrapNewWorkspaceLayout(WS, 'agent-1', 'Initial agent', false, 1),
      ).byWorkspaceId[WS];

      for (const seeded of [withEmpty, withOmitted]) {
        expect(seeded.root.type).toBe('panel');
        expect(seeded.columnCount).toBe(1);
        expect(seeded.canvasWidth).toBeNull();
        expect(seeded.canvasWidthSource).toBeNull();
      }
    });

    it('resolves a delayed initial agent into the left panel', () => {
      const pending = panelLayoutReducer(
        emptyState(),
        bootstrapNewWorkspaceLayout(WS, null, 'Specialist', false, 1, [issueLink(7)]),
      );
      const resolved = panelLayoutReducer(
        pending,
        resolveNewWorkspaceInitialAgent(WS, 'agent-1', 'Specialist', 10),
      ).byWorkspaceId[WS];
      const order = resolved.root.type === 'split' ? resolved.root.children : [];
      const agentPanelId = order[0]?.type === 'panel' ? order[0].panelId : '';

      expect(resolved.panels[agentPanelId].tabs).toEqual([
        expect.objectContaining({ type: 'agent', agentId: 'agent-1' }),
      ]);
      expect(resolved.newWorkspaceLifecycle).toMatchObject({
        initialAgentId: 'agent-1',
        initialAgentPending: false,
      });
    });

    it('reveals the deferred Spec tab in the right browser panel for a coordinator', () => {
      const seeded = panelLayoutReducer(
        emptyState(),
        bootstrapNewWorkspaceLayout(WS, 'agent-1', 'Coordinator', true, 1, [issueLink(7)]),
      );
      const revealed = panelLayoutReducer(
        seeded,
        revealDeferredSpecTab(WS, 'spec:created', 'Spec', 10),
      ).byWorkspaceId[WS];
      const order = revealed.root.type === 'split' ? revealed.root.children : [];
      const rightPanelId = order.at(-1)?.type === 'panel' ? (order.at(-1) as any).panelId : '';

      expect(revealed.panels[rightPanelId].tabs).toEqual([
        expect.objectContaining({ type: 'browser' }),
        expect.objectContaining({ type: 'note', noteId: 'spec' }),
      ]);
      expect(revealed.newWorkspaceLifecycle?.spec.state).toBe('revealed');
      // The right panel still carries browser tabs, so the reveal must keep
      // the seeded browser-tier geometry instead of the canonical chat+medium
      // pair.
      expect(revealed.canvasWidth).toBe(
        DEFAULT_CHAT_PANEL_WIDTH + DEFAULT_BROWSER_PANEL_WIDTH + PANEL_SPLIT_GUTTER_WIDTH,
      );
    });

    it('seeds owner/repo#number tab titles so fork pairs stay distinct', () => {
      const forkLink: ContextLink = {
        kind: 'issue',
        url: 'https://github.com/fork/widgets/issues/7',
        owner: 'fork',
        repo: 'widgets',
        number: 7,
      };
      const seeded = panelLayoutReducer(
        emptyState(),
        bootstrapNewWorkspaceLayout(WS, 'agent-1', 'Initial agent', false, 1, [
          issueLink(7),
          forkLink,
        ]),
      ).byWorkspaceId[WS];
      const order = seeded.root.type === 'split' ? seeded.root.children : [];
      const browserPanelId = order[1]?.type === 'panel' ? order[1].panelId : '';

      expect(seeded.panels[browserPanelId].tabs.map((tab) => tab.title)).toEqual([
        'acme/widgets#7',
        'fork/widgets#7',
      ]);
    });
  });

  describe('context-link empty-restore seeding (seedContextLinkEmptyLayout)', () => {
    const issueLink = (number: number): ContextLink => ({
      kind: 'issue',
      url: `https://github.com/acme/widgets/issues/${number}`,
      owner: 'acme',
      repo: 'widgets',
      number,
    });

    it('seeds the agent-left / browser-right split into an empty workspace', () => {
      const seeded = panelLayoutReducer(
        stateWithPanel('p1'),
        seedContextLinkEmptyLayout(WS, [issueLink(7), issueLink(8)]),
      ).byWorkspaceId[WS];

      expect(seeded.root.type).toBe('split');
      const order = seeded.root.type === 'split' ? seeded.root.children : [];
      expect(order).toHaveLength(2);
      const agentPanelId = order[0]?.type === 'panel' ? order[0].panelId : '';
      const browserPanelId = order[1]?.type === 'panel' ? order[1].panelId : '';
      expect(seeded.panels[agentPanelId].tabs).toEqual([]);
      expect(seeded.panels[agentPanelId].pristine).toBe(true);
      expect(seeded.panels[browserPanelId].tabs).toEqual([
        expect.objectContaining({ type: 'browser', browserUrl: issueLink(7).url }),
        expect.objectContaining({ type: 'browser', browserUrl: issueLink(8).url }),
      ]);
      expect(seeded.focusedPanelId).toBe(agentPanelId);
      expect(seeded.columnCount).toBe(2);
      expect(seeded.columnCountInitialized).toBe(true);
      expect(seeded.canvasWidthSource).toBe('intrinsic');
      expect(seeded.canvasWidth).toBe(
        DEFAULT_CHAT_PANEL_WIDTH + DEFAULT_BROWSER_PANEL_WIDTH + PANEL_SPLIT_GUTTER_WIDTH,
      );
      expect(seeded.newWorkspaceLifecycle).toBeNull();
    });

    it('caps seeded browser tabs at the limit', () => {
      const links = Array.from({ length: MAX_SEEDED_CONTEXT_LINK_TABS + 2 }, (_, i) =>
        issueLink(i + 1),
      );
      const seeded = panelLayoutReducer(stateWithPanel('p1'), seedContextLinkEmptyLayout(WS, links))
        .byWorkspaceId[WS];
      const order = seeded.root.type === 'split' ? seeded.root.children : [];
      const browserPanelId = order[1]?.type === 'panel' ? order[1].panelId : '';

      expect(seeded.panels[browserPanelId].tabs).toHaveLength(MAX_SEEDED_CONTEXT_LINK_TABS);
    });

    it('leaves a layout with visible tabs untouched', () => {
      const state = stateWithPanel('p1', [{ id: 't1', type: 'note', title: 'Note' }]);
      const next = panelLayoutReducer(state, seedContextLinkEmptyLayout(WS, [issueLink(7)]));
      expect(next.byWorkspaceId[WS]).toBe(state.byWorkspaceId[WS]);
    });

    it('leaves a layout with hidden tabs untouched', () => {
      const state = stateWithPanel('p1');
      state.byWorkspaceId[WS] = {
        ...state.byWorkspaceId[WS],
        hiddenTabs: createCollection('id', [
          { id: 'hidden-1', type: 'browser', title: 'Hidden', closable: true },
        ]),
      };
      const next = panelLayoutReducer(state, seedContextLinkEmptyLayout(WS, [issueLink(7)]));
      expect(next.byWorkspaceId[WS]).toBe(state.byWorkspaceId[WS]);
    });

    it('leaves a fresh-create bootstrap lifecycle untouched', () => {
      const bootstrapped = panelLayoutReducer(
        emptyState(),
        bootstrapNewWorkspaceLayout(WS, null, 'Specialist', false, 1),
      );
      const next = panelLayoutReducer(bootstrapped, seedContextLinkEmptyLayout(WS, [issueLink(7)]));
      expect(next.byWorkspaceId[WS]).toBe(bootstrapped.byWorkspaceId[WS]);
    });

    it('is a no-op without context links', () => {
      const state = stateWithPanel('p1');
      const next = panelLayoutReducer(state, seedContextLinkEmptyLayout(WS, []));
      expect(next.byWorkspaceId[WS]).toBe(state.byWorkspaceId[WS]);
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

    // preserveFocus (agent-driven visible position:same opens): the tab is
    // activated in the target panel so it paints, but panel focus and focus
    // history stay put — the same contract as openTabInRightmostColumn.
    it('preserveFocus activates the new tab in the target panel without moving focus', () => {
      const state = stateWithPanel('p1', [{ id: 'note', type: 'note', title: 'Note' }]);
      state.byWorkspaceId[WS].panels.p2 = {
        id: 'p2',
        tabs: [{ id: 'other', type: 'file', title: 'Other', closable: true }],
        activeTabId: 'other',
      };
      const before = state.byWorkspaceId[WS];
      const result = panelLayoutReducer(
        state,
        openTab(
          WS,
          { type: 'browser', title: 'Browser', browserUrl: 'https://agent.test', closable: true },
          'p2',
          'browser',
          undefined,
          10,
          undefined,
          true,
        ),
      ).byWorkspaceId[WS];

      expect(result.panels.p2.tabs.map((tab) => tab.id)).toEqual(['other', 'browser']);
      expect(result.panels.p2.activeTabId).toBe('browser');
      expect(result.focusedPanelId).toBe('p1');
      expect(result.focusHistory).toEqual(before.focusHistory);
      expect(result.pendingFocusTabId).toBeNull();
      expect(result.pendingPanelReveal).toEqual({
        panelId: 'p2',
        tabId: 'browser',
        requestId: 'browser',
        preserveFocus: true,
      });
      expect(result.layoutHistory).toHaveLength(1);
      expect(result.layoutHistory[0].panels.p2).toMatchObject({ activeTabId: 'other' });
    });

    it('preserveFocus marks the reveal when the target is the focused panel', () => {
      const state = stateWithPanel('p1', [{ id: 'note', type: 'note', title: 'Note' }]);
      const result = panelLayoutReducer(
        state,
        openTab(
          WS,
          { type: 'browser', title: 'Browser', browserUrl: 'https://agent.test', closable: true },
          undefined,
          'browser',
          undefined,
          10,
          undefined,
          true,
        ),
      ).byWorkspaceId[WS];

      expect(result.panels.p1.activeTabId).toBe('browser');
      expect(result.focusedPanelId).toBe('p1');
      expect(result.pendingFocusTabId).toBeNull();
      expect(result.pendingPanelReveal).toEqual({
        panelId: 'p1',
        tabId: 'browser',
        requestId: 'browser',
        preserveFocus: true,
      });

      const userOpen = panelLayoutReducer(
        state,
        openTab(
          WS,
          { type: 'browser', title: 'Browser', browserUrl: 'https://user.test', closable: true },
          undefined,
          'user-browser',
          undefined,
          10,
        ),
      ).byWorkspaceId[WS];
      expect(userOpen.pendingPanelReveal?.preserveFocus).toBeUndefined();
    });

    it('preserveFocus activates an equivalent inactive tab in place without moving focus', () => {
      const state = stateWithPanel('p1', [{ id: 'note', type: 'note', title: 'Note' }]);
      state.byWorkspaceId[WS].panels.p2 = {
        id: 'p2',
        tabs: [
          { id: 'other', type: 'file', title: 'Other', closable: true },
          {
            id: 'existing-browser',
            type: 'browser',
            title: 'Browser',
            browserUrl: 'https://agent.test',
            closable: true,
          },
        ],
        activeTabId: 'other',
        attentionTabIds: ['existing-browser'],
      };
      const result = panelLayoutReducer(
        state,
        openTab(
          WS,
          { type: 'browser', title: 'Browser', browserUrl: 'https://agent.test', closable: true },
          'p2',
          'request-1',
          undefined,
          10,
          undefined,
          true,
        ),
      ).byWorkspaceId[WS];

      expect(result.panels.p2.tabs.map((tab) => tab.id)).toEqual(['other', 'existing-browser']);
      expect(result.panels.p2.activeTabId).toBe('existing-browser');
      expect(result.panels.p2.attentionTabIds).toEqual([]);
      expect(result.focusedPanelId).toBe('p1');
      expect(result.pendingPanelReveal).toEqual({
        panelId: 'p2',
        tabId: 'existing-browser',
        requestId: 'request-1',
        preserveFocus: true,
      });
    });

    it('preserveFocus leaves state untouched when the target panel does not exist', () => {
      const state = stateWithPanel('p1');
      const result = panelLayoutReducer(
        state,
        openTab(
          WS,
          { type: 'browser', title: 'Browser', browserUrl: 'https://agent.test', closable: true },
          'missing',
          'browser',
          undefined,
          10,
          undefined,
          true,
        ),
      );
      expect(result).toBe(state);
    });
  });

  describe('openTabInRightmostColumn', () => {
    function twoColumnState() {
      const state = stateWithPanel('left', [{ id: 'left-tab', type: 'note', title: 'Left' }]);
      state.byWorkspaceId[WS] = {
        ...state.byWorkspaceId[WS],
        root: {
          type: 'split',
          direction: 'horizontal',
          children: [
            { type: 'panel', panelId: 'left' },
            { type: 'panel', panelId: 'right' },
          ],
          sizes: [50, 50],
        },
        panels: {
          ...state.byWorkspaceId[WS].panels,
          right: {
            id: 'right',
            tabs: [{ id: 'old-right', type: 'file', title: 'Old right', closable: true }],
            activeTabId: 'old-right',
          },
        },
        focusedPanelId: 'left',
      };
      return state;
    }

    it('activates new content in the rightmost column and keeps displaced content in history', () => {
      const result = panelLayoutReducer(
        twoColumnState(),
        openTabInRightmostColumn(
          WS,
          {
            type: 'agent',
            title: 'Assigned agent',
            agentId: 'agent-1',
            workspaceId: WS,
            closable: true,
          },
          { newTabId: 'new-right' },
          10,
        ),
      ).byWorkspaceId[WS];

      expect(result.focusedPanelId).toBe('right');
      expect(result.panels.right.tabs.map((tab) => tab.id)).toEqual(['old-right', 'new-right']);
      expect(result.panels.right.activeTabId).toBe('new-right');
      expect(result.panels.left.tabs.map((tab) => tab.id)).toEqual(['left-tab']);
      expect(Object.keys(result.panels)).toEqual(['left', 'right']);
      expect(result.layoutHistory).toHaveLength(1);
      expect(result.layoutHistory[0].panels.right).toMatchObject({
        activeTabId: 'old-right',
        tabs: [expect.objectContaining({ id: 'old-right' })],
      });
    });

    it('activates an equivalent tab in place unless duplicates are explicitly allowed', () => {
      const state = twoColumnState();
      state.byWorkspaceId[WS].panels.left.tabs[0] = {
        id: 'left-tab',
        type: 'file',
        title: 'Left',
        filePath: 'src/left.ts',
        closable: true,
      };
      const tab = {
        type: 'file' as const,
        title: 'Left',
        filePath: 'src/left.ts',
        closable: true,
      };
      const activated = panelLayoutReducer(
        state,
        openTabInRightmostColumn(WS, tab, { newTabId: 'ignored' }, 10),
      ).byWorkspaceId[WS];
      const duplicated = panelLayoutReducer(
        state,
        openTabInRightmostColumn(WS, tab, { allowDuplicate: true, newTabId: 'duplicate' }, 20),
      ).byWorkspaceId[WS];

      expect(activated.focusedPanelId).toBe('left');
      expect(activated.panels.right.tabs.map((candidate) => candidate.id)).toEqual(['old-right']);
      expect(duplicated.panels.right.tabs.at(-1)?.id).toBe('duplicate');
    });

    // preserveFocus (agent-driven visible opens, monorepo#3045): the tab is
    // activated so it paints, but panel focus and focus history stay put.
    it('preserveFocus activates the new tab in the rightmost column without moving focus', () => {
      const before = twoColumnState().byWorkspaceId[WS];
      const result = panelLayoutReducer(
        twoColumnState(),
        openTabInRightmostColumn(
          WS,
          { type: 'browser', title: 'Browser', browserUrl: 'https://agent.test', closable: true },
          { newTabId: 'new-right', preserveFocus: true },
          10,
        ),
      ).byWorkspaceId[WS];

      expect(result.panels.right.tabs.map((tab) => tab.id)).toEqual(['old-right', 'new-right']);
      expect(result.panels.right.activeTabId).toBe('new-right');
      expect(result.panels.right.attentionTabIds ?? []).toEqual([]);
      expect(result.focusedPanelId).toBe('left');
      expect(result.focusHistory).toEqual(before.focusHistory);
      expect(result.pendingFocusTabId).toBeNull();
      expect(result.pendingPanelReveal).toEqual({
        panelId: 'right',
        tabId: 'new-right',
        requestId: 'new-right',
        preserveFocus: true,
      });
      expect(result.layoutHistory).toHaveLength(1);
      expect(result.layoutHistory[0].panels.right).toMatchObject({ activeTabId: 'old-right' });
    });

    // Single column: the rightmost panel already is the focused panel, so the
    // reveal must carry the no-focus intent for the layout/tab to honour.
    it('preserveFocus marks the reveal when the rightmost column is already focused', () => {
      const state = stateWithPanel('p1', [{ id: 'note', type: 'note', title: 'Note' }]);
      const result = panelLayoutReducer(
        state,
        openTabInRightmostColumn(
          WS,
          { type: 'browser', title: 'Browser', browserUrl: 'https://agent.test', closable: true },
          { newTabId: 'browser', preserveFocus: true },
          10,
        ),
      ).byWorkspaceId[WS];

      expect(result.panels.p1.activeTabId).toBe('browser');
      expect(result.focusedPanelId).toBe('p1');
      expect(result.pendingFocusTabId).toBeNull();
      expect(result.pendingPanelReveal).toEqual({
        panelId: 'p1',
        tabId: 'browser',
        requestId: 'browser',
        preserveFocus: true,
      });

      const userOpen = panelLayoutReducer(
        state,
        openTabInRightmostColumn(
          WS,
          { type: 'browser', title: 'Browser', browserUrl: 'https://user.test', closable: true },
          { newTabId: 'user-browser' },
          10,
        ),
      ).byWorkspaceId[WS];
      expect(userOpen.pendingPanelReveal?.preserveFocus).toBeUndefined();
    });

    it('preserveFocus activates an equivalent inactive tab in place without moving focus', () => {
      const state = twoColumnState();
      state.byWorkspaceId[WS].panels.right = {
        ...state.byWorkspaceId[WS].panels.right,
        tabs: [
          ...state.byWorkspaceId[WS].panels.right.tabs,
          {
            id: 'existing-browser',
            type: 'browser',
            title: 'Browser',
            browserUrl: 'https://agent.test',
            closable: true,
          },
        ],
        attentionTabIds: ['existing-browser'],
      };
      const result = panelLayoutReducer(
        state,
        openTabInRightmostColumn(
          WS,
          { type: 'browser', title: 'Browser', browserUrl: 'https://agent.test', closable: true },
          { newTabId: 'request-1', preserveFocus: true },
          10,
        ),
      ).byWorkspaceId[WS];

      expect(result.panels.right.tabs.map((tab) => tab.id)).toEqual([
        'old-right',
        'existing-browser',
      ]);
      expect(result.panels.right.activeTabId).toBe('existing-browser');
      expect(result.panels.right.attentionTabIds).toEqual([]);
      expect(result.focusedPanelId).toBe('left');
      expect(result.pendingPanelReveal).toEqual({
        panelId: 'right',
        tabId: 'existing-browser',
        requestId: 'request-1',
        preserveFocus: true,
      });
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

    it('creates a stack to the right of a populated sole column', () => {
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
      expect(result.byWorkspaceId[WS].root).toMatchObject({
        type: 'split',
        children: [{ panelId: 'p1' }, {}],
      });
      expect(result.byWorkspaceId[WS].columnCount).toBe(2);
      expect(panels.at(-1)?.tabs.at(-1)).toMatchObject({
        type: 'note',
        noteId: 'spec',
      });
      expect(result.byWorkspaceId[WS].pendingPanelReveal).toMatchObject({
        panelId: panels.at(-1)?.id,
        tabId: panels.at(-1)?.activeTabId,
      });
    });

    it('adds chat-width geometry when opening an adjacent chat', () => {
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
      expect(result.root).toMatchObject({ type: 'split', children: [{ panelId: 'p1' }, {}] });
      expect(Object.values(result.panels).at(-1)?.tabs.at(-1)).toMatchObject({
        type: 'agent',
        agentId: 'agent-1',
      });
    });

    it('preserves existing explicit column pixels when adding the side stack', () => {
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
      expect(result.root).toMatchObject({ type: 'split', children: [{ panelId: 'p1' }, {}] });
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

    it('inserts a new fixed column immediately right of a middle source', () => {
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
        columnCount: 2,
        columnCountInitialized: true,
      };

      const result = panelLayoutReducer(
        state,
        openTabInAdjacentOrSplit(
          WS,
          { type: 'note', title: 'Linked', noteId: 'linked', closable: true },
          'p1',
          { newPanelId: 'p-new', newTabId: 'linked-tab' },
          1234,
        ),
      );
      const panels = Object.values(result.byWorkspaceId[WS].panels);
      const root = result.byWorkspaceId[WS].root;

      expect(panels).toHaveLength(3);
      expect(root).toMatchObject({
        type: 'split',
        direction: 'horizontal',
        children: [{ panelId: 'p1' }, { panelId: 'p-new' }, { panelId: 'p2' }],
      });
      expect(result.byWorkspaceId[WS].columnCount).toBe(3);
      expect(result.byWorkspaceId[WS].panels.p2.tabs).toHaveLength(1);
      expect(result.byWorkspaceId[WS].panels['p-new'].tabs).toEqual([
        expect.objectContaining({ id: 'linked-tab', noteId: 'linked' }),
      ]);
    });

    it('reuses the rightmost fixed column when the source is already rightmost', () => {
      let state = stateWithPanel('p1', [{ id: 'source', type: 'note', title: 'Source' }]);
      state = panelLayoutReducer(state, setPanelColumnCount(WS, 2, 10));
      const workspace = state.byWorkspaceId[WS];
      const rightmostPanelId = getPanelOrder(workspace.root).at(-1)!;

      const result = panelLayoutReducer(
        state,
        openTabInAdjacentOrSplit(
          WS,
          { type: 'note', title: 'Linked', noteId: 'linked', closable: true },
          rightmostPanelId,
          undefined,
          20,
        ),
      ).byWorkspaceId[WS];

      expect(getPanelOrder(result.root)).toHaveLength(2);
      expect(result.columnCount).toBe(2);
      expect(result.panels[rightmostPanelId].tabs.at(-1)).toMatchObject({ noteId: 'linked' });
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

    it.skip('prepends a new root column when panels stack from the left', () => {
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

      const action = openTabInNewRootColumn(
        WS,
        agentTab,
        { force: true, panelStackDirection: 'left' },
        10,
      );
      const result = panelLayoutReducer(state, action).byWorkspaceId[WS];

      expect(result.root).toMatchObject({
        children: [{ panelId: action.payload.newPanelId }, { panelId: 'p1' }, { panelId: 'p2' }],
      });
      expect(result.focusedPanelId).toBe(action.payload.newPanelId);
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

    it.skip('replaces the reusable panel and preserves pinned panels in pin mode', () => {
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
        openTabInNewRootColumn(
          WS,
          agentTab,
          { force: true, panelOpenMode: 'pin', panelStackDirection: 'left' },
          10,
        ),
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

    it.skip('keeps the reusable panel on the right in pin mode when configured', () => {
      const state = emptyState();
      state.byWorkspaceId[WS] = {
        ...emptyWorkspaceState,
        root: {
          type: 'split',
          direction: 'horizontal',
          children: [
            { type: 'panel', panelId: 'reuse' },
            { type: 'panel', panelId: 'pinned' },
          ],
          sizes: [50, 50],
        },
        panels: {
          reuse: {
            id: 'reuse',
            tabs: [{ id: 'old', type: 'note', title: 'Old', closable: true } as any],
            activeTabId: 'old',
          },
          pinned: {
            id: 'pinned',
            tabs: [{ id: 'keep', type: 'note', title: 'Keep', closable: true } as any],
            activeTabId: 'keep',
            pinned: true,
          },
        },
        focusedPanelId: 'reuse',
      };

      const result = panelLayoutReducer(
        state,
        openTabInNewRootColumn(
          WS,
          agentTab,
          { force: true, panelOpenMode: 'pin', panelStackDirection: 'right' },
          10,
        ),
      ).byWorkspaceId[WS];

      expect(result.root).toMatchObject({
        children: [{ panelId: 'pinned' }, { panelId: 'reuse' }],
      });
      expect(result.panels.reuse.tabs).toEqual([
        expect.objectContaining({ type: 'agent', agentId: 'agent-1' }),
      ]);
    });
  });

  describe('openBlankWorkingPanel', () => {
    it('inserts a pristine blank column after the focused panel without clearing it', () => {
      const state = stateWithPanel('working');
      state.byWorkspaceId[WS].panels.working = {
        id: 'working',
        tabs: [{ id: 'protected', type: 'note', title: 'Protected', closable: false } as any],
        activeTabId: 'protected',
      };

      const action = openBlankWorkingPanel(WS, 10);
      const result = panelLayoutReducer(state, action).byWorkspaceId[WS];

      expect(getPanelOrder(result.root)).toEqual(['working', action.payload.newPanelId]);
      expect(result.panels.working.tabs.map((tab) => tab.id)).toEqual(['protected']);
      expect(result.panels[action.payload.newPanelId]).toMatchObject({
        tabs: [],
        activeTabId: null,
        pristine: true,
      });
      expect(result.focusedPanelId).toBe(action.payload.newPanelId);
      expect(result.pendingPanelReveal).toEqual({
        panelId: action.payload.newPanelId,
        tabId: null,
        requestId: action.payload.newPanelId,
      });
      expect(result.layoutHistory).toHaveLength(1);
      expect(result.recentlyClosed).toEqual([]);
    });

    it('does not reuse an existing pristine panel', () => {
      const state = stateWithPanel('working');
      state.byWorkspaceId[WS].panels.working.pristine = true;

      const action = openBlankWorkingPanel(WS, 10);
      const result = panelLayoutReducer(state, action).byWorkspaceId[WS];

      expect(getPanelOrder(result.root)).toEqual(['working', action.payload.newPanelId]);
      expect(result.panels.working.pristine).toBe(true);
      expect(result.panels[action.payload.newPanelId].pristine).toBe(true);
    });

    it('is a no-op without a focused panel', () => {
      const state = stateWithPanel('working');
      state.byWorkspaceId[WS].focusedPanelId = null;

      expect(panelLayoutReducer(state, openBlankWorkingPanel(WS, 10))).toBe(state);
    });

    it('is a no-op at the four-column cap', () => {
      const state = stateWithPanel('p1');
      const workspace = state.byWorkspaceId[WS];
      workspace.root = {
        type: 'split',
        direction: 'horizontal',
        children: ['p1', 'p2', 'p3', 'p4'].map((panelId) => ({
          type: 'panel' as const,
          panelId,
        })),
        sizes: [25, 25, 25, 25],
      };
      workspace.panels = Object.fromEntries(
        ['p1', 'p2', 'p3', 'p4'].map((id) => [id, { id, tabs: [], activeTabId: null }]),
      );
      workspace.focusedPanelId = 'p2';
      workspace.columnCount = 4;

      expect(panelLayoutReducer(state, openBlankWorkingPanel(WS, 10))).toBe(state);
    });
  });

  describe.skip('legacy reusable panel state', () => {
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
      const action = openBlankWorkingPanel(WS, 10, 'left');

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

      const result = panelLayoutReducer(state, setPanelPinned(WS, 'target', false, 10, 'left'))
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
          {
            panelOpenMode: 'pin',
            panelStackDirection: 'left',
            force: true,
            newTabId: 'next-tab',
          },
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

  describe('fixed column state', () => {
    it('starts a new workspace with one visible agent column', () => {
      const result = panelLayoutReducer(
        emptyState(),
        bootstrapNewWorkspaceLayout(WS, 'agent-1', 'Coordinator', true),
      ).byWorkspaceId[WS];

      expect(result.root.type).toBe('panel');
      expect(Object.values(result.panels)).toHaveLength(1);
      expect(Object.values(result.panels)[0].tabs).toEqual([
        expect.objectContaining({ type: 'agent', agentId: 'agent-1' }),
      ]);
    });

    it('adds pristine columns to the right when the count increases', () => {
      const state = stateWithPanel('p1', [{ id: 'one', type: 'note', title: 'One' }]);
      const action = reconcilePanelColumnCount(WS, 3, 10);

      const result = panelLayoutReducer(state, action).byWorkspaceId[WS];
      const order = result.root.type === 'split' ? result.root.children : [];

      expect(order).toMatchObject([
        { panelId: 'p1' },
        { panelId: action.payload.newPanelIds[0] },
        { panelId: action.payload.newPanelIds[1] },
      ]);
      expect(result.panels[action.payload.newPanelIds[0]]).toMatchObject({
        tabs: [],
        activeTabId: null,
        pristine: true,
      });
      expect(result.panels.p1.tabs).toEqual([expect.objectContaining({ id: 'one' })]);
    });

    it('keeps added structural columns automatically fitted to the live viewport', () => {
      let state = stateWithPanel('p1', [{ id: 'one', type: 'note', title: 'One' }]);
      state.byWorkspaceId[WS] = {
        ...state.byWorkspaceId[WS],
        canvasWidth: 1800,
        canvasWidthSource: 'explicit',
      };

      for (const [count, availableWidth] of [
        [2, 640],
        [3, 960],
        [4, 1200],
      ] as const) {
        const action = setPanelColumnCount(WS, count, count, availableWidth);
        state = panelLayoutReducer(state, action);
        const workspace = state.byWorkspaceId[WS];

        expect(workspace.root).toMatchObject({
          type: 'split',
          direction: 'horizontal',
          sizes: Array.from({ length: count }, () => 100 / count),
        });
        expect(Object.keys(workspace.panels)).toHaveLength(count);
        expect(workspace.focusedPanelId).toBe(action.payload.newPanelIds[0]);
        expect(workspace.canvasWidth).toBeNull();
        expect(workspace.canvasWidthSource).toBeNull();
      }
    });

    it('restores the explicit pre-fit width and automatic fitted geometry through history', () => {
      let state = stateWithPanel('p1', [{ id: 'one', type: 'note', title: 'One' }]);
      state.byWorkspaceId[WS] = {
        ...state.byWorkspaceId[WS],
        canvasWidth: 1800,
        canvasWidthSource: 'explicit',
      };
      const increase = setPanelColumnCount(WS, 2, 10, 640);
      state = panelLayoutReducer(state, increase);

      state = panelLayoutReducer(state, goBack(WS, 20));
      expect(state.byWorkspaceId[WS]).toMatchObject({
        root: { type: 'panel', panelId: 'p1' },
        focusedPanelId: 'p1',
        columnCount: 1,
        canvasWidth: 1800,
        canvasWidthSource: 'explicit',
      });

      state = panelLayoutReducer(state, goForward(WS));
      expect(state.byWorkspaceId[WS]).toMatchObject({
        root: { type: 'split', direction: 'horizontal', sizes: [50, 50] },
        focusedPanelId: increase.payload.newPanelIds[0],
        columnCount: 2,
        canvasWidth: null,
        canvasWidthSource: null,
      });
    });

    it('keeps the existing proportional decrease behavior after a fitted increase', () => {
      const state = emptyState();
      state.byWorkspaceId[WS] = {
        ...emptyWorkspaceState,
        root: {
          type: 'split',
          direction: 'horizontal',
          children: ['p1', 'p2', 'p3'].map((panelId) => ({
            type: 'panel' as const,
            panelId,
          })),
          sizes: [100 / 3, 100 / 3, 100 / 3],
        },
        panels: Object.fromEntries(
          ['p1', 'p2', 'p3'].map((panelId) => [
            panelId,
            { id: panelId, tabs: [], activeTabId: null, pristine: true },
          ]),
        ),
        focusedPanelId: 'p3',
        columnCount: 3,
        canvasWidth: 960,
        canvasWidthSource: 'explicit',
      };

      const workspace = panelLayoutReducer(state, setPanelColumnCount(WS, 2, 10, 500))
        .byWorkspaceId[WS];

      expect(workspace.root).toMatchObject({
        type: 'split',
        sizes: [50, 50],
        children: [{ panelId: 'p1' }, { panelId: 'p2' }],
      });
      expect(workspace.focusedPanelId).toBe('p2');
      expect(workspace.canvasWidth).toBeCloseTo(637.333333, 6);
    });

    it('sets a valid count only for the target workspace', () => {
      const state = stateWithPanel('p1', [{ id: 'one', type: 'note', title: 'One' }]);
      state.byWorkspaceId.other = {
        ...emptyWorkspaceState,
        root: { type: 'panel', panelId: 'other-panel' },
        panels: { 'other-panel': { id: 'other-panel', tabs: [], activeTabId: null } },
        focusedPanelId: 'other-panel',
      };

      const result = panelLayoutReducer(state, setPanelColumnCount(WS, 2, 10));

      expect(result.byWorkspaceId[WS].columnCount).toBe(2);
      expect(result.byWorkspaceId.other.columnCount).toBe(1);
      expect(panelLayoutReducer(result, setPanelColumnCount(WS, 5, 11))).toBe(result);
    });

    it('walks counts one through four and recovers removed content in surviving history', () => {
      let state = stateWithPanel('p1', [{ id: 'tab-1', type: 'note', title: 'One' }]);
      const panelIds = () => {
        const root = state.byWorkspaceId[WS].root;
        if (root.type === 'panel') return [root.panelId];
        return root.children.map((child) => {
          if (child.type !== 'panel') throw new Error('Expected flat fixed columns');
          return child.panelId;
        });
      };

      for (const count of [1, 2, 3, 4] as const) {
        state = panelLayoutReducer(state, reconcilePanelColumnCount(WS, count, count));
        expect(panelIds()).toHaveLength(count);
        if (count > 1) {
          state = panelLayoutReducer(
            state,
            openTab(
              WS,
              { type: 'note', title: `Note ${count}`, noteId: `note-${count}` },
              panelIds().at(-1),
              `tab-${count}`,
              true,
              count,
            ),
          );
        }
      }

      for (const count of [3, 2, 1] as const) {
        state = panelLayoutReducer(state, reconcilePanelColumnCount(WS, count, 10 + count));
        expect(panelIds()).toHaveLength(count);
      }
      expect(state.byWorkspaceId[WS].panels.p1.tabs.map((tab) => tab.id)).toEqual([
        'tab-1',
        'tab-2',
        'tab-3',
        'tab-4',
      ]);
      expect(state.byWorkspaceId[WS].panels.p1.activeTabId).toBe('tab-1');
    });

    it('merges removed right columns into the surviving rightmost history', () => {
      const state = emptyState();
      state.byWorkspaceId[WS] = {
        ...emptyWorkspaceState,
        root: {
          type: 'split',
          direction: 'horizontal',
          children: ['p1', 'p2', 'p3', 'p4'].map((panelId) => ({
            type: 'panel' as const,
            panelId,
          })),
          sizes: [25, 25, 25, 25],
        },
        panels: Object.fromEntries(
          ['p1', 'p2', 'p3', 'p4'].map((panelId, index) => [
            panelId,
            {
              id: panelId,
              tabs: [{ id: `tab-${index + 1}`, type: 'note' as const, title: panelId }],
              activeTabId: `tab-${index + 1}`,
              ...(panelId === 'p4' ? { pinned: true } : {}),
            },
          ]),
        ) as any,
        focusedPanelId: 'p4',
      };

      const result = panelLayoutReducer(state, reconcilePanelColumnCount(WS, 2, 10)).byWorkspaceId[
        WS
      ];

      expect(Object.keys(result.panels)).toEqual(['p1', 'p2']);
      expect(result.panels.p2.tabs.map((tab) => tab.id)).toEqual(['tab-2', 'tab-3', 'tab-4']);
      expect(result.panels.p2.activeTabId).toBe('tab-2');
      expect(result.focusedPanelId).toBe('p2');
      expect(result.panels.p2).not.toHaveProperty('pinned');
      expect(result.layoutHistory).toHaveLength(1);
    });

    it('flattens legacy split layouts to the selected fixed count', () => {
      const state = stateWithPanel('p1', [{ id: 'one', type: 'note', title: 'One' }]);
      state.byWorkspaceId[WS] = {
        ...state.byWorkspaceId[WS],
        root: {
          type: 'split',
          direction: 'vertical',
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
        columnCount: 2,
      };

      const result = panelLayoutReducer(state, reconcilePanelColumnCount(WS, 2, 10)).byWorkspaceId[
        WS
      ];

      expect(result.root).toMatchObject({
        type: 'split',
        direction: 'horizontal',
        children: [{ type: 'panel' }, { type: 'panel' }],
      });
    });
  });

  describe('splitPanel', () => {
    it('adds direct horizontal columns from one through four and keeps history synchronized', () => {
      let state = stateWithPanel('p1');
      for (const expectedCount of [2, 3, 4]) {
        const workspace = state.byWorkspaceId[WS];
        const targetPanelId = getPanelOrder(workspace.root).at(-1)!;
        state = panelLayoutReducer(
          state,
          splitPanel(WS, targetPanelId, 'horizontal', undefined, expectedCount),
        );
        expectFixedColumns(state.byWorkspaceId[WS], expectedCount);
        expect(state.byWorkspaceId[WS].layoutHistory.at(-1)?.columnCount).toBe(expectedCount - 1);
      }

      const beforeLimit = state;
      state = panelLayoutReducer(
        state,
        splitPanel(WS, getPanelOrder(state.byWorkspaceId[WS].root).at(-1)!, 'horizontal'),
      );
      expect(state).toBe(beforeLimit);

      state = panelLayoutReducer(state, goBack(WS, 10));
      expectFixedColumns(state.byWorkspaceId[WS], 3);
      state = panelLayoutReducer(state, goForward(WS));
      expectFixedColumns(state.byWorkspaceId[WS], 4);
    });

    it('rejects stale targets and vertical splits without recording history', () => {
      const state = stateWithPanel('p1');
      expect(panelLayoutReducer(state, splitPanel(WS, 'stale', 'horizontal'))).toBe(state);
      expect(panelLayoutReducer(state, splitPanel(WS, 'p1', 'vertical'))).toBe(state);
    });

    it('clamps grid creation to four direct horizontal columns', () => {
      const action = createGridLayout(WS, 8, 1);
      const result = panelLayoutReducer(stateWithPanel('p1'), action).byWorkspaceId[WS];

      expect(action.payload.panelCount).toBe(4);
      expectFixedColumns(result, 4);
    });

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
        columnCount: 2,
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
        columnCount: 2,
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

  describe('fixed-column tab split moves', () => {
    function twoColumnState() {
      let state = stateWithPanel('p1', [
        { id: 'move', type: 'note', title: 'Move' },
        { id: 'stay', type: 'note', title: 'Stay' },
      ]);
      state = panelLayoutReducer(state, splitPanel(WS, 'p1', 'horizontal', undefined, 1));
      return state;
    }

    it('moves one pane into another stack, activates it, and preserves the source stack', () => {
      const state = twoColumnState();
      const targetPanelId = getPanelOrder(state.byWorkspaceId[WS].root)[1];
      state.byWorkspaceId[WS].panels.p1.attentionTabIds = ['move', 'stay'];
      state.byWorkspaceId[WS].panels[targetPanelId] = {
        ...state.byWorkspaceId[WS].panels[targetPanelId],
        tabs: [{ id: 'target', type: 'note', title: 'Target' }],
        activeTabId: 'target',
      };

      const result = panelLayoutReducer(
        state,
        moveTabToPanel(WS, 'move', 'p1', targetPanelId, undefined, 2),
      ).byWorkspaceId[WS];

      expect(result.panels.p1.tabs.map((tab) => tab.id)).toEqual(['stay']);
      expect(result.panels.p1.activeTabId).toBe('stay');
      expect(result.panels.p1.attentionTabIds).toEqual(['stay']);
      expect(result.panels[targetPanelId].tabs.map((tab) => tab.id)).toEqual(['target', 'move']);
      expect(result.panels[targetPanelId].activeTabId).toBe('move');
      expect(result.focusedPanelId).toBe(targetPanelId);
    });

    it('removes the emptied source column after a stack move', () => {
      let state = stateWithPanel('p1', [{ id: 'move', type: 'note', title: 'Move' }]);
      state = panelLayoutReducer(state, splitPanel(WS, 'p1', 'horizontal', undefined, 1));
      const targetPanelId = getPanelOrder(state.byWorkspaceId[WS].root)[1];
      state.byWorkspaceId[WS].panels[targetPanelId] = {
        ...state.byWorkspaceId[WS].panels[targetPanelId],
        tabs: [{ id: 'target', type: 'note', title: 'Target' }],
        activeTabId: 'target',
        pristine: false,
      };

      const result = panelLayoutReducer(
        state,
        moveTabToPanel(WS, 'move', 'p1', targetPanelId, undefined, 2),
      ).byWorkspaceId[WS];

      expect(result.panels.p1).toBeUndefined();
      expect(getPanelOrder(result.root)).toEqual([targetPanelId]);
      expect(result.panels[targetPanelId].tabs.map((tab) => tab.id)).toEqual(['target', 'move']);
    });

    it('keeps a center drop on its source stack unchanged', () => {
      const state = twoColumnState();

      expect(panelLayoutReducer(state, moveTabToPanel(WS, 'move', 'p1', 'p1', undefined, 2))).toBe(
        state,
      );
      expect(state.byWorkspaceId[WS].panels.p1.tabs.map((tab) => tab.id)).toEqual(['move', 'stay']);
    });

    it('collapses an emptied source when another empty column remains', () => {
      let state = stateWithPanel('p1', [{ id: 'move', type: 'note', title: 'Move' }]);
      state = panelLayoutReducer(state, splitPanel(WS, 'p1', 'horizontal', undefined, 1));
      const targetPanelId = getPanelOrder(state.byWorkspaceId[WS].root)[1];
      state.byWorkspaceId[WS].panels[targetPanelId] = {
        ...state.byWorkspaceId[WS].panels[targetPanelId],
        tabs: [{ id: 'target', type: 'note', title: 'Target' }],
        activeTabId: 'target',
        pristine: false,
      };
      state = panelLayoutReducer(state, splitPanel(WS, targetPanelId, 'horizontal', undefined, 2));
      const emptyPanelId = getPanelOrder(state.byWorkspaceId[WS].root).at(-1)!;

      const result = panelLayoutReducer(
        state,
        moveTabToPanel(WS, 'move', 'p1', targetPanelId, undefined, 3),
      ).byWorkspaceId[WS];

      expect(result.panels.p1).toBeUndefined();
      expect(getPanelOrder(result.root)).toEqual([targetPanelId, emptyPanelId]);
      expect(result.panels[emptyPanelId].tabs).toEqual([]);
    });

    it('moves the source column after the target when it contains the final pane', () => {
      let state = stateWithPanel('p1', [{ id: 'move', type: 'note', title: 'Move' }]);
      state = panelLayoutReducer(state, splitPanel(WS, 'p1', 'horizontal', undefined, 1));
      const targetPanelId = getPanelOrder(state.byWorkspaceId[WS].root)[1];
      const action = moveTabToSplit(WS, 'move', 'p1', targetPanelId, 'right', 2);

      const result = panelLayoutReducer(state, action).byWorkspaceId[WS];

      expect(result.panels[action.payload.newPanelId]).toBeUndefined();
      expect(getPanelOrder(result.root)).toEqual([targetPanelId, 'p1']);
      expect(result.panels.p1.tabs.map((tab) => tab.id)).toEqual(['move']);
    });

    it.each([
      ['left', ['p1', 'new', 'target']],
      ['right', ['p1', 'target', 'new']],
    ] as const)('inserts a %s drop in direct column order', (zone, expectedOrder) => {
      const state = twoColumnState();
      const targetPanelId = getPanelOrder(state.byWorkspaceId[WS].root)[1];
      const action = moveTabToSplit(WS, 'move', 'p1', targetPanelId, zone, 2);
      const result = panelLayoutReducer(state, action).byWorkspaceId[WS];

      expectFixedColumns(result, 3);
      expect(getPanelOrder(result.root)).toEqual(
        expectedOrder.map((id) =>
          id === 'new' ? action.payload.newPanelId : id === 'target' ? targetPanelId : id,
        ),
      );
      expect(result.panels[action.payload.newPanelId].tabs.map((tab) => tab.id)).toEqual(['move']);
      expect(result.panels.p1.tabs.map((tab) => tab.id)).toEqual(['stay']);
    });

    it('keeps the source tab and history untouched for stale and vertical targets', () => {
      const state = twoColumnState();
      const targetPanelId = getPanelOrder(state.byWorkspaceId[WS].root)[1];

      expect(panelLayoutReducer(state, moveTabToSplit(WS, 'move', 'p1', 'stale', 'left'))).toBe(
        state,
      );
      expect(
        panelLayoutReducer(state, moveTabToSplit(WS, 'move', 'p1', targetPanelId, 'top')),
      ).toBe(state);
      expect(
        panelLayoutReducer(state, moveTabToSplitLevel(WS, 'move', 'p1', [], 'after', 'vertical')),
      ).toBe(state);
      expect(state.byWorkspaceId[WS].panels.p1.tabs.map((tab) => tab.id)).toEqual(['move', 'stay']);
    });

    it('routes horizontal split-level drops through fixed root insertion', () => {
      const state = twoColumnState();
      const action = moveTabToSplitLevel(WS, 'move', 'p1', [], 'after', 'horizontal', 2);
      const result = panelLayoutReducer(state, action).byWorkspaceId[WS];

      expectFixedColumns(result, 3);
      expect(getPanelOrder(result.root).at(-1)).toBe(action.payload.newPanelId);
    });

    it('does not create a fifth column', () => {
      let state = twoColumnState();
      for (let index = 0; index < 2; index++) {
        const targetPanelId = getPanelOrder(state.byWorkspaceId[WS].root).at(-1)!;
        state = panelLayoutReducer(
          state,
          splitPanel(WS, targetPanelId, 'horizontal', undefined, 2 + index),
        );
      }
      const targetPanelId = getPanelOrder(state.byWorkspaceId[WS].root).at(-1)!;

      const result = panelLayoutReducer(
        state,
        moveTabToSplit(WS, 'move', 'p1', targetPanelId, 'right', 5),
      );

      expect(result).toBe(state);
      expectFixedColumns(result.byWorkspaceId[WS], 4);
      expect(result.byWorkspaceId[WS].panels.p1.tabs.map((tab) => tab.id)).toEqual([
        'move',
        'stay',
      ]);

      const edgeResult = panelLayoutReducer(
        state,
        moveTabToSplitLevel(WS, 'move', 'p1', [], 'after', 'horizontal', 6),
      );
      expect(edgeResult).toBe(state);
      expectFixedColumns(edgeResult.byWorkspaceId[WS], 4);
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

    describe('closeFocusedPanelTab', () => {
      it.each([1, 2, 3, 4] as const)(
        'keeps a final content tab close structural in a %i-column layout',
        (columnCount) => {
          const panelIds = Array.from({ length: columnCount }, (_, index) => `p${index + 1}`);
          const focusedPanelId = panelIds[columnCount - 1];
          const state = emptyState();
          state.byWorkspaceId[WS] = {
            ...emptyWorkspaceState,
            root:
              columnCount === 1
                ? { type: 'panel', panelId: 'p1' }
                : {
                    type: 'split',
                    direction: 'horizontal',
                    children: panelIds.map((panelId) => ({ type: 'panel' as const, panelId })),
                    sizes: panelIds.map(
                      (_, index) => ((index + 1) / ((columnCount * (columnCount + 1)) / 2)) * 100,
                    ),
                  },
            panels: Object.fromEntries(
              panelIds.map((panelId, index) => [
                panelId,
                {
                  id: panelId,
                  tabs: [
                    {
                      id: `t${index + 1}`,
                      type: 'note' as const,
                      title: `Tab ${index + 1}`,
                      closable: true,
                    },
                  ],
                  activeTabId: `t${index + 1}`,
                },
              ]),
            ),
            focusedPanelId,
            columnCount,
            canvasWidth: 1600,
            canvasWidthSource: 'explicit',
          };
          const before = state.byWorkspaceId[WS];

          const result = panelLayoutReducer(state, closeFocusedPanelTab(WS, 2222));
          const workspace = result.byWorkspaceId[WS];

          expect(workspace.root).toEqual(before.root);
          expect(Object.keys(workspace.panels)).toEqual(panelIds);
          expect(workspace.columnCount).toBe(columnCount);
          expect(workspace.canvasWidth).toBe(1600);
          expect(workspace.canvasWidthSource).toBe('explicit');
          expect(workspace.focusedPanelId).toBe(focusedPanelId);
          expect(workspace.panels[focusedPanelId]).toMatchObject({
            tabs: [],
            activeTabId: null,
          });
          expect(workspace.recentlyClosed[0]).toMatchObject({
            tab: { id: `t${columnCount}` },
            panelId: `p${columnCount}`,
            closedAt: 2222,
          });
        },
      );

      it('uses the normal replacement tab in a multi-tab focused panel', () => {
        const state = stateWithPanel('p1', [
          { id: 't1', type: 'note', title: 'A' },
          { id: 't2', type: 'note', title: 'B' },
          { id: 't3', type: 'note', title: 'C' },
        ]);
        state.byWorkspaceId[WS].panels.p1.activeTabId = 't2';

        const result = panelLayoutReducer(state, closeFocusedPanelTab(WS, 2222));

        expect(result.byWorkspaceId[WS].panels.p1.tabs.map((tab) => tab.id)).toEqual(['t1', 't3']);
        expect(result.byWorkspaceId[WS].panels.p1.activeTabId).toBe('t3');
      });

      it('no-ops for empty and non-closable focused panels', () => {
        const empty = stateWithPanel('p1');
        expect(panelLayoutReducer(empty, closeFocusedPanelTab(WS, 2222))).toBe(empty);

        const locked = stateWithPanel('p1', [{ id: 't1', type: 'note', title: 'Locked' }]);
        locked.byWorkspaceId[WS].panels.p1.tabs[0].closable = false;
        expect(panelLayoutReducer(locked, closeFocusedPanelTab(WS, 2222))).toBe(locked);
      });

      it.each([
        { count: 2, focusedIndex: 0, width: 640, scenario: 'first at 200% zoom' },
        { count: 2, focusedIndex: 1, width: 1600, scenario: 'last at 100% zoom' },
        { count: 3, focusedIndex: 0, width: 960, scenario: 'first at 100% zoom' },
        { count: 3, focusedIndex: 1, width: 480, scenario: 'middle at 200% zoom' },
        { count: 3, focusedIndex: 2, width: 1600, scenario: 'last at 100% zoom' },
        { count: 4, focusedIndex: 0, width: 560, scenario: 'first at 200% zoom' },
        { count: 4, focusedIndex: 1, width: 1600, scenario: 'middle-left at 100% zoom' },
        { count: 4, focusedIndex: 2, width: 800, scenario: 'middle-right at 200% zoom' },
        { count: 4, focusedIndex: 3, width: 1920, scenario: 'last at 100% zoom' },
      ] as const)(
        'removes the $scenario empty column and fits $count columns to $width px',
        ({ count, focusedIndex, width }) => {
          const panelIds = Array.from({ length: count }, (_, index) => `p${index + 1}`);
          const focusedPanelId = panelIds[focusedIndex];
          const state = emptyState();
          state.byWorkspaceId[WS] = {
            ...emptyWorkspaceState,
            root: {
              type: 'split',
              direction: 'horizontal',
              children: panelIds.map((panelId) => ({ type: 'panel' as const, panelId })),
              sizes: panelIds.map((_, index) => index + 1),
            },
            panels: Object.fromEntries(
              panelIds.map((panelId) => [
                panelId,
                { id: panelId, tabs: [], activeTabId: null, pristine: true },
              ]),
            ),
            focusedPanelId,
            columnCount: count,
            canvasWidth: 2600,
            canvasWidthSource: 'explicit',
          };
          const rootBefore = structuredClone(state.byWorkspaceId[WS].root);

          const closedState = panelLayoutReducer(state, closeFocusedPanelTab(WS, 2222, width));
          const workspace = closedState.byWorkspaceId[WS];
          const remainingIds = panelIds.filter((panelId) => panelId !== focusedPanelId);
          const expectedFocus = remainingIds[Math.min(focusedIndex, remainingIds.length - 1)];

          expect(Object.keys(workspace.panels)).toEqual(remainingIds);
          expect(workspace.columnCount).toBe(count - 1);
          expect(workspace.focusedPanelId).toBe(expectedFocus);
          expect(workspace.canvasWidth).toBe(
            getAutomaticPanelCanvasWidth(count - 1, 'viewport', width),
          );
          expect(workspace.canvasWidth).toBeLessThanOrEqual(width);
          if (workspace.root.type === 'split') {
            expect(workspace.root.children).toEqual(
              remainingIds.map((panelId) => ({ type: 'panel', panelId })),
            );
            expect(workspace.root.sizes).toEqual(remainingIds.map(() => 100 / remainingIds.length));
          } else {
            expect(workspace.root).toEqual({ type: 'panel', panelId: remainingIds[0] });
          }

          const restored = panelLayoutReducer(
            closedState,
            reopenClosedPanelColumn(WS, 2223, `restore-${count}-${focusedIndex}`),
          ).byWorkspaceId[WS];
          expect(restored.root).toEqual(rootBefore);
          expect(Object.keys(restored.panels).sort()).toEqual([...panelIds].sort());
          expect(restored.panels[focusedPanelId]).toMatchObject({
            tabs: [],
            activeTabId: null,
            pristine: true,
          });
          expect(restored.columnCount).toBe(count);
          expect(restored.canvasWidth).toBe(2600);
          expect(restored.canvasWidthSource).toBe('explicit');
          expect(restored.focusedPanelId).toBe(focusedPanelId);
        },
      );

      it('closes content on the first press and removes the empty column on the second press', () => {
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
            sizes: [35, 65],
          },
          panels: {
            p1: { id: 'p1', tabs: [], activeTabId: null },
            p2: {
              id: 'p2',
              tabs: [{ id: 't2', type: 'note', title: 'Two', closable: true }],
              activeTabId: 't2',
            },
          },
          focusedPanelId: 'p2',
          columnCount: 2,
          canvasWidth: 1800,
          canvasWidthSource: 'explicit',
        };

        const afterFirst = panelLayoutReducer(state, closeFocusedPanelTab(WS, 1000, 900));
        expect(afterFirst.byWorkspaceId[WS]).toMatchObject({
          columnCount: 2,
          focusedPanelId: 'p2',
        });
        expect(afterFirst.byWorkspaceId[WS].panels.p2.tabs).toEqual([]);

        const afterSecond = panelLayoutReducer(afterFirst, closeFocusedPanelTab(WS, 1001, 900));
        const workspace = afterSecond.byWorkspaceId[WS];
        expect(workspace.root).toEqual({ type: 'panel', panelId: 'p1' });
        expect(workspace.columnCount).toBe(1);
        expect(workspace.focusedPanelId).toBe('p1');
        expect(workspace.recentlyClosed[0]).toMatchObject({ tab: { id: 't2' }, panelId: 'p2' });
        expect(
          getItems(
            workspace.recentlyClosedColumns ??
              createCollection<RecentlyClosedPanelColumn, 'historyId'>('historyId'),
          ),
        ).toHaveLength(1);
        expect(JSON.parse(JSON.stringify(workspace.recentlyClosedColumns))).toEqual(
          workspace.recentlyClosedColumns,
        );
        expect(workspace.layoutHistory.every((snapshot) => !snapshot.panels.p2)).toBe(true);

        const backed = panelLayoutReducer(afterSecond, goBack(WS, 1002)).byWorkspaceId[WS];
        expect(backed.columnCount).toBe(1);
        expect(backed.panels.p2).toBeUndefined();

        const columnReopened = panelLayoutReducer(
          afterSecond,
          reopenClosedPanelColumn(WS, 1003, 'column-restore'),
        ).byWorkspaceId[WS];
        expect(columnReopened.root).toEqual({
          type: 'split',
          direction: 'horizontal',
          children: [
            { type: 'panel', panelId: 'p1' },
            { type: 'panel', panelId: 'p2' },
          ],
          sizes: [35, 65],
        });
        expect(columnReopened).toMatchObject({
          columnCount: 2,
          canvasWidth: 1800,
          canvasWidthSource: 'explicit',
          focusedPanelId: 'p2',
          pendingPanelReveal: {
            panelId: 'p2',
            tabId: null,
            requestId: 'column-restore',
          },
        });
        expect(columnReopened.panels.p2).toMatchObject({ tabs: [], activeTabId: null });
        expect(columnReopened.recentlyClosed[0].panelId).toBe('p2');

        const tabReopened = panelLayoutReducer(
          { byWorkspaceId: { [WS]: columnReopened } },
          reopenClosedTab(WS, 1004),
        ).byWorkspaceId[WS];
        expect(tabReopened.panels.p2.tabs).toEqual([expect.objectContaining({ title: 'Two' })]);
        expect(tabReopened.recentlyClosed).toEqual([]);
      });

      it('uses the latest available width for each consecutive empty-column removal', () => {
        const state = emptyState();
        const panelIds = ['p1', 'p2', 'p3'];
        state.byWorkspaceId[WS] = {
          ...emptyWorkspaceState,
          root: {
            type: 'split',
            direction: 'horizontal',
            children: panelIds.map((panelId) => ({ type: 'panel' as const, panelId })),
            sizes: [20, 30, 50],
          },
          panels: Object.fromEntries(
            panelIds.map((panelId) => [panelId, { id: panelId, tabs: [], activeTabId: null }]),
          ),
          focusedPanelId: 'p3',
          columnCount: 3,
          canvasWidth: 2400,
          canvasWidthSource: 'explicit',
        };

        const afterWideRemoval = panelLayoutReducer(state, closeFocusedPanelTab(WS, 1000, 1600));
        expect(afterWideRemoval.byWorkspaceId[WS].canvasWidth).toBe(1600);

        const afterNarrowRemoval = panelLayoutReducer(
          afterWideRemoval,
          closeFocusedPanelTab(WS, 1001, 600),
        ).byWorkspaceId[WS];
        expect(afterNarrowRemoval).toMatchObject({
          root: { type: 'panel', panelId: 'p1' },
          focusedPanelId: 'p1',
          columnCount: 1,
          canvasWidth: 600,
        });
      });
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

  describe('updateTabBrowserUrl', () => {
    const REQUESTED = 'http://daemon.localhost:3000/';
    const TUNNELED = 'http://127.0.0.1:52345/';

    function browserState(browserRequestedUrl?: string, browserUrl = TUNNELED) {
      const state = stateWithPanel('p1', [{ id: 't1', type: 'browser', title: 'Browser' }]);
      const tab = state.byWorkspaceId[WS].panels.p1.tabs[0] as any;
      tab.browserUrl = browserUrl;
      if (browserRequestedUrl !== undefined) tab.browserRequestedUrl = browserRequestedUrl;
      return state;
    }

    it('records the requested URL when a string is passed (rewritten open)', () => {
      const result = panelLayoutReducer(
        browserState(),
        updateTabBrowserUrl(WS, 't1', TUNNELED, REQUESTED),
      );
      const tab = result.byWorkspaceId[WS].panels.p1.tabs[0];
      expect(tab.browserUrl).toBe(TUNNELED);
      expect(tab.browserRequestedUrl).toBe(REQUESTED);
    });

    it('clears the requested URL when null is passed (non-rewritten open)', () => {
      const result = panelLayoutReducer(
        browserState(REQUESTED),
        updateTabBrowserUrl(WS, 't1', 'https://example.com/', null),
      );
      const tab = result.byWorkspaceId[WS].panels.p1.tabs[0];
      expect(tab.browserUrl).toBe('https://example.com/');
      expect(tab.browserRequestedUrl).toBeUndefined();
    });

    it('rebases the requested URL for same-origin webview navigations (omitted arg)', () => {
      const result = panelLayoutReducer(
        browserState(REQUESTED),
        updateTabBrowserUrl(WS, 't1', 'http://127.0.0.1:52345/app?x=1'),
      );
      const tab = result.byWorkspaceId[WS].panels.p1.tabs[0];
      expect(tab.browserUrl).toBe('http://127.0.0.1:52345/app?x=1');
      expect(tab.browserRequestedUrl).toBe('http://daemon.localhost:3000/app?x=1');
    });

    it('drops the requested URL when a navigation leaves the origin (omitted arg)', () => {
      const result = panelLayoutReducer(
        browserState(REQUESTED),
        updateTabBrowserUrl(WS, 't1', 'https://example.com/'),
      );
      const tab = result.byWorkspaceId[WS].panels.p1.tabs[0];
      expect(tab.browserUrl).toBe('https://example.com/');
      expect(tab.browserRequestedUrl).toBeUndefined();
    });

    it('leaves tabs without a requested URL unchanged on navigation (legacy behavior)', () => {
      const result = panelLayoutReducer(
        browserState(undefined, 'http://127.0.0.1:3000/'),
        updateTabBrowserUrl(WS, 't1', 'http://127.0.0.1:3000/next'),
      );
      const tab = result.byWorkspaceId[WS].panels.p1.tabs[0];
      expect(tab.browserUrl).toBe('http://127.0.0.1:3000/next');
      expect(tab.browserRequestedUrl).toBeUndefined();
    });
  });

  describe('setTabOwnerAgent (monorepo#2857)', () => {
    function browserState() {
      return stateWithPanel('p1', [{ id: 't1', type: 'browser', title: 'Browser' }]);
    }

    it('records the owner and emulated size on a visible browser tab', () => {
      const result = panelLayoutReducer(
        browserState(),
        setTabOwnerAgent(WS, 't1', 'agent-1', { width: 390, height: 844 }),
      );
      const tab = result.byWorkspaceId[WS].panels.p1.tabs[0];
      expect(tab.ownerAgentId).toBe('agent-1');
      expect(tab.emulatedSize).toEqual({ width: 390, height: 844 });
      expect(tab.viewport).toEqual({ mode: 'custom', width: 390, height: 844 });
    });

    it('records an explicit fit viewport atomically and no-ops when unchanged', () => {
      const action = setTabOwnerAgent(
        WS,
        't1',
        'agent-1',
        { width: 1280, height: 800 },
        undefined,
        { mode: 'fit' },
      );
      const result = panelLayoutReducer(browserState(), action);
      expect(result.byWorkspaceId[WS].panels.p1.tabs[0]).toMatchObject({
        ownerAgentId: 'agent-1',
        emulatedSize: { width: 1280, height: 800 },
        viewport: { mode: 'fit' },
      });
      expect(panelLayoutReducer(result, action)).toBe(result);
    });

    it('updates the emulated size on a resize (same owner, new size)', () => {
      const claimed = panelLayoutReducer(
        browserState(),
        setTabOwnerAgent(WS, 't1', 'agent-1', { width: 1280, height: 800 }),
      );
      const result = panelLayoutReducer(
        claimed,
        setTabOwnerAgent(WS, 't1', 'agent-1', { width: 390, height: 844 }),
      );
      expect(result.byWorkspaceId[WS].panels.p1.tabs[0].emulatedSize).toEqual({
        width: 390,
        height: 844,
      });
    });

    it('preserves a previously recorded size when the action omits it', () => {
      const claimed = panelLayoutReducer(
        browserState(),
        setTabOwnerAgent(WS, 't1', 'agent-1', { width: 1024, height: 768 }),
      );
      const result = panelLayoutReducer(claimed, setTabOwnerAgent(WS, 't1', 'agent-1'));
      expect(result).toBe(claimed); // no-op: same owner, size untouched
      expect(result.byWorkspaceId[WS].panels.p1.tabs[0].emulatedSize).toEqual({
        width: 1024,
        height: 768,
      });
    });

    it('is a no-op when both owner and size are unchanged', () => {
      const claimed = panelLayoutReducer(
        browserState(),
        setTabOwnerAgent(WS, 't1', 'agent-1', { width: 1280, height: 800 }),
      );
      const result = panelLayoutReducer(
        claimed,
        setTabOwnerAgent(WS, 't1', 'agent-1', { width: 1280, height: 800 }),
      );
      expect(result).toBe(claimed);
    });

    it('records the owner and size on a hidden (user-closed) owned tab', () => {
      const state = stateWithPanel('p1', [
        { id: 'owned', type: 'browser', title: 'B' },
        { id: 't2', type: 'note', title: 'A' },
      ]);
      (state.byWorkspaceId[WS].panels.p1.tabs[0] as any).ownerAgentId = 'agent-1';
      const hidden = panelLayoutReducer(state, closeTab(WS, 'owned', 'p1', 1000));
      expect(getItems(hidden.byWorkspaceId[WS].hiddenTabs).map((t) => t.id)).toEqual(['owned']);

      const result = panelLayoutReducer(
        hidden,
        setTabOwnerAgent(WS, 'owned', 'agent-1', { width: 390, height: 844 }),
      );
      const hiddenTab = getItems(result.byWorkspaceId[WS].hiddenTabs)[0];
      expect(hiddenTab.ownerAgentId).toBe('agent-1');
      expect(hiddenTab.emulatedSize).toEqual({ width: 390, height: 844 });
    });
  });

  describe('updateTabViewport', () => {
    it('persists a preset on a visible browser tab', () => {
      const state = stateWithPanel('p1', [{ id: 'b1', type: 'browser', title: 'Browser' }]);
      const viewport = {
        mode: 'preset' as const,
        presetId: 'iphone-se',
        width: 375,
        height: 667,
      };

      const result = panelLayoutReducer(state, updateTabViewport(WS, 'b1', viewport));

      expect(result.byWorkspaceId[WS].panels.p1.tabs[0].viewport).toEqual(viewport);
    });

    it('persists a custom viewport on a hidden browser tab', () => {
      const state = stateWithPanel('p1', [
        { id: 'b1', type: 'browser', title: 'Browser', ownerAgentId: 'agent-1' },
        { id: 'n1', type: 'note', title: 'Note' },
      ]);
      const hidden = panelLayoutReducer(state, closeTab(WS, 'b1', 'p1', 1000));

      const result = panelLayoutReducer(
        hidden,
        updateTabViewport(WS, 'b1', { mode: 'custom', width: 900, height: 700 }),
      );

      expect(getItems(result.byWorkspaceId[WS].hiddenTabs)[0].viewport).toEqual({
        mode: 'custom',
        width: 900,
        height: 700,
      });
    });

    it('ignores non-browser and unknown tabs', () => {
      const state = stateWithPanel('p1', [{ id: 'n1', type: 'note', title: 'Note' }]);
      expect(panelLayoutReducer(state, updateTabViewport(WS, 'n1', { mode: 'fit' }))).toBe(state);
      expect(panelLayoutReducer(state, updateTabViewport(WS, 'missing', { mode: 'fit' }))).toBe(
        state,
      );
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

    // A reopen is a fresh, unowned tab: a stale ownerAgentId in a
    // recentlyClosed entry would resurrect ownership in main's registry, and
    // the persisted owner name (monorepo#3438) goes with it.
    it('strips a stale ownerAgentId and ownerAgentName from the reopened tab', () => {
      const state = stateWithPanel('p1', [
        { id: 't1', type: 'browser', title: 'B', browserUrl: 'http://a/' },
        { id: 't2', type: 'note', title: 'A' },
      ]);
      const afterClose = panelLayoutReducer(state, closeTab(WS, 't1', 'p1', 1000));
      const entry = afterClose.byWorkspaceId[WS].recentlyClosed[0];
      (entry.tab as any).ownerAgentId = 'agent-1';
      (entry.tab as any).ownerAgentName = 'Alice';

      const afterReopen = panelLayoutReducer(afterClose, reopenClosedTab(WS, 1001));
      const reopened = afterReopen.byWorkspaceId[WS].panels.p1.tabs.at(-1);
      expect(reopened).toMatchObject({ type: 'browser', title: 'B' });
      expect(reopened).not.toHaveProperty('ownerAgentId');
      expect(reopened).not.toHaveProperty('ownerAgentName');
    });

    it('cannot reopen an agent-owned browser tab — a user close hides it instead (monorepo#2857)', () => {
      const state = stateWithPanel('p1', [
        { id: 't1', type: 'browser', title: 'B', browserUrl: 'http://a/', ownerAgentId: 'agent-1' },
        { id: 't2', type: 'note', title: 'A' },
      ]);
      const afterClose = panelLayoutReducer(state, closeTab(WS, 't1', 'p1', 1000));
      // The owned tab is hidden (kept alive), never in recentlyClosed.
      expect(afterClose.byWorkspaceId[WS].recentlyClosed).toHaveLength(0);
      expect(getItems(afterClose.byWorkspaceId[WS].hiddenTabs).map((t) => t.id)).toEqual(['t1']);

      const afterReopen = panelLayoutReducer(afterClose, reopenClosedTab(WS, 1001));
      expect(afterReopen.byWorkspaceId[WS].panels.p1.tabs.map((t) => t.id)).toEqual(['t2']);
    });
  });

  // Owned-tab lifecycle (monorepo#2857): user close hides, destroy removes,
  // agent deletion destroys visible + hidden owned tabs.
  describe('owned-tab lifecycle', () => {
    const ownedTab = {
      id: 'owned',
      type: 'browser',
      title: 'Owned',
      browserUrl: 'http://a/',
      ownerAgentId: 'agent-1',
    };

    it('hides an owned browser tab on user close and keeps it out of recentlyClosed', () => {
      const state = stateWithPanel('p1', [ownedTab, { id: 't2', type: 'note', title: 'A' }]);
      const result = panelLayoutReducer(state, closeTab(WS, 'owned', 'p1', 1000));
      const ws = result.byWorkspaceId[WS];
      expect(ws.panels.p1.tabs.map((t) => t.id)).toEqual(['t2']);
      expect(getItems(ws.hiddenTabs).map((t) => t.id)).toEqual(['owned']);
      expect(ws.recentlyClosed).toHaveLength(0);
    });

    it('destroys an owned visible tab when closeTab carries destroy=true', () => {
      const state = stateWithPanel('p1', [ownedTab, { id: 't2', type: 'note', title: 'A' }]);
      const result = panelLayoutReducer(state, closeTab(WS, 'owned', 'p1', 1000, true));
      const ws = result.byWorkspaceId[WS];
      expect(ws.panels.p1.tabs.map((t) => t.id)).toEqual(['t2']);
      expect(getItems(ws.hiddenTabs)).toHaveLength(0);
      expect(ws.recentlyClosed).toHaveLength(0);
    });

    it('destroys an already-hidden tab when closeTab carries destroy=true', () => {
      const state = stateWithPanel('p1', [ownedTab, { id: 't2', type: 'note', title: 'A' }]);
      const hidden = panelLayoutReducer(state, closeTab(WS, 'owned', 'p1', 1000));
      const result = panelLayoutReducer(hidden, closeTab(WS, 'owned', undefined, 1001, true));
      expect(getItems(result.byWorkspaceId[WS].hiddenTabs)).toHaveLength(0);
    });

    it('unowned browser tabs still genuinely close into recentlyClosed', () => {
      const state = stateWithPanel('p1', [
        { id: 'plain', type: 'browser', title: 'B', browserUrl: 'http://b/' },
        { id: 't2', type: 'note', title: 'A' },
      ]);
      const result = panelLayoutReducer(state, closeTab(WS, 'plain', 'p1', 1000));
      const ws = result.byWorkspaceId[WS];
      expect(getItems(ws.hiddenTabs)).toHaveLength(0);
      expect(ws.recentlyClosed.map((e) => e.tab.id)).toEqual(['plain']);
    });

    it('restores owned browser tabs with their original ID and removes them from hidden state', () => {
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
            tabs: [{ ...ownedTab, closable: true }],
            activeTabId: 'owned',
          },
          p2: { id: 'p2', tabs: [], activeTabId: null },
        },
        focusedPanelId: 'p1',
        columnCount: 2,
      };

      const closed = panelLayoutReducer(state, closePanel(WS, 'p1', 1500));
      expect(getItems(closed.byWorkspaceId[WS].hiddenTabs).map((tab) => tab.id)).toEqual(['owned']);
      const restored = panelLayoutReducer(
        closed,
        reopenClosedPanelColumn(WS, 1501, 'restore-owned'),
      ).byWorkspaceId[WS];

      expect(restored.panels.p1.tabs).toEqual([expect.objectContaining(ownedTab)]);
      expect(getItems(restored.hiddenTabs)).toEqual([]);
      expect(restored.recentlyClosed).toEqual([]);
    });

    it('destroyTabsByOwnerAgent removes visible and hidden tabs of that agent only', () => {
      const state = stateWithPanel('p1', [
        ownedTab,
        {
          id: 'other',
          type: 'browser',
          title: 'Other',
          browserUrl: 'http://o/',
          ownerAgentId: 'agent-2',
        },
        { id: 't2', type: 'note', title: 'A' },
      ]);
      const withHidden = panelLayoutReducer(state, closeTab(WS, 'owned', 'p1', 1000));
      expect(getItems(withHidden.byWorkspaceId[WS].hiddenTabs)).toHaveLength(1);

      const result = panelLayoutReducer(withHidden, destroyTabsByOwnerAgent(WS, 'agent-1', 1001));
      const ws = result.byWorkspaceId[WS];
      expect(getItems(ws.hiddenTabs)).toHaveLength(0);
      expect(ws.panels.p1.tabs.map((t) => t.id)).toEqual(['other', 't2']);
      expect(ws.recentlyClosed).toHaveLength(0);

      const afterOther = panelLayoutReducer(result, destroyTabsByOwnerAgent(WS, 'agent-2', 1002));
      expect(afterOther.byWorkspaceId[WS].panels.p1.tabs.map((t) => t.id)).toEqual(['t2']);
    });

    it('destroyOwnedTabsForWorkspace removes all owned tabs (visible + hidden) but keeps unowned', () => {
      const state = stateWithPanel('p1', [
        ownedTab,
        {
          id: 'other',
          type: 'browser',
          title: 'Other',
          browserUrl: 'http://o/',
          ownerAgentId: 'agent-2',
        },
        { id: 'plain', type: 'browser', title: 'B', browserUrl: 'http://b/' },
        { id: 't2', type: 'note', title: 'A' },
      ]);
      const withHidden = panelLayoutReducer(state, closeTab(WS, 'owned', 'p1', 1000));
      expect(getItems(withHidden.byWorkspaceId[WS].hiddenTabs)).toHaveLength(1);

      const result = panelLayoutReducer(withHidden, destroyOwnedTabsForWorkspace(WS, 1001));
      const ws = result.byWorkspaceId[WS];
      expect(getItems(ws.hiddenTabs)).toHaveLength(0);
      expect(ws.panels.p1.tabs.map((t) => t.id)).toEqual(['plain', 't2']);
    });

    it('workspaceDeleted drops the entire layout entry, including hidden owned tabs', () => {
      const state = stateWithPanel('p1', [ownedTab, { id: 't2', type: 'note', title: 'A' }]);
      const withHidden = panelLayoutReducer(state, closeTab(WS, 'owned', 'p1', 1000));
      expect(getItems(withHidden.byWorkspaceId[WS].hiddenTabs)).toHaveLength(1);

      const result = panelLayoutReducer(withHidden, workspaceDeleted(WS, []));
      expect(result.byWorkspaceId[WS]).toBeUndefined();
    });

    it('restoreHiddenTab moves the tab back into the focused panel and activates it', () => {
      const state = stateWithPanel('p1', [ownedTab, { id: 't2', type: 'note', title: 'A' }]);
      const hidden = panelLayoutReducer(state, closeTab(WS, 'owned', 'p1', 1000));
      const result = panelLayoutReducer(hidden, restoreHiddenTab(WS, 'owned', 1001));
      const ws = result.byWorkspaceId[WS];
      expect(getItems(ws.hiddenTabs)).toHaveLength(0);
      expect(ws.panels.p1.tabs.map((t) => t.id)).toEqual(['t2', 'owned']);
      expect(ws.panels.p1.activeTabId).toBe('owned');
      expect(ws.panels.p1.tabs.at(-1)?.ownerAgentId).toBe('agent-1');
    });

    // showTab without focus displays the pane (activates it in its column)
    // via a focus-preserving reveal, never moving panel focus (monorepo#3045).
    it('restoreHiddenTab with focus: false activates in the sole fixed column without moving focus', () => {
      const state = stateWithPanel('p1', [ownedTab, { id: 't2', type: 'note', title: 'A' }]);
      const hidden = panelLayoutReducer(state, closeTab(WS, 'owned', 'p1', 1000));
      const before = hidden.byWorkspaceId[WS];
      const result = panelLayoutReducer(hidden, restoreHiddenTab(WS, 'owned', 1001, false));
      const ws = result.byWorkspaceId[WS];
      expect(getItems(ws.hiddenTabs)).toHaveLength(0);
      expect(Object.keys(ws.panels)).toEqual(['p1']);
      expect(ws.panels.p1.tabs.map((t) => t.id)).toEqual(['t2', 'owned']);
      expect(ws.panels.p1.activeTabId).toBe('owned');
      expect(ws.panels.p1.attentionTabIds ?? []).toEqual([]);
      expect(ws.focusedPanelId).toBe(before.focusedPanelId);
      expect(ws.pendingPanelReveal).toEqual({
        panelId: 'p1',
        tabId: 'owned',
        requestId: 'owned',
        preserveFocus: true,
      });
      expect(ws.focusHistory).toBe(before.focusHistory);
    });

    it('restoreHiddenTab with focus: false activates in another fixed column without moving focus', () => {
      const state = stateWithPanel('p1', [ownedTab, { id: 't2', type: 'note', title: 'A' }]);
      state.byWorkspaceId[WS].root = {
        type: 'split',
        direction: 'horizontal',
        children: [
          { type: 'panel', panelId: 'p1' },
          { type: 'panel', panelId: 'p2' },
        ],
        sizes: [50, 50],
      };
      state.byWorkspaceId[WS].panels.p2 = {
        id: 'p2',
        tabs: [{ id: 'n2', type: 'note', title: 'B', closable: true } as any],
        activeTabId: 'n2',
      };
      const hidden = panelLayoutReducer(state, closeTab(WS, 'owned', 'p1', 1000));
      const before = hidden.byWorkspaceId[WS];
      const result = panelLayoutReducer(hidden, restoreHiddenTab(WS, 'owned', 1001, false));
      const ws = result.byWorkspaceId[WS];
      expect(getItems(ws.hiddenTabs)).toHaveLength(0);
      expect(ws.panels.p1.tabs.map((t) => t.id)).toEqual(['t2']);
      expect(ws.panels.p1.activeTabId).toBe(before.panels.p1.activeTabId);
      expect(ws.panels.p2.tabs.map((t) => t.id)).toEqual(['n2', 'owned']);
      expect(ws.panels.p2.activeTabId).toBe('owned');
      expect(ws.panels.p2.attentionTabIds ?? []).toEqual([]);
      expect(ws.focusedPanelId).toBe(before.focusedPanelId);
      expect(ws.pendingPanelReveal).toEqual({
        panelId: 'p2',
        tabId: 'owned',
        requestId: 'owned',
        preserveFocus: true,
      });
      expect(ws.focusHistory).toBe(before.focusHistory);
    });

    // showTab without focus on a tab already in a panel but not its active
    // tab: activate it in place via a focus-preserving reveal (monorepo#3045).
    it('activateVisibleTab activates an inactive tab in its panel without moving focus', () => {
      const state = stateWithPanel('p1', [ownedTab, { id: 't2', type: 'note', title: 'A' }]);
      state.byWorkspaceId[WS].root = {
        type: 'split',
        direction: 'horizontal',
        children: [
          { type: 'panel', panelId: 'p1' },
          { type: 'panel', panelId: 'p2' },
        ],
        sizes: [50, 50],
      };
      state.byWorkspaceId[WS].panels.p2 = {
        id: 'p2',
        tabs: [
          { id: 'n2', type: 'note', title: 'B', closable: true } as any,
          { id: 'b2', type: 'browser', title: 'Browser', browserUrl: 'http://b2/' } as any,
        ],
        activeTabId: 'n2',
        attentionTabIds: ['b2'],
      };
      state.byWorkspaceId[WS].focusedPanelId = 'p1';
      const before = state.byWorkspaceId[WS];
      const result = panelLayoutReducer(state, activateVisibleTab(WS, 'b2', 1001));
      const ws = result.byWorkspaceId[WS];
      expect(ws.panels.p2.activeTabId).toBe('b2');
      expect(ws.panels.p2.attentionTabIds).toEqual([]);
      expect(ws.panels.p1.activeTabId).toBe(before.panels.p1.activeTabId);
      expect(ws.focusedPanelId).toBe('p1');
      expect(ws.focusHistory).toBe(before.focusHistory);
      expect(ws.pendingPanelReveal).toEqual({
        panelId: 'p2',
        tabId: 'b2',
        requestId: 'b2',
        preserveFocus: true,
      });
    });

    it('activateVisibleTab is a no-op for an already-active tab or a tab not in any panel', () => {
      const state = stateWithPanel('p1', [ownedTab, { id: 't2', type: 'note', title: 'A' }]);
      state.byWorkspaceId[WS].panels.p1.activeTabId = 'owned';
      expect(panelLayoutReducer(state, activateVisibleTab(WS, 'owned', 1001))).toBe(state);
      expect(panelLayoutReducer(state, activateVisibleTab(WS, 'missing', 1001))).toBe(state);

      const hidden = panelLayoutReducer(state, closeTab(WS, 'owned', 'p1', 1000));
      expect(panelLayoutReducer(hidden, activateVisibleTab(WS, 'owned', 1001))).toBe(hidden);
    });

    // Agent openTab is hidden by default (monorepo#3045): the tab is created
    // straight into hiddenTabs with no panel/focus/active-tab change.
    it('openHiddenTab creates the tab in hiddenTabs without touching panels or focus', () => {
      const state = stateWithPanel('p1', [{ id: 't2', type: 'note', title: 'A' }]);
      const before = state.byWorkspaceId[WS];
      const result = panelLayoutReducer(
        state,
        openHiddenTab(
          WS,
          {
            type: 'browser',
            title: 'Browser',
            browserUrl: 'http://a/',
            closable: true,
            ownerAgentId: 'agent-1',
            emulatedSize: { width: 390, height: 844 },
          },
          'tab-hidden-1',
        ),
      );
      const ws = result.byWorkspaceId[WS];
      expect(getItems(ws.hiddenTabs).map((t) => t.id)).toEqual(['tab-hidden-1']);
      expect(getItems(ws.hiddenTabs)[0]).toMatchObject({
        ownerAgentId: 'agent-1',
        emulatedSize: { width: 390, height: 844 },
        browserUrl: 'http://a/',
      });
      expect(ws.panels).toBe(before.panels);
      expect(ws.focusedPanelId).toBe(before.focusedPanelId);
      expect(ws.panels.p1.activeTabId).toBe(before.panels.p1.activeTabId);
      expect(ws.pendingPanelReveal).toBeNull();
      expect(ws.layoutHistory).toBe(before.layoutHistory);
    });

    it('openHiddenTab generates an id when none is provided', () => {
      const state = stateWithPanel('p1', []);
      const result = panelLayoutReducer(
        state,
        openHiddenTab(WS, {
          type: 'browser',
          title: 'Browser',
          browserUrl: 'http://a/',
          closable: true,
          ownerAgentId: 'agent-1',
        }),
      );
      const items = getItems(result.byWorkspaceId[WS].hiddenTabs);
      expect(items).toHaveLength(1);
      expect(items[0].id).toMatch(/^tab-/);
    });

    it('openHiddenTab is a no-op when the id already exists (hidden or visible)', () => {
      const state = stateWithPanel('p1', [ownedTab, { id: 't2', type: 'note', title: 'A' }]);
      const hidden = panelLayoutReducer(state, closeTab(WS, 'owned', 'p1', 1000));
      const tab = {
        type: 'browser' as const,
        title: 'Browser',
        browserUrl: 'http://other/',
        closable: true,
        ownerAgentId: 'agent-1',
      };
      // Already hidden under the same id: the live tab must not be replaced.
      const dupHidden = panelLayoutReducer(hidden, openHiddenTab(WS, tab, 'owned'));
      expect(dupHidden).toBe(hidden);
      // Visible in a panel under the same id: also untouched.
      const dupVisible = panelLayoutReducer(state, openHiddenTab(WS, tab, 't2'));
      expect(dupVisible).toBe(state);
    });

    it('a hidden-created tab restores into a panel via restoreHiddenTab', () => {
      const state = stateWithPanel('p1', [{ id: 't2', type: 'note', title: 'A' }]);
      const withHidden = panelLayoutReducer(
        state,
        openHiddenTab(
          WS,
          {
            type: 'browser',
            title: 'Browser',
            browserUrl: 'http://a/',
            closable: true,
            ownerAgentId: 'agent-1',
          },
          'tab-hidden-1',
        ),
      );
      const result = panelLayoutReducer(withHidden, restoreHiddenTab(WS, 'tab-hidden-1', 1001));
      const ws = result.byWorkspaceId[WS];
      expect(getItems(ws.hiddenTabs)).toHaveLength(0);
      expect(ws.panels.p1.tabs.map((t) => t.id)).toEqual(['t2', 'tab-hidden-1']);
      expect(ws.panels.p1.activeTabId).toBe('tab-hidden-1');
    });

    it('destroyTabsByOwnerAgent removes hidden-created tabs of that agent', () => {
      const state = stateWithPanel('p1', [{ id: 't2', type: 'note', title: 'A' }]);
      const withHidden = panelLayoutReducer(
        state,
        openHiddenTab(
          WS,
          {
            type: 'browser',
            title: 'Browser',
            browserUrl: 'http://a/',
            closable: true,
            ownerAgentId: 'agent-1',
          },
          'tab-hidden-1',
        ),
      );
      const result = panelLayoutReducer(withHidden, destroyTabsByOwnerAgent(WS, 'agent-1', 1001));
      expect(getItems(result.byWorkspaceId[WS].hiddenTabs)).toHaveLength(0);
    });

    it('hides owned tabs when their panel is closed (others genuinely close)', () => {
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
          p1: {
            id: 'p1',
            tabs: [
              { ...ownedTab, closable: true } as any,
              { id: 'plain', type: 'note', title: 'N', closable: true } as any,
            ],
            activeTabId: 'owned',
          },
          p2: {
            id: 'p2',
            tabs: [{ id: 'keep', type: 'note', title: 'K', closable: true } as any],
            activeTabId: 'keep',
          },
        },
        focusedPanelId: 'p1',
      };
      const result = panelLayoutReducer(state, closePanel(WS, 'p1', 1000));
      const ws = result.byWorkspaceId[WS];
      expect(getItems(ws.hiddenTabs).map((t) => t.id)).toEqual(['owned']);
      expect(ws.recentlyClosed.map((e) => e.tab.id)).toEqual(['plain']);
    });

    it('updates title, URL, and favicon of hidden tabs', () => {
      const state = stateWithPanel('p1', [ownedTab, { id: 't2', type: 'note', title: 'A' }]);
      const hidden = panelLayoutReducer(state, closeTab(WS, 'owned', 'p1', 1000));

      let result = panelLayoutReducer(hidden, updateTabTitle(WS, 'owned', 'New Title'));
      result = panelLayoutReducer(result, updateTabBrowserUrl(WS, 'owned', 'http://b/', null));
      const hiddenTab = getItems(result.byWorkspaceId[WS].hiddenTabs)[0];
      expect(hiddenTab.title).toBe('New Title');
      expect(hiddenTab).toMatchObject({ browserUrl: 'http://b/' });
    });

    it('initializeLayout restores persisted hiddenTabs', () => {
      const state = emptyState();
      const result = panelLayoutReducer(
        state,
        initializeLayout(WS, {
          root: { type: 'panel', panelId: 'p1' },
          panels: { p1: { id: 'p1', tabs: [], activeTabId: null } },
          focusedPanelId: 'p1',
          hiddenTabs: [{ ...ownedTab, closable: true } as any],
        }),
      );
      expect(getItems(result.byWorkspaceId[WS].hiddenTabs).map((t) => t.id)).toEqual(['owned']);
    });

    // Bulk user closes hide owned tabs (never recentlyClosed) the same way
    // single closes do — partitionRemovedTabs covers every bulk path.
    it.each([
      ['closeOtherTabs', () => closeOtherTabs(WS, 'plain', 'p1', 1000)],
      ['closeTabsToRight', () => closeTabsToRight(WS, 'plain', 'p1', 1000)],
      ['closeAllTabs', () => closeAllTabs(WS, 'p1', 1000)],
      ['closeAllOthersEverywhere', () => closeAllOthersEverywhere(WS, 'plain', 'p1', 1000)],
    ])('%s hides owned tabs instead of pushing them to recentlyClosed', (_name, action) => {
      const state = stateWithPanel('p1', [
        { id: 'plain', type: 'note', title: 'P' },
        { ...ownedTab },
        { id: 'other', type: 'note', title: 'O' },
      ]);
      const ws = panelLayoutReducer(state, action()).byWorkspaceId[WS];
      expect(getItems(ws.hiddenTabs).map((t) => t.id)).toEqual(['owned']);
      expect(ws.recentlyClosed.map((e) => e.tab.id)).not.toContain('owned');
      expect(ws.panels.p1.tabs.map((t) => t.id)).not.toContain('owned');
    });

    // Regression (monorepo#2857 review): a destroyed owned tab lived on in
    // layoutHistory snapshots, so goBack resurrected a ghost tab whose
    // main-process registrations were already gone.
    it('goBack cannot resurrect a destroyed hidden tab — history is purged', () => {
      const state = stateWithPanel('p1', [ownedTab, { id: 't2', type: 'note', title: 'A' }]);
      const hidden = panelLayoutReducer(state, closeTab(WS, 'owned', 'p1', 1000));
      expect(hidden.byWorkspaceId[WS].layoutHistory[0].panels.p1.tabs.map((t) => t.id)).toEqual([
        'owned',
        't2',
      ]);

      const destroyed = panelLayoutReducer(hidden, closeTab(WS, 'owned', undefined, 1001, true));
      for (const snapshot of destroyed.byWorkspaceId[WS].layoutHistory) {
        expect(snapshot.panels.p1.tabs.map((t) => t.id)).not.toContain('owned');
      }

      const back = panelLayoutReducer(destroyed, goBack(WS, 1002)).byWorkspaceId[WS];
      expect(back.panels.p1.tabs.map((t) => t.id)).toEqual(['t2']);
      expect(getItems(back.hiddenTabs)).toHaveLength(0);
    });

    it('destroyTabsByOwnerAgent purges hidden owned tabs from layout history', () => {
      const state = stateWithPanel('p1', [ownedTab, { id: 't2', type: 'note', title: 'A' }]);
      const hidden = panelLayoutReducer(state, closeTab(WS, 'owned', 'p1', 1000));
      const destroyed = panelLayoutReducer(hidden, destroyTabsByOwnerAgent(WS, 'agent-1', 1001));
      for (const snapshot of destroyed.byWorkspaceId[WS].layoutHistory) {
        expect(snapshot.panels.p1.tabs.map((t) => t.id)).not.toContain('owned');
      }

      const back = panelLayoutReducer(destroyed, goBack(WS, 1002)).byWorkspaceId[WS];
      expect(back.panels.p1.tabs.map((t) => t.id)).toEqual(['t2']);
      expect(getItems(back.hiddenTabs)).toHaveLength(0);
    });

    // Regression (monorepo#2857 review): restoring a snapshot that predates
    // an owned tab's restore used to drop the live tab entirely — it must be
    // re-hidden instead (history navigation never destroys owned tabs).
    it('goBack re-hides an owned tab absent from the restored snapshot; goForward un-hides it', () => {
      const state = stateWithPanel('p1', [ownedTab, { id: 't2', type: 'note', title: 'A' }]);
      const hidden = panelLayoutReducer(state, closeTab(WS, 'owned', 'p1', 1000));
      const restored = panelLayoutReducer(hidden, restoreHiddenTab(WS, 'owned', 1001));
      expect(restored.byWorkspaceId[WS].panels.p1.tabs.map((t) => t.id)).toEqual(['t2', 'owned']);
      expect(getItems(restored.byWorkspaceId[WS].hiddenTabs)).toHaveLength(0);

      // history[1] is the pre-restore snapshot without the owned tab.
      const back = panelLayoutReducer(restored, goBack(WS, 1002)).byWorkspaceId[WS];
      expect(back.panels.p1.tabs.map((t) => t.id)).toEqual(['t2']);
      expect(getItems(back.hiddenTabs).map((t) => t.id)).toEqual(['owned']);

      const forward = panelLayoutReducer(
        panelLayoutReducer(restored, goBack(WS, 1002)),
        goForward(WS),
      ).byWorkspaceId[WS];
      expect(forward.panels.p1.tabs.map((t) => t.id)).toEqual(['t2', 'owned']);
      expect(getItems(forward.hiddenTabs)).toHaveLength(0);
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
        columnCount: 3,
        columnCountInitialized: true,
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
      expect(workspace.columnCount).toBe(2);
      expect(workspace.columnCountInitialized).toBe(true);
      expect(workspace.layoutHistory[0]).toMatchObject({
        canvasWidth: 1200,
        canvasWidthSource: 'explicit',
        columnCount: 3,
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

    it('restores a populated column with exact IDs, active tab, geometry, width, and focus', () => {
      const state = emptyState();
      state.byWorkspaceId[WS] = {
        ...emptyWorkspaceState,
        root: {
          type: 'split',
          direction: 'horizontal',
          sizes: [25, 75],
          children: [
            { type: 'panel', panelId: 'p1' },
            { type: 'panel', panelId: 'p2' },
          ],
        },
        panels: {
          p1: {
            id: 'p1',
            tabs: [
              { id: 't1', type: 'note', title: 'One', closable: true },
              { id: 't2', type: 'file', title: 'Two', closable: true },
            ],
            activeTabId: 't2',
          },
          p2: { id: 'p2', tabs: [], activeTabId: null },
        },
        focusedPanelId: 'p1',
        columnCount: 2,
        canvasWidth: 1400,
        canvasWidthSource: 'explicit',
      };
      const before = structuredClone(state.byWorkspaceId[WS]);

      const closed = panelLayoutReducer(state, closePanel(WS, 'p1', 2000));
      expect(closed.byWorkspaceId[WS].recentlyClosed).toHaveLength(2);

      const restored = panelLayoutReducer(
        closed,
        reopenClosedPanelColumn(WS, 2001, 'restore-column'),
      ).byWorkspaceId[WS];

      expect(restored.root).toEqual(before.root);
      expect(restored.panels.p1).toEqual(before.panels.p1);
      expect(restored.panels.p1.tabs.map((tab) => tab.id)).toEqual(['t1', 't2']);
      expect(restored.panels.p1.activeTabId).toBe('t2');
      expect(restored.focusedPanelId).toBe('p1');
      expect(restored.columnCount).toBe(2);
      expect(restored.canvasWidth).toBe(1400);
      expect(restored.canvasWidthSource).toBe('explicit');
      expect(restored.pendingPanelReveal).toEqual({
        panelId: 'p1',
        tabId: 't2',
        requestId: 'restore-column',
      });
      expect(restored.recentlyClosed).toEqual([]);
      expect(
        getItems(
          restored.recentlyClosedColumns ??
            createCollection<RecentlyClosedPanelColumn, 'historyId'>('historyId'),
        ),
      ).toEqual([]);
    });

    it('restores intrinsic canvas provenance exactly', () => {
      const state = emptyState();
      state.byWorkspaceId[WS] = {
        ...emptyWorkspaceState,
        root: {
          type: 'split',
          direction: 'horizontal',
          sizes: [40, 60],
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
        columnCount: 2,
        canvasWidth: 1428,
        canvasWidthSource: 'intrinsic',
      };

      const closed = panelLayoutReducer(state, closePanel(WS, 'p1', 3000));
      const restored = panelLayoutReducer(
        closed,
        reopenClosedPanelColumn(WS, 3001, 'restore-intrinsic'),
      ).byWorkspaceId[WS];

      expect(restored.root).toEqual(state.byWorkspaceId[WS].root);
      expect(restored.canvasWidth).toBe(1428);
      expect(restored.canvasWidthSource).toBe('intrinsic');
    });

    it('walks backward through consecutive column closes', () => {
      const state = emptyState();
      const panelIds = ['p1', 'p2', 'p3'];
      state.byWorkspaceId[WS] = {
        ...emptyWorkspaceState,
        root: {
          type: 'split',
          direction: 'horizontal',
          sizes: [20, 30, 50],
          children: panelIds.map((panelId) => ({ type: 'panel' as const, panelId })),
        },
        panels: Object.fromEntries(
          panelIds.map((panelId) => [panelId, { id: panelId, tabs: [], activeTabId: null }]),
        ),
        focusedPanelId: 'p3',
        columnCount: 3,
        canvasWidth: 1800,
        canvasWidthSource: 'explicit',
      };

      const afterP3 = panelLayoutReducer(state, closeFocusedPanelTab(WS, 4000, 1200));
      const afterP2 = panelLayoutReducer(afterP3, closeFocusedPanelTab(WS, 4001, 800));
      expect(
        getItems(
          afterP2.byWorkspaceId[WS].recentlyClosedColumns ??
            createCollection<RecentlyClosedPanelColumn, 'historyId'>('historyId'),
        ),
      ).toHaveLength(2);

      const p2Restored = panelLayoutReducer(
        afterP2,
        reopenClosedPanelColumn(WS, 4002, 'restore-p2'),
      );
      expect(Object.keys(p2Restored.byWorkspaceId[WS].panels)).toEqual(['p1', 'p2']);
      expect(p2Restored.byWorkspaceId[WS]).toMatchObject({
        columnCount: 2,
        canvasWidth: 1200,
        focusedPanelId: 'p2',
      });

      const p3Restored = panelLayoutReducer(
        p2Restored,
        reopenClosedPanelColumn(WS, 4003, 'restore-p3'),
      ).byWorkspaceId[WS];
      expect(Object.keys(p3Restored.panels)).toEqual(panelIds);
      expect(p3Restored.root).toEqual(state.byWorkspaceId[WS].root);
      expect(p3Restored).toMatchObject({
        columnCount: 3,
        canvasWidth: 1800,
        canvasWidthSource: 'explicit',
        focusedPanelId: 'p3',
      });
      expect(
        getItems(
          p3Restored.recentlyClosedColumns ??
            createCollection<RecentlyClosedPanelColumn, 'historyId'>('historyId'),
        ),
      ).toEqual([]);
    });

    it('does not apply a column snapshot after an incompatible structural change', () => {
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
        focusedPanelId: 'p2',
        columnCount: 2,
      };
      const closed = panelLayoutReducer(state, closePanel(WS, 'p2', 5000));
      const changed = panelLayoutReducer(
        closed,
        splitPanel(WS, 'p1', 'horizontal', undefined, 5001),
      );

      expect(
        panelLayoutReducer(changed, reopenClosedPanelColumn(WS, 5002, 'invalid-restore')),
      ).toBe(changed);
    });

    it('bounds closed-column history to the existing recent-history limit', () => {
      const panelIds = ['p1', 'p2', 'p3', 'p4'];
      let state = emptyState();
      state.byWorkspaceId[WS] = {
        ...emptyWorkspaceState,
        root: {
          type: 'split',
          direction: 'horizontal',
          children: panelIds.map((panelId) => ({ type: 'panel' as const, panelId })),
          sizes: [25, 25, 25, 25],
        },
        panels: Object.fromEntries(
          panelIds.map((panelId) => [panelId, { id: panelId, tabs: [], activeTabId: null }]),
        ),
        focusedPanelId: 'p4',
        columnCount: 4,
      };

      for (let index = 0; index < 25; index++) {
        const workspace = state.byWorkspaceId[WS];
        if (workspace.root.type !== 'split') throw new Error('Expected four columns');
        const target = workspace.root.children.at(-1);
        if (target?.type !== 'panel') throw new Error('Expected panel column');
        state = panelLayoutReducer(state, closePanel(WS, target.panelId, 7000 + index * 2));
        state = panelLayoutReducer(state, reconcilePanelColumnCount(WS, 4, 7001 + index * 2));
      }

      const closedColumns = getItems(
        state.byWorkspaceId[WS].recentlyClosedColumns ??
          createCollection<RecentlyClosedPanelColumn, 'historyId'>('historyId'),
      );
      expect(closedColumns).toHaveLength(20);
      expect(closedColumns[0].closedAt).toBe(7048);
      expect(closedColumns.at(-1)?.closedAt).toBe(7010);
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

    it('does not resurrect pruned agent or terminal tabs with their closed column', () => {
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
          sizes: [45, 55],
        },
        panels: {
          p1: {
            id: 'p1',
            tabs: [
              {
                id: 'agent-tab',
                type: 'agent',
                title: 'Agent',
                agentId: 'agent-1',
                closable: true,
              },
              {
                id: 'terminal-tab',
                type: 'terminal',
                title: 'Terminal',
                terminalId: 'term-1',
                closable: true,
              },
              { id: 'note-tab', type: 'note', title: 'Note', closable: true },
            ],
            activeTabId: 'terminal-tab',
          },
          p2: { id: 'p2', tabs: [], activeTabId: null },
        },
        focusedPanelId: 'p1',
        columnCount: 2,
      };

      let closed = panelLayoutReducer(state, closePanel(WS, 'p1', 6000));
      closed = panelLayoutReducer(closed, pruneRecentlyClosed(WS, { agentId: 'agent-1' }));
      closed = panelLayoutReducer(closed, removeTerminal(WS, 'term-1'));
      const restored = panelLayoutReducer(
        closed,
        reopenClosedPanelColumn(WS, 6001, 'restore-pruned'),
      ).byWorkspaceId[WS];

      expect(restored.panels.p1.tabs.map((tab) => tab.id)).toEqual(['note-tab']);
      expect(restored.panels.p1.activeTabId).toBe('note-tab');
      expect(restored.recentlyClosed.map((entry) => entry.tab.id)).toEqual([]);
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

    it('resizes a root divider proportionally and includes explicit widths in later snapshots', () => {
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
        columnCount: 3,
        canvasWidth: 1016,
      };

      const resized = panelLayoutReducer(
        state,
        resizePanelLayoutAtRootDivider(WS, [300, 400, 300], [300, 600, 100]),
      );

      expect(resized.byWorkspaceId[WS].canvasWidth).toBe(1016);
      expect(resized.byWorkspaceId[WS].canvasWidthSource).toBe('explicit');
      expect(resized.byWorkspaceId[WS].root).toMatchObject({ sizes: [30, 60, 10] });
      const snapshotted = panelLayoutReducer(
        resized,
        splitPanel(WS, 'p1', 'horizontal', undefined, 1234),
      );
      expect(snapshotted.byWorkspaceId[WS].layoutHistory[0].canvasWidth).toBe(1016);
    });

    it('commits the exact live preview widths instead of reconstructing mouse-up widths', () => {
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
        columnCount: 3,
        canvasWidth: 1016,
      };
      const previousWidths = [300, 400, 300];
      const finalPreviewWidths = [398, 344, 258];
      const reconstructedMouseUpWidths = [400, 342.857142857, 257.142857143];

      expect(finalPreviewWidths).not.toEqual(reconstructedMouseUpWidths);
      const resized = panelLayoutReducer(
        state,
        resizePanelLayoutAtRootDivider(WS, previousWidths, finalPreviewWidths),
      );

      const root = resized.byWorkspaceId[WS].root;
      expect(root.type).toBe('split');
      if (root.type !== 'split') throw new Error('Expected horizontal split');
      expect(root.sizes).toEqual([
        expect.closeTo(39.8, 8),
        expect.closeTo(34.4, 8),
        expect.closeTo(25.8, 8),
      ]);
      expect(resized.byWorkspaceId[WS].canvasWidth).toBe(1016);
      expect(resized.byWorkspaceId[WS].layoutHistory).toBe(state.byWorkspaceId[WS].layoutHistory);
      expect(
        panelLayoutReducer(
          state,
          resizePanelLayoutAtRootDivider(WS, previousWidths, previousWidths),
        ),
      ).toBe(state);
    });

    it('keeps the full canvas fixed without folding gutters into panel sizes', () => {
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
        resizePanelLayoutAtRootDivider(WS, [645, 397], [745, 297]),
      );
      const root = result.byWorkspaceId[WS].root;

      expect(result.byWorkspaceId[WS].canvasWidth).toBe(1050);
      if (root.type !== 'split') throw new Error('Expected horizontal split');
      expect((root.sizes[0] / 100) * 1042).toBeCloseTo(745);
      expect((root.sizes[1] / 100) * 1042).toBeCloseTo(297);
    });
  });

  describe('cross-slice: removeScript destroys script-backed tabs', () => {
    it('removes selected script tabs across panels and keeps unrelated terminal and script tabs', () => {
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
            tabs: [
              {
                id: 'script-selected',
                type: 'terminal',
                title: 'Selected script',
                scriptId: 'shared-id',
              },
              { id: 'note', type: 'note', title: 'Note', noteId: 'n1' },
              {
                id: 'terminal-same-id',
                type: 'terminal',
                title: 'Terminal',
                terminalId: 'shared-id',
              },
              {
                id: 'other-script',
                type: 'terminal',
                title: 'Other script',
                scriptId: 'other-id',
              },
            ],
            activeTabId: 'script-selected',
          },
          p2: {
            id: 'p2',
            tabs: [
              {
                id: 'script-duplicate',
                type: 'terminal',
                title: 'Duplicate script',
                scriptId: 'shared-id',
              },
            ],
            activeTabId: 'script-duplicate',
          },
        },
        focusedPanelId: 'p2',
        columnCount: 2,
      };

      const workspace = panelLayoutReducer(state, removeScript(WS, 'shared-id')).byWorkspaceId[WS];

      expect(Object.keys(workspace.panels)).toEqual(['p1']);
      expect(workspace.panels.p1.tabs.map((tab) => tab.id)).toEqual([
        'note',
        'terminal-same-id',
        'other-script',
      ]);
      expect(workspace.panels.p1.activeTabId).toBe('note');
      expect(workspace.focusedPanelId).toBe('p1');
      expect(workspace.columnCount).toBe(1);
    });

    it('keeps the current selection when a nonselected script tab is removed', () => {
      const state = stateWithPanel('p1', [
        { id: 'note', type: 'note', title: 'Note', noteId: 'n1' } as any,
        {
          id: 'script',
          type: 'terminal',
          title: 'Script',
          scriptId: 'script-1',
        } as any,
      ]);

      const workspace = panelLayoutReducer(state, removeScript(WS, 'script-1')).byWorkspaceId[WS];

      expect(workspace.panels.p1.tabs.map((tab) => tab.id)).toEqual(['note']);
      expect(workspace.panels.p1.activeTabId).toBe('note');
    });

    it('prunes recently closed script tabs so they cannot reopen', () => {
      const state = stateWithPanel('p1', [
        {
          id: 'script',
          type: 'terminal',
          title: 'Script',
          scriptId: 'script-1',
        } as any,
        { id: 'note', type: 'note', title: 'Note', noteId: 'n1' } as any,
      ]);
      const closed = panelLayoutReducer(state, closeTab(WS, 'script', 'p1', 1000));
      const removed = panelLayoutReducer(closed, removeScript(WS, 'script-1'));

      expect(removed.byWorkspaceId[WS].recentlyClosed).toEqual([]);
      const reopened = panelLayoutReducer(removed, reopenClosedTab(WS, 1001, 'script'));
      expect(reopened.byWorkspaceId[WS].panels.p1.tabs.map((tab) => tab.id)).toEqual(['note']);
      const back = panelLayoutReducer(removed, goBack(WS, 1002));
      expect(back.byWorkspaceId[WS].panels.p1.tabs.map((tab) => tab.id)).toEqual(['note']);
    });

    it('prunes script tabs from recently closed panel columns', () => {
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
            tabs: [
              {
                id: 'script',
                type: 'terminal',
                title: 'Script',
                scriptId: 'script-1',
                closable: true,
              },
              { id: 'note', type: 'note', title: 'Note', noteId: 'n1', closable: true },
            ],
            activeTabId: 'script',
          },
          p2: { id: 'p2', tabs: [], activeTabId: null },
        },
        focusedPanelId: 'p1',
        columnCount: 2,
      };
      const closed = panelLayoutReducer(state, closePanel(WS, 'p1', 2000));
      const removed = panelLayoutReducer(closed, removeScript(WS, 'script-1'));
      const restored = panelLayoutReducer(
        removed,
        reopenClosedPanelColumn(WS, 2001, 'restore-script-column'),
      ).byWorkspaceId[WS];

      expect(restored.panels.p1.tabs.map((tab) => tab.id)).toEqual(['note']);
      expect(restored.panels.p1.activeTabId).toBe('note');
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

  // Ownership + emulated size recording (monorepo#2857 §5.9).
  describe('setTabOwnerAgent', () => {
    const browserTab = { id: 'b1', type: 'browser', title: 'B', browserUrl: 'http://a/' };

    it('records the owner on a visible browser tab', () => {
      const state = stateWithPanel('p1', [browserTab]);
      const result = panelLayoutReducer(state, setTabOwnerAgent(WS, 'b1', 'agent-1'));
      expect(result.byWorkspaceId[WS].panels.p1.tabs[0]).toMatchObject({
        ownerAgentId: 'agent-1',
      });
      expect(result.byWorkspaceId[WS].panels.p1.tabs[0].emulatedSize).toBeUndefined();
    });

    it('records the emulated size alongside the owner and updates it on resize', () => {
      const state = stateWithPanel('p1', [browserTab]);
      const claimed = panelLayoutReducer(
        state,
        setTabOwnerAgent(WS, 'b1', 'agent-1', { width: 1280, height: 800 }),
      );
      expect(claimed.byWorkspaceId[WS].panels.p1.tabs[0].emulatedSize).toEqual({
        width: 1280,
        height: 800,
      });
      const resized = panelLayoutReducer(
        claimed,
        setTabOwnerAgent(WS, 'b1', 'agent-1', { width: 390, height: 844 }),
      );
      expect(resized.byWorkspaceId[WS].panels.p1.tabs[0].emulatedSize).toEqual({
        width: 390,
        height: 844,
      });
    });

    it('keeps a previously recorded size when the update omits one', () => {
      const state = stateWithPanel('p1', [browserTab]);
      const claimed = panelLayoutReducer(
        state,
        setTabOwnerAgent(WS, 'b1', 'agent-1', { width: 1280, height: 800 }),
      );
      const again = panelLayoutReducer(claimed, setTabOwnerAgent(WS, 'b1', 'agent-1'));
      expect(again).toBe(claimed);
    });

    it('is a no-op when owner and size are unchanged', () => {
      const state = stateWithPanel('p1', [browserTab]);
      const claimed = panelLayoutReducer(
        state,
        setTabOwnerAgent(WS, 'b1', 'agent-1', { width: 1280, height: 800 }),
      );
      const repeat = panelLayoutReducer(
        claimed,
        setTabOwnerAgent(WS, 'b1', 'agent-1', { width: 1280, height: 800 }),
      );
      expect(repeat).toBe(claimed);
    });

    it('updates a hidden (user-closed) owned tab — resize while hidden (monorepo#2857)', () => {
      const state = stateWithPanel('p1', [
        { ...browserTab, ownerAgentId: 'agent-1' } as any,
        { id: 't2', type: 'note', title: 'A' },
      ]);
      const hidden = panelLayoutReducer(state, closeTab(WS, 'b1', 'p1', 1000));
      expect(getItems(hidden.byWorkspaceId[WS].hiddenTabs).map((t) => t.id)).toEqual(['b1']);

      const resized = panelLayoutReducer(
        hidden,
        setTabOwnerAgent(WS, 'b1', 'agent-1', { width: 640, height: 480 }),
      );
      const hiddenTab = getItems(resized.byWorkspaceId[WS].hiddenTabs)[0];
      expect(hiddenTab.emulatedSize).toEqual({ width: 640, height: 480 });
      expect(hiddenTab.ownerAgentId).toBe('agent-1');
    });

    it('ignores unknown tab ids and non-browser tabs', () => {
      const state = stateWithPanel('p1', [{ id: 't2', type: 'note', title: 'A' }]);
      expect(panelLayoutReducer(state, setTabOwnerAgent(WS, 'missing', 'agent-1'))).toBe(state);
      expect(panelLayoutReducer(state, setTabOwnerAgent(WS, 't2', 'agent-1'))).toBe(state);
    });

    // monorepo#3438: the owner's display name persists with the tab so the
    // sidebar owner group can label it without an agent-store lookup.
    it('records the owner display name alongside the owner', () => {
      const state = stateWithPanel('p1', [browserTab]);
      const result = panelLayoutReducer(
        state,
        setTabOwnerAgent(WS, 'b1', 'agent-1', undefined, 'Docs Writer'),
      );
      expect(result.byWorkspaceId[WS].panels.p1.tabs[0]).toMatchObject({
        ownerAgentId: 'agent-1',
        ownerAgentName: 'Docs Writer',
      });
    });

    it('keeps a previously recorded name when the update omits one', () => {
      const state = stateWithPanel('p1', [browserTab]);
      const named = panelLayoutReducer(
        state,
        setTabOwnerAgent(WS, 'b1', 'agent-1', undefined, 'Docs Writer'),
      );
      const resized = panelLayoutReducer(
        named,
        setTabOwnerAgent(WS, 'b1', 'agent-1', { width: 640, height: 480 }),
      );
      expect(resized.byWorkspaceId[WS].panels.p1.tabs[0]).toMatchObject({
        ownerAgentName: 'Docs Writer',
        emulatedSize: { width: 640, height: 480 },
      });
    });

    it('updates the name on a repeat notification and no-ops when unchanged', () => {
      const state = stateWithPanel('p1', [browserTab]);
      const named = panelLayoutReducer(
        state,
        setTabOwnerAgent(WS, 'b1', 'agent-1', undefined, 'Old Name'),
      );
      const renamed = panelLayoutReducer(
        named,
        setTabOwnerAgent(WS, 'b1', 'agent-1', undefined, 'New Name'),
      );
      expect(renamed.byWorkspaceId[WS].panels.p1.tabs[0].ownerAgentName).toBe('New Name');
      const repeat = panelLayoutReducer(
        renamed,
        setTabOwnerAgent(WS, 'b1', 'agent-1', undefined, 'New Name'),
      );
      expect(repeat).toBe(renamed);
    });

    it('records the owner display name on a hidden owned tab', () => {
      const state = stateWithPanel('p1', [
        { ...browserTab, ownerAgentId: 'agent-1' } as any,
        { id: 't2', type: 'note', title: 'A' },
      ]);
      const hidden = panelLayoutReducer(state, closeTab(WS, 'b1', 'p1', 1000));
      const named = panelLayoutReducer(
        hidden,
        setTabOwnerAgent(WS, 'b1', 'agent-1', undefined, 'Docs Writer'),
      );
      expect(getItems(named.byWorkspaceId[WS].hiddenTabs)[0].ownerAgentName).toBe('Docs Writer');
    });
  });

  // Conversation-footer reveal uses another fixed column when available and
  // keeps panel focus stable.
  describe('revealHiddenTabAvoidingPanel', () => {
    const ownedTab = {
      id: 'owned',
      type: 'browser',
      title: 'Owned',
      browserUrl: 'http://a/',
      ownerAgentId: 'agent-1',
    };

    it('mounts into another panel without displacing or refocusing the avoided one', () => {
      const state = stateWithPanel('p1', [ownedTab, { id: 't2', type: 'note', title: 'A' }]);
      state.byWorkspaceId[WS].root = {
        type: 'split',
        direction: 'horizontal',
        children: [
          { type: 'panel', panelId: 'p1' },
          { type: 'panel', panelId: 'p2' },
        ],
        sizes: [50, 50],
      };
      state.byWorkspaceId[WS].panels.p2 = {
        id: 'p2',
        tabs: [{ id: 'n2', type: 'note', title: 'B', closable: true } as any],
        activeTabId: 'n2',
      };
      const hidden = panelLayoutReducer(state, closeTab(WS, 'owned', 'p1', 1000));
      const before = hidden.byWorkspaceId[WS];
      const result = panelLayoutReducer(
        hidden,
        revealHiddenTabAvoidingPanel(WS, 'owned', 'p1', 1001),
      );
      const ws = result.byWorkspaceId[WS];
      expect(getItems(ws.hiddenTabs)).toHaveLength(0);
      expect(ws.panels.p1.tabs.map((t) => t.id)).toEqual(['t2']);
      expect(ws.panels.p1.activeTabId).toBe(before.panels.p1.activeTabId);
      expect(ws.panels.p2.tabs.map((t) => t.id)).toEqual(['n2', 'owned']);
      expect(ws.panels.p2.activeTabId).toBe('owned');
      expect(ws.focusedPanelId).toBe(before.focusedPanelId);
      expect(ws.pendingPanelReveal).toMatchObject({ panelId: 'p2', tabId: 'owned' });
    });

    it('uses the sole fixed column without creating another column', () => {
      const state = stateWithPanel('p1', [ownedTab, { id: 't2', type: 'note', title: 'A' }]);
      const hidden = panelLayoutReducer(state, closeTab(WS, 'owned', 'p1', 1000));
      const before = hidden.byWorkspaceId[WS];
      const result = panelLayoutReducer(
        hidden,
        revealHiddenTabAvoidingPanel(WS, 'owned', 'p1', 1001),
      );
      const ws = result.byWorkspaceId[WS];
      expect(getItems(ws.hiddenTabs)).toHaveLength(0);
      expect(Object.keys(ws.panels)).toEqual(['p1']);
      expect(ws.panels.p1.tabs.map((t) => t.id)).toEqual(['t2', 'owned']);
      expect(ws.panels.p1.activeTabId).toBe('owned');
      expect(ws.focusedPanelId).toBe(before.focusedPanelId);
      expect(ws.pendingPanelReveal).toMatchObject({ panelId: 'p1', tabId: 'owned' });
    });

    it('ignores unknown hidden tab ids', () => {
      const state = stateWithPanel('p1', [{ id: 't2', type: 'note', title: 'A' }]);
      expect(panelLayoutReducer(state, revealHiddenTabAvoidingPanel(WS, 'missing', 'p1'))).toBe(
        state,
      );
    });
  });
});
