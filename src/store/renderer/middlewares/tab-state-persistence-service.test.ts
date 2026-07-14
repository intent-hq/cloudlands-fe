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

function createFakeApi(): FakeApi {
  let tabState = tabStateReducer(undefined, { type: "@@init" } as never);
  const dispatch = vi.fn((action: unknown) => {
    tabState = tabStateReducer(tabState, action as never);
    return action;
  });
  return {
    getState: () => ({ tabState } as unknown as StoreState),
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
    // then cleanupInvalidWorkspaceTabs fires with an empty validIds list
    // (workspace list not yet loaded) and wipes all tabs, persisting the empty
    // state back to localStorage.
    //
    // Expected behavior: cleanup with empty validIds should NOT persist an empty
    // list back over the hydrated state during the boot window.
    safeLocalStorage.setJSON(WORKSPACE_TABS_STORAGE_KEY, {
      openTabs: ["ws-a", "ws-b"],
      currentTabId: "ws-a",
      pinnedTabs: ["ws-a"],
      unsavedTabs: [],
      optimisticTabs: [],
      tabOrder: ["ws-a", "ws-b"],
    } satisfies PersistedWorkspaceTabsState);

    const { api } = build();
    // Middleware hydrates on creation (line 148 in the service)
    const chain = createTabStatePersistenceMiddleware()(api);
    const next = (action: unknown) => api.dispatch(action);
    const dispatchChained = chain(next);

    // At this point tabs are hydrated into Redux state
    // Now simulate the race: workspace list loads empty or partial
    dispatchChained(cleanupInvalidWorkspaceTabs([]));

    // BUG: the persisted state should NOT be empty — tabs that were just
    // hydrated must not be wiped by cleanup with an incomplete validIds list.
    const stored = safeLocalStorage.getJSON<PersistedWorkspaceTabsState>(
      WORKSPACE_TABS_STORAGE_KEY,
    );
    // This assertion FAILS before the fix and PASSES after
    expect(stored?.openTabs.length).toBeGreaterThan(0);
    expect(stored?.openTabs).toContain("ws-a");
  });

  it("cleanupInvalidWorkspaceTabs prunes stale ids and rewrites storage", () => {
    const { dispatch } = build();
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
});
