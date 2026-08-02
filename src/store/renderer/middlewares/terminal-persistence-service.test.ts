import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Middleware unit tests: exercise `createTerminalPersistenceMiddleware` with a
// fake middleware API + in-memory localStorage. Testing the factory directly
// keeps the tests independent of the singleton `appStore` (whose middleware
// chain is composed once at process start — before this file's setup can seed
// storage — when other suites in the same run initialize it first).
import { safeLocalStorage } from "$lib/utils/safe-storage";
import {
  setTerminalOverlayHeight,
  renameTerminal,
  saveTerminalMetadata,
  removeTerminal,
  openTerminalOverlay,
  loadWorkspaceTerminals,
  hydrateHeight,
  STORAGE_KEY,
  CUSTOM_NAMES_STORAGE_KEY,
  WORKSPACE_STATE_STORAGE_KEY,
  terminalsReducer,
  type PersistedWorkspaceState,
} from "$store/renderer/slices/terminals/terminals-slice";
import type { StoreState } from "$store/renderer/types";
import { createTerminalPersistenceMiddleware } from "./terminal-persistence-service";

const mem = new Map<string, string>();
function installMemoryLocalStorage(): void {
  vi.mocked(window.localStorage.getItem).mockImplementation(
    (key: string) => mem.get(key) ?? null
  );
  vi.mocked(window.localStorage.setItem).mockImplementation(
    (key: string, value: string) => {
      mem.set(key, String(value));
    }
  );
  vi.mocked(window.localStorage.removeItem).mockImplementation(
    (key: string) => {
      mem.delete(key);
    }
  );
}

type FakeApi = {
  getState: () => StoreState;
  dispatch: ReturnType<typeof vi.fn>;
};

function createFakeApi(): FakeApi {
  let terminalsState = terminalsReducer(undefined, { type: "@@init" } as never);
  const dispatch = vi.fn((action: unknown) => {
    terminalsState = terminalsReducer(terminalsState, action as never);
    return action;
  });
  return {
    getState: () => ({ terminals: terminalsState } as unknown as StoreState),
    dispatch,
  };
}

beforeEach(() => {
  installMemoryLocalStorage();
  mem.clear();
});
afterEach(() => {
  mem.clear();
});

describe("terminalPersistenceService — boot hydration", () => {
  it("dispatches hydrateHeight from seeded localStorage", () => {
    safeLocalStorage.setItem(STORAGE_KEY, "60");
    const api = createFakeApi();

    createTerminalPersistenceMiddleware()(api);

    const dispatchedTypes = api.dispatch.mock.calls.map(
      (call) => (call[0] as { type: string }).type
    );
    expect(dispatchedTypes).toContain(hydrateHeight.type);

    const heightAction = api.dispatch.mock.calls.find(
      (call) => (call[0] as { type: string }).type === hydrateHeight.type
    )?.[0] as { payload: [number] };
    expect(heightAction.payload[0]).toBe(60);
  });

  it("defaults height to 50 when localStorage is empty", () => {
    const api = createFakeApi();

    createTerminalPersistenceMiddleware()(api);

    const heightAction = api.dispatch.mock.calls.find(
      (call) => (call[0] as { type: string }).type === hydrateHeight.type
    )?.[0] as { payload: [number] };
    expect(heightAction.payload[0]).toBe(50);
  });
});

describe("terminalPersistenceService — height persistence", () => {
  it("persists height on setTerminalOverlayHeight", () => {
    const api = createFakeApi();
    const middleware = createTerminalPersistenceMiddleware()(api);
    const next = vi.fn((action) => {
      api.dispatch(action);
      return action;
    });
    const dispatch = middleware(next);

    dispatch(setTerminalOverlayHeight(75));

    expect(safeLocalStorage.getItem(STORAGE_KEY)).toBe("75");
  });
});

