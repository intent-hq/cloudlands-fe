import { afterEach, describe, expect, it, vi } from "vitest";
import type { BackendNotification } from "./backend-transport";

// FAKE transport only: no request/notification reaches the real daemon. Tests
// assert the JSON-RPC method + params `chat.subscribe`/`chat.unsubscribe` emit
// and that a PROTOCOL §7.1-shaped seq-0 push is ingested verbatim.
vi.mock("./backend-transport", () => {
  const listeners: Array<(n: BackendNotification) => void> = [];
  return {
    backendRequest: vi.fn(),
    onBackendNotification: vi.fn((handler: (n: BackendNotification) => void) => {
      listeners.push(handler);
      return () => {
        const idx = listeners.indexOf(handler);
        if (idx >= 0) listeners.splice(idx, 1);
      };
    }),
    __emit: (n: BackendNotification) => {
      // Snapshot the listener list — some handlers dispose synchronously.
      for (const l of [...listeners]) l(n);
    },
    __reset: () => {
      listeners.length = 0;
    },
  };
});

import * as transport from "./backend-transport";
import { LiveChatClient } from "./live-chat-client";

const mockedRequest = vi.mocked(transport.backendRequest);
const emit = (transport as unknown as { __emit: (n: BackendNotification) => void }).__emit;
const reset = (transport as unknown as { __reset: () => void }).__reset;

describe("LiveChatClient (fake transport)", () => {
  afterEach(() => {
    vi.clearAllMocks();
    reset();
  });

  it("subscribeSnapshot sends chat.subscribe with agentId and returns the seq-0 messages", async () => {
    // Daemon fast-path resolves with the subscriptionId, then broadcasts the
    // seq-0 snapshot push on `subscription.push` (PROTOCOL §7.1).
    mockedRequest.mockImplementation(async (method: string) => {
      if (method === "chat.subscribe") {
        // Schedule the push after the subscribe resolves so we exercise the
        // "arrives after we know the subscriptionId" path.
        queueMicrotask(() =>
          emit({
            method: "subscription.push",
            params: {
              subscriptionId: "sub-chat-1",
              kind: "snapshot",
              seq: 0,
              snapshot: {
                agentId: "agent-1",
                messages: [
                  {
                    id: "0190a1b2-user",
                    agentId: "agent-1",
                    seq: 0,
                    role: "user",
                    contentBlocks: [
                      { type: "text", id: "0190a1b2-user:0", text: "Run the tests" },
                    ],
                    timestamp: "2026-06-27T01:00:00.000Z",
                  },
                ],
                truncated: false,
                totalMessages: 1,
                nextToken: null,
              },
            },
          }),
        );
        return { subscriptionId: "sub-chat-1" };
      }
      return {};
    });

    const client = new LiveChatClient();
    const result = await client.subscribeSnapshot("agent-1");

    expect(mockedRequest).toHaveBeenCalledWith("chat.subscribe", { agentId: "agent-1" });
    expect(mockedRequest).toHaveBeenCalledWith("chat.unsubscribe", { subscriptionId: "sub-chat-1" });
    expect(result.messages.map((m) => m.id)).toEqual(["0190a1b2-user"]);
    expect(result.truncated).toBe(false);
    expect(result.totalMessages).toBe(1);
  });

  it("subscribeSnapshot surfaces the synthetic in-flight assistant message (CS-0 D5)", async () => {
    // When a turn is streaming, the daemon appends `{ isStreaming: true }` to
    // the snapshot's `messages`. That flag must ride through to the caller so
    // the reducer can render the partial (this is the whole point of the
    // hydration switch).
    mockedRequest.mockImplementation(async (method: string) => {
      if (method === "chat.subscribe") {
        queueMicrotask(() =>
          emit({
            method: "subscription.push",
            params: {
              subscriptionId: "sub-chat-2",
              kind: "snapshot",
              seq: 0,
              snapshot: {
                agentId: "agent-2",
                messages: [
                  {
                    id: "0190a200-asst",
                    agentId: "agent-2",
                    seq: 1,
                    role: "assistant",
                    isStreaming: true,
                    contentBlocks: [
                      { type: "text", id: "0190a200-asst:0", text: "Let me check" },
                    ],
                    timestamp: "2026-06-27T01:00:00.500Z",
                  },
                ],
                truncated: false,
                totalMessages: 2,
                nextToken: null,
              },
            },
          }),
        );
        return { subscriptionId: "sub-chat-2" };
      }
      return {};
    });

    const client = new LiveChatClient();
    const result = await client.subscribeSnapshot("agent-2");

    expect(result.messages).toHaveLength(1);
    const inFlight = result.messages[0] as { isStreaming?: boolean; role: string };
    expect(inFlight.role).toBe("assistant");
    expect(inFlight.isStreaming).toBe(true);
  });
});
