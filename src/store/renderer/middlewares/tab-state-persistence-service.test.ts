import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Middleware unit tests: exercise `createTabStatePersistenceMiddleware` with a
// fake middleware API + in-memory localStorage. Testing the factory directly
// keeps the tests independent of the singleton `appStore` (whose middleware
// chain is composed once at process start — before this file's setup can seed
// storage — when other suites in the same run initialize it first).
import { safeLocalStorage } from "$lib/utils/safe-storage";
import {
  cleanupInvalidWorkspaceTabs,
  closeWorkspaceTab,
  loadScrollPositions,
  loadWorkspaceTabsState,
  openWorkspaceTab,
  type PersistedWorkspaceTabsState,
  reorderWorkspaceTabs,
  saveScrollPosition,
  TAB_SCROLL_POSITIONS_STORAGE_KEY,
  tabStateReducer,
  toggleWorkspaceTabPin,
  WORKSPACE_TABS_STORAGE_KEY,
} from "$store/renderer/slices/tab-state/tab-state-slice";
import { setWorkspaceHasLoaded } from "$store/renderer/slices/workspace/workspace-slice";
import { connectionsListReceived } from "$store/renderer/slices/connections/connections-slice";
import { LOCAL_CONNECTION_ID } from "$shared/types/connections";
import type { StoreState } from "$store/renderer/types";
import { createTabStatePersistenceMiddleware } from "./tab-state-persistence-service";

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

function createFakeApi(activeIdRef?: { current: string }): FakeApi {
  let tabState = tabStateReducer(undefined, { type: "@@init" } as never);
  let workspaceState = { hasLoaded: false, loading: false, error: null };
  const dispatch = vi.fn((action: unknown) => {
    tabState = tabStateReducer(tabState, action as never);
    // Handle setWorkspaceHasLoaded action
    if (action && typeof action === 'object' && 'type' in action) {
      if (action.type === setWorkspaceHasLoaded.type && 'payload' in action) {
        const payload = action.payload as [boolean];
        workspaceState = { ...workspaceState, hasLoaded: payload[0] };
      }
    }
    return action;
  });
  return {
    getState: () =>
      ({
        tabState,
        workspace: workspaceState,
        connections: { activeId: activeIdRef?.current ?? LOCAL_CONNECTION_ID },
      }) as unknown as StoreState,
    dispatch,
  };
}

const seededTabs: PersistedWorkspaceTabsState = {
  openTabs: ["ws-a", "ws-b"],
  currentTabId: "ws-b",
  pinnedTabs: ["ws-a"],
  unsavedTabs: [],
  optimisticTabs: [],
  tabOrder: ["ws-a", "ws-b"],
};

beforeEach(() => {
  installMemoryLocalStorage();
  mem.clear();
});
afterEach(() => {
  mem.clear();
});

describe("tabStatePersistenceService — boot hydration", () => {
  it("dispatches loadWorkspaceTabsState + loadScrollPositions from seeded localStorage", () => {
    safeLocalStorage.setJSON(WORKSPACE_TABS_STORAGE_KEY, seededTabs);
    safeLocalStorage.setJSON(TAB_SCROLL_POSITIONS_STORAGE_KEY, {
      "ws-a-note-1": 120,
    });
    const api = createFakeApi();

    createTabStatePersistenceMiddleware()(api);

    const dispatchedTypes = api.dispatch.mock.calls.map(
      (call) => (call[0] as { type: string }).type,
    );
    expect(dispatchedTypes).toContain(loadScrollPositions.type);
    expect(dispatchedTypes).toContain(loadWorkspaceTabsState.type);

    const s = api.getState().tabState;
    expect(s.currentTabId).toBe("ws-b");
    expect(s.tabOrder).toEqual(["ws-a", "ws-b"]);
    expect(s.openTabs).toEqual({ "ws-a": true, "ws-b": true });
    expect(s.pinnedTabs).toEqual({ "ws-a": true });
    expect(s.scrollPositions).toEqual({ "ws-a-note-1": 120 });
  });

  it("does not dispatch when localStorage is empty", () => {
    const api = createFakeApi();
    createTabStatePersistenceMiddleware()(api);
    expect(api.dispatch).not.toHaveBeenCalled();
  });

  it("tolerates corrupt workspace-tabs JSON (no throw, no dispatch)", () => {
    vi.mocked(window.localStorage.getItem).mockImplementation((key: string) => {
      if (key === WORKSPACE_TABS_STORAGE_KEY) return "{not-valid-json";
      return null;
    });
    const api = createFakeApi();
    expect(() => createTabStatePersistenceMiddleware()(api)).not.toThrow();
    expect(api.dispatch).not.toHaveBeenCalled();
  });

  it("tolerates corrupt scroll-positions JSON (no throw, no dispatch)", () => {
    vi.mocked(window.localStorage.getItem).mockImplementation((key: string) => {
      if (key === TAB_SCROLL_POSITIONS_STORAGE_KEY) return "{not-valid";
      return null;
    });
    const api = createFakeApi();
    expect(() => createTabStatePersistenceMiddleware()(api)).not.toThrow();
    expect(api.dispatch).not.toHaveBeenCalled();
  });

  it("ignores workspace-tabs JSON whose shape is wrong", () => {
    safeLocalStorage.setJSON(WORKSPACE_TABS_STORAGE_KEY, { openTabs: "not-an-array" });
    const api = createFakeApi();
    createTabStatePersistenceMiddleware()(api);
    const dispatchedTypes = api.dispatch.mock.calls.map(
      (call) => (call[0] as { type: string }).type,
    );
    expect(dispatchedTypes).not.toContain(loadWorkspaceTabsState.type);
  });
});

