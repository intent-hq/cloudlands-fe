import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Middleware unit tests: exercise `createPanelLayoutPersistenceMiddleware` with
// a fake middleware API + in-memory localStorage. Testing the factory directly
// keeps the tests independent of the singleton `appStore`.
import { safeLocalStorage } from "$lib/utils/safe-storage";
import {
  initializeLayout,
  loadLayoutHistory,
  clearPanelLayout,
  setRestoreStatus,
  setDeferSpecTab,
  openTab,
  closeTab,
  splitPanel,
  panelLayoutReducer,
} from "$store/renderer/slices/panel-layout/panel-layout-slice";
import {
  workspaceMounted,
  workspaceUnmounted,
} from "$store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice";
import {
  PANEL_LAYOUT_STORAGE_KEY_PREFIX,
  HISTORY_PERSIST_DEBOUNCE_MS,
  type WorkspacePanelLayout,
} from "$store/renderer/slices/panel-layout/panel-layout-types";
import type { StoreState } from "$store/renderer/types";
import { hydrateWorkspaceNavigation } from "$store/renderer/slices/workspace-navigation/workspace-navigation-slice";
import { store as appStore } from "$store/renderer/store";
import { createPanelLayoutPersistenceMiddleware } from "./panel-layout-persistence-service";

vi.mock("$features/layout/panel-layout-history.client", () => ({
  savePanelLayoutHistory: vi.fn().mockResolvedValue(true),
  loadPanelLayoutHistory: vi.fn().mockResolvedValue(null),
}));

vi.mock("$features/layout/panel-layout-adapter", () => ({
  clearPanelLayoutAdapter: vi.fn(),
}));

const mem = new Map<string, string>();
function installMemoryLocalStorage(): void {
  vi.mocked(window.localStorage.getItem).mockImplementation(
    (key: string) => mem.get(key) ?? null,
  );
  vi.mocked(window.localStorage.setItem).mockImplementation(
    (key: string, value: string) => {
      mem.set(key, String(value));
    },
  );
  vi.mocked(window.localStorage.removeItem).mockImplementation((key: string) => {
    mem.delete(key);
  });
}

type FakeApi = {
  getState: () => StoreState;
  dispatch: ReturnType<typeof vi.fn>;
};

function createFakeApi(activeWorkspaceId: string | null = null): FakeApi {
  let panelLayoutState = { byWorkspaceId: {} };
  const dispatch = vi.fn((action: unknown) => {
    if (action && typeof action === "object" && "type" in action) {
      const state = { byWorkspaceId: panelLayoutState.byWorkspaceId };
      const newState = panelLayoutReducer(state, action as never);
      panelLayoutState = newState;
    }
    return action;
  });
  return {
    getState: () => ({ panelLayout: panelLayoutState, workspace: { activeWorkspaceId } } as unknown as StoreState),
    dispatch,
  };
}

const validLayout: WorkspacePanelLayout = {
  root: { type: "panel", panelId: "panel-1" },
  panels: {
    "panel-1": { id: "panel-1", tabs: [], activeTabId: null },
  },
  focusedPanelId: "panel-1",
};

function agentTabLayout(wsId: string, agentId: string): WorkspacePanelLayout {
  return {
    root: { type: "panel", panelId: "panel-1" },
    panels: {
      "panel-1": {
        id: "panel-1",
        tabs: [
          {
            id: "tab-agent-1",
            type: "agent",
            title: "Agent",
            agentId,
            workspaceId: wsId,
            closable: true,
          },
        ],
        activeTabId: "tab-agent-1",
      },
    },
    focusedPanelId: "panel-1",
  };
}

function tabsOf(layout: WorkspacePanelLayout | Pick<WorkspacePanelLayout, "panels">): Array<{ id: string; type: string }> {
  return Object.values(layout.panels).flatMap((panel) => panel.tabs);
}

beforeEach(() => {
  installMemoryLocalStorage();
  mem.clear();
  vi.clearAllMocks();
});

