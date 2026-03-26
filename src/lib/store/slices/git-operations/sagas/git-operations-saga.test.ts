import { beforeEach, describe, expect, it, vi } from "vitest";
import { testSaga } from "redux-saga-test-plan";
import * as sagaEffects from "redux-saga/effects";

vi.mock("typed-redux-saga", () => ({
  call: function* (fn: any, ...args: any[]) {
    return yield sagaEffects.call(fn, ...args);
  },
  fork: function* (fn: any, ...args: any[]) {
    return yield sagaEffects.fork(fn, ...args);
  },
  put: function* (action: any) {
    return yield sagaEffects.put(action);
  },
  take: function* (patternOrChannel: any) {
    return yield sagaEffects.take(patternOrChannel);
  },
}));

const { takeEveryFromElectronChannelMock } = vi.hoisted(() => ({
  takeEveryFromElectronChannelMock: vi.fn(function* () {}),
}));

vi.mock("$lib/store/utils/ipc-channel", () => ({
  takeEveryFromElectronChannel: takeEveryFromElectronChannelMock,
}));

import {
  setLastAutoCommitHookFailure,
  setLastGitError,
  setLastGitOperation,
} from "../git-operations-slice";
import {
  gitOperationsSaga,
  watchAutoCommitHookFailureSaga,
  watchGitOperationCompletedSaga,
  watchGitOperationFailedSaga,
} from "./git-operations-saga";

function getElectronHandler(eventName: string) {
  const call = takeEveryFromElectronChannelMock.mock.calls.find(([name]) => name === eventName);
  expect(call).toBeDefined();
  return call![1] as (data: any) => Generator;
}

describe("gitOperationsSaga", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (window as any).electronAPI = { on: vi.fn(), offById: vi.fn() };
  });

  it("forks all git operation watchers", () => {
    testSaga(gitOperationsSaga)
      .next()
      .fork(watchGitOperationCompletedSaga)
      .next()
      .fork(watchGitOperationFailedSaga)
      .next()
      .fork(watchAutoCommitHookFailureSaga)
      .next()
      .isDone();
  });

  it("records completed git operations before handling side effects", () => {
    const data = {
      operationId: "op-1",
      workspaceId: "ws-1",
      operationType: "commit" as const,
      metadata: { agentId: "agent-1" },
    };
    const iterator = watchGitOperationCompletedSaga();

    expect(iterator.next()).toEqual({ value: undefined, done: true });

    const handlerIterator = getElectronHandler("git:op-completed")(data);
    expect(handlerIterator.next()).toEqual({
      value: sagaEffects.put(setLastGitOperation(data)),
      done: false,
    });

    const effect = handlerIterator.next().value as any;
    expect(effect.type).toBe("CALL");
    expect(effect.payload.args).toEqual([data]);
  });

  it("records failed git operations before handling side effects", () => {
    const data = {
      operationId: "op-2",
      workspaceId: "ws-1",
      operationType: "push" as const,
      error: "push failed",
    };
    const iterator = watchGitOperationFailedSaga();

    expect(iterator.next()).toEqual({ value: undefined, done: true });

    const handlerIterator = getElectronHandler("git:op-failed")(data);
    expect(handlerIterator.next()).toEqual({
      value: sagaEffects.put(setLastGitError(data)),
      done: false,
    });

    const effect = handlerIterator.next().value as any;
    expect(effect.type).toBe("CALL");
    expect(effect.payload.args).toEqual([data]);
  });

  it("records auto-commit hook failures before handling side effects", () => {
    const data = {
      workspaceId: "ws-1",
      agentId: "agent-1",
      status: "waking-agent" as const,
      hookOutput: "lint failed",
      retryCount: 1,
    };
    const iterator = watchAutoCommitHookFailureSaga();

    expect(iterator.next()).toEqual({ value: undefined, done: true });

    const handlerIterator = getElectronHandler("git:auto-commit-hook-failure")(data);
    expect(handlerIterator.next()).toEqual({
      value: sagaEffects.put(setLastAutoCommitHookFailure(data)),
      done: false,
    });

    const effect = handlerIterator.next().value as any;
    expect(effect.type).toBe("CALL");
    expect(effect.payload.args).toEqual([data]);
  });
});