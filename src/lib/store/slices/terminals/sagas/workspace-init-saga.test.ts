import { beforeEach, describe, expect, it, vi } from "vitest";
import { runSaga } from "redux-saga";
import * as sagaEffects from "redux-saga/effects";

vi.mock("typed-redux-saga", () => {
  function* call(fn: any, ...args: any[]): Generator<any, any, any> {
    return yield sagaEffects.call(fn, ...args);
  }
  function* put(action: any): Generator<any, any, any> {
    return yield sagaEffects.put(action);
  }
  function* select(selector: any, ...args: any[]): Generator<any, any, any> {
    return yield sagaEffects.select(selector, ...args);
  }
  function* takeEvery(pattern: any, worker: any): Generator<any, any, any> {
    return yield sagaEffects.takeEvery(pattern, worker);
  }
  return { call, put, select, takeEvery };
});

const { loadTerminalMetadataMock, saveTerminalMetadataMock, removeTerminalMetadataMock } = vi.hoisted(() => ({
  loadTerminalMetadataMock: vi.fn(() => []),
  saveTerminalMetadataMock: vi.fn(),
  removeTerminalMetadataMock: vi.fn(),
}));

vi.mock("$features/terminal/terminal-manager.svelte", () => ({
  terminalManager: {
    loadTerminalMetadata: loadTerminalMetadataMock,
    saveTerminalMetadata: saveTerminalMetadataMock,
    removeTerminalMetadata: removeTerminalMetadataMock,
  },
}));

