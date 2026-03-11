import { describe, it, expect, vi, beforeEach } from "vitest";
import { createListenSyncChannel } from "./ipc-channel";

// Mock electron-bridge
vi.mock("$lib/electron-bridge", () => ({
  listenSync: vi.fn(),
}));

import { listenSync } from "$lib/electron-bridge";

const mockedListenSync = vi.mocked(listenSync);

describe("createListenSyncChannel", () => {
  let capturedHandler: ((payload: { payload: any }) => void) | null = null;
  let mockCleanup: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    capturedHandler = null;
    mockCleanup = vi.fn();

    mockedListenSync.mockImplementation((_event: string, handler: any) => {
      capturedHandler = handler;
      return mockCleanup;
    });
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
});

