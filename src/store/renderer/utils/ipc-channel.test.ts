import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  END,
  runSaga,
} from "redux-saga";
import {
  createElectronChannel,
  createListenSyncChannel,
  createWindowEventChannel,
  takeEveryFromElectronChannel,
  takeEveryFromListenSync,
  takeEveryFromWindowEvent,
} from "./ipc-channel";

// Mock electron-bridge
vi.mock("$lib/electron-bridge", async () => await import("$store/renderer/utils/test-helpers/electron-bridge-mock"));

import { listenSync } from "$lib/electron-bridge";

const mockedListenSync = vi.mocked(listenSync);
const flushSaga = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("createListenSyncChannel", () => {
  let capturedHandler: ((payload: { payload: any }) => void) | null = null;
  let mockCleanup: ReturnType<typeof vi.fn>;
  let originalElectronApi: typeof window.electronAPI | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    capturedHandler = null;
    mockCleanup = vi.fn();
    originalElectronApi = window.electronAPI;
    (window as any).electronAPI = {
      on: vi.fn(),
      offById: vi.fn(),
    };

    mockedListenSync.mockImplementation((_event: string, handler: any) => {
      capturedHandler = handler;
      return mockCleanup;
    });
  });

  afterEach(() => {
    if (originalElectronApi) {
      window.electronAPI = originalElectronApi;
      return;
    }

    delete (window as any).electronAPI;
  });

  it("should call listenSync with the event name", () => {
    createListenSyncChannel("terminal:disposed");
    expect(mockedListenSync).toHaveBeenCalledWith(
      "terminal:disposed",
      expect.any(Function),
    );
  });

  it("should emit unwrapped payload when listenSync handler is called", () => {
    const channel = createListenSyncChannel<{ id: string }>(
      "terminal:disposed",
    );
    const emitted: any[] = [];

    // Take from the channel
    channel.take((value) => {
      emitted.push(value);
    });

    // Simulate IPC event — listenSync wraps data in { payload: T }
    capturedHandler!({ payload: { id: "term-1" } });

    expect(emitted).toEqual([{ id: "term-1" }]);
  });

  it("should emit multiple events correctly", () => {
    const channel = createListenSyncChannel<string>("test:event");
    const emitted: string[] = [];

    // Set up sequential takes
    const takeFn = (value: string) => {
      emitted.push(value);
      channel.take(takeFn);
    };
    channel.take(takeFn);

    capturedHandler!({ payload: "first" });
    capturedHandler!({ payload: "second" });
    capturedHandler!({ payload: "third" });

    expect(emitted).toEqual(["first", "second", "third"]);
  });

  it("should call listenSync cleanup when channel is closed", () => {
    const channel = createListenSyncChannel("test:event");

    expect(mockCleanup).not.toHaveBeenCalled();

    channel.close();

    expect(mockCleanup).toHaveBeenCalledOnce();
  });

  it("should unwrap the { payload: T } wrapper from listenSync", () => {
    const channel = createListenSyncChannel<{ name: string; value: number }>(
      "test:complex",
    );
    const emitted: any[] = [];

    channel.take((value) => {
      emitted.push(value);
    });

    // listenSync wraps in { payload: T }, so we pass the wrapped version
    capturedHandler!({ payload: { name: "test", value: 42 } });

    // Channel should emit the unwrapped T
    expect(emitted).toEqual([{ name: "test", value: 42 }]);
  });

  it("should emit END when Electron is unavailable", () => {
    delete (window as any).electronAPI;

    const channel = createListenSyncChannel("test:event");
    let emitted: unknown;

    channel.take((value) => {
      emitted = value;
    });

    expect(mockedListenSync).not.toHaveBeenCalled();
    expect(emitted).toBe(END);
  });
});