afterEach(() => {
  mem.clear();
});

describe("panelLayoutPersistenceService — restore on mount", () => {
  it("restores valid layout from localStorage on workspaceMounted", () => {
    safeLocalStorage.setJSON(`${PANEL_LAYOUT_STORAGE_KEY_PREFIX}ws-restore`, validLayout);
    const api = createFakeApi();
    const middleware = createPanelLayoutPersistenceMiddleware()(api);
    const next = (action: unknown) => api.dispatch(action);
    const dispatch = middleware(next);

    dispatch(workspaceMounted("ws-restore"));

    const dispatchedTypes = api.dispatch.mock.calls.map(
      (call) => (call[0] as { type: string }).type,
    );
    expect(dispatchedTypes).toContain(setRestoreStatus.type);
    expect(dispatchedTypes).toContain(initializeLayout.type);
  });

  it("marks restore status as empty when no layout stored", () => {
    const api = createFakeApi();
    const middleware = createPanelLayoutPersistenceMiddleware()(api);
    const next = (action: unknown) => api.dispatch(action);
    const dispatch = middleware(next);

    dispatch(workspaceMounted("ws-empty"));

    const statusCalls = api.dispatch.mock.calls.filter(
      (call) => (call[0] as { type: string }).type === setRestoreStatus.type,
    );
    expect(statusCalls.length).toBeGreaterThan(0);
    const lastStatus = statusCalls[statusCalls.length - 1][0] as ReturnType<typeof setRestoreStatus>;
    expect(lastStatus.payload[1]).toBe("empty");
  });

  it("marks restore status as invalid for malformed layout", () => {
    safeLocalStorage.setJSON(`${PANEL_LAYOUT_STORAGE_KEY_PREFIX}ws-invalid`, {
      root: { type: "panel", panelId: "missing" },
      panels: {},
      focusedPanelId: null,
    });
    const api = createFakeApi();
    const middleware = createPanelLayoutPersistenceMiddleware()(api);
    const next = (action: unknown) => api.dispatch(action);
    const dispatch = middleware(next);

    dispatch(workspaceMounted("ws-invalid"));

    const statusCalls = api.dispatch.mock.calls.filter(
      (call) => (call[0] as { type: string }).type === setRestoreStatus.type,
    );
    const lastStatus = statusCalls[statusCalls.length - 1][0] as ReturnType<typeof setRestoreStatus>;
    expect(lastStatus.payload[1]).toBe("invalid");
  });

  it("skips restore for invalid workspace IDs (new, optimistic, undefined)", () => {
    const api = createFakeApi();
    const middleware = createPanelLayoutPersistenceMiddleware()(api);
    const next = (action: unknown) => api.dispatch(action);
    const dispatch = middleware(next);

    dispatch(workspaceMounted("new"));
    dispatch(workspaceMounted("optimistic-abc"));
    dispatch(workspaceMounted("undefined"));

    // The middleware passes through the mounted action but does not dispatch restore actions
    const dispatchedTypes = api.dispatch.mock.calls.map(
      (call) => (call[0] as { type: string }).type,
    );
    expect(dispatchedTypes).not.toContain(setRestoreStatus.type);
    expect(dispatchedTypes).not.toContain(initializeLayout.type);
  });

  it("restores only once per session (re-mount skips restore)", () => {
    safeLocalStorage.setJSON(`${PANEL_LAYOUT_STORAGE_KEY_PREFIX}ws-once`, validLayout);
    const api = createFakeApi();
    const middleware = createPanelLayoutPersistenceMiddleware()(api);
    const next = (action: unknown) => api.dispatch(action);
    const dispatch = middleware(next);

    dispatch(workspaceMounted("ws-once"));
    const firstCallCount = api.dispatch.mock.calls.length;
    expect(firstCallCount).toBeGreaterThan(0);

    api.dispatch.mockClear();
    dispatch(workspaceMounted("ws-once"));
    // Second mount passes through the action but does not restore again
    const dispatchedTypes = api.dispatch.mock.calls.map(
      (call) => (call[0] as { type: string }).type,
    );
    expect(dispatchedTypes).toContain(workspaceMounted.type);
    expect(dispatchedTypes).not.toContain(initializeLayout.type);
  });

  it("retroactively restores active workspace on middleware creation", () => {
    safeLocalStorage.setJSON(`${PANEL_LAYOUT_STORAGE_KEY_PREFIX}ws-retro`, validLayout);
    const api = createFakeApi("ws-retro");
    createPanelLayoutPersistenceMiddleware()(api);

    const dispatchedTypes = api.dispatch.mock.calls.map(
      (call) => (call[0] as { type: string }).type,
    );
    expect(dispatchedTypes).toContain(setRestoreStatus.type);
    expect(dispatchedTypes).toContain(initializeLayout.type);
  });
});

