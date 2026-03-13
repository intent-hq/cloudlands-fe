import { describe, expect, it, vi } from "vitest";
import * as sagaEffects from "redux-saga/effects";

vi.mock("typed-redux-saga", () => ({
  call: function* (fn: any, ...args: any[]) {
    return yield sagaEffects.call(fn, ...args);
  },
  delay: function* (ms: number) {
    return yield sagaEffects.delay(ms);
  },
  fork: function* (fn: any, ...args: any[]) {
    return yield sagaEffects.fork(fn, ...args);
  },
  join: function* (task: any) {
    return yield { type: "JOIN", payload: task };
  },
  put: function* (action: any) {
    return yield sagaEffects.put(action);
  },
  takeLatest: function* (pattern: any, worker: any) {
    return yield sagaEffects.takeLatest(pattern, worker);
  },
}));

import { initSaga } from "./init-saga";
import { notificationSettingsSaga } from "./notification-settings-saga";
import { persistenceSaga } from "./persistence-saga";

describe("notificationSettingsSaga", () => {
  it("starts persistence before waiting for init hydration", () => {
    const iterator = notificationSettingsSaga();
    const initTask = { id: "init-task" } as any;

    expect(iterator.next()).toEqual({ value: sagaEffects.fork(initSaga), done: false });
    expect(iterator.next(initTask)).toEqual({ value: sagaEffects.fork(persistenceSaga), done: false });
    expect(iterator.next()).toEqual({ value: { type: "JOIN", payload: initTask }, done: false });
    expect(iterator.next()).toEqual({ value: undefined, done: true });
  });
});