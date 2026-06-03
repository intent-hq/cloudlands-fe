import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  runSaga,
  stdChannel,
} from "redux-saga";

vi.mock(
  "typed-redux-saga",
  async () => await import("$store/renderer/utils/test-helpers/typed-redux-saga-mock"),
);

import {
  SAGA_MANAGER_ADD_CRASH_TYPE,
  type SagaCrashAction,
} from "../saga-crash-sentry-types";
import {
  __setSagaCrashSentryLoaderForTests,
  forwardSagaCrashToSentry,
  sagaCrashSentrySaga,
} from "./saga-crash-sentry-saga";

const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 0));

const crashAction: SagaCrashAction = {
  type: SAGA_MANAGER_ADD_CRASH_TYPE,
  payload: [
    "chatStateSaga",
    {
      crashedAtTs: 123,
      error: { name: "TypeError", message: "boom", stack: "stacktrace" },
    },
  ],
};

describe("sagaCrashSentrySaga", () => {
  afterEach(() => {
    __setSagaCrashSentryLoaderForTests(null);
    vi.clearAllMocks();
  });

  it("forwards package saga crash reports to Sentry from saga execution", async () => {
    const captureException = vi.fn();
    __setSagaCrashSentryLoaderForTests(async () => ({ captureException }));

    await runSaga({}, forwardSagaCrashToSentry, crashAction).toPromise();

    expect(captureException).toHaveBeenCalledOnce();
    const [error, context] = captureException.mock.calls[0];
    expect(error).toMatchObject({ name: "TypeError", message: "boom", stack: "stacktrace" });
    expect(context).toMatchObject({
      tags: { type: "sagaCrash", sagaName: "chatStateSaga" },
      extra: { source: "ag-redux-toolkit", actionType: SAGA_MANAGER_ADD_CRASH_TYPE },
    });
  });

  it("observes package saga crash actions from the registered watcher", async () => {
    const captureException = vi.fn();
    __setSagaCrashSentryLoaderForTests(async () => ({ captureException }));
    const channel = stdChannel();
    const task = runSaga({ channel, dispatch: vi.fn(), getState: () => ({}) }, sagaCrashSentrySaga);

    channel.put({ type: "other/action", payload: [] });
    channel.put(crashAction);
    await flushPromises();
    await flushPromises();
    task.cancel();
    await task.toPromise();

    expect(captureException).toHaveBeenCalledOnce();
  });

  it("does not crash if Sentry is unavailable", async () => {
    __setSagaCrashSentryLoaderForTests(async () => {
      throw new Error("Sentry unavailable");
    });

    await expect(runSaga({}, forwardSagaCrashToSentry, crashAction).toPromise()).resolves.toBeUndefined();
  });
});