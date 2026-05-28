import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { runSaga } from "redux-saga";
import { expectSaga } from "redux-saga-test-plan";
import * as sagaEffects from "redux-saga/effects";
import { installLocalStorageMock } from "$lib/store/utils/test-helpers/local-storage-mock";

vi.mock("typed-redux-saga", async () => await import("$lib/store/utils/test-helpers/typed-redux-saga-mock"));

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
  saveTerminalMetadata,
  type TerminalOverlayState,
} from "../terminals-slice";
import { createCollection } from "../../../utils/collection-utils";
import {
  getStoredCustomName,
  TERMINAL_METADATA_STORAGE_PREFIX,
  loadTerminalMetadataFromStorage,
  watchTerminalMetadataPersistence,
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
  const mockStorage = installLocalStorageMock();
  let originalElectronApi: unknown;

  const readStorage = (key: string) => {
    const value = window.localStorage.getItem(key);
    return value ? JSON.parse(value) : null;
  };

  beforeEach(() => {
    mockStorage.reset();
    vi.clearAllMocks();

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
      window.localStorage.setItem(CUSTOM_NAMES_STORAGE_KEY, JSON.stringify({ "term-1": "Legacy Name" }));

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

    it("filters invalid terminal metadata and cleans storage", async () => {
      window.localStorage.setItem(`${TERMINAL_METADATA_STORAGE_PREFIX}ws-1`, JSON.stringify([
        { terminalId: "term-1", workspaceId: "ws-1", createdAt: "2026-04-29T00:00:00.000Z" },
        { terminalId: "term-2", workspaceId: "other", createdAt: "2026-04-29T00:00:00.000Z" },
        { terminalId: 42, workspaceId: "ws-1", createdAt: "2026-04-29T00:00:00.000Z" },
      ]));

      const metadata = await runSaga(
        { dispatch: vi.fn(), getState: () => ({}) },
        loadTerminalMetadataFromStorage,
        "ws-1"
      ).toPromise();

      expect(metadata).toEqual([
        { terminalId: "term-1", workspaceId: "ws-1", createdAt: "2026-04-29T00:00:00.000Z" },
      ]);
      expect(readStorage(`${TERMINAL_METADATA_STORAGE_PREFIX}ws-1`)).toEqual(metadata);
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

  describe("watchTerminalMetadataPersistence", () => {
    it("persists terminal metadata by workspace and prunes removed terminals", async () => {
      await expectSaga(watchTerminalMetadataPersistence)
        .dispatch(saveTerminalMetadata("ws-1", "term-1", "Setup", "2026-04-29T00:00:00.000Z"))
        .dispatch(saveTerminalMetadata("ws-1", "term-2", "Terminal", "2026-04-29T00:01:00.000Z"))
        .dispatch(removeTerminal("ws-1", "term-1"))
        .silentRun(0);

      expect(readStorage(`${TERMINAL_METADATA_STORAGE_PREFIX}ws-1`)).toEqual([
        {
          terminalId: "term-2",
          workspaceId: "ws-1",
          createdAt: "2026-04-29T00:01:00.000Z",
          title: "Terminal",
        },
      ]);
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