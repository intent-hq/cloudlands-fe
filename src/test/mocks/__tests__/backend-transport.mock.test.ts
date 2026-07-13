import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Point the real backend-transport module at the fixture. The `vi.mock`
// factory is hoisted; a dynamic import inside it lets the factory reach the
// mock module without pinning an import-order dependency.
vi.mock("$lib/client/live/backend-transport", async () => {
  const mod = await import("../backend-transport.mock");
  return mod.mockBackendTransportModule;
});

import {
  backendRequest,
  backendSubscribe,
  backendUnsubscribe,
  detectLiveStateCapability,
  onBackendNotification,
} from "$lib/client/live/backend-transport";
import {
  BackendError,
  buildErrorPayload,
  buildEventNotification,
  buildSubscriptionPushDelta,
  buildSubscriptionPushSnapshot,
  installMockBackend,
  resetMockBackend,
  type MockBackendHandle,
} from "../backend-transport.mock";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("MockBackendTransport fixture", () => {
  let backend: MockBackendHandle;

  beforeEach(() => {
    backend = installMockBackend();
  });
  afterEach(() => {
    resetMockBackend();
  });

  describe("backendRequest scripting", () => {
    it("routes scripted responses to the registered handler and records the call", async () => {
      backend.onRequest("agent.list", (params) => {
        expect(params).toEqual({ workspaceId: "ws-1" });
        return { agents: [{ id: "a-1" }] };
      });

      const result = await backendRequest<{ agents: Array<{ id: string }> }>(
        "agent.list",
        { workspaceId: "ws-1" },
      );

      expect(result).toEqual({ agents: [{ id: "a-1" }] });
      expect(backend.requests).toEqual([
        { method: "agent.list", params: { workspaceId: "ws-1" } },
      ]);
    });

    it("resolves async handlers", async () => {
      backend.onRequest("note.read", async (params) => {
        await Promise.resolve();
        return { note: { id: (params as { id: string }).id, content: "ok" } };
      });
      const result = await backendRequest<{ note: { id: string; content: string } }>(
        "note.read",
        { id: "spec" },
      );
      expect(result.note.content).toBe("ok");
    });

    it("rejects with a BackendError carrying MOCK_UNHANDLED_METHOD when no handler is registered", async () => {
      await expect(backendRequest("workspace.list", {})).rejects.toBeInstanceOf(BackendError);
      await expect(backendRequest("workspace.list", {})).rejects.toMatchObject({
        code: "MOCK_UNHANDLED_METHOD",
      });
    });

    it("preserves a BackendError thrown from the handler (PROTOCOL §9)", async () => {
      backend.onRequest("note.update", () => {
        throw new BackendError(
          buildErrorPayload("CONFLICT", "expectedVersion mismatch", {
            rpcCode: -32005,
            data: { current: { rev: 3 } },
          }),
        );
      });
      const err = await backendRequest("note.update", {}).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BackendError);
      expect(err).toMatchObject({
        code: "CONFLICT",
        rpcCode: -32005,
        data: { current: { rev: 3 } },
      });
    });

    it("wraps a plain Error thrown from the handler as MOCK_HANDLER_ERROR", async () => {
      backend.onRequest("boom", () => {
        throw new Error("kaboom");
      });
      const err = await backendRequest("boom").catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BackendError);
      expect(err).toMatchObject({ code: "MOCK_HANDLER_ERROR", message: "kaboom" });
    });
  });

  describe("subscribe / unsubscribe", () => {
    it("auto-mints a subscriptionId when no onSubscribe handler is set", async () => {
      const first = await backendSubscribe<{ subscriptionId: string }>({
        eventTypes: ["agent:*"],
      });
      const second = await backendSubscribe<{ subscriptionId: string }>({
        eventTypes: ["note:*"],
      });
      expect(first.subscriptionId).toBe("mock-sub-1");
      expect(second.subscriptionId).toBe("mock-sub-2");
      expect(backend.subscribes).toHaveLength(2);
    });

    it("routes to the registered onSubscribe handler", async () => {
      backend.onSubscribe((params) => {
        expect(params).toEqual({ eventTypes: ["agent:*"], workspaceId: "ws-1" });
        return { subscriptionId: "sub-custom" };
      });
      const ack = await backendSubscribe<{ subscriptionId: string }>({
        eventTypes: ["agent:*"],
        workspaceId: "ws-1",
      });
      expect(ack.subscriptionId).toBe("sub-custom");
    });

    it("records unsubscribe ids and resolves", async () => {
      await expect(backendUnsubscribe("sub-1")).resolves.toBeUndefined();
      expect(backend.unsubscribes).toEqual(["sub-1"]);
    });
  });

  describe("notification delivery", () => {
    it("delivers pushEvent envelopes to every onBackendNotification handler", () => {
      const received: Array<{ method: string; params?: unknown }> = [];
      const dispose = onBackendNotification((n) => received.push(n));
      expect(backend.notificationHandlerCount).toBe(1);

      backend.pushEvent({ type: "agent:idle", data: { agentId: "a-1" } });
      backend.pushEvent({
        type: "note:updated",
        data: { noteId: "spec" },
        subscriptionId: "sub-7",
      });

      expect(received).toHaveLength(2);
      expect(received[0]).toMatchObject({
        method: "events.event",
        params: {
          event: expect.objectContaining({
            type: "agent:idle",
            data: { agentId: "a-1" },
          }),
        },
      });
      expect(received[1].params).toMatchObject({
        subscriptionId: "sub-7",
        event: expect.objectContaining({ type: "note:updated" }),
      });

      dispose();
      expect(backend.notificationHandlerCount).toBe(0);
    });

    it("fans a single pushEvent out to all subscribed handlers", () => {
      const a: BackendNotificationSpy[] = [];
      const b: BackendNotificationSpy[] = [];
      onBackendNotification((n) => a.push(n));
      onBackendNotification((n) => b.push(n));

      backend.pushEvent({ type: "task:status-changed", data: {} });

      expect(a).toHaveLength(1);
      expect(b).toHaveLength(1);
    });

    it("pushSubscriptionPush delivers snapshot and delta frames per PROTOCOL §6", () => {
      const received: Array<{ method: string; params?: unknown }> = [];
      onBackendNotification((n) => received.push(n));

      backend.pushSubscriptionPush({
        subscriptionId: "sub-1",
        kind: "snapshot",
        seq: 0,
        snapshot: [{ id: "a" }],
      });
      backend.pushSubscriptionPush({
        subscriptionId: "sub-1",
        kind: "delta",
        seq: 1,
        delta: { added: [{ id: "b" }], removedIds: ["a"] },
      });

      expect(received[0]).toEqual({
        method: "subscription.push",
        params: {
          subscriptionId: "sub-1",
          kind: "snapshot",
          seq: 0,
          snapshot: [{ id: "a" }],
        },
      });
      expect(received[1]).toEqual({
        method: "subscription.push",
        params: {
          subscriptionId: "sub-1",
          kind: "delta",
          seq: 1,
          delta: { added: [{ id: "b" }], removedIds: ["a"] },
        },
      });
    });

    it("accepts a pre-built notification envelope (bypasses defaults)", () => {
      const received: Array<{ method: string; params?: unknown }> = [];
      onBackendNotification((n) => received.push(n));
      const envelope = buildEventNotification(
        "agent:started",
        { agentId: "a-2" },
        { workspaceId: "ws-2", actor: { type: "agent", id: "a-2" } },
      );
      backend.pushEvent(envelope);
      expect(received).toEqual([envelope]);
    });
  });

  describe("detectLiveStateCapability", () => {
    it("returns the currently scripted value", async () => {
      await expect(detectLiveStateCapability()).resolves.toBe(false);
      backend.setLiveStateCapability(true);
      await expect(detectLiveStateCapability()).resolves.toBe(true);
    });
  });

  describe("resetMockBackend", () => {
    it("clears handlers, recorded calls, notification listeners, and capability", async () => {
      const received: unknown[] = [];
      onBackendNotification((n) => received.push(n));
      backend.onRequest("m", () => "ok");
      backend.setLiveStateCapability(true);
      await backendRequest("m");

      resetMockBackend();
      await flush();

      expect(backend.notificationHandlerCount).toBe(0);
      expect(backend.requests).toHaveLength(0);
      await expect(backendRequest("m")).rejects.toMatchObject({
        code: "MOCK_UNHANDLED_METHOD",
      });
      await expect(detectLiveStateCapability()).resolves.toBe(false);
    });
  });

  describe("builders (PROTOCOL anchors)", () => {
    it("buildEventNotification wraps the event in the §6.3 envelope", () => {
      const env = buildEventNotification(
        "note:updated",
        { noteId: "spec" },
        {
          id: "evt-1",
          workspaceId: "ws-1",
          timestamp: "2026-06-17T04:35:04.055Z",
          actor: { type: "agent", id: "agent-123", name: "Coordinator" },
          subscriptionId: "ws-sub-1",
        },
      );
      expect(env).toEqual({
        method: "events.event",
        params: {
          subscriptionId: "ws-sub-1",
          event: {
            type: "note:updated",
            workspaceId: "ws-1",
            id: "evt-1",
            timestamp: "2026-06-17T04:35:04.055Z",
            actor: { type: "agent", id: "agent-123", name: "Coordinator" },
            data: { noteId: "spec" },
          },
        },
      });
    });

    it("buildSubscriptionPushSnapshot defaults seq to 0", () => {
      expect(
        buildSubscriptionPushSnapshot({ subscriptionId: "s", snapshot: [] }),
      ).toEqual({
        method: "subscription.push",
        params: { subscriptionId: "s", kind: "snapshot", seq: 0, snapshot: [] },
      });
    });

    it("buildSubscriptionPushDelta preserves the added/updated/removedIds envelope", () => {
      expect(
        buildSubscriptionPushDelta({
          subscriptionId: "s",
          seq: 4,
          delta: { added: [{ id: "a" }], removedIds: ["b"] },
        }),
      ).toEqual({
        method: "subscription.push",
        params: {
          subscriptionId: "s",
          kind: "delta",
          seq: 4,
          delta: { added: [{ id: "a" }], removedIds: ["b"] },
        },
      });
    });

    it("buildErrorPayload threads rpcCode + data (PROTOCOL §9)", () => {
      expect(
        buildErrorPayload("CONFLICT", "expectedVersion mismatch", {
          rpcCode: -32005,
          data: { current: { rev: 3 } },
        }),
      ).toEqual({
        code: "CONFLICT",
        message: "expectedVersion mismatch",
        rpcCode: -32005,
        data: { current: { rev: 3 } },
      });
    });
  });
});

type BackendNotificationSpy = { method: string; params?: unknown };