describe("terminalPersistenceService — custom names", () => {
  it("persists custom name on renameTerminal", () => {
    const api = createFakeApi();
    const middleware = createTerminalPersistenceMiddleware()(api);
    const next = vi.fn((action) => {
      api.dispatch(action);
      return action;
    });
    const dispatch = middleware(next);

    dispatch(renameTerminal("ws-1", "term-1", "My Terminal"));

    const stored = safeLocalStorage.getJSON(CUSTOM_NAMES_STORAGE_KEY) as Record<
      string,
      Record<string, string>
    >;
    expect(stored["ws-1"]["term-1"]).toBe("My Terminal");
  });

  it("removes custom name when renamed to empty string", () => {
    const api = createFakeApi();
    const middleware = createTerminalPersistenceMiddleware()(api);
    const next = vi.fn((action) => {
      api.dispatch(action);
      return action;
    });
    const dispatch = middleware(next);

    // Set a name first
    dispatch(renameTerminal("ws-1", "term-1", "My Terminal"));
    // Then clear it
    dispatch(renameTerminal("ws-1", "term-1", "  "));

    const stored = safeLocalStorage.getJSON(CUSTOM_NAMES_STORAGE_KEY) as Record<
      string,
      Record<string, string>
    >;
    expect(stored["ws-1"]).toBeUndefined();
  });

  it("removes custom name on removeTerminal", () => {
    const api = createFakeApi();
    const middleware = createTerminalPersistenceMiddleware()(api);
    const next = vi.fn((action) => {
      api.dispatch(action);
      return action;
    });
    const dispatch = middleware(next);

    // Set a name first
    dispatch(renameTerminal("ws-1", "term-1", "My Terminal"));
    // Then remove the terminal
    dispatch(removeTerminal("ws-1", "term-1"));

    const stored = safeLocalStorage.getJSON(CUSTOM_NAMES_STORAGE_KEY) as Record<
      string,
      Record<string, string>
    >;
    expect(stored["ws-1"]).toBeUndefined();
  });
});

describe("terminalPersistenceService — metadata persistence", () => {
  it("persists terminal metadata on saveTerminalMetadata", () => {
    const api = createFakeApi();
    const middleware = createTerminalPersistenceMiddleware()(api);
    const next = vi.fn((action) => {
      api.dispatch(action);
      return action;
    });
    const dispatch = middleware(next);

    dispatch(
      saveTerminalMetadata(
        "ws-1",
        "term-1",
        "Setup",
        "2024-01-01T00:00:00.000Z"
      )
    );

    const stored = safeLocalStorage.getJSON(
      "terminal-metadata-ws-1"
    ) as Array<unknown>;
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      terminalId: "term-1",
      workspaceId: "ws-1",
      title: "Setup",
    });
  });

  it("removes terminal metadata on removeTerminal", () => {
    const api = createFakeApi();
    const middleware = createTerminalPersistenceMiddleware()(api);
    const next = vi.fn((action) => {
      api.dispatch(action);
      return action;
    });
    const dispatch = middleware(next);

    // Save metadata first
    dispatch(
      saveTerminalMetadata(
        "ws-1",
        "term-1",
        "Setup",
        "2024-01-01T00:00:00.000Z"
      )
    );
    // Then remove the terminal
    dispatch(removeTerminal("ws-1", "term-1"));

    const stored = safeLocalStorage.getJSON("terminal-metadata-ws-1") as Array<unknown>;
    expect(stored).toHaveLength(0);
  });
});

