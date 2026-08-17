import { runSaga, stdChannel } from 'redux-saga';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  clearAdapter: vi.fn(),
  getJSON: vi.fn(),
  loadHistory: vi.fn(),
  removeItem: vi.fn(),
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
vi.mock('../../../utils/safe-local-storage-saga', () => ({
  getLocalStorageJSON: function* (key: string) {
    return mocks.getJSON(key);
  },
  removeLocalStorageItem: function* (key: string) {
    mocks.removeItem(key);
  },
  setLocalStorageJSON: function* (key: string, value: unknown) {
    mocks.setJSON(key, value);
  },
}));

import { LOCAL_CONNECTION_ID } from '$shared/types/connections';
import type { AgentSession, Note } from '$shared/types';
import { ContentType, NoteVisibility } from '$shared/types';
import { connectionsListReceived } from '../../connections/connections-slice';
import {
  workspaceMounted,
  workspaceUnmounted,
} from '../../workspace-lifecycle/workspace-lifecycle-slice';
import {
  clearPanelLayout,
  collapseToReusablePanel,
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
  openTabInAdjacentOrSplit,
  openTabInNewRootColumn,
  panelLayoutScopeMounted,
  panelLayoutScopeUnmounted,
  reconcileStaleAgentTabs,
  reorderTabs,
  reopenClosedTab,
  revealDeferredSpecTab,
  resetLayout,
  resizePanelLayoutRightEdge,
  selectNextTab,
  selectPreviousTab,
  setActiveTab,
  setDeferSpecTab,
  setPanelPinned,
  setRestoreStatus,
  splitPanel,
  toggleExpandPanel,
  updateFileTabPath,
  updateSizes,
  updateSplitSizes,
  updateTabBrowserUrl,
  updateTabFavicon,
  updateTabTitle,
} from '../panel-layout-slice';
import { panelLayoutReducer } from '../panel-layout-slice';
import { setAgents } from '../../workspace-agents/workspace-agents-slice';
import {
  applyLocalNoteUpdate,
  applyNoteUpdated,
  loadWorkspaceNotesSucceeded,
  workspaceNotesReducer,
} from '../../workspace-notes/workspace-notes-slice';
import {
  HISTORY_PERSIST_DEBOUNCE_MS,
  PANEL_LAYOUT_STORAGE_KEY_PREFIX,
  type LayoutSnapshot,
  type WorkspacePanelLayout,
} from '../panel-layout-types';
import { isStoredLayoutValid, panelLayoutSaga } from './panel-layout-saga';

const WS_1 = 'ws-1';
const WS_2 = 'ws-2';
const REMOTE_ID = 'remote-1';
const STORAGE_KEY_1 = `${PANEL_LAYOUT_STORAGE_KEY_PREFIX}${WS_1}`;
const REMOTE_STORAGE_KEY_1 = `backend:${REMOTE_ID}:${STORAGE_KEY_1}`;
const NOW = new Date('2026-07-31T00:00:00.000Z');

