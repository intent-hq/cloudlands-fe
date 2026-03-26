import { beforeEach, describe, expect, it, vi } from "vitest";
import { runSaga } from "redux-saga";
import { expectSaga } from "redux-saga-test-plan";
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
  function* take(patternOrChannel: any): Generator<any, any, any> {
    return yield sagaEffects.take(patternOrChannel);
  }
  function* takeEvery(pattern: any, worker: any): Generator<any, any, any> {
    return yield sagaEffects.takeEvery(pattern, worker);
  }
  return { call, put, select, take, takeEvery };
});

const { takeEveryFromListenSyncMock } = vi.hoisted(() => ({
  takeEveryFromListenSyncMock: vi.fn(function* () {}),
}));

vi.mock("$lib/store/utils/ipc-channel", () => ({
  takeEveryFromListenSync: takeEveryFromListenSyncMock,
}));

import {
  CUSTOM_NAMES_STORAGE_KEY,
  WORKSPACE_STATE_STORAGE_KEY,
  removeTerminal,
  renameTerminal,
  type TerminalOverlayState,
} from "../terminals-slice";
import { createCollection } from "../../../utils/collection-utils";
import {
  getStoredCustomName,
  watchRenameTerminal,
  watchWorkspaceState,
} from "./persistence-saga";
import { watchTerminalDisposed } from "./ipc-saga";

function getListenSyncHandler(eventName: string) {
  const call = takeEveryFromListenSyncMock.mock.calls.find(([name]) => name === eventName);
  expect(call).toBeDefined();
  return call![1] as (data: any) => Generator;
}

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
    it("registers a terminal disposed handler that removes the terminal", () => {
      const iterator = watchTerminalDisposed();

      expect(iterator.next()).toEqual({ value: undefined, done: true });
      expect(takeEveryFromListenSyncMock).toHaveBeenCalledWith(
        "terminal:disposed",
        expect.any(Function),
      );

      expect(getListenSyncHandler("terminal:disposed")({ terminalId: "term-1", workspaceId: "ws-1" }).next()).toEqual({
        value: sagaEffects.put(removeTerminal("ws-1", "term-1")),
        done: false,
      });
    });

    it("ignores invalid terminal disposed payloads", () => {
      const iterator = watchTerminalDisposed();

      expect(iterator.next()).toEqual({ value: undefined, done: true });
      expect(getListenSyncHandler("terminal:disposed")({ terminalId: "term-1" }).next()).toEqual({
        value: undefined,
        done: true,
      });
    });
  });

  describe("persistence helpers", () => {
    it("migrates legacy custom-name storage and preserves lookups", async () => {
      storage.set(CUSTOM_NAMES_STORAGE_KEY, JSON.stringify({ "term-1": "Legacy Name" }));

      const storedCustomName = await runSaga(
        { dispatch: vi.fn(), getState: () => ({}) },
        getStoredCustomName,
        "ws-1",
        "term-1"
      ).toPromise();

      expect(storedCustomName).toBe("Legacy Name");
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
      const state: { terminals: TerminalOverlayState } = {
        terminals: {
          height: 50,
          workspaces: {
            "ws-active": {
              isOpen: false,
              activeTerminalId: "active-term",
              terminals: createCollection("id"),
              terminalsLoaded: false,
              isLoadingTerminals: false,
              recentlyCreatedTerminals: [],
            },
            "ws-target": {
              isOpen: true,
              activeTerminalId: "target-term",
              terminals: createCollection("id"),
              terminalsLoaded: false,
              isLoadingTerminals: false,
              recentlyCreatedTerminals: [],
            },
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