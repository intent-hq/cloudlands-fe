import { beforeEach, describe, it, vi } from "vitest";
import { expectSaga } from "redux-saga-test-plan";
import * as matchers from "redux-saga-test-plan/matchers";
import * as sagaEffects from "redux-saga/effects";

vi.mock("typed-redux-saga", () => ({
  call: function* (fnOrDescriptor: any, ...args: any[]) {
    return yield Array.isArray(fnOrDescriptor)
      ? sagaEffects.call(fnOrDescriptor as [any, any], ...args)
      : sagaEffects.call(fnOrDescriptor, ...args);
  },
  put: function* (action: any) {
    return yield sagaEffects.put(action);
  },
  takeLatest: function* (pattern: any, worker: any) {
    return yield sagaEffects.takeLatest(pattern, worker);
  },
}));

vi.mock("$lib/electron-bridge", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "$lib/electron-bridge";
import { clearError, fetchEditors, setLoading } from "../installed-editors-slice";
import { fetchEditorsSaga } from "./fetch-editors-saga";

describe("fetchEditorsSaga", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("clears loading when detection returns neither data nor an error", async () => {
    await expectSaga(fetchEditorsSaga)
      .provide([[matchers.call.fn(invoke), { success: false }]])
      .dispatch(fetchEditors(true))
      .put(clearError())
      .put(setLoading(true))
      .put(setLoading(false))
      .silentRun(0);
  });
});