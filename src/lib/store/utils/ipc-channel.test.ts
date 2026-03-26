import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { END } from "redux-saga";
import * as sagaEffects from "redux-saga/effects";
import {
  createElectronChannel,
  createListenSyncChannel,
  createWindowEventChannel,
  takeEveryFromElectronChannel,
  takeEveryFromListenSync,
  takeEveryFromWindowEvent,
} from "./ipc-channel";

// Mock electron-bridge
vi.mock("$lib/electron-bridge", () => ({
  listenSync: vi.fn(),
}));

import { listenSync } from "$lib/electron-bridge";

const mockedListenSync = vi.mocked(listenSync);

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

  beforeEach(() => {
    originalElectronApi = window.electronAPI;
    (window as any).electronAPI = {
      on: vi.fn(() => "listener-1"),
      offById: vi.fn(),
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

  it("takeEveryFromWindowEvent takes from its channel, calls the handler, and closes on exit", () => {
    const handler = function* (data: { id: string }) {
      return data;
    };
    const iterator = takeEveryFromWindowEvent("window:test", handler);

    const first = iterator.next().value as any;
    const channel = first.payload.channel;
    vi.spyOn(channel, "close");

    expect(first).toEqual(sagaEffects.take(channel));
    expect(iterator.next({ id: "abc" })).toEqual({
      value: sagaEffects.call(handler, { id: "abc" }),
      done: false,
    });

    iterator.return(undefined);

    expect(channel.close).toHaveBeenCalledOnce();
  });

  it("takeEveryFromListenSync takes from its channel, calls the handler, and closes on exit", () => {
    const handler = function* (data: { id: string }) {
      return data;
    };
    const iterator = takeEveryFromListenSync("terminal:disposed", handler);

    const first = iterator.next().value as any;
    const channel = first.payload.channel;
    vi.spyOn(channel, "close");

    expect(first).toEqual(sagaEffects.take(channel));
    expect(iterator.next({ id: "term-1" })).toEqual({
      value: sagaEffects.call(handler, { id: "term-1" }),
      done: false,
    });

    iterator.return(undefined);

    expect(channel.close).toHaveBeenCalledOnce();
  });

  it("takeEveryFromElectronChannel takes from its channel, calls the handler, and closes on exit", () => {
    const handler = function* (data: { message: string }) {
      return data;
    };
    const iterator = takeEveryFromElectronChannel("agent:plan-required", handler);

    const first = iterator.next().value as any;
    const channel = first.payload.channel;
    vi.spyOn(channel, "close");

    expect(first).toEqual(sagaEffects.take(channel));
    expect(iterator.next({ message: "Upgrade required" })).toEqual({
      value: sagaEffects.call(handler, { message: "Upgrade required" }),
      done: false,
    });

    iterator.return(undefined);

    expect(channel.close).toHaveBeenCalledOnce();
  });
});

