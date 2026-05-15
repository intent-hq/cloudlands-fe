import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import * as sagaEffects from "redux-saga/effects";
import {
  runSaga,
  type Task,
} from "redux-saga";

const loggerMock = vi.hoisted(() => ({
  debug: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}));

vi.mock("typed-redux-saga", () => ({
  fork: function* (fn: any, ...args: any[]) {
    return yield sagaEffects.fork(fn, ...args);
  },
  take: function* (pattern: any) {
    return yield sagaEffects.take(pattern);
  },
}));

vi.mock("$lib/utils/client-logger", () => ({
  createLogger: () => loggerMock,
}));

import { chatLifecycleSaga } from "./chat-lifecycle-saga";

describe("chatLifecycleSaga", () => {
  const windowListeners = new Map<string, EventListener>();
  let fakeWindow: Pick<Window, "addEventListener" | "removeEventListener">;

  beforeEach(() => {
    windowListeners.clear();
    vi.clearAllMocks();

    fakeWindow = {
      addEventListener: vi.fn((type: string, handler: EventListener) => {
        windowListeners.set(type, handler);
      }),
      removeEventListener: vi.fn((type: string, handler: EventListener) => {
        if (windowListeners.get(type) === handler) windowListeners.delete(type);
      }),
    };

    vi.stubGlobal("window", fakeWindow);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function startLifecycleSaga(): Promise<Task> {
    const task = runSaga({}, chatLifecycleSaga);
    await Promise.resolve();
    await Promise.resolve();
    return task;
  }

  async function stopLifecycleSaga(task: Task): Promise<void> {
    task.cancel();
    await task.toPromise().catch(() => undefined);
  }

  it("owns online/offline listener registration and cleanup", async () => {
    const task = await startLifecycleSaga();

    expect(fakeWindow.addEventListener).toHaveBeenCalledWith("online", expect.any(Function));
    expect(fakeWindow.addEventListener).toHaveBeenCalledWith("offline", expect.any(Function));

    const onlineHandler = windowListeners.get("online");
    const offlineHandler = windowListeners.get("offline");
    expect(onlineHandler).toBeDefined();
    expect(offlineHandler).toBeDefined();

    await stopLifecycleSaga(task);

    expect(fakeWindow.removeEventListener).toHaveBeenCalledWith("online", onlineHandler);
    expect(fakeWindow.removeEventListener).toHaveBeenCalledWith("offline", offlineHandler);
  });

  it("logs connection status changes from the saga", async () => {
    const task = await startLifecycleSaga();

    windowListeners.get("offline")?.(new Event("offline"));
    windowListeners.get("online")?.(new Event("online"));
    await Promise.resolve();

    expect(loggerMock.warn).toHaveBeenCalledWith("Connection lost - streaming may be interrupted");
    expect(loggerMock.info).toHaveBeenCalledWith("Connection restored");

    await stopLifecycleSaga(task);
  });
});