const tab = { id: 'tab-1', type: 'note' as const, title: 'Note', closable: true, noteId: 'note-1' };
const layout: WorkspacePanelLayout = {
  root: { type: 'panel', panelId: 'panel-1' },
  panels: { 'panel-1': { id: 'panel-1', tabs: [tab], activeTabId: tab.id } },
  focusedPanelId: 'panel-1',
  canvasWidth: null,
  canvasWidthSource: null,
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
    tabState: { currentTabId: activeWorkspaceId },
    connections: { activeId: activeBackendId },
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
  };
  const channel = stdChannel();
  const dispatch = vi.fn((action) => {
    state = {
      ...state,
      panelLayout: panelLayoutReducer(state.panelLayout, action),
      workspaceNotes: workspaceNotesReducer(state.workspaceNotes, action),
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
  };
  const channel = stdChannel();
  const dispatch = vi.fn((action) => {
    state = { ...state, panelLayout: panelLayoutReducer(state.panelLayout, action) };
    channel.put(action);
  });
  const getState = () => ({
    ...state,
    connections: { ...state.connections, activeId: backendId },
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
  collapseToReusablePanel,
  closeTab,
  closeActiveTab,
  closeTabsByType,
  closeTabsByAgentId,
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
  updateFileTabPath,
  consumePendingFocus,
  setPanelPinned,
];

describe('panelLayoutSaga', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    mocks.loadHistory.mockResolvedValue(null);
    mocks.saveHistory.mockResolvedValue(true);
  });

  afterEach(() => vi.useRealTimers());

  it('validates stored tree references, focus, tabs, and active tab ids', () => {
    expect(isStoredLayoutValid(layout)).toBe(true);
    expect(isStoredLayoutValid({ ...layout, canvasWidth: 1080 })).toBe(true);
    expect(
      isStoredLayoutValid({ ...layout, canvasWidth: 1080, canvasWidthSource: 'explicit' }),
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
    ).toBe(false);
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
      false,
    );
    expect(isStoredLayoutValid({ ...layout, focusedPanelId: 'missing' })).toBe(false);
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
    ).toBe(false);
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
    expect(Object.values(stored.panels)).toContainEqual(expect.objectContaining({ pinned: true }));
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

  it('pins the initial agent while migrating a legacy layout without pin state', async () => {
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
    expect(restored.panels['panel-1']).toMatchObject({ pinned: true });
    await cancelSaga(task);
  });

  it('preserves an explicit unpin during restore instead of reapplying migration', async () => {
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
    expect(restored.panels['panel-1']).toMatchObject({ pinned: false });
    await cancelSaga(task);
  });

  it('pins an undefined initial-agent panel in a partially migrated layout', async () => {
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
    expect(restored.panels['panel-1']).toMatchObject({ pinned: true });
    expect(restored.panels['panel-2']).toMatchObject({ pinned: true });
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
      ['missing', undefined],
      ['invalid', { bad: true }],
      ['empty', emptyStoredLayout],
      ['normalized-empty', foreignOnlyLayout],
    ])('opens the newest primary agent after a %s restore', async (_name, stored) => {
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
      expect(tabs).toEqual([expect.objectContaining({ type: 'agent', agentId: 'agent-recent' })]);
      expect(workspace.focusedPanelId).toBeTruthy();
      expect(workspace.pendingFocusTabId).toBe(tabs[0].id);
      expect(
        Object.values(workspace.panels).find((panel: any) => panel.tabs.length > 0),
      ).toMatchObject({ pinned: true });
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

      expect(run.getState().panelLayout.byWorkspaceId[WS_1]).toMatchObject(layout);
      expect(
        run.dispatch.mock.calls.some(([action]) => action.type === openTabInAdjacentOrSplit.type),
      ).toBe(false);
      await cancelSaga(run.task);
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
      channel.put(connectionsListReceived({ connections: [], activeId: REMOTE_ID }));
      await settle();

      expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
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
      channel.put(connectionsListReceived({ connections: [], activeId: REMOTE_ID }));
      await settle();

      // WS_1-before-WS_2 relies on Set insertion order (retroactiveRestore
      // adds WS_1 at saga start, workspaceMounted adds WS_2 later), which is
      // guaranteed in JS — a reordering here means the switch loop changed.
      expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
        setRestoreStatus(WS_1, 'pending'),
        initializeLayout(WS_1, layout),
        setRestoreStatus(WS_1, 'restored'),
        setRestoreStatus(WS_2, 'pending'),
        initializeLayout(WS_2, layout),
        setRestoreStatus(WS_2, 'restored'),
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
      channel.put(connectionsListReceived({ connections: [], activeId: REMOTE_ID }));
      await settle();

      expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
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
      channel.put(connectionsListReceived({ connections: [], activeId: REMOTE_ID }));
      await settle();

      const dispatched = dispatch.mock.calls.map(([action]) => action);
      expect(dispatched.map((action) => action.type)).toEqual([
        setRestoreStatus.type,
        resetLayout.type,
        loadLayoutHistory.type,
        setRestoreStatus.type,
      ]);
      expect(dispatched[0]).toEqual(setRestoreStatus(WS_1, 'pending'));
      expect(dispatched[1].payload.wsId).toBe(WS_1);
      expect(dispatched[2]).toEqual(loadLayoutHistory(WS_1, [], 0));
      expect(dispatched[3]).toEqual(setRestoreStatus(WS_1, 'empty'));
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
      channel.put(connectionsListReceived({ connections: [], activeId: REMOTE_ID }));
      await settle();

      expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
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

      run.send(connectionsListReceived({ connections: [], activeId: REMOTE_ID }));
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
      channel.put(connectionsListReceived({ connections: [], activeId: REMOTE_ID }));
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
      channel.put(connectionsListReceived({ connections: [], activeId: REMOTE_ID }));
      await settle();
      mocks.saveHistory.mockClear();
      await cancelSaga(task);

      expect(mocks.saveHistory).not.toHaveBeenCalled();
    });

    it('normalizes restored multi-tab panels into focused one-tab panels', async () => {
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
      expect(normalized.root.type).toBe('split');
      expect(normalized.root.direction).toBe('horizontal');
      expect(normalized.root.children).toHaveLength(2);
      const panel1Id = normalized.root.children[0].panelId;
      const panel2Id = normalized.root.children[1].panelId;
      expect(normalized.panels[panel1Id].tabs.map(({ id }: { id: string }) => id)).toEqual([
        'tab-1',
      ]);
      expect(normalized.panels[panel2Id].tabs.map(({ id }: { id: string }) => id)).toEqual([
        'tab-2',
      ]);
      expect(normalized.focusedPanelId).toBe(panel2Id);
      await cancelSaga(task);
    });
  });
});
