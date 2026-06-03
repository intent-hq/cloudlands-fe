import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { testSaga } from "redux-saga-test-plan";
import * as sagaEffects from "redux-saga/effects";
import {
  selectNotificationVolume,
  selectSoundEnabled,
  selectSoundOnlyWhenUnfocused,
} from "$store/renderer/slices/user-preferences/user-preferences-selectors";
import {
  selectActiveWorkspace,
  selectWorkspaceById,
} from "$store/renderer/slices/workspace/workspace-selectors";

vi.mock("typed-redux-saga", () => ({
  call: function* (fn: any, ...args: any[]) {
    return yield sagaEffects.call(fn, ...args);
  },
  fork: function* (fn: any, ...args: any[]) {
    return yield sagaEffects.fork(fn, ...args);
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

vi.mock("$store/renderer/utils/ipc-channel", () => ({
  takeEveryFromElectronChannel: takeEveryFromElectronChannelMock,
}));

import {
  uiSaga,
  watchBackgroundAgentSpawnedSaga,
  watchNotificationNavigateSaga,
  watchNotificationShowSaga,
} from "./ui-notifications-saga";

function getElectronHandler(eventName: string) {
  const call = takeEveryFromElectronChannelMock.mock.calls.find(([name]) => name === eventName);
  expect(call).toBeDefined();
  return call![1] as (data: any) => Generator;
}

describe("uiSaga", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (window as any).electronAPI = { on: vi.fn(), offById: vi.fn() };
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("forks all UI notification watchers", () => {
    testSaga(uiSaga)
      .next()
      .fork(watchBackgroundAgentSpawnedSaga)
      .next()
      .fork(watchNotificationShowSaga)
      .next()
      .fork(watchNotificationNavigateSaga)
      .next()
      .isDone();
  });

  it("shows a background agent toast through a call effect", () => {
    const data = {
      workspaceId: "ws-1",
      agentId: "agent-1",
      taskTitle: "Review layout",
      agentType: "background",
    };
    const iterator = watchBackgroundAgentSpawnedSaga();

    expect(iterator.next()).toEqual({ value: undefined, done: true });

    const handlerIterator = getElectronHandler("background-agent:spawned")(data);
    expect(handlerIterator.next()).toEqual({
      value: sagaEffects.select(selectWorkspaceById.select, "ws-1"),
      done: false,
    });
    expect(handlerIterator.next({ id: "ws-1", title: "Current Space" })).toEqual({
      value: sagaEffects.select(selectActiveWorkspace.select),
      done: false,
    });
    const effect = handlerIterator.next({ id: "ws-2" }).value as any;
    expect(effect.type).toBe("CALL");
    expect(effect.payload.args).toEqual([data, "Current Space", true]);
  });

  it("skips playing a sound when notification sound is disabled", () => {
    const iterator = watchNotificationShowSaga();

    expect(iterator.next()).toEqual({ value: undefined, done: true });

    const handlerIterator = getElectronHandler("notification:show")({ agentName: "Auggie", timestamp: "now" });
    expect(handlerIterator.next()).toEqual({
      value: sagaEffects.select(selectSoundEnabled.select),
      done: false,
    });
    expect(handlerIterator.next(false)).toEqual({ value: undefined, done: true });
  });

  it("skips playing a sound when the window is focused and the setting requires unfocused", () => {
    vi.mocked(document.hasFocus).mockReturnValue(true);
    const iterator = watchNotificationShowSaga();

    expect(iterator.next()).toEqual({ value: undefined, done: true });

    const handlerIterator = getElectronHandler("notification:show")({ agentName: "Auggie", timestamp: "now" });
    expect(handlerIterator.next()).toEqual({
      value: sagaEffects.select(selectSoundEnabled.select),
      done: false,
    });
    expect(handlerIterator.next(true)).toEqual({
      value: sagaEffects.select(selectSoundOnlyWhenUnfocused.select),
      done: false,
    });
    expect(handlerIterator.next(true)).toEqual({ value: undefined, done: true });
  });

  it("plays notification sounds through a call effect", () => {
    const iterator = watchNotificationShowSaga();

    expect(iterator.next()).toEqual({ value: undefined, done: true });

    const handlerIterator = getElectronHandler("notification:show")({ agentName: "Auggie", timestamp: "now" });
    expect(handlerIterator.next()).toEqual({
      value: sagaEffects.select(selectSoundEnabled.select),
      done: false,
    });
    expect(handlerIterator.next(true)).toEqual({
      value: sagaEffects.select(selectSoundOnlyWhenUnfocused.select),
      done: false,
    });
    expect(handlerIterator.next(false)).toEqual({
      value: sagaEffects.select(selectNotificationVolume.select),
      done: false,
    });

    const effect = handlerIterator.next(0.7).value as any;
    expect(effect.type).toBe("CALL");
    expect(effect.payload.args).toEqual(["Auggie", 0.7]);
  });

  it("navigates to the workspace through a call effect", () => {
    const iterator = watchNotificationNavigateSaga();

    expect(iterator.next()).toEqual({ value: undefined, done: true });

    const effect = getElectronHandler("notification:navigate")({ workspaceId: "ws-1" }).next().value as any;
    expect(effect.type).toBe("CALL");
    expect(effect.payload.args).toEqual(["/workspace/ws-1"]);
  });
});