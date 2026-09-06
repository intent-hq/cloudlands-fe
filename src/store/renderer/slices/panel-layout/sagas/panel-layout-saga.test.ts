import { runSaga, stdChannel } from 'redux-saga';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCollection } from '@augmentcode/themis/utils/collections/collection-utils';

const mocks = vi.hoisted(() => ({
  clearAdapter: vi.fn(),
  getJSON: vi.fn(),
  loadHistory: vi.fn(),
  removeItem: vi.fn(),
  resolveBrowserLinkUrl: vi.fn(),
  saveHistory: vi.fn(),
  setJSON: vi.fn(),
}));

vi.mock('$features/layout/panel-layout-adapter', () => ({
  clearPanelLayoutAdapter: mocks.clearAdapter,
}));
vi.mock('$features/layout/panel-layout-history.client', () => ({
  loadPanelLayoutHistory: mocks.loadHistory,
  savePanelLayoutHistory: mocks.saveHistory,
}));
vi.mock('$lib/utils/browser-url-resolution', () => ({
  resolveBrowserLinkUrl: mocks.resolveBrowserLinkUrl,
}));
vi.mock('../../../utils/safe-local-storage-saga', () => ({
  // Yield the mock's return value so a test can hand back a Promise to hold
  // a restore in flight (the saga awaits yielded promises; plain values pass
  // through unchanged).
  getLocalStorageJSON: function* (key: string) {
    return yield mocks.getJSON(key);
  },
  removeLocalStorageItem: function* (key: string) {
    mocks.removeItem(key);
  },
  setLocalStorageJSON: function* (key: string, value: unknown) {
    mocks.setJSON(key, value);
  },
}));

import { LOCAL_CONNECTION_ID } from '$shared/types/connections';
import type { AgentSession, ContextLink, Note, Workspace } from '$shared/types';
import { ContentType, NoteVisibility } from '$shared/types';
import { connectionsListReceived } from '../../connections/connections-slice';
import { setWorkspaceEntity, setWorkspaceHasLoaded } from '../../workspace/workspace-slice';
import {
  workspaceMounted,
  workspaceUnmounted,
} from '../../workspace-lifecycle/workspace-lifecycle-slice';
import {
  clearPanelLayout,
  bootstrapNewWorkspaceLayout,
  closeActiveTab,
  closeAllOthersEverywhere,
  closeAllTabs,
  closeOtherTabs,
  closePanel,
  closeTab,
  closeTabsByAgentId,
  closeTabsByType,
  closeTabsToRight,
  consumePendingFocus,
  emptyWorkspaceState,
  focusPanel,
  goBack,
  goBackInFocusHistory,
  goForward,
  goForwardInFocusHistory,
  initializeLayout,
  loadLayoutHistory,
  movePanel,
  movePanelToRootEdge,
  moveTabToPanel,
  moveTabToSplit,
  moveTabToSplitLevel,
  openTab,
  openBlankWorkingPanel,
  openHiddenTab,
  openTabInAdjacentOrSplit,
  openTabInNewRootColumn,
  openTabInRightmostColumn,
  openTabInRightmostColumnRequested,
  panelLayoutScopeMounted,
  panelLayoutScopeUnmounted,
  preparePanelLayoutBackendRestore,
  reconcilePanelColumnCount,
  reconcileStaleAgentTabs,
  reorderTabs,
  reopenClosedPanelColumn,
  reopenClosedTab,
  revealDeferredSpecTab,
  revealHiddenTabAvoidingPanel,
  resetLayout,
  resizePanelLayoutRightEdge,
  selectNextTab,
  selectPreviousTab,
  setActiveTab,
  setPanelColumnCount,
  setDeferSpecTab,
  setRestoreStatus,
  splitPanel,
  toggleExpandPanel,
  updateFileTabPath,
  updateSizes,
  updateSplitSizes,
  updateTabBrowserUrl,
  updateTabFavicon,
  updateTabTitle,
  updateTabViewport,
} from '../panel-layout-slice';
import { panelLayoutReducer } from '../panel-layout-slice';
import {
  initialState as userPreferencesInitialState,
  userPreferencesReducer,
} from '../../user-preferences/user-preferences-slice';
import { setAgents } from '../../workspace-agents/workspace-agents-slice';
import { removeScript } from '../../scripts/scripts-slice';
import {
  applyLocalNoteUpdate,
  applyNoteUpdated,
  loadWorkspaceNotesSucceeded,
  workspaceNotesReducer,
} from '../../workspace-notes/workspace-notes-slice';
import {
  HISTORY_PERSIST_DEBOUNCE_MS,
  PANEL_LAYOUT_PERSISTENCE_VERSION,
  PANEL_LAYOUT_STORAGE_KEY_PREFIX,
  type LayoutSnapshot,
  type WorkspacePanelLayout,
} from '../panel-layout-types';
import {
  displacedOrphanSliverFixture,
  narrowOverlappingGeometryFixture,
} from '../panel-layout-restore.test-fixtures';
import {
  hydrateWorkspaceLayout,
  isStoredLayoutValid,
  panelLayoutSaga,
  waitForWorkspaceLayoutRestore,
  watchRightmostColumnRequests,
} from './panel-layout-saga';

const WS_1 = 'ws-1';
const WS_2 = 'ws-2';
const REMOTE_ID = 'remote-1';
const STORAGE_KEY_1 = `${PANEL_LAYOUT_STORAGE_KEY_PREFIX}${WS_1}`;
const REMOTE_STORAGE_KEY_1 = `backend:${REMOTE_ID}:${STORAGE_KEY_1}`;
const NOW = new Date('2026-07-31T00:00:00.000Z');

const tab = { id: 'tab-1', type: 'note' as const, title: 'Note', closable: true, noteId: 'note-1' };
const layout: WorkspacePanelLayout = {
  version: PANEL_LAYOUT_PERSISTENCE_VERSION,
  root: { type: 'panel', panelId: 'panel-1' },
  panels: { 'panel-1': { id: 'panel-1', tabs: [tab], activeTabId: tab.id } },
  focusedPanelId: 'panel-1',
  canvasWidth: null,
  canvasWidthSource: null,
  columnCount: 1,
};
const snapshot: LayoutSnapshot = { ...layout, timestamp: 10 };

function workspaceState(history: LayoutSnapshot[] = [snapshot]) {
  return {
    ...emptyWorkspaceState,
    ...layout,
    layoutHistory: history,
    historyIndex: history.length - 1,
  };
}