describe("createWindowEventChannel", () => {
  it("should emit event detail when the window event fires", () => {
    const channel = createWindowEventChannel<{ id: string }>("window:test");
    const emitted: Array<{ id: string }> = [];

    channel.take((value) => {
      emitted.push(value);
    });

    window.dispatchEvent(new CustomEvent("window:test", { detail: { id: "abc" } }));

    expect(emitted).toEqual([{ id: "abc" }]);
    channel.close();
  });

  it("should emit the native event when detail is unavailable", () => {
    const channel = createWindowEventChannel<Event>("resize");
    const emitted: Event[] = [];

    channel.take((value) => {
      emitted.push(value);
    });

    const event = new Event("resize");
    window.dispatchEvent(event);

    expect(emitted).toEqual([event]);
    channel.close();
  });

  it("should support capture listeners and stop propagation when requested", () => {
    const addEventListenerSpy = vi.spyOn(window, "addEventListener");
    const removeEventListenerSpy = vi.spyOn(window, "removeEventListener");
    const channel = createWindowEventChannel<{ id: string }>("window:capture", {
      capture: true,
      stopImmediatePropagation: true,
    });
    const emitted: Array<{ id: string }> = [];

    channel.take((value) => {
      emitted.push(value);
    });

    const event = new CustomEvent("window:capture", { detail: { id: "abc" } });
    const stopImmediatePropagationSpy = vi.spyOn(event, "stopImmediatePropagation");

    window.dispatchEvent(event);

    expect(addEventListenerSpy).toHaveBeenCalledWith("window:capture", expect.any(Function), true);
    expect(stopImmediatePropagationSpy).toHaveBeenCalledOnce();
    expect(emitted).toEqual([{ id: "abc" }]);

    channel.close();

    expect(removeEventListenerSpy).toHaveBeenCalledWith(
      "window:capture",
      expect.any(Function),
      true,
    );
  });

  it("should emit END when window is unavailable", () => {
    const originalWindow = globalThis.window;
    vi.stubGlobal("window", undefined);

    try {
      const channel = createWindowEventChannel("window:test");
      let emitted: unknown;

      channel.take((value) => {
        emitted = value;
      });

      expect(emitted).toBe(END);
    } finally {
      vi.stubGlobal("window", originalWindow);
    }
  });
});

describe("createElectronChannel", () => {
  let capturedHandler: ((payload: any) => void) | null = null;
  let mockOn: ReturnType<typeof vi.fn>;
  let mockOffById: ReturnType<typeof vi.fn>;
  let originalElectronApi: typeof window.electronAPI | undefined;

  beforeEach(() => {
    capturedHandler = null;
    mockOn = vi.fn((_event: string, handler: (payload: any) => void) => {
      capturedHandler = handler;
      return "listener-1";
    });
    mockOffById = vi.fn();
    originalElectronApi = window.electronAPI;
    (window as any).electronAPI = {
      on: mockOn,
      offById: mockOffById,
    };
  });

  afterEach(() => {
    if (originalElectronApi) {
      window.electronAPI = originalElectronApi;
      return;
    }

    delete (window as any).electronAPI;
  });

  it("should call electronAPI.on with the event name", () => {
    createElectronChannel("agent:auth-required");

    expect(mockOn).toHaveBeenCalledWith("agent:auth-required", expect.any(Function));
  });

  it("should emit event data when the Electron listener fires", () => {
    const channel = createElectronChannel<{ message: string }>("agent:plan-required");
    const emitted: Array<{ message: string }> = [];

    channel.take((value) => {
      emitted.push(value);
    });

    capturedHandler?.({ message: "Upgrade required" });

    expect(emitted).toEqual([{ message: "Upgrade required" }]);
  });

  it("should buffer bursty event data until the saga takes it", () => {
    const channel = createElectronChannel<{ message: string }>("agent:plan-required");
    const emitted: Array<{ message: string }> = [];

    capturedHandler?.({ message: "first" });
    capturedHandler?.({ message: "second" });

    channel.take((value) => {
      emitted.push(value);
    });
    channel.take((value) => {
      emitted.push(value);
    });

    expect(emitted).toEqual([{ message: "first" }, { message: "second" }]);
  });

  it("should remove the listener by id when the channel closes", () => {
    const channel = createElectronChannel("auto-update:up-to-date");

    channel.close();

    expect(mockOffById).toHaveBeenCalledWith("auto-update:up-to-date", "listener-1");
  });

  it("should emit END when Electron is unavailable", () => {
    delete (window as any).electronAPI;

    const channel = createElectronChannel("github:auth-required");
    let emitted: unknown;

    channel.take((value) => {
      emitted = value;
    });

    expect(mockOn).not.toHaveBeenCalled();
    expect(emitted).toBe(END);
    expect(() => channel.close()).not.toThrow();
  });
});

