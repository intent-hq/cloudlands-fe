/**
 * Tests for interrupted-agents-service.
 *
 * Verifies:
 * - Catch-up check on install when backend is already connected
 * - Initial connection listener (install before connect)
 * - Reconnect listener
 * - Per-epoch deduplication prevents double-showing the modal
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installInterruptedAgentsService } from "./interrupted-agents-service";
import type { InterruptedAgent } from "$lib/client/app-client";

describe("interrupted-agents-service", () => {
  let mockAppClient: {
    agents: {
      listInterrupted: ReturnType<typeof vi.fn>;
    };
  };
  let mockElectronAPI: {
    invoke: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
    offById: ReturnType<typeof vi.fn>;
  };
  let showHandler: ReturnType<typeof vi.fn>;
  let listenerIdCounter: number;

  beforeEach(() => {
    listenerIdCounter = 0;

    mockAppClient = {
      agents: {
        listInterrupted: vi.fn().mockResolvedValue([]),
      },
    };

    mockElectronAPI = {
      invoke: vi.fn(),
      on: vi.fn((_channel: string, _handler: (payload: any) => void) => {
        listenerIdCounter += 1;
        return `listener-${listenerIdCounter}`;
      }),
      offById: vi.fn(),
    };

    showHandler = vi.fn();

    // Install the mock electronAPI on window
    (global as any).window = {
      electronAPI: mockElectronAPI,
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete (global as any).window;
  });

  it("queries backend status on install and checks if already connected (catch-up)", async () => {
    mockElectronAPI.invoke.mockResolvedValueOnce({ status: "connected" });
    const interruptedAgent: InterruptedAgent = {
      sessionId: "agent-1",
      workspaceId: "ws-1",
      name: "Agent One",
      status: "active",
      interruptedAt: "2026-07-18T01:41:14Z",
    };
    mockAppClient.agents.listInterrupted.mockResolvedValueOnce([interruptedAgent]);

    installInterruptedAgentsService(mockAppClient, showHandler);

    // Wait for async catch-up
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockElectronAPI.invoke).toHaveBeenCalledWith("backend:get-status");
    expect(mockAppClient.agents.listInterrupted).toHaveBeenCalled();
    expect(showHandler).toHaveBeenCalledWith([interruptedAgent]);
  });

  it("does not check on install if backend is not connected", async () => {
    mockElectronAPI.invoke.mockResolvedValueOnce({ status: "disconnected" });

    installInterruptedAgentsService(mockAppClient, showHandler);

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockElectronAPI.invoke).toHaveBeenCalledWith("backend:get-status");
    expect(mockAppClient.agents.listInterrupted).not.toHaveBeenCalled();
    expect(showHandler).not.toHaveBeenCalled();
  });

  it("handles errors during status query gracefully", async () => {
    mockElectronAPI.invoke.mockRejectedValueOnce(new Error("IPC error"));

    installInterruptedAgentsService(mockAppClient, showHandler);

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockElectronAPI.invoke).toHaveBeenCalledWith("backend:get-status");
    expect(mockAppClient.agents.listInterrupted).not.toHaveBeenCalled();
    expect(showHandler).not.toHaveBeenCalled();
  });

  it("listens for initial connection event (install before connect)", async () => {
    mockElectronAPI.invoke.mockResolvedValueOnce({ status: "disconnected" });
    const interruptedAgent: InterruptedAgent = {
      sessionId: "agent-2",
      workspaceId: "ws-2",
      name: "Agent Two",
      status: "active",
      interruptedAt: "2026-07-18T01:42:00Z",
    };
    mockAppClient.agents.listInterrupted.mockResolvedValue([interruptedAgent]);

    installInterruptedAgentsService(mockAppClient, showHandler);

    await new Promise((resolve) => setTimeout(resolve, 10));

    // Clear the call from catch-up
    mockAppClient.agents.listInterrupted.mockClear();

    // Simulate initial connection event
    const statusListener = mockElectronAPI.on.mock.calls.find(
      ([channel]) => channel === "backend:status",
    )?.[1];
    expect(statusListener).toBeDefined();
    statusListener({ status: "connected", reconnected: false });

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockAppClient.agents.listInterrupted).toHaveBeenCalled();
    expect(showHandler).toHaveBeenCalledWith([interruptedAgent]);
  });

  it("deduplicates checks for the same epoch (rapid double events)", async () => {
    mockElectronAPI.invoke.mockResolvedValueOnce({ status: "connected" });
    const interruptedAgent: InterruptedAgent = {
      sessionId: "agent-3",
      workspaceId: "ws-3",
      name: "Agent Three",
      status: "active",
      interruptedAt: "2026-07-18T01:43:00Z",
    };
    mockAppClient.agents.listInterrupted.mockResolvedValue([interruptedAgent]);

    installInterruptedAgentsService(mockAppClient, showHandler);

    await new Promise((resolve) => setTimeout(resolve, 10));

    // Catch-up check happened
    expect(mockAppClient.agents.listInterrupted).toHaveBeenCalledTimes(1);
    expect(showHandler).toHaveBeenCalledTimes(1);

    mockAppClient.agents.listInterrupted.mockClear();
    showHandler.mockClear();

    // Simulate the initial connection event (which would increment epoch and try again)
    const statusListener = mockElectronAPI.on.mock.calls.find(
      ([channel]) => channel === "backend:status",
    )?.[1];
    statusListener({ status: "connected", reconnected: false });

    await new Promise((resolve) => setTimeout(resolve, 10));

    // New epoch, so check happens again
    expect(mockAppClient.agents.listInterrupted).toHaveBeenCalledTimes(1);
    expect(showHandler).toHaveBeenCalledTimes(1);
  });

  it("handles reconnect events", async () => {
    mockElectronAPI.invoke.mockResolvedValueOnce({ status: "disconnected" });
    const interruptedAgent: InterruptedAgent = {
      sessionId: "agent-4",
      workspaceId: "ws-4",
      name: "Agent Four",
      status: "active",
      interruptedAt: "2026-07-18T01:44:00Z",
    };
    mockAppClient.agents.listInterrupted.mockResolvedValue([interruptedAgent]);

    installInterruptedAgentsService(mockAppClient, showHandler);

    await new Promise((resolve) => setTimeout(resolve, 10));

    // No check on install (disconnected)
    expect(mockAppClient.agents.listInterrupted).not.toHaveBeenCalled();

    // Simulate reconnect event - call all backend:status listeners
    const statusListeners = mockElectronAPI.on.mock.calls
      .filter(([channel]) => channel === "backend:status")
      .map(([, handler]) => handler);
    expect(statusListeners.length).toBeGreaterThanOrEqual(1);

    statusListeners.forEach((listener) => {
      listener({ status: "connected", reconnected: true });
    });

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockAppClient.agents.listInterrupted).toHaveBeenCalled();
    expect(showHandler).toHaveBeenCalledWith([interruptedAgent]);
  });

  it("cleans up listeners on dispose", async () => {
    mockElectronAPI.invoke.mockResolvedValueOnce({ status: "disconnected" });

    const dispose = installInterruptedAgentsService(mockAppClient, showHandler);

    await new Promise((resolve) => setTimeout(resolve, 10));

    dispose();

    expect(mockElectronAPI.offById).toHaveBeenCalled();
  });
});