vi.mock("$lib/electron-bridge", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "$lib/electron-bridge";
import {
  loadWorkspaceTerminals,
  setIsLoadingTerminals,
  setTerminalsLoaded,
} from "../terminals-slice";
import { loadTerminalsSaga } from "./workspace-init-saga";

describe("loadTerminalsSaga — stale ID reconciliation", () => {
  const WS = "ws-test-1";
  const storage = new Map<string, string>();

  beforeEach(() => {
    storage.clear();
    vi.clearAllMocks();

    vi.mocked(window.localStorage.getItem).mockImplementation((key: string) => {
      return storage.get(key) ?? null;
    });
    vi.mocked(window.localStorage.setItem).mockImplementation((key: string, value: string) => {
      storage.set(key, value);
    });

    (window as any).electronAPI = (window as any).electronAPI ?? { on: vi.fn(), off: vi.fn() };
  });

  it("prunes stale localStorage terminals absent from backend", async () => {
    // Setup: localStorage has 3 terminals
    const storedTerminals = [
      { terminalId: "term-1", workspaceId: WS, createdAt: "2026-01-01T00:00:00Z", title: "Terminal 1" },
      { terminalId: "term-2", workspaceId: WS, createdAt: "2026-01-02T00:00:00Z", title: "Terminal 2" },
      { terminalId: "term-3", workspaceId: WS, createdAt: "2026-01-03T00:00:00Z", title: "Terminal 3" },
    ];
    loadTerminalMetadataMock.mockReturnValue(storedTerminals);

    // Backend only knows about term-1
    vi.mocked(invoke).mockResolvedValue({
      success: true,
      terminals: [{ id: "term-1", workspaceId: WS, cwd: "/home" }],
    });

    const dispatched: any[] = [];
    await runSaga(
      {
        dispatch: (action: any) => dispatched.push(action),
        getState: () => ({}),
      },
      loadTerminalsSaga,
      WS,
    ).toPromise();

    // Find the loadWorkspaceTerminals dispatch
    const loadAction = dispatched.find(
      (a) => a.type === loadWorkspaceTerminals.type,
    );
    expect(loadAction).toBeDefined();

    const [, terminals] = loadAction.payload;

    // Only the backend-known terminal survives; stale ones are pruned
    expect(terminals).toHaveLength(1);
    expect(terminals[0].id).toBe("term-1");

    // Verify removeTerminalMetadata was called for stale entries
    expect(removeTerminalMetadataMock).toHaveBeenCalledWith("term-2", WS);
    expect(removeTerminalMetadataMock).toHaveBeenCalledWith("term-3", WS);
    expect(removeTerminalMetadataMock).toHaveBeenCalledTimes(2);
  });

  it("adds backend-only terminals and prunes stale localStorage ones", async () => {
    // localStorage has term-stale (not in backend)
    const storedTerminals = [
      { terminalId: "term-stale", workspaceId: WS, createdAt: "2026-01-01T00:00:00Z", title: "Stale" },
    ];
    loadTerminalMetadataMock.mockReturnValue(storedTerminals);

    // Backend has term-new (not in localStorage)
    vi.mocked(invoke).mockResolvedValue({
      success: true,
      terminals: [{ id: "term-new", workspaceId: WS, cwd: "/home" }],
    });

    const dispatched: any[] = [];
    await runSaga(
      {
        dispatch: (action: any) => dispatched.push(action),
        getState: () => ({}),
      },
      loadTerminalsSaga,
      WS,
    ).toPromise();

    const loadAction = dispatched.find(
      (a) => a.type === loadWorkspaceTerminals.type,
    );
    const [, terminals] = loadAction.payload;

    // Only backend terminal survives; stale localStorage entry is pruned
    expect(terminals).toHaveLength(1);
    expect(terminals[0].id).toBe("term-new");

    // Backend-only terminal was saved to localStorage
    expect(saveTerminalMetadataMock).toHaveBeenCalledWith("term-new", WS, "Setup");

    // Stale terminal was removed from localStorage
    expect(removeTerminalMetadataMock).toHaveBeenCalledWith("term-stale", WS);
  });

  it("dispatches loading lifecycle actions in correct order", async () => {
    loadTerminalMetadataMock.mockReturnValue([]);
    vi.mocked(invoke).mockResolvedValue({ success: true, terminals: [] });

    const dispatched: any[] = [];
    await runSaga(
      {
        dispatch: (action: any) => dispatched.push(action),
        getState: () => ({}),
      },
      loadTerminalsSaga,
      WS,
    ).toPromise();

    const types = dispatched.map((a) => a.type);
    expect(types[0]).toBe(setIsLoadingTerminals.type);
    expect(types).toContain(loadWorkspaceTerminals.type);
    expect(types).toContain(setTerminalsLoaded.type);
    // Last two should be setTerminalsLoaded and setIsLoadingTerminals(false) from finally
    expect(types[types.length - 2]).toBe(setTerminalsLoaded.type);
    expect(types[types.length - 1]).toBe(setIsLoadingTerminals.type);
  });

  it("does not prune localStorage terminals when backend call returns success:false", async () => {
    const storedTerminals = [
      { terminalId: "term-1", workspaceId: WS, createdAt: "2026-01-01T00:00:00Z", title: "Terminal 1" },
      { terminalId: "term-2", workspaceId: WS, createdAt: "2026-01-02T00:00:00Z", title: "Terminal 2" },
    ];
    loadTerminalMetadataMock.mockReturnValue(storedTerminals);

    // Backend returns failure
    vi.mocked(invoke).mockResolvedValue({ success: false });

    const dispatched: any[] = [];
    await runSaga(
      {
        dispatch: (action: any) => dispatched.push(action),
        getState: () => ({}),
      },
      loadTerminalsSaga,
      WS,
    ).toPromise();

    const loadAction = dispatched.find(
      (a) => a.type === loadWorkspaceTerminals.type,
    );
    expect(loadAction).toBeDefined();

    const [, terminals] = loadAction.payload;

    // All localStorage terminals should be preserved — no pruning
    expect(terminals).toHaveLength(2);
    expect(terminals.map((t: any) => t.id)).toEqual(["term-1", "term-2"]);
    expect(removeTerminalMetadataMock).not.toHaveBeenCalled();
  });

  it("does not prune localStorage terminals when backend call throws", async () => {
    const storedTerminals = [
      { terminalId: "term-1", workspaceId: WS, createdAt: "2026-01-01T00:00:00Z", title: "Terminal 1" },
    ];
    loadTerminalMetadataMock.mockReturnValue(storedTerminals);

    // Backend throws an error
    vi.mocked(invoke).mockRejectedValue(new Error("IPC connection lost"));

    const dispatched: any[] = [];
    await runSaga(
      {
        dispatch: (action: any) => dispatched.push(action),
        getState: () => ({}),
      },
      loadTerminalsSaga,
      WS,
    ).toPromise();

    const loadAction = dispatched.find(
      (a) => a.type === loadWorkspaceTerminals.type,
    );
    expect(loadAction).toBeDefined();

    const [, terminals] = loadAction.payload;

    // localStorage terminal should be preserved — no pruning on IPC failure
    expect(terminals).toHaveLength(1);
    expect(terminals[0].id).toBe("term-1");
    expect(removeTerminalMetadataMock).not.toHaveBeenCalled();
  });
});

