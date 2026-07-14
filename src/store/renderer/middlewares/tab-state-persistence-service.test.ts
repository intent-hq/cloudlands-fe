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
    getState: () => ({ tabState, workspace: workspaceState } as unknown as StoreState),
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