describe("takeEvery helper effects", () => {
  let originalElectronApi: typeof window.electronAPI | undefined;
  let capturedElectronHandler: ((payload: any) => void) | null = null;
  let mockOffById: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    originalElectronApi = window.electronAPI;
    capturedElectronHandler = null;
    mockOffById = vi.fn();
    (window as any).electronAPI = {
      on: vi.fn((_event: string, handler: (payload: any) => void) => {
        capturedElectronHandler = handler;
        return "listener-1";
      }),
      offById: mockOffById,
    };
    mockedListenSync.mockImplementation(() => vi.fn());
  });

  afterEach(() => {
    if (originalElectronApi) {
      window.electronAPI = originalElectronApi;
      return;
    }

    delete (window as any).electronAPI;
  });

  it("takeEveryFromWindowEvent forks its listener loop and returns", () => {
    const handler = function* (data: { id: string }) {
      return data;
    };
    const iterator = takeEveryFromWindowEvent("window:test", handler);

    const first = iterator.next().value as any;
    expect(first.type).toBe("FORK");
    expect(first.payload.args).toEqual(["window:test", handler, {}]);
    expect(iterator.next({} as any).done).toBe(true);
  });

  it("takeEveryFromListenSync forks its listener loop and returns", () => {
    const handler = function* (data: { id: string }) {
      return data;
    };
    const iterator = takeEveryFromListenSync("terminal:disposed", handler);

    const first = iterator.next().value as any;
    expect(first.type).toBe("FORK");
    expect(first.payload.args).toEqual(["terminal:disposed", handler]);
    expect(iterator.next({} as any).done).toBe(true);
  });

  it("takeEveryFromElectronChannel forks its listener loop and returns", () => {
    const handler = function* (data: { message: string }) {
      return data;
    };
    const iterator = takeEveryFromElectronChannel("agent:plan-required", handler);

    const first = iterator.next().value as any;
    expect(first.type).toBe("FORK");
    expect(first.payload.args).toEqual(["agent:plan-required", handler]);
    expect(iterator.next({} as any).done).toBe(true);
  });

  it("takeEveryFromListenSync handles events and cleans up when its owning saga is cancelled", async () => {
    let capturedListenSyncHandler: ((payload: { payload: { id: string } }) => void) | null = null;
    const cleanup = vi.fn();
    const calls: string[] = [];

    mockedListenSync.mockImplementation((_event: string, handler: any) => {
      capturedListenSyncHandler = handler;
      return cleanup;
    });

    function* handler(data: { id: string }) {
      calls.push(data.id);
    }

    function* rootSaga() {
      yield* takeEveryFromListenSync<{ id: string }>("terminal:disposed", handler);
    }

    const task = runSaga({ dispatch: vi.fn(), getState: () => ({}) }, rootSaga);

    await flushSaga();
    expect(mockedListenSync).toHaveBeenCalledWith("terminal:disposed", expect.any(Function));

    capturedListenSyncHandler!({ payload: { id: "term-1" } });
    await flushSaga();
    expect(calls).toEqual(["term-1"]);

    task.cancel();
    await task.toPromise();

    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("takeEveryFromListenSync starts later handlers while an earlier handler is delayed", async () => {
    let capturedListenSyncHandler: ((payload: { payload: { id: string } }) => void) | null = null;
    let releaseFirstHandler: (() => void) | undefined;
    const firstHandlerDelay = new Promise<void>((resolve) => {
      releaseFirstHandler = resolve;
    });
    const cleanup = vi.fn();
    const starts: string[] = [];
    const finishes: string[] = [];

    mockedListenSync.mockImplementation((_event: string, handler: any) => {
      capturedListenSyncHandler = handler;
      return cleanup;
    });

    function* handler(data: { id: string }) {
      starts.push(data.id);
      if (data.id === "first") {
        yield firstHandlerDelay;
      }
      finishes.push(data.id);
    }

    function* rootSaga() {
      yield* takeEveryFromListenSync<{ id: string }>("terminal:disposed", handler);
    }

    const task = runSaga({ dispatch: vi.fn(), getState: () => ({}) }, rootSaga);

    await flushSaga();
    capturedListenSyncHandler!({ payload: { id: "first" } });
    await flushSaga();
    capturedListenSyncHandler!({ payload: { id: "second" } });
    await flushSaga();

    expect(starts).toEqual(["first", "second"]);
    expect(finishes).toEqual(["second"]);

    releaseFirstHandler?.();
    task.cancel();
    await task.toPromise();

    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("takeEveryFromWindowEvent handles events and removes its listener when cancelled", async () => {
    const calls: string[] = [];
    const removeEventListenerSpy = vi.spyOn(window, "removeEventListener");

    function* handler(data: { id: string }) {
      calls.push(data.id);
    }

    function* rootSaga() {
      yield* takeEveryFromWindowEvent<{ id: string }>("window:test", handler);
    }

    const task = runSaga({ dispatch: vi.fn(), getState: () => ({}) }, rootSaga);

    await flushSaga();
    window.dispatchEvent(new CustomEvent("window:test", { detail: { id: "event-1" } }));
    await flushSaga();
    expect(calls).toEqual(["event-1"]);

    task.cancel();
    await task.toPromise();

    expect(removeEventListenerSpy).toHaveBeenCalledWith("window:test", expect.any(Function));
    removeEventListenerSpy.mockRestore();
  });

  it("takeEveryFromElectronChannel handles events and removes its listener when cancelled", async () => {
    const calls: string[] = [];

    function* handler(data: { message: string }) {
      calls.push(data.message);
    }

    function* rootSaga() {
      yield* takeEveryFromElectronChannel<{ message: string }>("agent:plan-required", handler);
    }

    const task = runSaga({ dispatch: vi.fn(), getState: () => ({}) }, rootSaga);

    await flushSaga();
    capturedElectronHandler!({ message: "Upgrade required" });
    await flushSaga();
    expect(calls).toEqual(["Upgrade required"]);

    task.cancel();
    await task.toPromise();

    expect(mockOffById).toHaveBeenCalledWith("agent:plan-required", "listener-1");
  });

  it("takeEveryFromElectronChannel starts later handlers while an earlier handler is delayed", async () => {
    let releaseFirstHandler: (() => void) | undefined;
    const firstHandlerDelay = new Promise<void>((resolve) => {
      releaseFirstHandler = resolve;
    });
    const starts: string[] = [];
    const finishes: string[] = [];

    function* handler(data: { message: string }) {
      starts.push(data.message);
      if (data.message === "first") {
        yield firstHandlerDelay;
      }
      finishes.push(data.message);
    }

    function* rootSaga() {
      yield* takeEveryFromElectronChannel<{ message: string }>("agent:plan-required", handler);
    }

    const task = runSaga({ dispatch: vi.fn(), getState: () => ({}) }, rootSaga);

    await flushSaga();
    capturedElectronHandler!({ message: "first" });
    await flushSaga();
    capturedElectronHandler!({ message: "second" });
    await flushSaga();

    expect(starts).toEqual(["first", "second"]);
    expect(finishes).toEqual(["second"]);

    releaseFirstHandler?.();
    task.cancel();
    await task.toPromise();

    expect(mockOffById).toHaveBeenCalledWith("agent:plan-required", "listener-1");
  });
});