describe("panelLayoutPersistenceService — persistence", () => {
  function build(): { api: FakeApi; dispatch: (action: unknown) => unknown } {
    const api = createFakeApi();
    const chain = createPanelLayoutPersistenceMiddleware()(api);
    const next = (action: unknown) => api.dispatch(action);
    const dispatch = chain(next);
    return { api, dispatch };
  }

  it("persists layout to localStorage on openTab", () => {
    const { dispatch } = build();
    dispatch(initializeLayout("ws-persist", validLayout));
    dispatch(openTab("ws-persist", { type: "note", title: "Note", closable: true, noteId: "note-1" }));

    const stored = safeLocalStorage.getJSON<WorkspacePanelLayout>(
      `${PANEL_LAYOUT_STORAGE_KEY_PREFIX}ws-persist`,
    );
    expect(stored).toBeDefined();
    expect(stored?.panels).toBeDefined();
  });

  it("persists layout to localStorage on closeTab", () => {
    const { dispatch } = build();
    dispatch(initializeLayout("ws-close", validLayout));
    mem.clear();
    dispatch(closeTab("ws-close", "tab-1"));

    const stored = safeLocalStorage.getJSON<WorkspacePanelLayout>(
      `${PANEL_LAYOUT_STORAGE_KEY_PREFIX}ws-close`,
    );
    expect(stored).toBeDefined();
  });

  it("persists layout to localStorage on splitPanel", () => {
    const { dispatch } = build();
    dispatch(initializeLayout("ws-split", validLayout));
    mem.clear();
    dispatch(splitPanel("ws-split", "panel-1", "horizontal"));

    const stored = safeLocalStorage.getJSON<WorkspacePanelLayout>(
      `${PANEL_LAYOUT_STORAGE_KEY_PREFIX}ws-split`,
    );
    expect(stored).toBeDefined();
  });

  it("removes localStorage entry on clearPanelLayout", () => {
    const { dispatch } = build();
    dispatch(initializeLayout("ws-clear", validLayout));
    expect(mem.has(`${PANEL_LAYOUT_STORAGE_KEY_PREFIX}ws-clear`)).toBe(true);

    dispatch(clearPanelLayout("ws-clear"));
    expect(mem.has(`${PANEL_LAYOUT_STORAGE_KEY_PREFIX}ws-clear`)).toBe(false);
  });
});

