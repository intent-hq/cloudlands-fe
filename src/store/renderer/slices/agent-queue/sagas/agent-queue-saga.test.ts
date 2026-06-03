import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  runSaga,
  stdChannel,
} from "redux-saga";
import * as sagaEffects from "redux-saga/effects";
import type { QueuedMessage } from "$shared/types";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
}));

vi.mock("typed-redux-saga", () => ({
  call: function* (fnOrDescriptor: any, ...args: any[]) {
    return yield Array.isArray(fnOrDescriptor)
      ? sagaEffects.call(fnOrDescriptor as [any, any], ...args)
      : sagaEffects.call(fnOrDescriptor, ...args);
  },
  put: function* (action: any) {
    return yield sagaEffects.put(action);
  },
  fork: function* (fn: any, ...args: any[]) {
    return yield sagaEffects.fork(fn, ...args);
  },
  cancelled: function* () {
    return yield sagaEffects.cancelled();
  },
  takeEvery: function* (pattern: any, worker: any) {
    return yield sagaEffects.takeEvery(pattern, worker);
  },
}));

vi.mock("$lib/electron-bridge", () => ({
  invoke: invokeMock,
}));

vi.mock("$store/renderer/utils/ipc-channel", () => ({
  takeEveryFromElectronChannel: vi.fn(function* () {}),
}));

vi.mock("$lib/utils/client-logger", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import {
  hydrateAgentQueueRequested,
  replaceAgentQueue,
  setAgentQueueError,
  setAgentQueueHydrating,
} from "../agent-queue-slice";
import {
  handleQueueUpdated,
  hydrateAgentQueue,
  watchQueueHydrationSaga,
} from "./agent-queue-saga";

const queuedMessage: QueuedMessage = {
  id: "queue-1",
  content: "Queued hello",
  queuedAt: "2024-01-01T00:00:00.000Z",
  position: 0,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function flushTasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("agent queue IPC saga", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("replaces agentQueue state for agent:queue:updated payloads", async () => {
    const dispatched: any[] = [];

    await runSaga(
      { dispatch: (action: any) => dispatched.push(action), getState: () => ({}) },
      handleQueueUpdated,
      { agentId: "agent-1", queue: [queuedMessage] },
    ).toPromise();

    expect(dispatched).toEqual([replaceAgentQueue("agent-1", [queuedMessage])]);
    expect(dispatched[0].payload[1][0]).not.toBe(queuedMessage);
  });

  it("ignores queue updates without an agent id", async () => {
    const dispatched: any[] = [];

    await runSaga(
      { dispatch: (action: any) => dispatched.push(action), getState: () => ({}) },
      handleQueueUpdated,
      { queue: [queuedMessage] },
    ).toPromise();

    expect(dispatched).toEqual([]);
  });

  it("hydrates initial queue from wrapped get-queue IPC response", async () => {
    invokeMock.mockResolvedValue({
      success: true,
      data: { success: true, queue: [queuedMessage] },
    });
    const dispatched: any[] = [];

    await runSaga(
      { dispatch: (action: any) => dispatched.push(action), getState: () => ({}) },
      hydrateAgentQueue,
      hydrateAgentQueueRequested("agent-1"),
    ).toPromise();

    expect(invokeMock).toHaveBeenCalledWith("agent:backend:get-queue", { agentId: "agent-1" });
    expect(dispatched).toEqual([replaceAgentQueue("agent-1", [queuedMessage])]);
  });

  it("stores hydration errors in agentQueue state", async () => {
    invokeMock.mockResolvedValue({ success: false, error: { message: "boom" } });
    const dispatched: any[] = [];

    await runSaga(
      { dispatch: (action: any) => dispatched.push(action), getState: () => ({}) },
      hydrateAgentQueue,
      hydrateAgentQueueRequested("agent-1"),
    ).toPromise();

    expect(dispatched).toEqual([setAgentQueueError("agent-1", "boom")]);
  });

  it("hydrates multiple agents concurrently without globally cancelling earlier requests", async () => {
    const firstHydration = deferred<any>();
    const secondHydration = deferred<any>();
    invokeMock.mockImplementation((_channel, { agentId }) =>
      agentId === "agent-1" ? firstHydration.promise : secondHydration.promise,
    );
    const dispatched: any[] = [];
    const channel = stdChannel();

    const task = runSaga(
      { channel, dispatch: (action: any) => dispatched.push(action), getState: () => ({}) },
      watchQueueHydrationSaga,
    );

    channel.put(hydrateAgentQueueRequested("agent-1"));
    channel.put(hydrateAgentQueueRequested("agent-2"));
    await flushTasks();

    expect(invokeMock).toHaveBeenCalledTimes(2);

    secondHydration.resolve({ success: true, data: { success: true, queue: [] } });
    firstHydration.resolve({ success: true, data: { success: true, queue: [queuedMessage] } });
    await flushTasks();

    expect(dispatched).toEqual([
      replaceAgentQueue("agent-2", []),
      replaceAgentQueue("agent-1", [queuedMessage]),
    ]);

    task.cancel();
    await task.toPromise();
  });

  it("clears hydration state when an in-flight hydration is cancelled", async () => {
    const hydration = deferred<any>();
    invokeMock.mockReturnValue(hydration.promise);
    const dispatched: any[] = [];

    const task = runSaga(
      { dispatch: (action: any) => dispatched.push(action), getState: () => ({}) },
      hydrateAgentQueue,
      hydrateAgentQueueRequested("agent-1"),
    );
    await flushTasks();

    task.cancel();
    await task.toPromise();

    expect(dispatched).toEqual([setAgentQueueHydrating("agent-1", false)]);
  });
});
