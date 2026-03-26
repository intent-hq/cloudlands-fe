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
  select: function* (selector: any, ...args: any[]) {
    return yield sagaEffects.select(selector, ...args);
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
  openGitCredentialsModal,
  openGitHubAuthModal,
} from "$lib/store/slices/global-modals/global-modals-slice";
import { selectHasShownGitCredentialsModalForWorkspace } from "$lib/store/slices/global-modals/global-modals-selectors";
import {
  authSaga,
  watchAgentAuthRequiredSaga,
  watchAgentPlanRequiredSaga,
  watchGitAuthRequiredSaga,
  watchGitHubAuthRequiredSaga,
} from "./auth-saga";

function getElectronHandler(eventName: string) {
  const call = takeEveryFromElectronChannelMock.mock.calls.find(([name]) => name === eventName);
  expect(call).toBeDefined();
  return call![1] as (data: any) => Generator;
}

describe("authSaga", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (window as any).electronAPI = { on: vi.fn(), offById: vi.fn() };
  });

  it("forks all auth watchers", () => {
    testSaga(authSaga)
      .next()
      .fork(watchGitHubAuthRequiredSaga)
      .next()
      .fork(watchGitAuthRequiredSaga)
      .next()
      .fork(watchAgentAuthRequiredSaga)
      .next()
      .fork(watchAgentPlanRequiredSaga)
      .next()
      .isDone();
  });

  it("dispatches the GitHub auth modal action for github auth events", () => {
    const data = { workspaceId: "ws-1", message: "Sign in required" };
    const iterator = watchGitHubAuthRequiredSaga();

    expect(iterator.next()).toEqual({ value: undefined, done: true });
    expect(getElectronHandler("github:auth-required")(data).next()).toEqual({
      value: sagaEffects.put(openGitHubAuthModal(data)),
      done: false,
    });
  });

  it("checks workspace dedupe before opening the git credentials modal", () => {
    const data = {
      workspaceId: "ws-1",
      operation: "push",
      message: "Credentials needed",
      command: "git push",
      cwd: "/repo",
      rawError: "fatal",
    };
    const iterator = watchGitAuthRequiredSaga();

    expect(iterator.next()).toEqual({ value: undefined, done: true });

    const handlerIterator = getElectronHandler("git:auth-required")(data);
    expect(handlerIterator.next()).toEqual({
      value: sagaEffects.select(
        selectHasShownGitCredentialsModalForWorkspace.select,
        "ws-1",
      ),
      done: false,
    });
    expect(handlerIterator.next(false)).toEqual({
      value: sagaEffects.put(
        openGitCredentialsModal({
          workspaceId: "ws-1",
          message: "Credentials needed",
          operation: "push",
          command: "git push",
          cwd: "/repo",
          rawError: "fatal",
        })
      ),
      done: false,
    });
  });

  it("skips opening the git credentials modal when it was already shown", () => {
    const data = {
      workspaceId: "ws-1",
      operation: "push",
      message: "Credentials needed",
    };
    const iterator = watchGitAuthRequiredSaga();

    expect(iterator.next()).toEqual({ value: undefined, done: true });

    const handlerIterator = getElectronHandler("git:auth-required")(data);
    expect(handlerIterator.next()).toEqual({
      value: sagaEffects.select(
        selectHasShownGitCredentialsModalForWorkspace.select,
        "ws-1",
      ),
      done: false,
    });
    expect(handlerIterator.next(true)).toEqual({ value: undefined, done: true });
  });

  it("shows the agent auth toast through a call effect", () => {
    const data = { workspaceId: "ws-1", isRemote: true, message: "Log in to continue" };
    const iterator = watchAgentAuthRequiredSaga();

    expect(iterator.next()).toEqual({ value: undefined, done: true });
    const effect = getElectronHandler("agent:auth-required")(data).next().value as any;

    expect(effect.type).toBe("CALL");
    expect(effect.payload.args).toEqual([data]);
  });

  it("shows the plan required toast through a call effect", () => {
    const data = { workspaceId: "ws-1", message: "Upgrade required" };
    const iterator = watchAgentPlanRequiredSaga();

    expect(iterator.next()).toEqual({ value: undefined, done: true });
    const effect = getElectronHandler("agent:plan-required")(data).next().value as any;

    expect(effect.type).toBe("CALL");
    expect(effect.payload.args).toEqual([data]);
  });
});