describe("panelLayoutPersistenceService — workspace unmount", () => {
  it("calls clearPanelLayoutAdapter on workspaceUnmounted", async () => {
    const { clearPanelLayoutAdapter } = await import("$features/layout/panel-layout-adapter");
    const api = createFakeApi();
    const middleware = createPanelLayoutPersistenceMiddleware()(api);
    const next = (action: unknown) => api.dispatch(action);
    const dispatch = middleware(next);

    dispatch(workspaceUnmounted("ws-cleanup"));

    // Wait for dynamic import to resolve
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(clearPanelLayoutAdapter).toHaveBeenCalledWith("ws-cleanup");
  });

  it("clears once-per-session restore flag on workspaceUnmounted", () => {
    safeLocalStorage.setJSON(`${PANEL_LAYOUT_STORAGE_KEY_PREFIX}ws-unmount`, validLayout);
    const api = createFakeApi();
    const middleware = createPanelLayoutPersistenceMiddleware()(api);
    const next = (action: unknown) => api.dispatch(action);
    const dispatch = middleware(next);

    dispatch(workspaceMounted("ws-unmount"));
    const firstCallCount = api.dispatch.mock.calls.length;
    expect(firstCallCount).toBeGreaterThan(0);

    dispatch(workspaceUnmounted("ws-unmount"));
    api.dispatch.mockClear();

    dispatch(workspaceMounted("ws-unmount"));
    expect(api.dispatch.mock.calls.length).toBeGreaterThan(0);
  });
});

describe("panelLayoutPersistenceService — history", () => {
  it("loads history from disk on initializeLayout", async () => {
    const { loadPanelLayoutHistory } = await import("$features/layout/panel-layout-history.client");
    const historyData = {
      version: 1,
      workspaceId: "ws-history",
      history: [{ root: validLayout.root, panels: validLayout.panels, focusedPanelId: validLayout.focusedPanelId, timestamp: Date.now() }],
      historyIndex: 0,
      lastUpdated: new Date().toISOString(),
    };
    vi.mocked(loadPanelLayoutHistory).mockResolvedValue(historyData);

    const api = createFakeApi();
    const middleware = createPanelLayoutPersistenceMiddleware()(api);
    const next = (action: unknown) => api.dispatch(action);
    const dispatch = middleware(next);

    dispatch(initializeLayout("ws-history", validLayout));

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(loadPanelLayoutHistory).toHaveBeenCalledWith("ws-history");
    const dispatchedTypes = api.dispatch.mock.calls.map(
      (call) => (call[0] as { type: string }).type,
    );
    expect(dispatchedTypes).toContain(loadLayoutHistory.type);
  });

  it("schedules debounced history save on history-affecting actions", async () => {
    vi.useFakeTimers();
    const { savePanelLayoutHistory } = await import("$features/layout/panel-layout-history.client");

    const api = createFakeApi();
    const middleware = createPanelLayoutPersistenceMiddleware()(api);
    const next = (action: unknown) => api.dispatch(action);
    const dispatch = middleware(next);

    dispatch(initializeLayout("ws-debounce", validLayout));
    dispatch(openTab("ws-debounce", { type: "note", title: "Note", closable: true, noteId: "note-1" }));

    expect(savePanelLayoutHistory).not.toHaveBeenCalled();

    vi.advanceTimersByTime(HISTORY_PERSIST_DEBOUNCE_MS);
    await vi.runAllTimersAsync();

    expect(savePanelLayoutHistory).toHaveBeenCalled();
    vi.useRealTimers();
  });
});

