/**
 * Tests for interrupted-agents-service.
 *
 * Verifies:
 * - Catch-up check on install when backend is already connected
 * - Initial connection listener (install before connect)
 * - Reconnect listener
 * - Per-epoch deduplication prevents double-showing the modal
 * - Cross-window reconciliation: agent:updated for a listed agent debounces a
 *   listInterrupted re-query that prunes resolved rows / closes silently
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  INTERRUPTED_RECONCILE_DEBOUNCE_MS,
  installInterruptedAgentsService,
  notifyInterruptedAgentUpdated,
  notifyInterruptedAgentsModalClosed,
} from "./interrupted-agents-service";
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
  let dispose: (() => void) | null;

  beforeEach(() => {
    listenerIdCounter = 0;
    dispose = null;

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
    if (dispose) {
      dispose();
      dispose = null;
    }
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

    dispose = installInterruptedAgentsService(mockAppClient, showHandler);

    // Wait for async catch-up
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockElectronAPI.invoke).toHaveBeenCalledWith("backend:get-status");
    expect(mockAppClient.agents.listInterrupted).toHaveBeenCalled();
    expect(showHandler).toHaveBeenCalledWith([interruptedAgent]);
  });

  it("does not check on install if backend is not connected", async () => {
    mockElectronAPI.invoke.mockResolvedValueOnce({ status: "disconnected" });

    dispose = installInterruptedAgentsService(mockAppClient, showHandler);

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockElectronAPI.invoke).toHaveBeenCalledWith("backend:get-status");
    expect(mockAppClient.agents.listInterrupted).not.toHaveBeenCalled();
    expect(showHandler).not.toHaveBeenCalled();
  });

  it("handles errors during status query gracefully", async () => {
    mockElectronAPI.invoke.mockRejectedValueOnce(new Error("IPC error"));

    dispose = installInterruptedAgentsService(mockAppClient, showHandler);

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

    dispose = installInterruptedAgentsService(mockAppClient, showHandler);

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

  it("allows checks for different epochs (sequential connections)", async () => {
    mockElectronAPI.invoke.mockResolvedValueOnce({ status: "connected" });
    const interruptedAgent: InterruptedAgent = {
      sessionId: "agent-3",
      workspaceId: "ws-3",
      name: "Agent Three",
      status: "active",
      interruptedAt: "2026-07-18T01:43:00Z",
    };
    mockAppClient.agents.listInterrupted.mockResolvedValue([interruptedAgent]);

    dispose = installInterruptedAgentsService(mockAppClient, showHandler);

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

    dispose = installInterruptedAgentsService(mockAppClient, showHandler);

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

    const localDispose = installInterruptedAgentsService(mockAppClient, showHandler);

    await new Promise((resolve) => setTimeout(resolve, 10));

    localDispose();

    expect(mockElectronAPI.offById).toHaveBeenCalled();
  });

  describe("cross-window reconciliation (agent:updated → listInterrupted re-query)", () => {
    function interrupted(agentId: string): InterruptedAgent {
      return {
        agentId,
        workspaceId: "ws-1",
        workspaceName: "Workspace One",
        agentName: `Agent ${agentId}`,
        prevStatus: "active",
        interruptedAt: "2026-08-01T00:00:00Z",
      };
    }

    /** Install with the modal open on the given agents; returns after catch-up. */
    async function installWithOpenModal(agents: InterruptedAgent[]): Promise<void> {
      mockElectronAPI.invoke.mockResolvedValueOnce({ status: "connected" });
      mockAppClient.agents.listInterrupted.mockResolvedValueOnce(agents);
      dispose = installInterruptedAgentsService(mockAppClient, showHandler);
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(showHandler).toHaveBeenCalledWith(agents);
      showHandler.mockClear();
      mockAppClient.agents.listInterrupted.mockClear();
    }

    async function flushDebounce(): Promise<void> {
      await new Promise((resolve) =>
        setTimeout(resolve, INTERRUPTED_RECONCILE_DEBOUNCE_MS + 30),
      );
    }

    it("prunes rows resolved elsewhere after a listed agent:updated", async () => {
      const a1 = interrupted("agent-1");
      const a2 = interrupted("agent-2");
      await installWithOpenModal([a1, a2]);

      // Another window resolved agent-1; the re-query only returns agent-2.
      mockAppClient.agents.listInterrupted.mockResolvedValue([a2]);
      notifyInterruptedAgentUpdated("agent-1");
      await flushDebounce();

      expect(mockAppClient.agents.listInterrupted).toHaveBeenCalledTimes(1);
      expect(showHandler).toHaveBeenCalledWith([a2]);
    });

    it("closes the modal silently (empty list) when all agents were resolved elsewhere", async () => {
      const a1 = interrupted("agent-1");
      await installWithOpenModal([a1]);

      mockAppClient.agents.listInterrupted.mockResolvedValue([]);
      notifyInterruptedAgentUpdated("agent-1");
      await flushDebounce();

      expect(showHandler).toHaveBeenCalledWith([]);
    });

    it("ignores agent:updated for agents not listed by the modal", async () => {
      await installWithOpenModal([interrupted("agent-1")]);

      notifyInterruptedAgentUpdated("agent-unrelated");
      await flushDebounce();

      expect(mockAppClient.agents.listInterrupted).not.toHaveBeenCalled();
      expect(showHandler).not.toHaveBeenCalled();
    });

    it("debounces a burst of agent:updated into a single re-query", async () => {
      const a1 = interrupted("agent-1");
      const a2 = interrupted("agent-2");
      const a3 = interrupted("agent-3");
      await installWithOpenModal([a1, a2, a3]);

      mockAppClient.agents.listInterrupted.mockResolvedValue([a3]);
      notifyInterruptedAgentUpdated("agent-1");
      notifyInterruptedAgentUpdated("agent-2");
      notifyInterruptedAgentUpdated("agent-1");
      await flushDebounce();

      expect(mockAppClient.agents.listInterrupted).toHaveBeenCalledTimes(1);
      expect(showHandler).toHaveBeenCalledTimes(1);
      expect(showHandler).toHaveBeenCalledWith([a3]);
    });

    it("no-ops once the modal closed locally (local resolve path unchanged)", async () => {
      await installWithOpenModal([interrupted("agent-1")]);

      notifyInterruptedAgentsModalClosed();
      notifyInterruptedAgentUpdated("agent-1");
      await flushDebounce();

      expect(mockAppClient.agents.listInterrupted).not.toHaveBeenCalled();
      expect(showHandler).not.toHaveBeenCalled();
    });

    it("a reconnect-epoch re-check replaces the open list instead of double-showing", async () => {
      const a1 = interrupted("agent-1");
      const a2 = interrupted("agent-2");
      await installWithOpenModal([a1, a2]);

      // During the outage everything was resolved: the reconnect check
      // returns an empty list, which must close the stale modal silently.
      mockAppClient.agents.listInterrupted.mockResolvedValue([]);
      const statusListeners = mockElectronAPI.on.mock.calls
        .filter(([channel]) => channel === "backend:status")
        .map(([, handler]) => handler);
      statusListeners.forEach((listener) => {
        listener({ status: "connected", reconnected: true });
      });
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(showHandler).toHaveBeenCalledTimes(1);
      expect(showHandler).toHaveBeenCalledWith([]);
    });
  });
});
