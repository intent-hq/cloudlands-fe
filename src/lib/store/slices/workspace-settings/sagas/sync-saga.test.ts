import { describe, expect, it, vi } from "vitest";
import * as sagaEffects from "redux-saga/effects";

vi.mock("typed-redux-saga", () => ({
  call: function* (fn: any, ...args: any[]) {
    return yield sagaEffects.call(fn, ...args);
  },
  join: function* (task: any) {
    return yield { type: "JOIN", payload: task };
  },
  put: function* (action: any) {
    return yield sagaEffects.put(action);
  },
  select: function* (selector: any, ...args: any[]) {
    return yield sagaEffects.select(selector, ...args);
  },
  takeEvery: function* (pattern: any, worker: any) {
    return yield sagaEffects.takeEvery(pattern, worker);
  },
}));

vi.mock("$lib/electron-bridge", () => ({
  invoke: vi.fn(),
}));

import {
  refreshAutoCommitSettings,
  syncWorkspaceSettings,
  loadAutoCommitSettings,
} from "../workspace-settings-slice";
import { selectAutoCommitEnabled } from "../workspace-settings-selectors";
import { initSaga, getGlobalAutoCommitDefault } from "./init-saga";
import { syncSaga } from "./sync-saga";

describe("syncSaga", () => {
  it("re-syncs previously synced workspaces after a refresh", () => {
    const initTask = { id: "startup-init" };
    const iterator = syncSaga(initTask);

    const syncRegistration = iterator.next().value as any;
    const refreshRegistration = iterator.next().value as any;

    const syncWorker = syncRegistration.payload.args[1] as (
      action: ReturnType<typeof syncWorkspaceSettings>
    ) => Generator;
    const refreshWorker = refreshRegistration.payload.args[1] as () => Generator;

    const syncIterator = syncWorker(syncWorkspaceSettings("ws-1"));
    expect(syncIterator.next()).toEqual({ value: { type: "JOIN", payload: initTask }, done: false });
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