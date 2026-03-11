import { beforeEach, describe, expect, it, vi } from "vitest";
import { eventChannel, runSaga } from "redux-saga";
import { expectSaga } from "redux-saga-test-plan";
import * as sagaEffects from "redux-saga/effects";

vi.mock("typed-redux-saga", () => {
  function* call(fn: any, ...args: any[]): Generator<any, any, any> {
    return yield sagaEffects.call(fn, ...args);
  }
  function* put(action: any): Generator<any, any, any> {
    return yield sagaEffects.put(action);
  }
  function* select(selector: any): Generator<any, any, any> {
    return yield sagaEffects.select(selector);
  }
  function* take(patternOrChannel: any): Generator<any, any, any> {
    return yield sagaEffects.take(patternOrChannel);
  }
  function* takeEvery(pattern: any, worker: any): Generator<any, any, any> {
    return yield sagaEffects.takeEvery(pattern, worker);
  }
  return { call, put, select, take, takeEvery };
});

const { createListenSyncChannelMock } = vi.hoisted(() => ({
  createListenSyncChannelMock: vi.fn(),
}));

vi.mock("$lib/store/utils/ipc-channel", () => ({
  createListenSyncChannel: createListenSyncChannelMock,
}));

import {
  CUSTOM_NAMES_STORAGE_KEY,
  WORKSPACE_STATE_STORAGE_KEY,
  removeTerminal,
  renameTerminal,
  type TerminalOverlayState,
} from "../terminal-overlay-slice";
import {
  getStoredCustomName,
  watchRenameTerminal,
  watchWorkspaceState,
} from "./persistence-saga";
import { watchTerminalDisposed } from "./ipc-saga";

describe("terminal overlay sagas", () => {
  const storage = new Map<string, string>();
  let originalElectronApi: unknown;

  const readStorage = (key: string) => {
    const value = storage.get(key);
    return value ? JSON.parse(value) : null;
  };

  beforeEach(() => {
    storage.clear();
    vi.clearAllMocks();

    vi.mocked(window.localStorage.getItem).mockImplementation((key: string) => {
      return storage.get(key) ?? null;
    });
    vi.mocked(window.localStorage.setItem).mockImplementation((key: string, value: string) => {
      storage.set(key, value);
    });
    vi.mocked(window.localStorage.removeItem).mockImplementation((key: string) => {
      storage.delete(key);
    });
    vi.mocked(window.localStorage.clear).mockImplementation(() => {
      storage.clear();
    });

    originalElectronApi = (window as any).electronAPI;
    (window as any).electronAPI = originalElectronApi ?? { on: vi.fn(), off: vi.fn() };
  });

  describe("watchTerminalDisposed", () => {
    it("skips channel setup outside Electron", async () => {
      (window as any).electronAPI = undefined;

      await runSaga({ dispatch: vi.fn(), getState: () => ({}) }, watchTerminalDisposed).toPromise();

      expect(createListenSyncChannelMock).not.toHaveBeenCalled();
    });

    it("closes the IPC channel when the saga is cancelled", async () => {
      const channel = eventChannel<never>(() => () => {});
      const originalClose = channel.close.bind(channel);
      const closeSpy = vi.fn(() => originalClose());
      (channel as any).close = closeSpy;
      createListenSyncChannelMock.mockReturnValue(channel);

      const task = runSaga({ dispatch: vi.fn(), getState: () => ({}) }, watchTerminalDisposed);
      task.cancel();
      await task.toPromise();

      expect(closeSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("persistence helpers", () => {
    it("migrates legacy custom-name storage and preserves lookups", () => {
      storage.set(CUSTOM_NAMES_STORAGE_KEY, JSON.stringify({ "term-1": "Legacy Name" }));

      expect(getStoredCustomName("ws-1", "term-1")).toBe("Legacy Name");
      expect(readStorage(CUSTOM_NAMES_STORAGE_KEY)).toEqual({
        __legacy__: { "term-1": "Legacy Name" },
      });
    });
  });

  describe("watchRenameTerminal", () => {
    it("stores custom names per workspace so same terminal ids do not collide", async () => {
      await expectSaga(watchRenameTerminal)
        .dispatch(renameTerminal("ws-1", "term-1", "First Name"))
        .dispatch(renameTerminal("ws-2", "term-1", "Second Name"))
        .silentRun(0);

      expect(readStorage(CUSTOM_NAMES_STORAGE_KEY)).toEqual({
        "ws-1": { "term-1": "First Name" },
        "ws-2": { "term-1": "Second Name" },
      });
    });
  });

  describe("watchWorkspaceState", () => {
    it("persists the workspace referenced by the action payload, without terminals", async () => {
      const state: { terminalOverlay: TerminalOverlayState } = {
        terminalOverlay: {
          height: 50,
          activeWorkspaceId: "ws-active",
          workspaces: {
            "ws-active": { isOpen: false, activeTerminalId: "active-term", terminals: [] },
            "ws-target": { isOpen: true, activeTerminalId: "target-term", terminals: [] },
          },
        },
      };

      await expectSaga(watchWorkspaceState)
        .withState(state)
        .dispatch(removeTerminal("ws-target", "term-1"))
        .silentRun(0);

      expect(readStorage(WORKSPACE_STATE_STORAGE_KEY)).toEqual({
        "ws-target": { isOpen: true, activeTerminalId: "target-term" },
      });
    });
  });
});