describe("tabStatePersistenceService — per-action persistence", () => {
  function build(): { api: FakeApi; dispatch: (action: unknown) => unknown } {
    const api = createFakeApi();
    const chain = createTabStatePersistenceMiddleware()(api);
    const next = (action: unknown) => api.dispatch(action);
    const dispatch = chain(next);
    return { api, dispatch };
  }

  it("persists the serialized shape on openWorkspaceTab", () => {
    const { dispatch } = build();
    dispatch(openWorkspaceTab("ws-persist"));
    const stored = safeLocalStorage.getJSON<PersistedWorkspaceTabsState>(
      WORKSPACE_TABS_STORAGE_KEY,
    );
    expect(stored).toBeDefined();
    expect(stored?.openTabs).toContain("ws-persist");
    expect(stored?.currentTabId).toBe("ws-persist");
    expect(stored?.tabOrder).toContain("ws-persist");
  });

  it("persists pin toggles", () => {
    const { dispatch } = build();
    dispatch(openWorkspaceTab("ws-pin"));
    dispatch(toggleWorkspaceTabPin("ws-pin"));
    const stored = safeLocalStorage.getJSON<PersistedWorkspaceTabsState>(
      WORKSPACE_TABS_STORAGE_KEY,
    );
    expect(stored?.pinnedTabs).toContain("ws-pin");
  });

  it("persists reorder", () => {
    const { dispatch } = build();
    dispatch(openWorkspaceTab("ws-r1"));
    dispatch(openWorkspaceTab("ws-r2"));
    dispatch(reorderWorkspaceTabs("ws-r1", "ws-r2"));
    const stored = safeLocalStorage.getJSON<PersistedWorkspaceTabsState>(
      WORKSPACE_TABS_STORAGE_KEY,
    );
    const order = stored?.tabOrder ?? [];
    expect(order.indexOf("ws-r2")).toBeLessThan(order.indexOf("ws-r1"));
  });

  it("persists closeWorkspaceTab", () => {
    const { dispatch } = build();
    dispatch(openWorkspaceTab("ws-close"));
    dispatch(closeWorkspaceTab("ws-close"));
    const stored = safeLocalStorage.getJSON<PersistedWorkspaceTabsState>(
      WORKSPACE_TABS_STORAGE_KEY,
    );
    expect(stored?.openTabs ?? []).not.toContain("ws-close");
  });

  it("persists scroll positions on saveScrollPosition", () => {
    const { dispatch } = build();
    dispatch(saveScrollPosition("ws-scroll", 42));
    const stored = safeLocalStorage.getJSON<Record<string, number>>(
      TAB_SCROLL_POSITIONS_STORAGE_KEY,
    );
    expect(stored?.["ws-scroll"]).toBe(42);
  });

  it("REGRESSION: hydrated tabs clobbered by early cleanupInvalidWorkspaceTabs with empty validIds", () => {
    // Simulates the boot-order race: hydrate restores tabs from localStorage,
    // then cleanupInvalidWorkspaceTabs fires before workspace.hasLoaded becomes true
    // (workspace list not yet loaded) and wipes all tabs, persisting the empty
    // state back to localStorage.
    //
    // Expected behavior: cleanup that fires before workspace.hasLoaded should NOT
    // persist, preventing the empty result from clobbering the hydrated state.
    safeLocalStorage.setJSON(WORKSPACE_TABS_STORAGE_KEY, {
      openTabs: ["ws-a", "ws-b"],
      currentTabId: "ws-a",
      pinnedTabs: ["ws-a"],
      unsavedTabs: [],
      optimisticTabs: [],
      tabOrder: ["ws-a", "ws-b"],
    } satisfies PersistedWorkspaceTabsState);

    const { dispatch } = build();
    // Middleware hydrates on creation (line 148 in the service)
    // workspace.hasLoaded is false by default at boot

    // Now simulate the race: cleanupInvalidWorkspaceTabs fires with empty validIds
    // before workspace.hasLoaded becomes true
    dispatch(cleanupInvalidWorkspaceTabs([]));

    // The persisted state should NOT be clobbered — tabs that were just
    // hydrated must not be wiped by cleanup that fires before hasLoaded.
    const stored = safeLocalStorage.getJSON<PersistedWorkspaceTabsState>(
      WORKSPACE_TABS_STORAGE_KEY,
    );
    // This assertion FAILS before the fix and PASSES after
    expect(stored?.openTabs.length).toBeGreaterThan(0);
    expect(stored?.openTabs).toContain("ws-a");
  });

  it("cleanupInvalidWorkspaceTabs prunes stale ids and rewrites storage when hasLoaded is true", () => {
    const { dispatch } = build();
    // Simulate workspace list loaded
    dispatch(setWorkspaceHasLoaded(true));
    dispatch(openWorkspaceTab("ws-keep"));
    dispatch(openWorkspaceTab("ws-drop"));
    dispatch(cleanupInvalidWorkspaceTabs(["ws-keep"]));
    const stored = safeLocalStorage.getJSON<PersistedWorkspaceTabsState>(
      WORKSPACE_TABS_STORAGE_KEY,
    );
    expect(stored?.openTabs).toContain("ws-keep");
    expect(stored?.openTabs ?? []).not.toContain("ws-drop");
    expect(stored?.tabOrder ?? []).not.toContain("ws-drop");
  });

  it("cleanupInvalidWorkspaceTabs with empty validIds DOES persist after workspace list is loaded", () => {
    // Once workspace.hasLoaded is true, even an empty validIds cleanup should persist,
    // as that represents a legitimate "all workspaces removed/archived" outcome.
    const { dispatch } = build();
    dispatch(openWorkspaceTab("ws-a"));
    dispatch(openWorkspaceTab("ws-b"));
    // Mark workspace list as loaded
    dispatch(setWorkspaceHasLoaded(true));
    // Now cleanup with empty validIds (all workspaces removed)
    dispatch(cleanupInvalidWorkspaceTabs([]));
    const stored = safeLocalStorage.getJSON<PersistedWorkspaceTabsState>(
      WORKSPACE_TABS_STORAGE_KEY,
    );
    // Should persist the empty cleanup result since hasLoaded is true
    expect(stored?.openTabs).toEqual([]);
    expect(stored?.tabOrder).toEqual([]);
  });
});

