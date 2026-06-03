import {
  describe,
  expect,
  it,
  vi,
} from "vitest";
import * as sagaEffects from "redux-saga/effects";

vi.mock("typed-redux-saga", async () => await import("$store/renderer/utils/test-helpers/typed-redux-saga-mock"));

vi.mock("$lib/electron-bridge", async () => await import("$store/renderer/utils/test-helpers/electron-bridge-mock"));

import {
  syncWorkspaceSettings,
  loadAutoCommitSettings,
} from "../workspace-settings-slice";
import { selectAutoCommitEnabled } from "../workspace-settings-selectors";
import {
  initSaga,
  getGlobalAutoCommitDefault,
} from "./init-saga";
import { syncSaga } from "./sync-saga";
import { workspaceMounted } from "../../workspace-lifecycle/workspace-lifecycle-slice";

describe("syncSaga", () => {
  it("re-syncs previously synced workspaces after a refresh", () => {
    // Create a mock Task object matching redux-saga's Task shape
    const initTask = {
      ["@@redux-saga/TASK"]: true,
      isRunning: () => true,
      isCancelled: () => false,
      isAborted: () => false,
      result: () => undefined,
      error: () => undefined,
      cancel: () => {},
      setContext: () => {},
      toPromise: () => Promise.resolve(),
    };
    const iterator = syncSaga(initTask);

    // First registration: workspaceMounted → dispatches syncWorkspaceSettings
    const mountRegistration = iterator.next().value as any;
    expect(mountRegistration.payload.args[0]).toBe(workspaceMounted);

    const syncRegistration = iterator.next().value as any;
    const refreshRegistration = iterator.next().value as any;

    const syncWorker = syncRegistration.payload.args[1] as (
      action: ReturnType<typeof syncWorkspaceSettings>
    ) => Generator;
    const refreshWorker = refreshRegistration.payload.args[1] as () => Generator;

    const syncIterator = syncWorker(syncWorkspaceSettings("ws-1"));
    expect(syncIterator.next()).toEqual({ value: sagaEffects.join(initTask), done: false });
    // loadAutoCommitSettings is dispatched with workspaceId and the global default
    expect(syncIterator.next()).toEqual({
      value: sagaEffects.put(loadAutoCommitSettings("ws-1", getGlobalAutoCommitDefault())),
      done: false,
    });
    expect(syncIterator.next()).toEqual({
      value: sagaEffects.select(selectAutoCommitEnabled.select, "ws-1"),
      done: false,
    });

    const initialSync = syncIterator.next(true).value as any;
    expect(initialSync.payload.fn.name).toBe("syncToWorkspace");
    expect(initialSync.payload.args).toEqual(["ws-1", true]);
    expect(syncIterator.next()).toEqual({ value: undefined, done: true });

    const refreshIterator = refreshWorker();
    expect(refreshIterator.next()).toEqual({ value: sagaEffects.call(initSaga), done: false });
    // First workspace: put loadAutoCommitSettings
    expect(refreshIterator.next()).toEqual({
      value: sagaEffects.put(loadAutoCommitSettings("ws-1", getGlobalAutoCommitDefault())),
      done: false,
    });
    expect(refreshIterator.next()).toEqual({
      value: sagaEffects.select(selectAutoCommitEnabled.select, "ws-1"),
      done: false,
    });

    const refreshSync = refreshIterator.next(false).value as any;
    expect(refreshSync.payload.fn.name).toBe("syncToWorkspace");
    expect(refreshSync.payload.args).toEqual(["ws-1", false]);
    expect(refreshIterator.next()).toEqual({ value: undefined, done: true });

    expect(syncWorker(syncWorkspaceSettings("ws-1")).next()).toEqual({
      value: undefined,
      done: true,
    });
    expect(iterator.next()).toEqual({ value: undefined, done: true });
  });
});