describe("panelLayoutPersistenceService — pre-restore clobber guard", () => {
  function build(): { api: FakeApi; dispatch: (action: unknown) => unknown } {
    const api = createFakeApi();
    const chain = createPanelLayoutPersistenceMiddleware()(api);
    const next = (action: unknown) => api.dispatch(action);
    const dispatch = chain(next);
    return { api, dispatch };
  }

  it("does not overwrite a stored non-empty layout with an empty one before restore has run", () => {
    const KEY = `${PANEL_LAYOUT_STORAGE_KEY_PREFIX}ws-preclobber`;
    safeLocalStorage.setJSON(KEY, agentTabLayout("ws-preclobber", "agent-1"));
    const { dispatch } = build();

    // A persist action arriving before workspaceMounted lazily creates the
    // empty workspace state in the reducer — it must NOT clobber storage.
    dispatch(setDeferSpecTab("ws-preclobber", true));

    const stored = safeLocalStorage.getJSON<WorkspacePanelLayout>(KEY);
    expect(stored).toBeDefined();
    expect(tabsOf(stored!).map((t) => t.id)).toContain("tab-agent-1");
  });

  it("restores the stored agent tab on mount even after a pre-restore persist action", () => {
    const KEY = `${PANEL_LAYOUT_STORAGE_KEY_PREFIX}ws-preclobber-mount`;
    safeLocalStorage.setJSON(KEY, agentTabLayout("ws-preclobber-mount", "agent-1"));
    const { api, dispatch } = build();

    dispatch(setDeferSpecTab("ws-preclobber-mount", true));
    dispatch(workspaceMounted("ws-preclobber-mount"));

    const ws = api.getState().panelLayout.byWorkspaceId["ws-preclobber-mount"];
    expect(ws).toBeDefined();
    expect(ws.restoreStatus).toBe("restored");
    expect(tabsOf(ws).map((t) => t.id)).toContain("tab-agent-1");
  });

  it("still persists an empty layout once the workspace has been restored this session", () => {
    const KEY = `${PANEL_LAYOUT_STORAGE_KEY_PREFIX}ws-emptyok`;
    safeLocalStorage.setJSON(KEY, agentTabLayout("ws-emptyok", "agent-1"));
    const { dispatch } = build();

    dispatch(workspaceMounted("ws-emptyok"));
    dispatch(closeTab("ws-emptyok", "tab-agent-1"));

    const stored = safeLocalStorage.getJSON<WorkspacePanelLayout>(KEY);
    expect(stored).toBeDefined();
    expect(tabsOf(stored!)).toHaveLength(0);
  });
});

// Create-flow regression: drive the REAL middleware chain (configured store) the
// way CompactWorkspaceInitializer / OnboardingPage do — `clearPanelLayout` +
// `hydrateWorkspaceNavigation` with an agent-only drawer — and assert the
// initial agent tab lands in `panel-layout-{wsId}` and survives a fresh session.
describe("panelLayoutPersistenceService — workspace creation flow (real middleware chain)", () => {
  beforeAll(() => {
    installMemoryLocalStorage();
    appStore.init();
  });

  it("persists the initial agent tab for a brand-new workspace and restores it in a fresh session", () => {
    const WS = "ws-create-flow";
    const AGENT = "agent-initial";
    const KEY = `${PANEL_LAYOUT_STORAGE_KEY_PREFIX}${WS}`;

    appStore.dispatch(clearPanelLayout(WS));
    appStore.dispatch(
      hydrateWorkspaceNavigation(WS, {
        version: 2,
        workspace: { id: WS, status: "loading" },
        mainPanel: { type: "empty" },
        drawer: { open: true, type: "agent", itemId: AGENT },
        navigation: { history: [], currentIndex: -1 },
        ui: { hasInitialized: false },
      }),
    );

    const stored = safeLocalStorage.getJSON<WorkspacePanelLayout>(KEY);
    expect(stored).toBeDefined();
    const storedAgentTabs = tabsOf(stored!).filter(
      (t) => t.type === "agent" && (t as { agentId?: string }).agentId === AGENT,
    );
    expect(storedAgentTabs).toHaveLength(1);

    // Simulate a fresh session: unmount clears the once-per-session restore
    // flag, the reducer state is wiped, and only localStorage survives.
    const persisted = mem.get(KEY)!;
    appStore.dispatch(workspaceUnmounted(WS));
    appStore.dispatch(clearPanelLayout(WS)); // wipes reducer state (also removes the key)
    mem.set(KEY, persisted); // storage survives an app restart

    appStore.dispatch(workspaceMounted(WS));

    const wsState = appStore.state.panelLayout.byWorkspaceId[WS];
    expect(wsState).toBeDefined();
    expect(wsState.restoreStatus).toBe("restored");
    const restoredAgentTabs = tabsOf(wsState).filter(
      (t) => t.type === "agent" && (t as { agentId?: string }).agentId === AGENT,
    );
    expect(restoredAgentTabs).toHaveLength(1);
  });
});