function storeState(
  activeWorkspaceId: string | null = null,
  activeBackendId: string = LOCAL_CONNECTION_ID,
) {
  return {
    panelLayout: {
      byWorkspaceId: {
        [WS_1]: workspaceState(),
        [WS_2]: workspaceState([{ ...snapshot, timestamp: 20 }]),
      },
    },
    userPreferences: userPreferencesInitialState,
    tabState: { currentTabId: activeWorkspaceId },
    connections: { activeId: activeBackendId, windowBackendId: activeBackendId },
    workspaceAgents: { byWorkspaceId: {} },
    workspace: { workspaces: createCollection('id') },
  };
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function startSaga(state = storeState(), activeWorkspaceId: string | null = null) {
  const channel = stdChannel();
  const dispatch = vi.fn();
  const task = runSaga({ channel, dispatch, getState: () => state }, panelLayoutSaga, {
    activeWorkspaceId: activeWorkspaceId ?? state.tabState.currentTabId,
  });
  return { channel, dispatch, task };
}

function specNote(content: string, createdAt = '2026-07-31T00:00:00.000Z'): Note {
  return {
    id: 'spec',
    workspaceId: WS_1,
    title: 'Spec',
    content,
    contentType: ContentType.Markdown,
    tags: [],
    isPinned: false,
    isArchived: false,
    visibility: NoteVisibility.Workspace,
    createdAt,
    updatedAt: createdAt,
  };
}

function startLifecycleSaga(initialSpecContent = '', activeWorkspaceId: string | null = null) {
  let state: any = {
    ...storeState(activeWorkspaceId),
    panelLayout: { byWorkspaceId: {} },
    workspaceAgents: { byWorkspaceId: {} },
    agentSessions: { byAgentId: {}, agentIdsByWorkspace: {} },
    workspaceNotes: workspaceNotesReducer(
      undefined,
      loadWorkspaceNotesSucceeded([WS_1], { [WS_1]: [specNote(initialSpecContent)] }),
    ),
    userPreferences: userPreferencesInitialState,
  };
  const channel = stdChannel();
  const dispatch = vi.fn((action) => {
    state = {
      ...state,
      panelLayout: panelLayoutReducer(state.panelLayout, action),
      workspaceNotes: workspaceNotesReducer(state.workspaceNotes, action),
      userPreferences: userPreferencesReducer(state.userPreferences, action),
    };
    channel.put(action);
  });
  const task = runSaga({ channel, dispatch, getState: () => state }, panelLayoutSaga);
  const send = (action: { type: string; payload?: unknown }) => dispatch(action);
  return { dispatch, getState: () => state, send, task };
}

function startRestoreSaga(
  stored: unknown,
  agents: AgentSession[],
  initialLayout = emptyWorkspaceState,
  contextLinks?: ContextLink[],
  opts: { workspaceListLoaded?: boolean } = {},
) {
  mocks.getJSON.mockReturnValue(stored);
  let backendId = LOCAL_CONNECTION_ID;
  let state: any = {
    ...storeState(WS_1),
    panelLayout: { byWorkspaceId: { [WS_1]: { ...initialLayout } } },
    workspaceAgents: {
      byWorkspaceId: {
        [WS_1]: {
          agentIds: agents.map((agent) => String(agent.id)),
          foregroundAgentIds: agents.map((agent) => agent.id),
        },
      },
    },
    agentSessions: {
      byAgentId: Object.fromEntries(agents.map((agent) => [String(agent.id), agent])),
    },
    workspaceNotes: workspaceNotesReducer(undefined, { type: '@@test/init' }),
    workspace: {
      workspaces: createCollection(
        'id',
        contextLinks ? [{ id: WS_1, contextLinks } as unknown as Workspace] : [],
      ),
      hasLoaded: opts.workspaceListLoaded ?? true,
    },
  };
  const channel = stdChannel();
  const dispatch = vi.fn((action) => {
    state = { ...state, panelLayout: panelLayoutReducer(state.panelLayout, action) };
    if (action.type === setWorkspaceEntity.type) {
      state = {
        ...state,
        workspace: {
          ...state.workspace,
          workspaces: createCollection('id', [action.payload[0]]),
        },
      };
    }
    if (action.type === setWorkspaceHasLoaded.type) {
      state = { ...state, workspace: { ...state.workspace, hasLoaded: action.payload[0] } };
    }
    channel.put(action);
  });
  // The loaded-list stamp follows the active backend: a real backend switch
  // reloads the workspace list for the incoming backend.
  const getState = () => ({
    ...state,
    connections: { ...state.connections, activeId: backendId, windowBackendId: backendId },
    workspace: {
      ...state.workspace,
      loadedBackendId: state.workspace.hasLoaded ? backendId : null,
    },
  });
  const task = runSaga({ channel, dispatch, getState }, panelLayoutSaga, {
    activeWorkspaceId: WS_1,
  });
  return {
    dispatch,
    getState,
    send: channel.put,
    setBackendId: (id: string) => {
      backendId = id;
    },
    task,
  };
}

function agent(
  id: string,
  name: string,
  userMessageAt?: string,
  overrides: Partial<AgentSession> = {},
): AgentSession {
  return {
    id,
    backendSessionId: null,
    workspaceId: WS_1,
    name,
    status: 'idle',
    messages: userMessageAt
      ? [{ id: `message-${id}`, role: 'user', timestamp: userMessageAt }]
      : [],
    createdAt: '2026-07-31T00:00:00.000Z',
    updatedAt: '2026-07-31T00:00:00.000Z',
    ...overrides,
  } as AgentSession;
}

async function cancelSaga(task: ReturnType<typeof runSaga>) {
  task.cancel();
  await task.toPromise();
}

const persistActionCreators = [
  initializeLayout,
  openTab,
  openTabInAdjacentOrSplit,
  openTabInNewRootColumn,
  openTabInRightmostColumn,
  openBlankWorkingPanel,
  closeTab,
  closeActiveTab,
  closeTabsByType,
  closeTabsByAgentId,
  removeScript,
  reopenClosedTab,
  setActiveTab,
  selectNextTab,
  selectPreviousTab,
  reorderTabs,
  moveTabToPanel,
  moveTabToSplit,
  moveTabToSplitLevel,
  closeOtherTabs,
  closeTabsToRight,
  closeAllTabs,
  closeAllOthersEverywhere,
  focusPanel,
  splitPanel,
  closePanel,
  movePanel,
  movePanelToRootEdge,
  updateSizes,
  updateSplitSizes,
  resizePanelLayoutRightEdge,
  toggleExpandPanel,
  resetLayout,
  goBack,
  goForward,
  goBackInFocusHistory,
  goForwardInFocusHistory,
  setDeferSpecTab,
  reconcileStaleAgentTabs,
  updateTabTitle,
  updateTabBrowserUrl,
  updateTabFavicon,
  updateTabViewport,
  updateFileTabPath,
  consumePendingFocus,
  reconcilePanelColumnCount,
  // Sidebar/footer reveals persist through a dedicated watcher (not
  // PERSIST_ACTIONS) so a revealed owned tab does not revert to hidden on
  // restart (monorepo#3112).
  revealHiddenTabAvoidingPanel,
];

describe('panelLayoutSaga', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    mocks.loadHistory.mockResolvedValue(null);
    mocks.saveHistory.mockResolvedValue(true);
    // Default: pass-through resolution (no rewrite for this session).
    mocks.resolveBrowserLinkUrl.mockImplementation(async (url: string) => ({
      url,
      rewritten: false,
    }));
  });

  afterEach(() => vi.useRealTimers());

  it('validates stored layout data while allowing recoverable placement mismatches', () => {
    expect(isStoredLayoutValid(layout)).toBe(true);
    expect(isStoredLayoutValid({ ...layout, canvasWidth: 1080 })).toBe(true);
    expect(
      isStoredLayoutValid({ ...layout, canvasWidth: 1080, canvasWidthSource: 'explicit' }),
    ).toBe(true);
    expect(
      isStoredLayoutValid({ ...layout, canvasWidth: 1428, canvasWidthSource: 'intrinsic' }),
    ).toBe(true);
    expect(isStoredLayoutValid({ ...layout, canvasWidthSource: 'viewport' } as never)).toBe(false);
    expect(isStoredLayoutValid({ ...layout, canvasWidth: 0 })).toBe(false);
    expect(isStoredLayoutValid({ ...layout, canvasWidth: Number.NaN })).toBe(false);
    expect(
      isStoredLayoutValid({
        ...layout,
        panels: { 'panel-1': { ...layout.panels['panel-1'], pinned: true } },
      }),
    ).toBe(true);
    expect(
      isStoredLayoutValid({
        ...layout,
        panels: { 'panel-1': { ...layout.panels['panel-1'], pinned: 'yes' } },
      }),
    ).toBe(true);
    expect(
      isStoredLayoutValid({
        ...layout,
        deferSpecTab: true,
        newWorkspaceLifecycle: {
          coordinator: true,
          initialAgentId: 'agent-1',
          initialAgentPending: false,
          spec: { noteId: 'spec', generation: 'spec:created', state: 'deferred' },
        },
      }),
    ).toBe(true);
    expect(isStoredLayoutValid(null)).toBe(false);
    expect(isStoredLayoutValid({ ...layout, root: { type: 'panel', panelId: 'missing' } })).toBe(
      true,
    );
    expect(isStoredLayoutValid({ ...layout, focusedPanelId: 'missing' })).toBe(true);
    expect(isStoredLayoutValid(displacedOrphanSliverFixture(WS_1))).toBe(true);
    expect(
      isStoredLayoutValid({
        ...layout,
        panels: { 'panel-1': { ...layout.panels['panel-1'], tabs: [null] } },
      }),
    ).toBe(false);
    expect(
      isStoredLayoutValid({
        ...layout,
        panels: { 'panel-1': { ...layout.panels['panel-1'], activeTabId: 'missing' } },
      }),
    ).toBe(false);
    expect(
      isStoredLayoutValid({
        ...layout,
        root: { type: 'split', direction: 'horizontal', children: [layout.root], sizes: [] },
      }),
    ).toBe(true);
  });

  it('reveals first canonical Spec write once and does not activate a background workspace', async () => {
    const { dispatch, getState, send, task } = startLifecycleSaga('', WS_2);
    await settle();
    send(bootstrapNewWorkspaceLayout(WS_1, 'agent-1', 'Coordinator', true));
    await settle();
    expect(getState().panelLayout.byWorkspaceId[WS_1].newWorkspaceLifecycle.spec).toEqual({
      noteId: 'spec',
      generation: 'spec:2026-07-31T00:00:00.000Z',
      state: 'deferred',
    });

    send(applyLocalNoteUpdate(WS_1, 'spec', { content: '# Optimistic only' }));
    await settle();
    send(loadWorkspaceNotesSucceeded([WS_1], { [WS_1]: [specNote('')] }));
    await settle();
    expect(getState().panelLayout.byWorkspaceId[WS_1].newWorkspaceLifecycle.spec.state).toBe(
      'deferred',
    );
    expect(
      Object.values(getState().panelLayout.byWorkspaceId[WS_1].panels)
        .flatMap((panel: any) => panel.tabs)
        .some((candidate: any) => candidate.type === 'note' && candidate.noteId === 'spec'),
    ).toBe(false);

    mocks.setJSON.mockClear();
    dispatch.mockClear();
    send(applyNoteUpdated(WS_1, 'spec', { ...specNote('# Plan'), rev: 1 }));
    await settle();
    send(applyNoteUpdated(WS_1, 'spec', { ...specNote('# Plan revised'), rev: 2 }));
    await settle();

    const workspace = getState().panelLayout.byWorkspaceId[WS_1];
    const specTabs = Object.values(workspace.panels)
      .flatMap((panel: any) => panel.tabs)
      .filter((candidate: any) => candidate.type === 'note' && candidate.noteId === 'spec');
    expect(specTabs).toHaveLength(1);
    expect(workspace.newWorkspaceLifecycle.spec.state).toBe('revealed');
    expect(workspace.columnCount).toBe(2);
    const order = workspace.root.type === 'split' ? workspace.root.children : [];
    expect(order).toHaveLength(2);
    expect(
      workspace.panels[order[0].type === 'panel' ? order[0].panelId : ''].tabs[0],
    ).toMatchObject({
      type: 'agent',
      agentId: 'agent-1',
    });
    expect(
      workspace.panels[order[1].type === 'panel' ? order[1].panelId : ''].tabs.at(-1),
    ).toMatchObject({ type: 'note', noteId: 'spec' });
    expect(
      dispatch.mock.calls.filter(([action]) => action.type === revealDeferredSpecTab.type),
    ).toHaveLength(1);
    expect(
      dispatch.mock.calls.some(([action]) => action.type === 'tabState/openWorkspaceTab'),
    ).toBe(false);
    expect(mocks.setJSON.mock.calls.at(-1)?.[1]).toMatchObject({
      newWorkspaceLifecycle: { spec: { state: 'revealed' } },
    });
    await cancelSaga(task);
  });

  it('reconciles the configured count before opening ordinary content on the right', async () => {
    const state: any = storeState();
    state.panelLayout.byWorkspaceId[WS_1].columnCount = 3;
    const { channel, dispatch, task } = startSaga(state);
    const action = openTabInRightmostColumnRequested(
      WS_1,
      { type: 'note', title: 'Plan', noteId: 'plan', closable: true },
      { allowDuplicate: true, newTabId: 'tab-plan' },
      123,
    );

    channel.put(action);
    await settle();

    expect(dispatch.mock.calls.slice(0, 2).map(([dispatched]) => dispatched.type)).toEqual([
      'panelLayout/reconcilePanelColumnCount',
      'panelLayout/openTabInRightmostColumn',
    ]);
    expect(dispatch.mock.calls[0]?.[0]).toMatchObject({ payload: { wsId: WS_1, count: 3 } });
    expect(dispatch.mock.calls[1]?.[0]).toMatchObject({
      payload: {
        wsId: WS_1,
        newTabId: 'tab-plan',
        allowDuplicate: true,
        timestamp: 123,
      },
    });
    await cancelSaga(task);
  });

  // An agent-driven visible open activates the tab in the rightmost column
  // (so it paints and can be captured) but never moves panel focus; the
  // scroll-into-view reveal is dropped when this window does not display the
  // workspace (jsdom's route is `/`) and kept when it does (monorepo#3045).
  it.each([
    ['not displayed', '/', true],
    ['displayed', `/workspace/${WS_1}`, false],
  ])(
    'routes agent-driven content into the rightmost stack, activated without focus (%s)',
    async (_label, route, revealDropped) => {
      window.history.pushState({}, '', route);
      let state: any = storeState();
      state.panelLayout.byWorkspaceId[WS_1].columnCount = 2;
      const focusedBefore = state.panelLayout.byWorkspaceId[WS_1].focusedPanelId;
      const channel = stdChannel();
      const dispatch = vi.fn((action) => {
        state = { ...state, panelLayout: panelLayoutReducer(state.panelLayout, action) };
      });
      const task = runSaga(
        { channel, dispatch, getState: () => state },
        watchRightmostColumnRequests,
      );

      try {
        channel.put(
          openTabInRightmostColumnRequested(
            WS_1,
            { type: 'browser', title: 'Browser', browserUrl: 'https://example.test' },
            { newTabId: 'browser-1', agentDriven: true },
            123,
          ),
        );
        await settle();

        expect(dispatch.mock.calls.map(([action]) => action.type)).toEqual([
          'panelLayout/reconcilePanelColumnCount',
          'panelLayout/openTabInRightmostColumn',
          ...(revealDropped
            ? ['panelLayout/consumePanelReveal', 'panelLayout/consumePendingFocus']
            : []),
        ]);
        expect(dispatch.mock.calls[1]?.[0]).toMatchObject({ payload: { preserveFocus: true } });
        const workspace = state.panelLayout.byWorkspaceId[WS_1];
        const rightmostPanelId =
          workspace.root.type === 'split'
            ? workspace.root.children.at(-1).panelId
            : workspace.root.panelId;
        const rightmostPanel = workspace.panels[rightmostPanelId];
        expect(rightmostPanel.activeTabId).toBe('browser-1');
        expect(rightmostPanel.tabs.map((tab: { id: string }) => tab.id)).toContain('browser-1');
        expect(rightmostPanel.attentionTabIds ?? []).not.toContain('browser-1');
        expect(workspace.focusedPanelId).toBe(focusedBefore);
        expect(workspace.pendingFocusTabId).toBeNull();
        expect(workspace.pendingPanelReveal).toEqual(
          revealDropped
            ? null
            : expect.objectContaining({ panelId: rightmostPanelId, tabId: 'browser-1' }),
        );
      } finally {
        await cancelSaga(task);
        window.history.pushState({}, '', '/');
      }
    },
  );

  it.each([true, false])(
    'preserves the production bootstrap when coordinator=%s mounts before persistence',
    async (coordinator) => {
      const seeded = panelLayoutReducer(
        { byWorkspaceId: {} },
        bootstrapNewWorkspaceLayout(WS_1, 'agent-1', 'Initial agent', coordinator),
      ).byWorkspaceId[WS_1];
      const mounted = startRestoreSaga(null, [], seeded);
      await settle();

      const workspace = mounted.getState().panelLayout.byWorkspaceId[WS_1];
      const agentPanels = Object.values(workspace.panels).filter((panel: any) =>
        panel.tabs.some((candidate: any) => candidate.agentId === 'agent-1'),
      );
      expect(agentPanels).toHaveLength(1);
      expect(agentPanels[0]).not.toHaveProperty('pinned');
      expect(workspace.focusedPanelId).toBe(agentPanels[0].id);
      expect(mocks.setJSON.mock.calls.at(-1)?.[1]).toMatchObject({
        newWorkspaceLifecycle: { initialAgentId: 'agent-1', initialAgentPending: false },
      });
      await cancelSaga(mounted.task);
    },
  );

  it('resolves an existing delayed agent snapshot during production mount without duplication', async () => {
    const seeded = panelLayoutReducer(
      { byWorkspaceId: {} },
      bootstrapNewWorkspaceLayout(WS_1, null, 'Initial agent', false),
    ).byWorkspaceId[WS_1];
    const initial = agent('agent-delayed', 'Delayed agent');
    const mounted = startRestoreSaga(null, [initial], seeded);
    await settle();
    mounted.send(setAgents(WS_1, [initial]));
    await settle();

    const workspace = mounted.getState().panelLayout.byWorkspaceId[WS_1];
    const agentPanels = Object.values(workspace.panels).filter((panel: any) =>
      panel.tabs.some((candidate: any) => candidate.agentId === initial.id),
    );
    expect(agentPanels).toHaveLength(1);
    expect(agentPanels[0]).not.toHaveProperty('pinned');
    expect(workspace.focusedPanelId).toBe(agentPanels[0].id);
    expect(workspace.newWorkspaceLifecycle).toMatchObject({
      initialAgentId: initial.id,
      initialAgentPending: false,
    });
    await cancelSaga(mounted.task);
  });

  it('resolves delayed agent metadata from the canonical snapshot without duplicates', async () => {
    const { getState, send, task } = startLifecycleSaga();
    await settle();
    send(bootstrapNewWorkspaceLayout(WS_1, null, 'Specialist'));
    await settle();
    const later = {
      id: 'agent-later',
      workspaceId: WS_1,
      name: 'Later',
      createdAt: '2026-07-31T00:01:00.000Z',
    } as AgentSession;
    const canonical = {
      id: 'agent-canonical',
      workspaceId: WS_1,
      name: 'Canonical',
      createdAt: '2026-07-31T00:00:00.000Z',
    } as AgentSession;
    send(setAgents(WS_1, [later, canonical]));
    await settle();
    send(setAgents(WS_1, [later, canonical]));
    await settle();

    const workspace = getState().panelLayout.byWorkspaceId[WS_1];
    expect(Object.values(workspace.panels).flatMap((panel: any) => panel.tabs)).toEqual([
      expect.objectContaining({ type: 'agent', agentId: 'agent-canonical' }),
    ]);
    expect(workspace.newWorkspaceLifecycle).toMatchObject({
      initialAgentId: 'agent-canonical',
      initialAgentPending: false,
    });
    await cancelSaga(task);
  });

  it('persists the canonical bootstrap for exact reload restoration', async () => {
    const lifecycle = startLifecycleSaga();
    await settle();
    lifecycle.send(bootstrapNewWorkspaceLayout(WS_1, 'agent-1', 'Coordinator', true));
    await settle();
    const stored = mocks.setJSON.mock.calls.find(([key]) => key === STORAGE_KEY_1)?.[1];
    expect(stored).toMatchObject({
      deferSpecTab: true,
      newWorkspaceLifecycle: {
        coordinator: true,
        initialAgentId: 'agent-1',
        spec: { state: 'deferred' },
      },
    });
    expect(Object.values(stored.panels).every((panel) => !('pinned' in panel))).toBe(true);
    await cancelSaga(lifecycle.task);

    mocks.getJSON.mockReturnValue(stored);
    const restored = startSaga(storeState(WS_1));
    await settle();
    const initialize = restored.dispatch.mock.calls.find(
      ([action]) => action.type === initializeLayout.type,
    )?.[0];
    expect(initialize?.payload.layout).toEqual(stored);
    await cancelSaga(restored.task);
  });

  it('retroactively restores the active workspace with exact status transitions', async () => {
    mocks.getJSON.mockReturnValue(layout);
    const { dispatch, task } = startSaga(storeState(WS_2), WS_1);
    await settle();

    expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
      setRestoreStatus(WS_1, 'pending'),
      initializeLayout(WS_1, layout),
      setRestoreStatus(WS_1, 'restored'),
    ]);
    await cancelSaga(task);
  });

  it('restores a migrated two-column layout without a second reconciliation', async () => {
    const mismatched: WorkspacePanelLayout = { ...layout, columnCount: 2 };
    const run = startRestoreSaga(mismatched, []);
    await settle();

    const workspace = run.getState().panelLayout.byWorkspaceId[WS_1];
    const panelIds = workspace.root.type === 'split' ? workspace.root.children : [];
    const initialized = run.dispatch.mock.calls
      .map(([action]) => action)
      .find((action) => action.type === initializeLayout.type);

    expect(initialized?.payload.layout.columnCount).toBe(2);
    expect(initialized?.payload.layout.root).toEqual(workspace.root);
    expect(
      run.dispatch.mock.calls.some(([action]) => action.type === reconcilePanelColumnCount.type),
    ).toBe(false);
    expect(panelIds).toHaveLength(2);
    expect(panelIds[0]).toEqual({ type: 'panel', panelId: 'panel-1' });
    expect(workspace.panels['panel-1']).toMatchObject({
      activeTabId: tab.id,
      tabs: [tab],
    });
    expect(workspace.focusedPanelId).toBe('panel-1');
    const missingPanelId = panelIds[1]?.type === 'panel' ? panelIds[1].panelId : '';
    expect(workspace.panels[missingPanelId]).toEqual({
      id: missingPanelId,
      tabs: [],
      activeTabId: null,
      pristine: true,
    });
    expect(workspace.layoutHistory).toEqual([]);
    expect(mocks.saveHistory).not.toHaveBeenCalled();
    expect(mocks.setJSON.mock.calls).toEqual([[STORAGE_KEY_1, initialized?.payload.layout]]);

    const healed = initialized?.payload.layout as WorkspacePanelLayout;
    run.send(panelLayoutScopeUnmounted(WS_1));
    await settle();
    mocks.getJSON.mockReturnValue(healed);
    run.dispatch.mockClear();
    mocks.setJSON.mockClear();
    run.send(panelLayoutScopeMounted(WS_1));
    await settle();

    const repeated = run.getState().panelLayout.byWorkspaceId[WS_1];
    expect(repeated.root.type === 'split' ? repeated.root.children : []).toHaveLength(2);
    expect(
      run.dispatch.mock.calls.some(([action]) => action.type === reconcilePanelColumnCount.type),
    ).toBe(false);
    expect(mocks.setJSON).not.toHaveBeenCalled();
    await cancelSaga(run.task);
  });

  it.each([
    {
      name: 'narrow overlapping geometry',
      stored: narrowOverlappingGeometryFixture(WS_1),
      expectedOrder: ['narrow-left', 'narrow-middle', 'wide-right'],
      expectedFocus: 'narrow-middle',
      expectedActive: ['left-active', 'middle-active', 'right-active'],
    },
    {
      name: 'displaced orphan sliver placement',
      stored: displacedOrphanSliverFixture(WS_1),
      expectedOrder: ['anchored-left', 'displaced'],
      expectedFocus: 'displaced',
      expectedActive: ['left-active', 'recovered-active'],
    },
  ])('repairs and persists $name once, then restores it stably', async (fixture) => {
    const first = startRestoreSaga(fixture.stored, []);
    await settle();

    expect(mocks.setJSON).toHaveBeenCalledTimes(1);
    const repaired = mocks.setJSON.mock.calls[0]?.[1] as WorkspacePanelLayout;
    const repairedOrder =
      repaired.root.type === 'panel'
        ? [repaired.root.panelId]
        : repaired.root.children.map((child) =>
            child.type === 'panel' ? child.panelId : 'nested',
          );
    expect(repairedOrder).toEqual(fixture.expectedOrder);
    expect(repaired.root.type === 'split' ? repaired.root.sizes : [100]).toEqual(
      fixture.expectedOrder.map(() => 100 / fixture.expectedOrder.length),
    );
    expect(repaired.focusedPanelId).toBe(fixture.expectedFocus);
    expect(fixture.expectedOrder.map((panelId) => repaired.panels[panelId].activeTabId)).toEqual(
      fixture.expectedActive,
    );
    await cancelSaga(first.task);

    mocks.setJSON.mockClear();
    const second = startRestoreSaga(repaired, []);
    await settle();

    const initialized = second.dispatch.mock.calls.find(
      ([action]) => action.type === initializeLayout.type,
    )?.[0].payload.layout;
    expect(initialized).toEqual(repaired);
    expect(mocks.setJSON).not.toHaveBeenCalled();
    await cancelSaga(second.task);
  });

  it('derives a legacy one-panel count after a stale same-backend remount', async () => {
    const selected = panelLayoutReducer(undefined, setPanelColumnCount(WS_1, 3, 10)).byWorkspaceId[
      WS_1
    ];
    const current: WorkspacePanelLayout = {
      version: PANEL_LAYOUT_PERSISTENCE_VERSION,
      root: selected.root,
      panels: selected.panels,
      focusedPanelId: selected.focusedPanelId,
      canvasWidth: selected.canvasWidth,
      canvasWidthSource: selected.canvasWidthSource,
      columnCount: 3,
    };
    const legacy: WorkspacePanelLayout = {
      root: { type: 'panel', panelId: 'legacy' },
      panels: { legacy: { id: 'legacy', tabs: [tab], activeTabId: tab.id } },
      focusedPanelId: 'legacy',
      canvasWidth: 1600,
    };
    const run = startRestoreSaga(current, [], selected);
    await settle();
    const history = run.getState().panelLayout.byWorkspaceId[WS_1].layoutHistory;
    mocks.getJSON.mockReturnValue(legacy);
    run.dispatch.mockClear();
    mocks.setJSON.mockClear();

    run.send(panelLayoutScopeUnmounted(WS_1));
    await settle();
    run.send(panelLayoutScopeMounted(WS_1));
    await settle();

    const restored = run.getState().panelLayout.byWorkspaceId[WS_1];
    expect(
      run.dispatch.mock.calls.find(
        ([action]) => action.type === preparePanelLayoutBackendRestore.type,
      )?.[0],
    ).toEqual(preparePanelLayoutBackendRestore(WS_1));
    expect(
      run.dispatch.mock.calls.find(([action]) => action.type === initializeLayout.type)?.[0].payload
        .layout.columnCount,
    ).toBe(1);
    expect(
      run.dispatch.mock.calls.some(([action]) => action.type === reconcilePanelColumnCount.type),
    ).toBe(false);
    expect(restored).toMatchObject({
      root: { type: 'panel', panelId: 'legacy' },
      focusedPanelId: 'legacy',
      canvasWidth: null,
      canvasWidthSource: null,
      columnCount: 1,
    });
    expect(restored.panels.legacy).toMatchObject({ activeTabId: tab.id, tabs: [tab] });
    expect(restored.layoutHistory).toBe(history);
    expect(mocks.saveHistory).not.toHaveBeenCalled();
    expect(mocks.setJSON.mock.calls.at(-1)).toEqual([
      STORAGE_KEY_1,
      expect.objectContaining({
        root: { type: 'panel', panelId: 'legacy' },
        focusedPanelId: 'legacy',
        canvasWidth: null,
        canvasWidthSource: null,
        columnCount: 1,
      }),
    ]);
    await cancelSaga(run.task);
  });

  it('restores a legacy initial-agent layout without adding pin state', async () => {
    const legacyAgentTab = {
      ...tab,
      type: 'agent' as const,
      agentId: 'agent-1',
      workspaceId: WS_1,
    };
    const legacyLayout: WorkspacePanelLayout = {
      ...layout,
      panels: {
        'panel-1': { id: 'panel-1', tabs: [legacyAgentTab], activeTabId: legacyAgentTab.id },
      },
      newWorkspaceLifecycle: {
        coordinator: true,
        initialAgentId: 'agent-1',
        initialAgentPending: false,
        spec: { noteId: 'spec', generation: null, state: 'revealed' },
      },
    };
    mocks.getJSON.mockReturnValue(legacyLayout);
    const { dispatch, task } = startSaga(storeState(WS_1));
    await settle();

    const restored = dispatch.mock.calls.find(
      ([action]) => action.type === initializeLayout.type,
    )?.[0].payload.layout;
    expect(restored.panels['panel-1']).not.toHaveProperty('pinned');
    await cancelSaga(task);
  });

  it('removes an explicit legacy unpin during restore', async () => {
    const explicitUnpin: WorkspacePanelLayout = {
      ...layout,
      panels: {
        'panel-1': {
          ...layout.panels['panel-1'],
          tabs: [{ ...tab, type: 'agent', agentId: 'agent-1', workspaceId: WS_1 }],
          pinned: false,
        },
      },
    };
    mocks.getJSON.mockReturnValue(explicitUnpin);
    const { dispatch, task } = startSaga(storeState(WS_1));
    await settle();

    const restored = dispatch.mock.calls.find(
      ([action]) => action.type === initializeLayout.type,
    )?.[0].payload.layout;
    expect(restored.panels['panel-1']).not.toHaveProperty('pinned');
    await cancelSaga(task);
  });

  it('removes all pin state from a partially migrated layout', async () => {
    const initialAgentTab = {
      ...tab,
      type: 'agent' as const,
      agentId: 'agent-1',
      workspaceId: WS_1,
    };
    const partiallyMigrated: WorkspacePanelLayout = {
      root: {
        type: 'split',
        direction: 'horizontal',
        children: [
          { type: 'panel', panelId: 'panel-1' },
          { type: 'panel', panelId: 'panel-2' },
        ],
        sizes: [50, 50],
      },
      panels: {
        'panel-1': { id: 'panel-1', tabs: [initialAgentTab], activeTabId: initialAgentTab.id },
        'panel-2': { id: 'panel-2', tabs: [], activeTabId: null, pinned: true },
      },
      focusedPanelId: 'panel-1',
      newWorkspaceLifecycle: {
        coordinator: true,
        initialAgentId: 'agent-1',
        initialAgentPending: false,
        spec: { noteId: 'spec', generation: null, state: 'revealed' },
      },
    };
    mocks.getJSON.mockReturnValue(partiallyMigrated);
    const { dispatch, task } = startSaga(storeState(WS_1));
    await settle();

    const restored = dispatch.mock.calls.find(
      ([action]) => action.type === initializeLayout.type,
    )?.[0].payload.layout;
    expect(Object.keys(restored.panels)).toEqual(['panel-1', 'panel-2']);
    expect(restored.panels['panel-1']).not.toHaveProperty('pinned');
    expect(restored.panels['panel-2']).not.toHaveProperty('pinned');
    await cancelSaga(task);
  });

  it('removes foreign workspace panels while restoring persisted layout state', async () => {
    const foreignTab = { ...tab, id: 'foreign-tab', workspaceId: WS_2 };
    const contaminatedLayout: WorkspacePanelLayout = {
      root: {
        type: 'split',
        direction: 'horizontal',
        children: [layout.root, { type: 'panel', panelId: 'foreign-panel' }],
        sizes: [50, 50],
      },
      panels: {
        ...layout.panels,
        'foreign-panel': {
          id: 'foreign-panel',
          tabs: [foreignTab],
          activeTabId: foreignTab.id,
        },
      },
      focusedPanelId: 'foreign-panel',
    };
    mocks.getJSON.mockReturnValue(contaminatedLayout);
    const { dispatch, task } = startSaga(storeState(WS_1));
    await settle();

    expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
      setRestoreStatus(WS_1, 'pending'),
      initializeLayout(WS_1, layout),
      setRestoreStatus(WS_1, 'restored'),
    ]);
    await cancelSaga(task);
  });

  it('marks missing and malformed mount storage exactly and skips invalid workspace ids', async () => {
    mocks.getJSON.mockImplementation((key: string) =>
      key.endsWith(WS_1) ? undefined : { bad: true },
    );
    const { channel, dispatch, task } = startSaga();
    await settle();
    channel.put(workspaceMounted(WS_1));
    channel.put(workspaceMounted(WS_2));
    channel.put(workspaceMounted('optimistic-new'));
    await settle();

    expect(dispatch.mock.calls.map(([action]) => action.type)).toEqual([
      setRestoreStatus.type,
      resetLayout.type,
      setRestoreStatus.type,
      setRestoreStatus.type,
      resetLayout.type,
      setRestoreStatus.type,
    ]);
    expect(
      dispatch.mock.calls
        .map(([action]) => action)
        .filter((action) => action.type === setRestoreStatus.type),
    ).toEqual([
      setRestoreStatus(WS_1, 'pending'),
      setRestoreStatus(WS_1, 'empty'),
      setRestoreStatus(WS_2, 'pending'),
      setRestoreStatus(WS_2, 'invalid'),
    ]);
    await cancelSaga(task);
  });

  describe('empty restored layout reconciliation', () => {
    const emptyStoredLayout: WorkspacePanelLayout = {
      root: { type: 'panel', panelId: 'empty-panel' },
      panels: { 'empty-panel': { id: 'empty-panel', tabs: [], activeTabId: null } },
      focusedPanelId: 'empty-panel',
    };
    const foreignOnlyLayout: WorkspacePanelLayout = {
      root: { type: 'panel', panelId: 'foreign-panel' },
      panels: {
        'foreign-panel': {
          id: 'foreign-panel',
          tabs: [
            {
              id: 'foreign-tab',
              type: 'agent',
              title: 'Foreign',
              agentId: 'foreign-agent',
              workspaceId: WS_2,
              closable: true,
            },
          ],
          activeTabId: 'foreign-tab',
        },
      },
      focusedPanelId: 'foreign-panel',
    };

    it.each([
      ['missing', undefined, 'agent-initial'],
      ['invalid', { bad: true }, 'agent-recent'],
      ['empty', emptyStoredLayout, 'agent-recent'],
      ['normalized-empty', foreignOnlyLayout, 'agent-recent'],
    ])('opens the expected agent after a %s restore', async (_name, stored, expectedAgentId) => {
      const initial = agent('agent-initial', 'Initial', undefined, { isInitialAgent: true });
      const recent = agent('agent-recent', 'Recent', '2026-07-31T02:00:00.000Z');
      const background = agent('agent-background', 'Background', '2026-07-31T03:00:00.000Z', {
        isBackground: true,
      });
      const delegated = agent('agent-delegated', 'Delegated', '2026-07-31T04:00:00.000Z', {
        metadata: { createdByAgentId: 'agent-initial' },
      });
      const run = startRestoreSaga(stored, [initial, recent, background, delegated]);
      await settle();

      const workspace = run.getState().panelLayout.byWorkspaceId[WS_1];
      const tabs = Object.values(workspace.panels).flatMap((panel: any) => panel.tabs);
      expect(tabs).toEqual([expect.objectContaining({ type: 'agent', agentId: expectedAgentId })]);
      expect(workspace.focusedPanelId).toBeTruthy();
      expect(workspace.pendingFocusTabId).toBe(tabs[0].id);
      expect(
        Object.values(workspace.panels).find((panel: any) => panel.tabs.length > 0),
      ).not.toHaveProperty('pinned');
      expect(mocks.setJSON.mock.calls.at(-1)?.[1]).toMatchObject({
        focusedPanelId: workspace.focusedPanelId,
        panels: workspace.panels,
      });
      await cancelSaga(run.task);
    });

    it.each([
      ['no user-message stamp', {}],
      ['top-level initial marker', { isInitialAgent: true }],
      ['metadata initial marker', { metadata: { isInitialAgent: true } }],
      ['wrong workspace', { workspaceId: WS_2 }],
      ['deleted status', { status: 'deleted' }],
      ['pending deletion', { pendingDeleteAt: '2026-07-31T03:00:00.000Z' }],
      ['background marker', { isBackground: true }],
      ['delegation marker', { metadata: { createdByAgentId: 'agent-parent' } }],
      ['child marker', { parentSessionId: 'agent-parent' }],
    ])('leaves the restored layout empty for %s', async (_name, overrides) => {
      const timestamp = Object.keys(overrides).length ? '2026-07-31T02:00:00.000Z' : undefined;
      const ineligible = agent('agent-ineligible', 'Ineligible', timestamp, overrides);
      const run = startRestoreSaga(emptyStoredLayout, [ineligible]);
      await settle();
      run.dispatch(setAgents(WS_1, [ineligible]));
      await settle();

      const tabs = Object.values(run.getState().panelLayout.byWorkspaceId[WS_1].panels).flatMap(
        (panel: any) => panel.tabs,
      );
      expect(tabs).toEqual([]);
      expect(
        run.dispatch.mock.calls.filter(([action]) => action.type === openTabInAdjacentOrSplit.type),
      ).toHaveLength(0);
      await cancelSaga(run.task);
    });

    it('reconciles once when the agent snapshot arrives after the empty restore', async () => {
      const initial = agent('agent-initial', 'Initial', undefined, { isInitialAgent: true });
      const recent = agent('agent-recent', 'Recent', '2026-07-31T02:00:00.000Z');
      const run = startRestoreSaga(emptyStoredLayout, []);
      await settle();

      run.dispatch(setAgents(WS_1, [initial, recent]));
      run.dispatch(setAgents(WS_1, [initial, recent]));
      await settle();

      const tabs = Object.values(run.getState().panelLayout.byWorkspaceId[WS_1].panels).flatMap(
        (panel: any) => panel.tabs,
      );
      expect(tabs).toEqual([expect.objectContaining({ agentId: 'agent-recent' })]);
      expect(
        run.dispatch.mock.calls.filter(([action]) => action.type === openTabInAdjacentOrSplit.type),
      ).toHaveLength(1);
      await cancelSaga(run.task);
    });

    it('leaves a non-empty restored layout unchanged', async () => {
      const recent = agent('agent-recent', 'Recent', '2026-07-31T02:00:00.000Z');
      const run = startRestoreSaga(layout, [recent]);
      await settle();

      const { version: _version, ...restoredLayout } = layout;
      expect(run.getState().panelLayout.byWorkspaceId[WS_1]).toMatchObject(restoredLayout);
      expect(
        run.dispatch.mock.calls.some(([action]) => action.type === openTabInAdjacentOrSplit.type),
      ).toBe(false);
      await cancelSaga(run.task);
    });

    describe('first-open context-link seeding (workspaces created elsewhere)', () => {
      const contextLinks: ContextLink[] = [
        {
          kind: 'issue',
          url: 'https://github.com/acme/widgets/issues/7',
          owner: 'acme',
          repo: 'widgets',
          number: 7,
        },
        {
          kind: 'pr',
          url: 'https://github.com/acme/widgets/pull/9',
          owner: 'acme',
          repo: 'widgets',
          number: 9,
        },
      ];

      function expectSeededSplit(workspace: any, agentId: string) {
        expect(workspace.root.type).toBe('split');
        const order = workspace.root.type === 'split' ? workspace.root.children : [];
        const agentPanelId = order[0]?.type === 'panel' ? order[0].panelId : '';
        const browserPanelId = order[1]?.type === 'panel' ? order[1].panelId : '';
        expect(workspace.panels[agentPanelId].tabs).toEqual([
          expect.objectContaining({ type: 'agent', agentId }),
        ]);
        expect(workspace.panels[browserPanelId].tabs).toEqual(
          contextLinks.map((link) =>
            expect.objectContaining({ type: 'browser', browserUrl: link.url }),
          ),
        );
        expect(workspace.columnCount).toBe(2);
      }

      it('seeds the split on a missing restore when the workspace has context links', async () => {
        const initial = agent('agent-initial', 'Initial', undefined, { isInitialAgent: true });
        const run = startRestoreSaga(undefined, [initial], emptyWorkspaceState, contextLinks);
        await settle();

        expectSeededSplit(run.getState().panelLayout.byWorkspaceId[WS_1], 'agent-initial');
        expect(mocks.setJSON.mock.calls.at(-1)?.[1]).toMatchObject({
          panels: run.getState().panelLayout.byWorkspaceId[WS_1].panels,
        });
        await cancelSaga(run.task);
      });

      it('seeds once when the agent snapshot arrives after the missing restore', async () => {
        const initial = agent('agent-initial', 'Initial', undefined, { isInitialAgent: true });
        const run = startRestoreSaga(undefined, [], emptyWorkspaceState, contextLinks);
        await settle();

        expect(
          Object.values(run.getState().panelLayout.byWorkspaceId[WS_1].panels).flatMap(
            (panel: any) => panel.tabs,
          ),
        ).toEqual([]);

        run.dispatch(setAgents(WS_1, [initial]));
        run.dispatch(setAgents(WS_1, [initial]));
        await settle();

        expectSeededSplit(run.getState().panelLayout.byWorkspaceId[WS_1], 'agent-initial');
        expect(
          run.dispatch.mock.calls.filter(
            ([action]) => action.type === openTabInAdjacentOrSplit.type,
          ),
        ).toHaveLength(1);
        await cancelSaga(run.task);
      });

      it.each([
        ['a stored empty layout (user closed all tabs)', emptyStoredLayout],
        ['an invalid stored layout', { bad: true }],
      ])('does not seed after %s', async (_name, stored) => {
        const recent = agent('agent-recent', 'Recent', '2026-07-31T02:00:00.000Z');
        const run = startRestoreSaga(stored, [recent], emptyWorkspaceState, contextLinks);
        await settle();

        const workspace = run.getState().panelLayout.byWorkspaceId[WS_1];
        expect(workspace.root.type).toBe('panel');
        const tabs = Object.values(workspace.panels).flatMap((panel: any) => panel.tabs);
        expect(tabs).toEqual([expect.objectContaining({ type: 'agent', agentId: 'agent-recent' })]);
        await cancelSaga(run.task);
      });

      it('does not seed when no agent is resolvable yet', async () => {
        const run = startRestoreSaga(undefined, [], emptyWorkspaceState, contextLinks);
        await settle();

        const workspace = run.getState().panelLayout.byWorkspaceId[WS_1];
        expect(workspace.root.type).toBe('panel');
        expect(Object.values(workspace.panels).flatMap((panel: any) => panel.tabs)).toEqual([]);
        await cancelSaga(run.task);
      });

      it('defers a first open that races the workspace-list load, then seeds when the entity arrives', async () => {
        const initial = agent('agent-initial', 'Initial', undefined, { isInitialAgent: true });
        const run = startRestoreSaga(undefined, [initial], emptyWorkspaceState, undefined, {
          workspaceListLoaded: false,
        });
        await settle();

        // Record not landed + list not loaded: no tab may open, or the seed
        // would be permanently lost to a persisted linkless layout.
        expect(
          Object.values(run.getState().panelLayout.byWorkspaceId[WS_1].panels).flatMap(
            (panel: any) => panel.tabs,
          ),
        ).toEqual([]);

        run.dispatch(setWorkspaceEntity({ id: WS_1, contextLinks } as unknown as Workspace));
        await settle();

        expectSeededSplit(run.getState().panelLayout.byWorkspaceId[WS_1], 'agent-initial');
        await cancelSaga(run.task);
      });

      it('opens the plain agent tab when the record is still missing after the list load', async () => {
        const initial = agent('agent-initial', 'Initial', undefined, { isInitialAgent: true });
        const run = startRestoreSaga(undefined, [initial], emptyWorkspaceState, undefined, {
          workspaceListLoaded: false,
        });
        await settle();

        expect(
          Object.values(run.getState().panelLayout.byWorkspaceId[WS_1].panels).flatMap(
            (panel: any) => panel.tabs,
          ),
        ).toEqual([]);

        run.dispatch(setWorkspaceHasLoaded(true));
        await settle();

        const workspace = run.getState().panelLayout.byWorkspaceId[WS_1];
        expect(workspace.root.type).toBe('panel');
        const tabs = Object.values(workspace.panels).flatMap((panel: any) => panel.tabs);
        expect(tabs).toEqual([
          expect.objectContaining({ type: 'agent', agentId: 'agent-initial' }),
        ]);
        await cancelSaga(run.task);
      });

      it('keeps the plain single-agent reconciliation without context links', async () => {
        const initial = agent('agent-initial', 'Initial', undefined, { isInitialAgent: true });
        const run = startRestoreSaga(undefined, [initial], emptyWorkspaceState, []);
        await settle();

        const workspace = run.getState().panelLayout.byWorkspaceId[WS_1];
        expect(workspace.root.type).toBe('panel');
        const tabs = Object.values(workspace.panels).flatMap((panel: any) => panel.tabs);
        expect(tabs).toEqual([
          expect.objectContaining({ type: 'agent', agentId: 'agent-initial' }),
        ]);
        await cancelSaga(run.task);
      });
    });
  });

  it('restores and cleans up a rendered canonical panel-layout scope', async () => {
    mocks.getJSON.mockReturnValue(layout);
    const { channel, dispatch, task } = startSaga();
    await settle();
    channel.put(panelLayoutScopeMounted(WS_1));
    await settle();

    expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
      setRestoreStatus(WS_1, 'pending'),
      initializeLayout(WS_1, layout),
      setRestoreStatus(WS_1, 'restored'),
    ]);

    channel.put(panelLayoutScopeUnmounted(WS_1));
    await settle();
    expect(mocks.clearAdapter).toHaveBeenCalledWith(WS_1);
    await cancelSaga(task);
  });

  describe('restart rehydration of tunneled browser tabs (monorepo#2789)', () => {
    const REQUESTED = 'http://daemon.localhost:3000/';
    const DEAD_TUNNEL = 'http://127.0.0.1:52345/';
    const FRESH_TUNNEL = 'http://127.0.0.1:61111/';

    function browserLayout(tabOverrides: Record<string, unknown> = {}): WorkspacePanelLayout {
      const browserTab = {
        id: 'tab-b',
        type: 'browser' as const,
        title: 'Browser',
        closable: true,
        browserUrl: DEAD_TUNNEL,
        browserRequestedUrl: REQUESTED,
        ...tabOverrides,
      };
      return {
        root: { type: 'panel', panelId: 'panel-1' },
        panels: {
          'panel-1': { id: 'panel-1', tabs: [browserTab], activeTabId: browserTab.id },
        },
        focusedPanelId: 'panel-1',
        canvasWidth: null,
        canvasWidthSource: null,
      };
    }

    // The rehydration saga re-reads the store before retargeting (stale
    // guard), so these tests need state that reflects the saga's own
    // dispatches (initializeLayout, updateTabBrowserUrl) — unlike startSaga's
    // static state.
    function startReducingSaga(options: { backendId?: () => string } = {}) {
      const getBackendId = options.backendId ?? (() => LOCAL_CONNECTION_ID);
      let panelLayout: ReturnType<typeof panelLayoutReducer> = { byWorkspaceId: {} };
      const channel = stdChannel();
      const dispatch = vi.fn((action) => {
        panelLayout = panelLayoutReducer(panelLayout, action);
        channel.put(action);
      });
      const getState = () => ({
        ...storeState(WS_1, getBackendId()),
        panelLayout,
      });
      const task = runSaga({ channel, dispatch, getState }, panelLayoutSaga, {
        activeWorkspaceId: null,
      });
      return { channel, dispatch, getState, task };
    }

    it('re-resolves a restored tunneled tab onto the fresh endpoint', async () => {
      mocks.getJSON.mockReturnValue(browserLayout());
      mocks.resolveBrowserLinkUrl.mockResolvedValue({
        url: FRESH_TUNNEL,
        rewritten: true,
        requestedUrl: REQUESTED,
        tunneled: true,
      });
      const { channel, dispatch, task } = startReducingSaga();
      await settle();
      channel.put(workspaceMounted(WS_1));
      await settle();

      expect(mocks.resolveBrowserLinkUrl).toHaveBeenCalledWith(REQUESTED, expect.anything());
      expect(dispatch.mock.calls.map(([action]) => action)).toContainEqual(
        updateTabBrowserUrl(WS_1, 'tab-b', FRESH_TUNNEL, REQUESTED),
      );
      await cancelSaga(task);
    });

    it('leaves the tab untouched when the resolution lands on the stored URL', async () => {
      mocks.getJSON.mockReturnValue(browserLayout());
      mocks.resolveBrowserLinkUrl.mockResolvedValue({
        url: DEAD_TUNNEL,
        rewritten: true,
        requestedUrl: REQUESTED,
      });
      const { channel, dispatch, task } = startReducingSaga();
      await settle();
      channel.put(workspaceMounted(WS_1));
      await settle();

      expect(dispatch.mock.calls.some(([action]) => action.type === updateTabBrowserUrl.type)).toBe(
        false,
      );
      await cancelSaga(task);
    });

    it('never resolves legacy layouts without a requested URL (byte-identical restore)', async () => {
      mocks.getJSON.mockReturnValue(browserLayout({ browserRequestedUrl: undefined }));
      const { channel, dispatch, task } = startSaga();
      await settle();
      channel.put(workspaceMounted(WS_1));
      await settle();

      expect(mocks.resolveBrowserLinkUrl).not.toHaveBeenCalled();
      expect(dispatch.mock.calls.some(([action]) => action.type === updateTabBrowserUrl.type)).toBe(
        false,
      );
      await cancelSaga(task);
    });

    it('falls back to the requested URL when the rewrite cannot be established', async () => {
      mocks.getJSON.mockReturnValue(browserLayout());
      // resolveBrowserLinkUrl never throws: a failed resolution passes the
      // URL through unresolved, so the tab lands on its requested URL and the
      // normal navigation error path shows instead of the dead port.
      mocks.resolveBrowserLinkUrl.mockResolvedValue({ url: REQUESTED, rewritten: false });
      const { channel, dispatch, task } = startReducingSaga();
      await settle();
      channel.put(workspaceMounted(WS_1));
      await settle();

      expect(dispatch.mock.calls.map(([action]) => action)).toContainEqual(
        updateTabBrowserUrl(WS_1, 'tab-b', REQUESTED, REQUESTED),
      );
      await cancelSaga(task);
    });

    it('re-resolves restored tunneled tabs on the backend-switch restore path too', async () => {
      const remoteKey = `backend:${REMOTE_ID}:${PANEL_LAYOUT_STORAGE_KEY_PREFIX}${WS_1}`;
      mocks.getJSON.mockImplementation((key: string) =>
        key === remoteKey ? browserLayout() : undefined,
      );
      mocks.resolveBrowserLinkUrl.mockResolvedValue({
        url: FRESH_TUNNEL,
        rewritten: true,
        requestedUrl: REQUESTED,
        tunneled: true,
      });
      let backendId = LOCAL_CONNECTION_ID;
      const { channel, dispatch, task } = startReducingSaga({ backendId: () => backendId });
      await settle();
      channel.put(workspaceMounted(WS_1));
      await settle();
      dispatch.mockClear();

      backendId = REMOTE_ID;
      channel.put(
        connectionsListReceived({
          connections: [],
          activeId: REMOTE_ID,
          windowBackendId: REMOTE_ID,
        }),
      );
      await settle();

      expect(mocks.resolveBrowserLinkUrl).toHaveBeenCalledWith(REQUESTED, expect.anything());
      expect(dispatch.mock.calls.map(([action]) => action)).toContainEqual(
        updateTabBrowserUrl(WS_1, 'tab-b', FRESH_TUNNEL, REQUESTED),
      );
      await cancelSaga(task);
    });

    it('drops a stale resolution when the tab navigated while the probe was in flight', async () => {
      mocks.getJSON.mockReturnValue(browserLayout());
      let resolveProbe!: (value: unknown) => void;
      mocks.resolveBrowserLinkUrl.mockReturnValue(
        new Promise((resolve) => {
          resolveProbe = resolve;
        }),
      );
      const { channel, dispatch, task } = startReducingSaga();
      await settle();
      channel.put(workspaceMounted(WS_1));
      await settle();

      // User navigates the tab while the dead-port probe is still running
      // (harness dispatch reduces the store and forwards to the channel).
      dispatch(updateTabBrowserUrl(WS_1, 'tab-b', 'http://127.0.0.1:59999/', REQUESTED));
      dispatch.mockClear();

      resolveProbe({ url: FRESH_TUNNEL, rewritten: true, requestedUrl: REQUESTED, tunneled: true });
      await settle();

      // The late resolution must not clobber the newer navigation.
      expect(dispatch.mock.calls.some(([action]) => action.type === updateTabBrowserUrl.type)).toBe(
        false,
      );
      await cancelSaga(task);
    });

    it('settles hydration while rehydration probes are still in flight (listTabs must not time out)', async () => {
      mocks.getJSON.mockReturnValue(browserLayout());
      // A never-settling resolution simulates the dead-port reachability
      // probe (1.5s+ per tab). Hydration callers (browser IPC listTabs, with
      // main's 500ms timeout) wait on the restore settling — an attached
      // rehydration fork would hold `call(handleWorkspaceMountedRestore)`
      // open until every probe finishes.
      mocks.resolveBrowserLinkUrl.mockReturnValue(new Promise(() => {}));
      const { channel, dispatch, task } = startSaga();
      await settle();

      let hydrated = false;
      const state = storeState();
      const waiter = runSaga({ channel, dispatch, getState: () => state }, function* () {
        yield* hydrateWorkspaceLayout(WS_1);
        hydrated = true;
      });
      await settle();

      expect(mocks.resolveBrowserLinkUrl).toHaveBeenCalled();
      expect(hydrated).toBe(true);
      expect(dispatch.mock.calls.map(([action]) => action)).toContainEqual(
        setRestoreStatus(WS_1, 'restored'),
      );
      await waiter.toPromise();
      await cancelSaga(task);
    });

    it('settles every mounted workspace on switch while rehydration probes are still in flight', async () => {
      const remoteKey2 = `backend:${REMOTE_ID}:${PANEL_LAYOUT_STORAGE_KEY_PREFIX}${WS_2}`;
      mocks.getJSON.mockImplementation((key: string) =>
        key === REMOTE_STORAGE_KEY_1 || key === remoteKey2 ? browserLayout() : undefined,
      );
      // Both workspaces restore a tunneled tab whose probe never settles. An
      // attached fork would serialize the probes into the switch restore
      // loop, leaving WS_2's pre-registered inflight entry pending.
      mocks.resolveBrowserLinkUrl.mockReturnValue(new Promise(() => {}));
      let backendId = LOCAL_CONNECTION_ID;
      const channel = stdChannel();
      const dispatch = vi.fn();
      const getState = () => storeState(WS_1, backendId);
      const task = runSaga({ channel, dispatch, getState }, panelLayoutSaga, {
        activeWorkspaceId: WS_1,
      });
      await settle();
      channel.put(workspaceMounted(WS_2));
      await settle();
      dispatch.mockClear();

      backendId = REMOTE_ID;
      channel.put(
        connectionsListReceived({
          connections: [],
          activeId: REMOTE_ID,
          windowBackendId: REMOTE_ID,
        }),
      );
      await settle();

      let waited = false;
      const waiter = runSaga({ channel, dispatch, getState }, function* () {
        yield* waitForWorkspaceLayoutRestore(WS_2);
        waited = true;
      });
      await settle();

      expect(mocks.resolveBrowserLinkUrl).toHaveBeenCalled();
      expect(waited).toBe(true);
      const dispatched = dispatch.mock.calls.map(([action]) => action);
      expect(dispatched).toContainEqual(setRestoreStatus(WS_1, 'restored'));
      expect(dispatched).toContainEqual(setRestoreStatus(WS_2, 'restored'));
      await waiter.toPromise();
      await cancelSaga(task);
    });
  });

  it.each([
    {
      name: 'drops an unprovenanced legacy fill',
      stored: { ...layout, canvasWidth: 1600, canvasWidthSource: undefined },
      expectedWidth: null,
      expectedSource: null,
    },
    {
      name: 'preserves a proven user width',
      stored: { ...layout, canvasWidth: 720, canvasWidthSource: 'explicit' as const },
      expectedWidth: 720,
      expectedSource: 'explicit',
    },
  ])('$name during restore', async ({ stored, expectedWidth, expectedSource }) => {
    mocks.getJSON.mockReturnValue(stored);
    const { channel, dispatch, task } = startSaga();
    await settle();
    channel.put(panelLayoutScopeMounted(WS_1));
    await settle();

    const restored = dispatch.mock.calls.find(
      ([action]) => action.type === initializeLayout.type,
    )?.[0].payload.layout;
    expect(restored).toMatchObject({
      canvasWidth: expectedWidth,
      canvasWidthSource: expectedSource,
    });
    await cancelSaga(task);
  });

  it('persists explicit width provenance with the exact user width', async () => {
    mocks.getJSON.mockReturnValue(undefined);
    const state = storeState();
    state.panelLayout.byWorkspaceId[WS_1] = {
      ...workspaceState(),
      canvasWidth: 720,
      canvasWidthSource: 'explicit',
    };
    const { channel, task } = startSaga(state);
    await settle();
    channel.put({ type: focusPanel.type, payload: [WS_1, 'panel-1'] });
    await settle();

    expect(mocks.setJSON.mock.calls[0]?.[1]).toMatchObject({
      canvasWidth: 720,
      canvasWidthSource: 'explicit',
    });
    await cancelSaga(task);
  });

  it.each(persistActionCreators)(
    'persists the exact post-reducer layout for $type',
    async (creator) => {
      mocks.getJSON.mockReturnValue(undefined);
      const { channel, task } = startSaga();
      await settle();
      channel.put({ type: creator.type, payload: { wsId: WS_1 } });
      await settle();

      expect(mocks.setJSON.mock.calls).toEqual([[STORAGE_KEY_1, layout]]);
      await cancelSaga(task);
    },
  );

  it('persists and snapshots a reopened panel column through one watcher', async () => {
    const { channel, task } = startSaga();
    await settle();
    channel.put({ type: reopenClosedPanelColumn.type, payload: { wsId: WS_1 } });
    await settle();

    expect(mocks.setJSON.mock.calls).toEqual([[STORAGE_KEY_1, layout]]);
    await vi.advanceTimersByTimeAsync(HISTORY_PERSIST_DEBOUNCE_MS);
    await settle();
    expect(mocks.saveHistory).toHaveBeenCalledWith(
      WS_1,
      expect.objectContaining({ workspaceId: WS_1, history: [snapshot] }),
      LOCAL_CONNECTION_ID,
    );
    await cancelSaga(task);
  });

  it('does not reconcile other workspaces when one workspace changes its column count', async () => {
    const state = storeState();
    const { channel, dispatch, task } = startSaga(state);
    await settle();
    dispatch.mockClear();

    channel.put(setPanelColumnCount(WS_1, 3));
    await settle();

    expect(
      dispatch.mock.calls
        .map(([action]) => action)
        .filter((action) => action.type === reconcilePanelColumnCount.type),
    ).toEqual([]);

    await cancelSaga(task);
  });

  it('persists hidden tabs without adding panel history', async () => {
    mocks.getJSON.mockReturnValue(undefined);
    const { channel, task } = startSaga();
    await settle();

    channel.put(openHiddenTab(WS_1, { type: 'browser', title: 'Hidden', closable: true }));
    await settle();

    expect(mocks.setJSON).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(HISTORY_PERSIST_DEBOUNCE_MS);
    await settle();
    expect(mocks.saveHistory).not.toHaveBeenCalled();
    await cancelSaga(task);
  });

  // Sidebar/footer reveals persist without adding panel history
  // (monorepo#3112).
  it('persists revealHiddenTabAvoidingPanel without adding panel history', async () => {
    mocks.getJSON.mockReturnValue(undefined);
    const { channel, task } = startSaga();
    await settle();

    channel.put(revealHiddenTabAvoidingPanel(WS_1, 'tab-hidden', 'panel-1'));
    await settle();

    expect(mocks.setJSON).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(HISTORY_PERSIST_DEBOUNCE_MS);
    await settle();
    expect(mocks.saveHistory).not.toHaveBeenCalled();
    await cancelSaga(task);
  });

  it('persists saved widths instead of the session-only expanded geometry', async () => {
    const state = storeState();
    state.panelLayout.byWorkspaceId[WS_1] = {
      ...workspaceState(),
      root: {
        type: 'split',
        direction: 'horizontal',
        children: [
          { type: 'panel', panelId: 'panel-1' },
          { type: 'panel', panelId: 'panel-2' },
        ],
        sizes: [100, 0],
      },
      panels: {
        ...layout.panels,
        'panel-2': { id: 'panel-2', tabs: [], activeTabId: null },
      },
      expandedPanelId: 'panel-1',
      savedSizesBeforeExpand: [{ nodePath: [], sizes: [35, 65] }],
      canvasWidth: 1652,
      savedCanvasWidthBeforeExpand: null,
      canvasWidthSource: 'explicit',
      savedCanvasWidthSourceBeforeExpand: null,
    };
    const { channel, task } = startSaga(state);
    await settle();
    channel.put(toggleExpandPanel(WS_1, 'panel-1'));
    await settle();

    expect(mocks.setJSON.mock.calls[0]?.[1]).toMatchObject({
      root: { sizes: [35, 65] },
      canvasWidth: null,
      canvasWidthSource: null,
    });
    await cancelSaga(task);
  });

  it('protects a non-empty stored layout from a pre-restore empty-state write', async () => {
    mocks.getJSON.mockReturnValue(layout);
    const state = storeState();
    state.panelLayout.byWorkspaceId[WS_1] = { ...emptyWorkspaceState };
    const { channel, task } = startSaga(state);
    await settle();
    channel.put({ type: focusPanel.type, payload: [WS_1, 'default'] });
    await settle();

    expect(mocks.setJSON.mock.calls).toEqual([]);
    await cancelSaga(task);
  });

  it('protects a non-empty stored layout from any pre-restore write, even with in-memory tabs', async () => {
    mocks.getJSON.mockReturnValue(layout);
    const { channel, task } = startSaga();
    await settle();
    channel.put({ type: focusPanel.type, payload: [WS_1, 'panel-1'] });
    await settle();

    expect(mocks.setJSON.mock.calls).toEqual([]);
    await cancelSaga(task);
  });

  it('persists normally once the workspace has been restored', async () => {
    mocks.getJSON.mockReturnValue(layout);
    const { channel, task } = startSaga();
    await settle();
    channel.put(workspaceMounted(WS_1));
    await settle();
    channel.put({ type: focusPanel.type, payload: [WS_1, 'panel-1'] });
    await settle();

    expect(mocks.setJSON.mock.calls).toEqual([[STORAGE_KEY_1, layout]]);
    await cancelSaga(task);
  });

  it('round-trips browser requested URL and viewport with the persisted tab', async () => {
    const browserTab = {
      id: 'tab-b',
      type: 'browser' as const,
      title: 'Browser',
      closable: true,
      browserUrl: 'http://127.0.0.1:52345/',
      browserRequestedUrl: 'http://daemon.localhost:3000/',
      viewport: { mode: 'preset' as const, presetId: 'iphone-se', width: 375, height: 667 },
    };
    const state = storeState();
    state.panelLayout.byWorkspaceId[WS_1] = {
      ...workspaceState(),
      panels: {
        'panel-1': { id: 'panel-1', tabs: [browserTab], activeTabId: browserTab.id },
      },
    };
    mocks.getJSON.mockReturnValue(undefined);
    const { channel, task } = startSaga(state);
    await settle();
    channel.put(workspaceMounted(WS_1));
    await settle();
    channel.put({ type: focusPanel.type, payload: [WS_1, 'panel-1'] });
    await settle();

    const persisted = mocks.setJSON.mock.calls.find(([key]) => key === STORAGE_KEY_1)?.[1];
    expect(persisted?.panels['panel-1'].tabs[0]).toMatchObject({
      browserUrl: 'http://127.0.0.1:52345/',
      browserRequestedUrl: 'http://daemon.localhost:3000/',
      viewport: { mode: 'preset', presetId: 'iphone-se', width: 375, height: 667 },
    });
    await cancelSaga(task);
  });

  it('keeps persisting a parked (restored then unmounted) workspace', async () => {
    mocks.getJSON.mockReturnValue(layout);
    const { channel, task } = startSaga();
    await settle();
    channel.put(workspaceMounted(WS_1));
    await settle();
    channel.put(workspaceUnmounted(WS_1));
    await settle();
    channel.put({ type: focusPanel.type, payload: [WS_1, 'panel-1'] });
    await settle();

    expect(mocks.setJSON.mock.calls).toEqual([[STORAGE_KEY_1, layout]]);
    await cancelSaga(task);
  });

  it('survives a local-storage failure and processes the next mutation', async () => {
    mocks.getJSON.mockReturnValue(undefined);
    mocks.setJSON.mockImplementationOnce(() => {
      throw new Error('quota');
    });
    const { channel, task } = startSaga();
    await settle();
    channel.put({ type: focusPanel.type, payload: [WS_1, 'panel-1'] });
    channel.put({ type: focusPanel.type, payload: [WS_2, 'panel-1'] });
    await settle();

    expect(mocks.setJSON.mock.calls).toEqual([
      [STORAGE_KEY_1, layout],
      [`${PANEL_LAYOUT_STORAGE_KEY_PREFIX}${WS_2}`, layout],
    ]);
    await cancelSaga(task);
  });

  it('debounces history independently across workspaces', async () => {
    const { channel, task } = startSaga();
    await settle();
    channel.put({ type: openTab.type, payload: { wsId: WS_1 } });
    channel.put({ type: closeTab.type, payload: { wsId: WS_1 } });
    channel.put({ type: openTab.type, payload: { wsId: WS_2 } });
    await settle();
    await vi.advanceTimersByTimeAsync(HISTORY_PERSIST_DEBOUNCE_MS);
    await vi.runAllTimersAsync();
    await settle();
    const persistedAt = new Date(NOW.getTime() + HISTORY_PERSIST_DEBOUNCE_MS).toISOString();

    expect(mocks.saveHistory.mock.calls).toEqual([
      [
        WS_1,
        {
          version: 1,
          workspaceId: WS_1,
          history: [snapshot],
          historyIndex: 0,
          lastUpdated: persistedAt,
        },
        LOCAL_CONNECTION_ID,
      ],
      [
        WS_2,
        {
          version: 1,
          workspaceId: WS_2,
          history: [{ ...snapshot, timestamp: 20 }],
          historyIndex: 0,
          lastUpdated: persistedAt,
        },
        LOCAL_CONNECTION_ID,
      ],
    ]);
    await cancelSaga(task);
  });

  it('coalesces repeated same-key history updates and reads the latest state', async () => {
    const state = storeState();
    const { channel, task } = startSaga(state);
    await settle();
    channel.put({ type: openTab.type, payload: { wsId: WS_1 } });
    await settle();
    state.panelLayout.byWorkspaceId[WS_1] = workspaceState([{ ...snapshot, timestamp: 30 }]);
    channel.put({ type: closeTab.type, payload: { wsId: WS_1 } });
    await settle();
    await vi.advanceTimersByTimeAsync(HISTORY_PERSIST_DEBOUNCE_MS);
    await settle();

    expect(mocks.saveHistory.mock.calls).toEqual([
      [
        WS_1,
        {
          version: 1,
          workspaceId: WS_1,
          history: [{ ...snapshot, timestamp: 30 }],
          historyIndex: 0,
          lastUpdated: new Date(NOW.getTime() + HISTORY_PERSIST_DEBOUNCE_MS).toISOString(),
        },
        LOCAL_CONNECTION_ID,
      ],
    ]);
    await cancelSaga(task);
  });

  it('loads valid history after initialization and ignores malformed history', async () => {
    mocks.loadHistory
      .mockResolvedValueOnce({
        version: 1,
        workspaceId: WS_1,
        history: [snapshot],
        historyIndex: 0,
        lastUpdated: NOW.toISOString(),
      })
      .mockResolvedValueOnce({ history: 'bad', historyIndex: 0 });
    const { channel, dispatch, task } = startSaga();
    await settle();
    channel.put(initializeLayout(WS_1, layout));
    await settle();
    channel.put(initializeLayout(WS_2, layout));
    await settle();

    expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
      loadLayoutHistory(WS_1, [snapshot], 0),
    ]);
    await cancelSaga(task);
  });

  it('removes foreign workspace panels from loaded layout history', async () => {
    const foreignTab = { ...tab, id: 'foreign-tab', workspaceId: WS_2 };
    const contaminatedSnapshot: LayoutSnapshot = {
      root: {
        type: 'split',
        direction: 'horizontal',
        children: [layout.root, { type: 'panel', panelId: 'foreign-panel' }],
        sizes: [50, 50],
      },
      panels: {
        ...layout.panels,
        'foreign-panel': {
          id: 'foreign-panel',
          tabs: [foreignTab],
          activeTabId: foreignTab.id,
        },
      },
      focusedPanelId: 'foreign-panel',
      timestamp: 20,
    };
    mocks.loadHistory.mockResolvedValue({
      version: 1,
      workspaceId: WS_1,
      history: [contaminatedSnapshot],
      historyIndex: 0,
      lastUpdated: NOW.toISOString(),
    });
    const { channel, dispatch, task } = startSaga();
    await settle();
    channel.put(initializeLayout(WS_1, layout));
    await settle();

    expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
      loadLayoutHistory(WS_1, [{ ...layout, timestamp: 20 }], 0),
    ]);
    await cancelSaga(task);
  });

  it('ignores an empty workspace id when clearing persisted layout', async () => {
    const { channel, task } = startSaga();
    await settle();
    channel.put(clearPanelLayout(''));
    await settle();

    expect(mocks.removeItem.mock.calls).toEqual([]);
    await cancelSaga(task);
  });

  it('survives rejected history loads, history saves, and adapter cleanup', async () => {
    const historyData = {
      version: 1,
      workspaceId: WS_2,
      history: [{ ...snapshot, timestamp: 20 }],
      historyIndex: 0,
      lastUpdated: NOW.toISOString(),
    };
    mocks.loadHistory
      .mockRejectedValueOnce(new Error('history load failed'))
      .mockResolvedValueOnce(historyData);
    mocks.saveHistory
      .mockRejectedValueOnce(new Error('history save failed'))
      .mockResolvedValueOnce(true);
    mocks.clearAdapter
      .mockRejectedValueOnce(new Error('adapter cleanup failed'))
      .mockResolvedValueOnce(undefined);
    const { channel, dispatch, task } = startSaga();
    await settle();

    channel.put(initializeLayout(WS_1, layout));
    await settle();
    channel.put(initializeLayout(WS_2, layout));
    await settle();
    channel.put({ type: openTab.type, payload: { wsId: WS_1 } });
    await settle();
    await vi.advanceTimersByTimeAsync(HISTORY_PERSIST_DEBOUNCE_MS);
    channel.put({ type: openTab.type, payload: { wsId: WS_2 } });
    await settle();
    await vi.advanceTimersByTimeAsync(HISTORY_PERSIST_DEBOUNCE_MS);
    channel.put(workspaceUnmounted(WS_1));
    await settle();
    channel.put(workspaceUnmounted(WS_2));
    await settle();

    expect(mocks.loadHistory.mock.calls).toEqual([
      [WS_1, LOCAL_CONNECTION_ID],
      [WS_2, LOCAL_CONNECTION_ID],
    ]);
    expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
      loadLayoutHistory(WS_2, historyData.history, historyData.historyIndex),
    ]);
    expect(mocks.saveHistory.mock.calls).toEqual([
      [
        WS_1,
        {
          version: 1,
          workspaceId: WS_1,
          history: [snapshot],
          historyIndex: 0,
          lastUpdated: new Date(NOW.getTime() + HISTORY_PERSIST_DEBOUNCE_MS).toISOString(),
        },
        LOCAL_CONNECTION_ID,
      ],
      [
        WS_2,
        {
          version: 1,
          workspaceId: WS_2,
          history: historyData.history,
          historyIndex: 0,
          lastUpdated: new Date(NOW.getTime() + HISTORY_PERSIST_DEBOUNCE_MS * 2).toISOString(),
        },
        LOCAL_CONNECTION_ID,
      ],
    ]);
    expect(mocks.clearAdapter.mock.calls).toEqual([[WS_1], [WS_2]]);
    expect(task.isRunning()).toBe(true);
    await cancelSaga(task);
  });

  it('clears persisted state and cancels only matching history on panel scope teardown', async () => {
    const { channel, task } = startSaga();
    await settle();
    channel.put(clearPanelLayout(WS_1));
    channel.put({ type: openTab.type, payload: { wsId: WS_1 } });
    channel.put({ type: openTab.type, payload: { wsId: WS_2 } });
    channel.put(panelLayoutScopeUnmounted(WS_1));
    await settle();
    await vi.advanceTimersByTimeAsync(HISTORY_PERSIST_DEBOUNCE_MS);

    expect(mocks.removeItem.mock.calls).toEqual([[STORAGE_KEY_1]]);
    expect(mocks.clearAdapter.mock.calls).toEqual([[WS_1]]);
    expect(mocks.saveHistory.mock.calls).toEqual([
      [
        WS_2,
        {
          version: 1,
          workspaceId: WS_2,
          history: [{ ...snapshot, timestamp: 20 }],
          historyIndex: 0,
          lastUpdated: new Date(NOW.getTime() + HISTORY_PERSIST_DEBOUNCE_MS).toISOString(),
        },
        LOCAL_CONNECTION_ID,
      ],
    ]);
    await cancelSaga(task);
  });

  it('flushes every pending workspace history with its captured backend when cancelled', async () => {
    const { channel, task } = startSaga();
    await settle();
    channel.put({ type: openTab.type, payload: { wsId: WS_1 } });
    channel.put({ type: openTab.type, payload: { wsId: WS_2 } });
    await settle();
    await cancelSaga(task);

    expect(task.isCancelled()).toBe(true);
    expect(mocks.saveHistory.mock.calls).toEqual([
      [
        WS_1,
        {
          version: 1,
          workspaceId: WS_1,
          history: [snapshot],
          historyIndex: 0,
          lastUpdated: NOW.toISOString(),
        },
        LOCAL_CONNECTION_ID,
      ],
      [
        WS_2,
        {
          version: 1,
          workspaceId: WS_2,
          history: [{ ...snapshot, timestamp: 20 }],
          historyIndex: 0,
          lastUpdated: NOW.toISOString(),
        },
        LOCAL_CONNECTION_ID,
      ],
    ]);
  });

  describe('multi-backend namespacing', () => {
    it('heals and persists a backend-scoped restore without live column state', async () => {
      const mismatched: WorkspacePanelLayout = { ...layout, columnCount: 2 };
      const run = startRestoreSaga(layout, []);
      await settle();
      run.dispatch.mockClear();
      mocks.setJSON.mockClear();
      mocks.getJSON.mockImplementation((key: string) =>
        key === REMOTE_STORAGE_KEY_1 ? mismatched : layout,
      );
      run.setBackendId(REMOTE_ID);

      run.send(
        connectionsListReceived({
          connections: [],
          activeId: REMOTE_ID,
          windowBackendId: REMOTE_ID,
        }),
      );
      await settle();

      const workspace = run.getState().panelLayout.byWorkspaceId[WS_1];
      const children = workspace.root.type === 'split' ? workspace.root.children : [];
      expect(
        run.dispatch.mock.calls.find(([action]) => action.type === initializeLayout.type)?.[0]
          .payload.layout.columnCount,
      ).toBe(2);
      expect(
        run.dispatch.mock.calls.some(([action]) => action.type === reconcilePanelColumnCount.type),
      ).toBe(false);
      expect(children).toHaveLength(2);
      expect(children[0]).toEqual({ type: 'panel', panelId: 'panel-1' });
      const rightPanelId = children[1]?.type === 'panel' ? children[1].panelId : '';
      expect(workspace.panels[rightPanelId]).toEqual({
        id: rightPanelId,
        tabs: [],
        activeTabId: null,
        pristine: true,
      });
      expect(workspace.panels['panel-1']).toMatchObject({ activeTabId: tab.id, tabs: [tab] });
      expect(workspace.focusedPanelId).toBe('panel-1');
      expect(workspace.layoutHistory).toEqual([]);
      expect(mocks.saveHistory).not.toHaveBeenCalled();
      expect(mocks.setJSON.mock.calls).toEqual([
        [REMOTE_STORAGE_KEY_1, expect.objectContaining({ columnCount: 2, root: workspace.root })],
      ]);
      await cancelSaga(run.task);
    });

    it('restores independent counts when switching between backend namespaces', async () => {
      const localLayout: WorkspacePanelLayout = {
        version: PANEL_LAYOUT_PERSISTENCE_VERSION,
        root: {
          type: 'split',
          direction: 'horizontal',
          children: [
            { type: 'panel', panelId: 'local-left' },
            { type: 'panel', panelId: 'local-right' },
          ],
          sizes: [50, 50],
        },
        panels: {
          'local-left': { id: 'local-left', tabs: [], activeTabId: null },
          'local-right': { id: 'local-right', tabs: [], activeTabId: null },
        },
        focusedPanelId: 'local-left',
        canvasWidth: null,
        canvasWidthSource: null,
        columnCount: 2,
      };
      const initialLayout = panelLayoutReducer(undefined, setPanelColumnCount(WS_1, 2, 10))
        .byWorkspaceId[WS_1];
      const run = startRestoreSaga(localLayout, [], initialLayout);
      await settle();
      expect(run.getState().panelLayout.byWorkspaceId[WS_1].columnCount).toBe(2);

      mocks.getJSON.mockImplementation((key: string) =>
        key === REMOTE_STORAGE_KEY_1 ? layout : localLayout,
      );
      run.setBackendId(REMOTE_ID);
      run.send(
        connectionsListReceived({
          connections: [],
          activeId: REMOTE_ID,
          windowBackendId: REMOTE_ID,
        }),
      );
      await settle();
      expect(run.getState().panelLayout.byWorkspaceId[WS_1].columnCount).toBe(1);

      run.setBackendId(LOCAL_CONNECTION_ID);
      run.send(
        connectionsListReceived({
          connections: [],
          activeId: LOCAL_CONNECTION_ID,
          windowBackendId: LOCAL_CONNECTION_ID,
        }),
      );
      await settle();
      expect(run.getState().panelLayout.byWorkspaceId[WS_1].columnCount).toBe(2);
      await cancelSaga(run.task);
    });

    it('keeps the bare legacy key for the local backend', async () => {
      mocks.getJSON.mockReturnValue(undefined);
      const { channel, task } = startSaga(storeState(null, LOCAL_CONNECTION_ID));
      await settle();
      channel.put({ type: openTab.type, payload: { wsId: WS_1 } });
      await settle();

      expect(mocks.setJSON.mock.calls).toEqual([[STORAGE_KEY_1, layout]]);
      await cancelSaga(task);
    });

    it('namespaces layout reads, writes, clears, and history by remote backend id', async () => {
      mocks.getJSON.mockReturnValue(undefined);
      const { channel, task } = startSaga(storeState(null, REMOTE_ID));
      await settle();
      channel.put(workspaceMounted(WS_1));
      channel.put({ type: openTab.type, payload: { wsId: WS_1 } });
      channel.put(clearPanelLayout(WS_1));
      await settle();
      await vi.advanceTimersByTimeAsync(HISTORY_PERSIST_DEBOUNCE_MS);

      expect(mocks.getJSON.mock.calls).toEqual([[REMOTE_STORAGE_KEY_1]]);
      expect(mocks.setJSON.mock.calls).toEqual([[REMOTE_STORAGE_KEY_1, layout]]);
      expect(mocks.removeItem.mock.calls).toEqual([[REMOTE_STORAGE_KEY_1]]);
      expect(mocks.saveHistory.mock.calls.map(([wsId, , backendId]) => [wsId, backendId])).toEqual([
        [WS_1, REMOTE_ID],
      ]);
      await cancelSaga(task);
    });

    it('re-restores the active workspace from the incoming backend namespace on switch', async () => {
      mocks.getJSON.mockImplementation((key: string) =>
        key === REMOTE_STORAGE_KEY_1 ? layout : undefined,
      );
      let backendId = LOCAL_CONNECTION_ID;
      const channel = stdChannel();
      const dispatch = vi.fn();
      const task = runSaga(
        { channel, dispatch, getState: () => storeState(WS_1, backendId) },
        panelLayoutSaga,
        { activeWorkspaceId: WS_1 },
      );
      await settle();
      dispatch.mockClear();

      backendId = REMOTE_ID;
      channel.put(
        connectionsListReceived({
          connections: [],
          activeId: REMOTE_ID,
          windowBackendId: REMOTE_ID,
        }),
      );
      await settle();

      expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
        preparePanelLayoutBackendRestore(WS_1),
        setRestoreStatus(WS_1, 'pending'),
        initializeLayout(WS_1, layout),
        setRestoreStatus(WS_1, 'restored'),
      ]);
      await cancelSaga(task);
    });

    it('re-restores every mounted workspace from the incoming backend namespace on switch', async () => {
      const remoteKey2 = `backend:${REMOTE_ID}:${PANEL_LAYOUT_STORAGE_KEY_PREFIX}${WS_2}`;
      mocks.getJSON.mockImplementation((key: string) =>
        key === REMOTE_STORAGE_KEY_1 || key === remoteKey2 ? layout : undefined,
      );
      let backendId = LOCAL_CONNECTION_ID;
      const channel = stdChannel();
      const dispatch = vi.fn();
      const task = runSaga(
        { channel, dispatch, getState: () => storeState(WS_1, backendId) },
        panelLayoutSaga,
        { activeWorkspaceId: WS_1 },
      );
      await settle();
      channel.put(workspaceMounted(WS_2));
      await settle();
      dispatch.mockClear();

      backendId = REMOTE_ID;
      channel.put(
        connectionsListReceived({
          connections: [],
          activeId: REMOTE_ID,
          windowBackendId: REMOTE_ID,
        }),
      );
      await settle();

      // WS_1-before-WS_2 relies on Set insertion order (retroactiveRestore
      // adds WS_1 at saga start, workspaceMounted adds WS_2 later), which is
      // guaranteed in JS — a reordering here means the switch loop changed.
      expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
        preparePanelLayoutBackendRestore(WS_1),
        setRestoreStatus(WS_1, 'pending'),
        initializeLayout(WS_1, layout),
        setRestoreStatus(WS_1, 'restored'),
        preparePanelLayoutBackendRestore(WS_2),
        setRestoreStatus(WS_2, 'pending'),
        initializeLayout(WS_2, layout),
        setRestoreStatus(WS_2, 'restored'),
      ]);
      await cancelSaga(task);
    });

    it('registers switch re-restores in flight so hydration waiters see post-switch state (monorepo#2789)', async () => {
      let resolveStored!: (value: unknown) => void;
      const storedPromise = new Promise((resolve) => {
        resolveStored = resolve;
      });
      mocks.getJSON.mockReturnValue(undefined);
      let backendId = LOCAL_CONNECTION_ID;
      const channel = stdChannel();
      const dispatch = vi.fn();
      const getState = () => storeState(WS_1, backendId);
      const task = runSaga({ channel, dispatch, getState }, panelLayoutSaga, {
        activeWorkspaceId: WS_1,
      });
      await settle();
      dispatch.mockClear();

      // The incoming backend's storage read stays pending, holding the
      // switch re-restore in flight while the store still has the outgoing
      // backend's layout.
      mocks.getJSON.mockImplementation((key: string) =>
        key === REMOTE_STORAGE_KEY_1 ? storedPromise : undefined,
      );
      backendId = REMOTE_ID;
      channel.put(
        connectionsListReceived({
          connections: [],
          activeId: REMOTE_ID,
          windowBackendId: REMOTE_ID,
        }),
      );
      await settle();

      let waited = false;
      const waiter = runSaga({ channel, dispatch, getState }, function* () {
        yield* waitForWorkspaceLayoutRestore(WS_1);
        waited = true;
      });
      await settle();
      // The waiter must block on the in-flight switch re-restore — a no-op
      // wait here is the stale-tabs leak the registration exists to prevent.
      expect(waited).toBe(false);

      resolveStored(layout);
      await waiter.toPromise();
      expect(waited).toBe(true);
      expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
        preparePanelLayoutBackendRestore(WS_1),
        setRestoreStatus(WS_1, 'pending'),
        initializeLayout(WS_1, layout),
        setRestoreStatus(WS_1, 'restored'),
      ]);
      await cancelSaga(task);
    });

    it('skips unmounted workspaces when re-restoring on switch', async () => {
      mocks.getJSON.mockImplementation((key: string) =>
        key.startsWith(`backend:${REMOTE_ID}:`) ? layout : undefined,
      );
      let backendId = LOCAL_CONNECTION_ID;
      const channel = stdChannel();
      const dispatch = vi.fn();
      const task = runSaga(
        { channel, dispatch, getState: () => storeState(WS_1, backendId) },
        panelLayoutSaga,
        { activeWorkspaceId: WS_1 },
      );
      await settle();
      channel.put(workspaceMounted(WS_2));
      channel.put(workspaceUnmounted(WS_2));
      await settle();
      dispatch.mockClear();

      backendId = REMOTE_ID;
      channel.put(
        connectionsListReceived({
          connections: [],
          activeId: REMOTE_ID,
          windowBackendId: REMOTE_ID,
        }),
      );
      await settle();

      expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
        preparePanelLayoutBackendRestore(WS_1),
        setRestoreStatus(WS_1, 'pending'),
        initializeLayout(WS_1, layout),
        setRestoreStatus(WS_1, 'restored'),
      ]);
      await cancelSaga(task);
    });

    it('resets the layout on switch when the incoming backend has nothing saved', async () => {
      mocks.getJSON.mockReturnValue(undefined);
      let backendId = LOCAL_CONNECTION_ID;
      const channel = stdChannel();
      const dispatch = vi.fn();
      const task = runSaga(
        { channel, dispatch, getState: () => storeState(WS_1, backendId) },
        panelLayoutSaga,
        { activeWorkspaceId: WS_1 },
      );
      await settle();
      dispatch.mockClear();

      backendId = REMOTE_ID;
      channel.put(
        connectionsListReceived({
          connections: [],
          activeId: REMOTE_ID,
          windowBackendId: REMOTE_ID,
        }),
      );
      await settle();

      const dispatched = dispatch.mock.calls.map(([action]) => action);
      expect(dispatched.map((action) => action.type)).toEqual([
        preparePanelLayoutBackendRestore.type,
        setRestoreStatus.type,
        resetLayout.type,
        loadLayoutHistory.type,
        setRestoreStatus.type,
      ]);
      expect(dispatched[0]).toEqual(preparePanelLayoutBackendRestore(WS_1));
      expect(dispatched[1]).toEqual(setRestoreStatus(WS_1, 'pending'));
      expect(dispatched[2].payload.wsId).toBe(WS_1);
      expect(dispatched[3]).toEqual(loadLayoutHistory(WS_1, [], 0));
      expect(dispatched[4]).toEqual(setRestoreStatus(WS_1, 'empty'));
      await cancelSaga(task);
    });

    it('restores the lifecycle-mounted workspace after an in-flight workspace switch', async () => {
      const remoteStorageKey2 = `backend:${REMOTE_ID}:${PANEL_LAYOUT_STORAGE_KEY_PREFIX}${WS_2}`;
      mocks.getJSON.mockImplementation((key: string) =>
        key === remoteStorageKey2 ? layout : undefined,
      );
      let backendId = LOCAL_CONNECTION_ID;
      const channel = stdChannel();
      const dispatch = vi.fn();
      const task = runSaga(
        { channel, dispatch, getState: () => storeState(WS_1, backendId) },
        panelLayoutSaga,
        { activeWorkspaceId: WS_1 },
      );
      await settle();

      channel.put(workspaceUnmounted(WS_1));
      channel.put(workspaceMounted(WS_2));
      await settle();
      dispatch.mockClear();

      backendId = REMOTE_ID;
      channel.put(
        connectionsListReceived({
          connections: [],
          activeId: REMOTE_ID,
          windowBackendId: REMOTE_ID,
        }),
      );
      await settle();

      expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
        preparePanelLayoutBackendRestore(WS_2),
        setRestoreStatus(WS_2, 'pending'),
        initializeLayout(WS_2, layout),
        setRestoreStatus(WS_2, 'restored'),
      ]);
      await cancelSaga(task);
    });

    it('opens the same recent primary agent after an empty backend switch restore', async () => {
      const recent = agent('agent-recent', 'Recent', '2026-07-31T02:00:00.000Z');
      const run = startRestoreSaga(layout, [recent]);
      await settle();
      run.dispatch.mockClear();
      mocks.getJSON.mockReturnValue(undefined);
      run.setBackendId(REMOTE_ID);

      run.send(
        connectionsListReceived({
          connections: [],
          activeId: REMOTE_ID,
          windowBackendId: REMOTE_ID,
        }),
      );
      await settle();

      const workspace = run.getState().panelLayout.byWorkspaceId[WS_1];
      const tabs = Object.values(workspace.panels).flatMap((panel: any) => panel.tabs);
      expect(tabs).toEqual([expect.objectContaining({ agentId: 'agent-recent' })]);
      expect(workspace.pendingFocusTabId).toBe(tabs[0].id);
      await cancelSaga(run.task);
    });
  });

  describe('redesigned panel persistence', () => {
    it.each([movePanel, movePanelToRootEdge])(
      'persists whole-panel action $type',
      async (creator) => {
        mocks.getJSON.mockReturnValue(undefined);
        const { channel, task } = startSaga();
        await settle();
        channel.put({ type: creator.type, payload: { wsId: WS_1 } });
        await settle();

        expect(mocks.setJSON.mock.calls).toEqual([[STORAGE_KEY_1, layout]]);
        await cancelSaga(task);
      },
    );

    it('does not save debounced history into a newly selected backend', async () => {
      let backendId = LOCAL_CONNECTION_ID;
      const channel = stdChannel();
      const task = runSaga(
        { channel, dispatch: vi.fn(), getState: () => storeState(WS_1, backendId) },
        panelLayoutSaga,
      );
      await settle();
      mocks.saveHistory.mockClear();

      channel.put({ type: openTab.type, payload: { wsId: WS_1 } });
      await settle();
      backendId = REMOTE_ID;
      channel.put(
        connectionsListReceived({
          connections: [],
          activeId: REMOTE_ID,
          windowBackendId: REMOTE_ID,
        }),
      );
      await settle();
      await vi.advanceTimersByTimeAsync(HISTORY_PERSIST_DEBOUNCE_MS);
      await settle();

      expect(mocks.saveHistory).not.toHaveBeenCalled();
      await cancelSaga(task);
    });

    it('does not flush stale pending history after a backend switch', async () => {
      let backendId = LOCAL_CONNECTION_ID;
      const channel = stdChannel();
      const task = runSaga(
        { channel, dispatch: vi.fn(), getState: () => storeState(WS_1, backendId) },
        panelLayoutSaga,
      );
      await settle();
      channel.put({ type: openTab.type, payload: { wsId: WS_1 } });
      await settle();

      backendId = REMOTE_ID;
      channel.put(
        connectionsListReceived({
          connections: [],
          activeId: REMOTE_ID,
          windowBackendId: REMOTE_ID,
        }),
      );
      await settle();
      mocks.saveHistory.mockClear();
      await cancelSaga(task);

      expect(mocks.saveHistory).not.toHaveBeenCalled();
    });

    it('keeps restored multi-tab content in one fixed column history', async () => {
      const multiTabLayout = {
        root: { type: 'panel' as const, panelId: 'panel-1' },
        panels: {
          'panel-1': {
            id: 'panel-1',
            tabs: [
              {
                id: 'tab-1',
                type: 'note' as const,
                title: 'Note 1',
                closable: true,
                noteId: 'note-1',
              },
              {
                id: 'tab-2',
                type: 'note' as const,
                title: 'Note 2',
                closable: true,
                noteId: 'note-2',
              },
            ],
            activeTabId: 'tab-2',
          },
        },
        focusedPanelId: 'panel-1',
      };
      mocks.getJSON.mockReturnValue(multiTabLayout);
      const { channel, dispatch, task } = startSaga();
      await settle();
      channel.put(workspaceMounted(WS_1));
      await settle();

      const initializeCalls = dispatch.mock.calls.filter(
        ([action]) => action.type === initializeLayout.type,
      );
      expect(initializeCalls).toHaveLength(1);
      const normalized = initializeCalls[0][0].payload.layout;
      expect(normalized.root).toEqual({ type: 'panel', panelId: 'panel-1' });
      expect(normalized.panels['panel-1'].tabs.map(({ id }: { id: string }) => id)).toEqual([
        'tab-1',
        'tab-2',
      ]);
      expect(normalized.panels['panel-1'].activeTabId).toBe('tab-2');
      expect(normalized.focusedPanelId).toBe('panel-1');
      await cancelSaga(task);
    });
  });
});