describe("terminalPersistenceService — workspace state persistence", () => {
  it("persists workspace state on openTerminalOverlay", () => {
    const api = createFakeApi();
    const middleware = createTerminalPersistenceMiddleware()(api);
    const next = vi.fn((action) => {
      api.dispatch(action);
      return action;
    });
    const dispatch = middleware(next);

    dispatch(openTerminalOverlay("ws-1", "term-1"));

    const stored = safeLocalStorage.getJSON(
      WORKSPACE_STATE_STORAGE_KEY
    ) as Record<string, PersistedWorkspaceState>;
    expect(stored["ws-1"]).toMatchObject({
      isOpen: true,
      activeTerminalId: "term-1",
    });
  });

  it("restores saved state when loadWorkspaceTerminals is dispatched without savedState", () => {
    // Seed localStorage with saved state
    safeLocalStorage.setJSON(WORKSPACE_STATE_STORAGE_KEY, {
      "ws-1": { isOpen: true, activeTerminalId: "term-2" },
    });

    const api = createFakeApi();
    const middleware = createTerminalPersistenceMiddleware()(api);
    const next = vi.fn((action) => {
      // Simulate the reducer applying the action
      api.dispatch(action);
      return action;
    });
    const dispatch = middleware(next);

    // Dispatch loadWorkspaceTerminals without savedState (as lifecycle-read-service does)
    dispatch(
      loadWorkspaceTerminals("ws-1", [
        { id: "term-1", name: "Terminal 1" },
        { id: "term-2", name: "Terminal 2" },
      ])
    );

    // The middleware should have intercepted and re-dispatched with savedState
    const calls = next.mock.calls;
    const lastCall = calls[calls.length - 1][0] as {
      type: string;
      payload: [string, unknown[], PersistedWorkspaceState | null];
    };
    expect(lastCall.payload[2]).toMatchObject({
      isOpen: true,
      activeTerminalId: "term-2",
    });
  });

  it("does not override savedState when already provided", () => {
    // Seed localStorage with different state
    safeLocalStorage.setJSON(WORKSPACE_STATE_STORAGE_KEY, {
      "ws-1": { isOpen: true, activeTerminalId: "term-1" },
    });

    const api = createFakeApi();
    const middleware = createTerminalPersistenceMiddleware()(api);
    const next = vi.fn((action) => {
      api.dispatch(action);
      return action;
    });
    const dispatch = middleware(next);

    // Dispatch with explicit savedState (should not be overridden)
    const explicitState = { isOpen: false, activeTerminalId: "term-2" };
    dispatch(
      loadWorkspaceTerminals(
        "ws-1",
        [
          { id: "term-1", name: "Terminal 1" },
          { id: "term-2", name: "Terminal 2" },
        ],
        explicitState
      )
    );

    // The middleware should NOT override the provided savedState
    const calls = next.mock.calls;
    const lastCall = calls[calls.length - 1][0] as {
      type: string;
      payload: [string, unknown[], PersistedWorkspaceState];
    };
    expect(lastCall.payload[2]).toBe(explicitState);
  });

  // Invariant pin (intent-hq/monorepo#1330 investigation): loadWorkspaceTerminals
  // is in WORKSPACE_STATE_PERSIST_ACTIONS and the reducer forces isOpen=false on
  // an empty list, so an empty hydration COULD durably overwrite a persisted
  // { isOpen: true }. Today that is prevented only by an accident of control
  // flow: the interceptor's `return next(...)` for the savedState-undefined
  // path (the only path lifecycle-read-service/seeder use) exits before the
  // GAP-5 persist block runs. This test pins that invariant so a refactor of
  // the interceptor cannot silently make the in-memory clobber durable.
  it("does not durably persist isOpen=false when a transient empty list clobbers a saved open state (monorepo#1330)", () => {
    safeLocalStorage.setJSON(WORKSPACE_STATE_STORAGE_KEY, {
      "ws-1": { isOpen: true, activeTerminalId: "pty-1" },
    });

    const api = createFakeApi();
    const middleware = createTerminalPersistenceMiddleware()(api);
    const next = vi.fn((action) => {
      api.dispatch(action);
      return action;
    });
    const dispatch = middleware(next);

    // Mount hydration lands with a transient empty list (savedState omitted,
    // exactly as lifecycle-read-service dispatches it).
    dispatch(loadWorkspaceTerminals("ws-1", []));

    const stored = safeLocalStorage.getJSON(
      WORKSPACE_STATE_STORAGE_KEY
    ) as Record<string, PersistedWorkspaceState>;
    expect(stored["ws-1"]).toMatchObject({ isOpen: true });
  });
});