describe("tabStatePersistenceService — backend namespacing", () => {
  const REMOTE = "mock-10.0.0.9:5181";
  const REMOTE_TABS_KEY = `backend:${REMOTE}:${WORKSPACE_TABS_STORAGE_KEY}`;
  const REMOTE_SCROLL_KEY = `backend:${REMOTE}:${TAB_SCROLL_POSITIONS_STORAGE_KEY}`;

  function build(activeIdRef: { current: string }): {
    api: FakeApi;
    dispatch: (action: unknown) => unknown;
  } {
    const api = createFakeApi(activeIdRef);
    const chain = createTabStatePersistenceMiddleware()(api);
    const next = (action: unknown) => api.dispatch(action);
    const dispatch = chain(next);
    return { api, dispatch };
  }

  it("local backend keeps the legacy un-namespaced keys (migration)", () => {
    const activeIdRef = { current: LOCAL_CONNECTION_ID };
    const { dispatch } = build(activeIdRef);
    dispatch(openWorkspaceTab("ws-local"));
    // Legacy key is written; no namespaced key exists.
    expect(
      safeLocalStorage.getJSON<PersistedWorkspaceTabsState>(WORKSPACE_TABS_STORAGE_KEY)?.openTabs,
    ).toContain("ws-local");
    expect(mem.has(REMOTE_TABS_KEY)).toBe(false);
  });

  it("remote backend writes to a backend-prefixed key, not the legacy one", () => {
    const activeIdRef = { current: REMOTE };
    const { dispatch } = build(activeIdRef);
    dispatch(openWorkspaceTab("ws-remote"));
    dispatch(saveScrollPosition("ws-remote-note", 88));
    expect(
      safeLocalStorage.getJSON<PersistedWorkspaceTabsState>(REMOTE_TABS_KEY)?.openTabs,
    ).toContain("ws-remote");
    expect(safeLocalStorage.getJSON<Record<string, number>>(REMOTE_SCROLL_KEY)).toEqual({
      "ws-remote-note": 88,
    });
    // The legacy (local) key is untouched.
    expect(mem.has(WORKSPACE_TABS_STORAGE_KEY)).toBe(false);
  });

  it("hydrates from the backend-prefixed key when the active backend is remote", () => {
    safeLocalStorage.setJSON(REMOTE_TABS_KEY, seededTabs);
    const activeIdRef = { current: REMOTE };
    const api = createFakeApi(activeIdRef);
    createTabStatePersistenceMiddleware()(api);
    const s = api.getState().tabState;
    expect(s.currentTabId).toBe("ws-b");
    expect(s.openTabs).toEqual({ "ws-a": true, "ws-b": true });
  });

  it("no cross-backend clobber on a shared workspace ID", () => {
    // Local persists tabs for workspace `shared`.
    const localRef = { current: LOCAL_CONNECTION_ID };
    build(localRef).dispatch(openWorkspaceTab("shared"));
    // Remote persists different tabs for the SAME workspace ID.
    const remoteRef = { current: REMOTE };
    build(remoteRef).dispatch(openWorkspaceTab("shared-remote-only"));

    const local = safeLocalStorage.getJSON<PersistedWorkspaceTabsState>(WORKSPACE_TABS_STORAGE_KEY);
    const remote = safeLocalStorage.getJSON<PersistedWorkspaceTabsState>(REMOTE_TABS_KEY);
    expect(local?.openTabs).toEqual(["shared"]);
    expect(remote?.openTabs).toEqual(["shared-remote-only"]);
  });

  it("re-hydrates the incoming backend's tabs on a backend switch", () => {
    // Local boots with its own tabs stored; remote has a distinct saved strip.
    safeLocalStorage.setJSON(WORKSPACE_TABS_STORAGE_KEY, {
      ...seededTabs,
      openTabs: ["local-a"],
      currentTabId: "local-a",
      pinnedTabs: [],
      tabOrder: ["local-a"],
    } satisfies PersistedWorkspaceTabsState);
    safeLocalStorage.setJSON(REMOTE_TABS_KEY, {
      ...seededTabs,
      openTabs: ["remote-x", "remote-y"],
      currentTabId: "remote-y",
      pinnedTabs: [],
      tabOrder: ["remote-x", "remote-y"],
    } satisfies PersistedWorkspaceTabsState);

    const activeIdRef = { current: LOCAL_CONNECTION_ID };
    const { api, dispatch } = build(activeIdRef);
    // Booted as local.
    expect(api.getState().tabState.currentTabId).toBe("local-a");

    // Simulate the post-switch window reload learning it is now on `REMOTE`.
    activeIdRef.current = REMOTE;
    dispatch(connectionsListReceived({ connections: [], activeId: REMOTE }));

    const s = api.getState().tabState;
    expect(s.currentTabId).toBe("remote-y");
    expect(s.openTabs).toEqual({ "remote-x": true, "remote-y": true });
  });

  it("resets to empty when the incoming backend has no saved tabs", () => {
    safeLocalStorage.setJSON(WORKSPACE_TABS_STORAGE_KEY, {
      ...seededTabs,
      openTabs: ["local-a"],
      currentTabId: "local-a",
      pinnedTabs: [],
      tabOrder: ["local-a"],
    } satisfies PersistedWorkspaceTabsState);

    const activeIdRef = { current: LOCAL_CONNECTION_ID };
    const { api, dispatch } = build(activeIdRef);
    expect(api.getState().tabState.openTabs).toEqual({ "local-a": true });

    activeIdRef.current = REMOTE;
    dispatch(connectionsListReceived({ connections: [], activeId: REMOTE }));

    const s = api.getState().tabState;
    expect(s.openTabs).toEqual({});
    expect(s.currentTabId).toBeNull();
  });
});
