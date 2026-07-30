import { afterEach, describe, expect, it, vi } from "vitest";
import type { BackendNotification } from "./backend-transport";

// FAKE transport only: no request/notification reaches the real daemon. Tests
// assert the JSON-RPC method + params `chat.subscribe`/`chat.unsubscribe` emit
// and that PROTOCOL §7.1-shaped pushes (seq-0 snapshot + block deltas) are
// ingested verbatim.
vi.mock("./backend-transport", () => {
  const listeners: Array<(n: BackendNotification) => void> = [];
  const reconnectListeners: Array<() => void> = [];
  return {
    backendRequest: vi.fn(),
    onBackendNotification: vi.fn((handler: (n: BackendNotification) => void) => {
      listeners.push(handler);
      return () => {
        const idx = listeners.indexOf(handler);
        if (idx >= 0) listeners.splice(idx, 1);
      };
    }),
    onBackendReconnected: vi.fn((handler: () => void) => {
      reconnectListeners.push(handler);
      return () => {
        const idx = reconnectListeners.indexOf(handler);
        if (idx >= 0) reconnectListeners.splice(idx, 1);
      };
    }),
    __emit: (n: BackendNotification) => {
      // Snapshot the listener list — some handlers dispose synchronously.
      for (const l of [...listeners]) l(n);
    },
    __emitReconnect: () => {
      for (const l of [...reconnectListeners]) l();
    },
    __reset: () => {
      listeners.length = 0;
      reconnectListeners.length = 0;
    },
  };
});

import * as transport from "./backend-transport";
import { LiveChatClient } from "./live-chat-client";

const mockedRequest = vi.mocked(transport.backendRequest);
const emit = (transport as unknown as { __emit: (n: BackendNotification) => void }).__emit;
const emitReconnect = (transport as unknown as { __emitReconnect: () => void }).__emitReconnect;
const reset = (transport as unknown as { __reset: () => void }).__reset;

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

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

// ---------------------------------------------------------------------------
// Standing subscription: chat.subscribe stays open and the block-granularity
// delta stream (PROTOCOL §7.1) is reduced onto the seq-0 message page.
// ---------------------------------------------------------------------------

/** Sequentially-minted subscriptionIds for each `chat.subscribe` call. */
function mockChatSubscribe(prefix = "sub"): void {
  let n = 0;
  mockedRequest.mockImplementation(async (method: string) => {
    if (method === "chat.subscribe") {
      n += 1;
      return { subscriptionId: `${prefix}-${n}` };
    }
    return {};
  });
}

function snapshotPush(subscriptionId: string, seq: number, snapshot: unknown): void {
  emit({
    method: "subscription.push",
    params: { subscriptionId, kind: "snapshot", seq, snapshot },
  });
}

function deltaPush(subscriptionId: string, seq: number, delta: unknown): void {
  emit({ method: "subscription.push", params: { subscriptionId, kind: "delta", seq, delta } });
}

/** The §7.1 seq-0 snapshot object for one persisted user message. */
const SEEDED_SNAPSHOT = {
  agentId: "agent-1",
  messages: [
    {
      id: "0190a1b2-user",
      agentId: "agent-1",
      seq: 0,
      role: "user",
      contentBlocks: [{ type: "text", id: "0190a1b2-user:0", text: "Run the tests" }],
      timestamp: "2026-06-27T01:00:00.000Z",
    },
  ],
  truncated: false,
  totalMessages: 1,
  nextToken: null,
};

describe("LiveChatClient.subscribe (standing §7.1 subscription)", () => {
  afterEach(() => {
    vi.clearAllMocks();
    reset();
  });

  it("registers chat.subscribe, emits the seq-0 snapshot, and unsubscribes on dispose", async () => {
    mockChatSubscribe();
    const client = new LiveChatClient();
    const seen: Array<{ messages: unknown[]; isStreaming: boolean }> = [];
    const off = client.subscribe("agent-1", (t) => seen.push(t));
    await flush();

    expect(mockedRequest).toHaveBeenCalledWith("chat.subscribe", { agentId: "agent-1" });
    snapshotPush("sub-1", 0, SEEDED_SNAPSHOT);

    expect(seen).toHaveLength(1);
    expect(seen[0].messages.map((m) => (m as { id: string }).id)).toEqual(["0190a1b2-user"]);
    expect(seen[0].isStreaming).toBe(false);

    off();
    expect(mockedRequest).toHaveBeenCalledWith("chat.unsubscribe", { subscriptionId: "sub-1" });
  });

  it("derives isStreaming from the snapshot's in-flight message and activity flags", async () => {
    mockChatSubscribe();
    const client = new LiveChatClient();
    const seen: Array<{ isStreaming: boolean }> = [];
    const off = client.subscribe("agent-1", (t) => seen.push(t));
    await flush();

    snapshotPush("sub-1", 0, {
      ...SEEDED_SNAPSHOT,
      messages: [
        ...SEEDED_SNAPSHOT.messages,
        {
          id: "0190a200-asst",
          agentId: "agent-1",
          seq: 1,
          role: "assistant",
          isStreaming: true,
          contentBlocks: [{ type: "text", id: "0190a200-asst:0", text: "Let me check" }],
          timestamp: "2026-06-27T01:00:00.500Z",
        },
      ],
      totalMessages: 2,
      turnInFlight: true,
    });

    expect(seen[0].isStreaming).toBe(true);
    off();
  });

  it("folds added/updated block deltas into the owning message (created on first appearance)", async () => {
    mockChatSubscribe();
    const client = new LiveChatClient();
    const seen: Array<{ messages: unknown[]; isStreaming: boolean }> = [];
    const off = client.subscribe("agent-1", (t) => seen.push(t));
    await flush();
    snapshotPush("sub-1", 0, SEEDED_SNAPSHOT);

    // First chunk: `added` creates the in-flight assistant message.
    deltaPush("sub-1", 1, {
      added: [
        {
          agentId: "agent-1",
          messageId: "0190a200-asst",
          role: "assistant",
          block: { type: "text", id: "0190a200-asst:0", text: "Let me" },
        },
      ],
      updated: [],
      removedIds: [],
    });
    // Growth: `updated` carries the FULL current block.
    deltaPush("sub-1", 2, {
      added: [],
      updated: [
        {
          agentId: "agent-1",
          messageId: "0190a200-asst",
          role: "assistant",
          block: { type: "text", id: "0190a200-asst:0", text: "Let me check the logs first." },
        },
      ],
      removedIds: [],
    });

    const last = seen[seen.length - 1];
    expect(last.messages).toHaveLength(2);
    const asst = last.messages[1] as {
      id: string;
      isStreaming?: boolean;
      contentBlocks: Array<{ id: string; text: string }>;
    };
    expect(asst.id).toBe("0190a200-asst");
    expect(asst.isStreaming).toBe(true);
    expect(asst.contentBlocks).toEqual([
      { type: "text", id: "0190a200-asst:0", text: "Let me check the logs first." },
    ]);
    expect(last.isStreaming).toBe(true);
    off();
  });

  it("applies the terminal reconcile: authoritative fields, orphan removedIds, streaming off", async () => {
    mockChatSubscribe();
    const client = new LiveChatClient();
    const seen: Array<{ messages: unknown[]; isStreaming: boolean }> = [];
    const off = client.subscribe("agent-1", (t) => seen.push(t));
    await flush();
    snapshotPush("sub-1", 0, SEEDED_SNAPSHOT);

    deltaPush("sub-1", 1, {
      added: [
        {
          agentId: "agent-1",
          messageId: "0190a200-asst",
          role: "assistant",
          block: { type: "text", id: "0190a200-asst:0", text: "Working" },
        },
        {
          agentId: "agent-1",
          messageId: "0190a200-asst",
          role: "assistant",
          // A mispredicted tool_result id the persisted message won't contain.
          block: { type: "tool_result", id: "0190a200-asst:2", tool_use_id: "call-1", output: [] },
        },
      ],
      updated: [],
      removedIds: [],
    });
    // Terminal frame after agent:stream:end (§7.1): persisted blocks as
    // `updated` with messageSeq/timestamp/streamingComplete, orphan removed.
    deltaPush("sub-1", 2, {
      added: [],
      updated: [
        {
          agentId: "agent-1",
          messageId: "0190a200-asst",
          role: "assistant",
          messageSeq: 1,
          timestamp: "2026-06-27T01:00:05.000Z",
          streamingComplete: true,
          block: { type: "text", id: "0190a200-asst:0", text: "Working" },
        },
      ],
      removedIds: ["0190a200-asst:2"],
    });

    const last = seen[seen.length - 1];
    const asst = last.messages[1] as {
      isStreaming?: boolean;
      streamingComplete?: boolean;
      seq?: number;
      timestamp: string;
      contentBlocks: Array<{ id: string }>;
    };
    expect(asst.isStreaming).toBe(false);
    expect(asst.streamingComplete).toBe(true);
    expect(asst.seq).toBe(1);
    expect(asst.timestamp).toBe("2026-06-27T01:00:05.000Z");
    expect(asst.contentBlocks.map((b) => b.id)).toEqual(["0190a200-asst:0"]);
    expect(last.isStreaming).toBe(false);
    off();
  });

  it("resnapshots on a sequence gap (unsubscribe + fresh chat.subscribe) and recovers", async () => {
    mockChatSubscribe();
    const client = new LiveChatClient();
    const seen: Array<{ messages: unknown[] }> = [];
    const off = client.subscribe("agent-1", (t) => seen.push(t));
    await flush();
    snapshotPush("sub-1", 0, SEEDED_SNAPSHOT);

    // seq jumps 1 → 3: a gap. The client must self-heal via re-registration.
    deltaPush("sub-1", 3, { added: [], updated: [], removedIds: [] });
    await flush();

    expect(mockedRequest).toHaveBeenCalledWith("chat.unsubscribe", { subscriptionId: "sub-1" });
    expect(mockedRequest.mock.calls.filter(([m]) => m === "chat.subscribe")).toHaveLength(2);

    // Recovery seq-0 snapshot on the fresh registration rebuilds the transcript.
    snapshotPush("sub-2", 0, { ...SEEDED_SNAPSHOT, totalMessages: 3 });
    const last = seen[seen.length - 1] as { totalMessages?: number };
    expect(last.totalMessages).toBe(3);
    off();
  });

  it("ignores stale duplicate deltas without resnapshotting", async () => {
    mockChatSubscribe();
    const client = new LiveChatClient();
    const seen: unknown[] = [];
    const off = client.subscribe("agent-1", (t) => seen.push(t));
    await flush();
    snapshotPush("sub-1", 0, SEEDED_SNAPSHOT);
    deltaPush("sub-1", 1, {
      added: [
        {
          agentId: "agent-1",
          messageId: "0190a200-asst",
          role: "assistant",
          block: { type: "text", id: "0190a200-asst:0", text: "Hi" },
        },
      ],
      updated: [],
      removedIds: [],
    });
    const emitsBefore = seen.length;

    // Re-delivery of seq 1 (already applied): silently ignored — not a gap.
    deltaPush("sub-1", 1, { added: [], updated: [], removedIds: [] });
    await flush();

    expect(seen.length).toBe(emitsBefore);
    expect(mockedRequest.mock.calls.filter(([m]) => m === "chat.subscribe")).toHaveLength(1);
    expect(mockedRequest).not.toHaveBeenCalledWith("chat.unsubscribe", expect.anything());
    off();
  });

  it("buffers pushes that race the subscribe reply and replays them post-ack", async () => {
    // Hold the chat.subscribe reply so the seq-0 push arrives pre-ack.
    let resolveSubscribe: ((r: { subscriptionId: string }) => void) | undefined;
    mockedRequest.mockImplementation((method: string) => {
      if (method === "chat.subscribe") {
        return new Promise((resolve) => {
          resolveSubscribe = resolve as typeof resolveSubscribe;
        });
      }
      return Promise.resolve({});
    });

    const client = new LiveChatClient();
    const seen: Array<{ messages: unknown[] }> = [];
    const off = client.subscribe("agent-1", (t) => seen.push(t));

    // The push lands BEFORE the subscribe reply resolves.
    snapshotPush("sub-early", 0, SEEDED_SNAPSHOT);
    expect(seen).toHaveLength(0);

    resolveSubscribe?.({ subscriptionId: "sub-early" });
    await flush();

    expect(seen).toHaveLength(1);
    expect(seen[0].messages.map((m) => (m as { id: string }).id)).toEqual(["0190a1b2-user"]);
    off();
  });

  it("re-registers on transport reconnect without unsubscribing the dead id", async () => {
    mockChatSubscribe();
    const client = new LiveChatClient();
    const seen: Array<{ messages: unknown[] }> = [];
    const off = client.subscribe("agent-1", (t) => seen.push(t));
    await flush();
    snapshotPush("sub-1", 0, SEEDED_SNAPSHOT);

    emitReconnect();
    await flush();

    // The restarted daemon dropped its registry: no chat.unsubscribe frame
    // for the stale id, just a fresh chat.subscribe.
    expect(mockedRequest).not.toHaveBeenCalledWith("chat.unsubscribe", expect.anything());
    expect(mockedRequest.mock.calls.filter(([m]) => m === "chat.subscribe")).toHaveLength(2);

    // Pushes for the dead id no longer match; the fresh seq-0 reseeds.
    snapshotPush("sub-2", 0, { ...SEEDED_SNAPSHOT, totalMessages: 5 });
    const last = seen[seen.length - 1] as { totalMessages?: number };
    expect(last.totalMessages).toBe(5);
    off();
  });

  it("stops emitting and unsubscribes after dispose", async () => {
    mockChatSubscribe();
    const client = new LiveChatClient();
    const seen: unknown[] = [];
    const off = client.subscribe("agent-1", (t) => seen.push(t));
    await flush();
    snapshotPush("sub-1", 0, SEEDED_SNAPSHOT);
    expect(seen).toHaveLength(1);

    off();
    expect(mockedRequest).toHaveBeenCalledWith("chat.unsubscribe", { subscriptionId: "sub-1" });

    snapshotPush("sub-1", 0, SEEDED_SNAPSHOT);
    deltaPush("sub-1", 1, { added: [], updated: [], removedIds: [] });
    expect(seen).toHaveLength(1);
  });

  it("preserves prior tool_use name/input on a progress-only (empty-name) tick", async () => {
    mockChatSubscribe();
    const client = new LiveChatClient();
    const seen: Array<{ messages: unknown[] }> = [];
    const off = client.subscribe("agent-1", (t) => seen.push(t));
    await flush();
    snapshotPush("sub-1", 0, SEEDED_SNAPSHOT);

    deltaPush("sub-1", 1, {
      added: [
        {
          agentId: "agent-1",
          messageId: "0190a200-asst",
          role: "assistant",
          block: {
            type: "tool_use",
            id: "0190a200-asst:0",
            name: "run_tests",
            input: { suite: "unit" },
            toolCallId: "call-1",
            metadata: { toolKind: "execute", status: "started" },
          },
        },
      ],
      updated: [],
      removedIds: [],
    });
    // Sparse progress tick: the daemon's mapper defaults unset fields.
    deltaPush("sub-1", 2, {
      added: [],
      updated: [
        {
          agentId: "agent-1",
          messageId: "0190a200-asst",
          role: "assistant",
          block: {
            type: "tool_use",
            id: "0190a200-asst:0",
            name: "",
            input: {},
            toolCallId: "call-1",
            metadata: { toolKind: "other", status: "in_progress" },
          },
        },
      ],
      removedIds: [],
    });

    const last = seen[seen.length - 1];
    const asst = last.messages[1] as {
      contentBlocks: Array<{ name?: string; input?: unknown; metadata?: Record<string, unknown> }>;
    };
    expect(asst.contentBlocks[0].name).toBe("run_tests");
    expect(asst.contentBlocks[0].input).toEqual({ suite: "unit" });
    expect(asst.contentBlocks[0].metadata?.toolKind).toBe("execute");
    expect(asst.contentBlocks[0].metadata?.status).toBe("in_progress");
    off();
  });

  it("folds a user-row delta into a new user message and upserts on re-delivery", async () => {
    mockChatSubscribe();
    const client = new LiveChatClient();
    const seen: Array<{ messages: unknown[]; isStreaming: boolean }> = [];
    const off = client.subscribe("agent-1", (t) => seen.push(t));
    await flush();
    snapshotPush("sub-1", 0, SEEDED_SNAPSHOT);

    // A queued user message lands as an `added` row (intentd#747): complete
    // at birth, so it carries messageSeq/timestamp/streamingComplete like a
    // terminal frame.
    const userRow = {
      agentId: "agent-1",
      messageId: "0190a1c0-user2",
      role: "user",
      messageSeq: 1,
      timestamp: "2026-06-27T01:00:02.000Z",
      streamingComplete: true,
      block: { type: "text", id: "0190a1c0-user2:0", text: "Also lint it" },
    };
    deltaPush("sub-1", 1, { added: [userRow], updated: [], removedIds: [] });

    let last = seen[seen.length - 1];
    expect(last.messages).toHaveLength(2);
    const user = last.messages[1] as {
      id: string;
      role: string;
      isStreaming?: boolean;
      seq?: number;
      timestamp: string;
      contentBlocks: Array<{ id: string; text: string }>;
    };
    expect(user.id).toBe("0190a1c0-user2");
    expect(user.role).toBe("user");
    expect(user.isStreaming).toBe(false);
    expect(user.seq).toBe(1);
    expect(user.timestamp).toBe("2026-06-27T01:00:02.000Z");
    expect(user.contentBlocks).toEqual([
      { type: "text", id: "0190a1c0-user2:0", text: "Also lint it" },
    ]);
    // The user-row's streamingComplete is not an assistant terminal — no turn
    // was in flight and none starts, so transcript-level streaming stays off.
    expect(last.isStreaming).toBe(false);

    // Re-delivery of the same row as `updated` upserts (same block id) —
    // never a duplicate message or block (intentd#747 semantics).
    deltaPush("sub-1", 2, { added: [], updated: [userRow], removedIds: [] });
    last = seen[seen.length - 1];
    expect(last.messages).toHaveLength(2);
    const again = last.messages[1] as { contentBlocks: unknown[] };
    expect(again.contentBlocks).toHaveLength(1);
    expect(last.isStreaming).toBe(false);
    off();
  });
});

// ---------------------------------------------------------------------------
// Regression scenarios ported from the deleted firehose suites (monorepo#1127)
// onto the chat.subscribe delta path.
// ---------------------------------------------------------------------------

describe("LiveChatClient.subscribe (ported delta-path regressions)", () => {
  afterEach(() => {
    vi.clearAllMocks();
    reset();
  });

  it("interrupt-send terminal reconcile keeps the partial blocks (§7.2: updated, never removedIds)", async () => {
    // cloudlands-fe#132 / intentd#336: a user interrupt persists the partial
    // assistant row BEFORE agent:stream:end, so the terminal reconcile
    // re-emits the streamed blocks as authoritative `updated` entries — the
    // partial output is never wiped via removedIds.
    mockChatSubscribe();
    const client = new LiveChatClient();
    const seen: Array<{ messages: unknown[]; isStreaming: boolean }> = [];
    const off = client.subscribe("agent-1", (t) => seen.push(t));
    await flush();
    snapshotPush("sub-1", 0, SEEDED_SNAPSHOT);

    // Streamed-so-far partial: text + a completed tool pair.
    deltaPush("sub-1", 1, {
      added: [
        {
          agentId: "agent-1",
          messageId: "0190a200-asst",
          role: "assistant",
          block: { type: "text", id: "0190a200-asst:0", text: "Partial " },
        },
        {
          agentId: "agent-1",
          messageId: "0190a200-asst",
          role: "assistant",
          block: {
            type: "tool_use",
            id: "0190a200-asst:1",
            name: "Read",
            input: { path: "src/lib.rs" },
            toolCallId: "t-int",
            metadata: { toolKind: "read", status: "completed" },
          },
        },
      ],
      updated: [],
      removedIds: [],
    });
    expect(seen[seen.length - 1].isStreaming).toBe(true);

    // Interrupt: the daemon flushed the partial row (§7.2) and the terminal
    // reconcile re-emits every persisted block as `updated` with the
    // authoritative fields. removedIds stays empty — nothing is orphaned.
    deltaPush("sub-1", 2, {
      added: [],
      updated: [
        {
          agentId: "agent-1",
          messageId: "0190a200-asst",
          role: "assistant",
          messageSeq: 1,
          timestamp: "2026-06-27T01:00:03.000Z",
          streamingComplete: true,
          block: { type: "text", id: "0190a200-asst:0", text: "Partial " },
        },
        {
          agentId: "agent-1",
          messageId: "0190a200-asst",
          role: "assistant",
          messageSeq: 1,
          timestamp: "2026-06-27T01:00:03.000Z",
          streamingComplete: true,
          block: {
            type: "tool_use",
            id: "0190a200-asst:1",
            name: "Read",
            input: { path: "src/lib.rs" },
            toolCallId: "t-int",
            metadata: { toolKind: "read", status: "completed" },
          },
        },
      ],
      removedIds: [],
    });

    const last = seen[seen.length - 1];
    const asst = last.messages[1] as {
      isStreaming?: boolean;
      contentBlocks: Array<{ id: string; type: string; text?: string }>;
    };
    // The partial output survives the interrupt — blocks intact, in order.
    expect(asst.contentBlocks.map((b) => b.id)).toEqual(["0190a200-asst:0", "0190a200-asst:1"]);
    expect(asst.contentBlocks[0].text).toBe("Partial ");
    expect(asst.isStreaming).toBe(false);
    expect(last.isStreaming).toBe(false);
    off();
  });

  it("mid-turn rehydration: the seq-0 snapshot's synthetic in-flight assistant continues via deltas without a gap", async () => {
    // Tab switch / app restart mid-turn: the seq-0 snapshot carries the
    // synthetic in-flight assistant message (partial text preserved) and the
    // live delta stream keeps growing the SAME message by block id.
    mockChatSubscribe();
    const client = new LiveChatClient();
    const seen: Array<{ messages: unknown[]; isStreaming: boolean }> = [];
    const off = client.subscribe("agent-1", (t) => seen.push(t));
    await flush();

    snapshotPush("sub-1", 0, {
      ...SEEDED_SNAPSHOT,
      messages: [
        ...SEEDED_SNAPSHOT.messages,
        {
          id: "0190a200-asst",
          agentId: "agent-1",
          seq: 1,
          role: "assistant",
          isStreaming: true,
          contentBlocks: [{ type: "text", id: "0190a200-asst:0", text: "Partial so f" }],
          timestamp: "2026-06-27T01:00:00.500Z",
        },
      ],
      totalMessages: 2,
    });
    expect(seen[0].isStreaming).toBe(true);

    // The next live delta grows the snapshot's in-flight block — same
    // messageId, same block id — with no resnapshot in between.
    deltaPush("sub-1", 1, {
      added: [],
      updated: [
        {
          agentId: "agent-1",
          messageId: "0190a200-asst",
          role: "assistant",
          block: { type: "text", id: "0190a200-asst:0", text: "Partial so far, and more." },
        },
      ],
      removedIds: [],
    });

    const last = seen[seen.length - 1];
    expect(last.messages).toHaveLength(2);
    const asst = last.messages[1] as { contentBlocks: Array<{ text: string }> };
    expect(asst.contentBlocks).toHaveLength(1);
    expect(asst.contentBlocks[0].text).toBe("Partial so far, and more.");
    // No gap was seen: exactly one chat.subscribe registration.
    expect(mockedRequest.mock.calls.filter(([m]) => m === "chat.subscribe")).toHaveLength(1);
    off();
  });

  it("reconnect replay converges (RESUB-1): fresh snapshot + live deltas apply, dead-id pushes are ignored", async () => {
    // cloudlands-fe#15: the daemon restarted and dropped its registry. The
    // client re-registers, the fresh seq-0 snapshot rebuilds, subsequent live
    // deltas apply — and a replayed push for the dead id never writes.
    mockChatSubscribe();
    const client = new LiveChatClient();
    const seen: Array<{ messages: unknown[]; totalMessages?: number }> = [];
    const off = client.subscribe("agent-1", (t) => seen.push(t));
    await flush();
    snapshotPush("sub-1", 0, SEEDED_SNAPSHOT);

    emitReconnect();
    await flush();

    // Fresh registration; the restarted daemon replays a stale-looking push
    // on the DEAD id first — it must be ignored, not resurrect old state.
    const emitsBefore = seen.length;
    deltaPush("sub-1", 1, {
      added: [
        {
          agentId: "agent-1",
          messageId: "ghost-asst",
          role: "assistant",
          block: { type: "text", id: "ghost-asst:0", text: "stale replay" },
        },
      ],
      updated: [],
      removedIds: [],
    });
    expect(seen.length).toBe(emitsBefore);

    // The new registration's seq-0 snapshot converges the transcript…
    snapshotPush("sub-2", 0, { ...SEEDED_SNAPSHOT, totalMessages: 2 });
    // …and live deltas continue on the new id.
    deltaPush("sub-2", 1, {
      added: [
        {
          agentId: "agent-1",
          messageId: "0190a300-asst",
          role: "assistant",
          block: { type: "text", id: "0190a300-asst:0", text: "post-restart turn" },
        },
      ],
      updated: [],
      removedIds: [],
    });

    const last = seen[seen.length - 1];
    const ids = last.messages.map((m) => (m as { id: string }).id);
    expect(ids).toEqual(["0190a1b2-user", "0190a300-asst"]);
    expect(ids).not.toContain("ghost-asst");
    off();
  });

  it("truncation/shrink: a recovery snapshot with fewer messages rebuilds the transcript (agent.replaceMessages)", async () => {
    // Edit/regenerate flows swap the transcript via agent.replaceMessages
    // (#505 baseline-merge lineage). On the delta path the convergence
    // guarantee is the §7.1 invariant: a fresh snapshot REBUILDS the message
    // list — dropped rows are gone, not merged back.
    mockChatSubscribe();
    const client = new LiveChatClient();
    const seen: Array<{ messages: unknown[]; totalMessages?: number }> = [];
    const off = client.subscribe("agent-1", (t) => seen.push(t));
    await flush();
    snapshotPush("sub-1", 0, {
      ...SEEDED_SNAPSHOT,
      messages: [
        ...SEEDED_SNAPSHOT.messages,
        {
          id: "0190a200-asst",
          agentId: "agent-1",
          seq: 1,
          role: "assistant",
          contentBlocks: [{ type: "text", id: "0190a200-asst:0", text: "Old answer" }],
          timestamp: "2026-06-27T01:00:01.000Z",
        },
      ],
      totalMessages: 2,
    });
    expect(seen[0].messages).toHaveLength(2);

    // The swap invalidates the registration's seq stream: a gap triggers the
    // self-heal resnapshot whose fresh page is the truncated transcript.
    deltaPush("sub-1", 5, { added: [], updated: [], removedIds: [] });
    await flush();
    snapshotPush("sub-2", 0, SEEDED_SNAPSHOT);

    const last = seen[seen.length - 1];
    expect(last.messages.map((m) => (m as { id: string }).id)).toEqual(["0190a1b2-user"]);
    expect(last.totalMessages).toBe(1);
    off();
  });

  it("renders daemon-synthesized standalone resource blocks verbatim (proposal + turn-end question, §7.1)", async () => {
    // The FE lift is gone — the daemon synthesizes the standalone
    // proposal-resource block (after the tool_result) and drains AtTurnEnd
    // question blocks into the terminal reconcile as `added`. Both must ride
    // through the reconciler byte-faithfully.
    mockChatSubscribe();
    const client = new LiveChatClient();
    const seen: Array<{ messages: unknown[] }> = [];
    const off = client.subscribe("agent-1", (t) => seen.push(t));
    await flush();
    snapshotPush("sub-1", 0, SEEDED_SNAPSHOT);

    const proposalResource = {
      type: "resource",
      id: "0190a200-asst:2",
      resource: {
        uri: "intent-proposal://plan/abc",
        name: "Plan proposal",
        mimeType: "application/vnd.intent.proposal+json",
        text: '{"kind":"plan","preview":{"title":"Plan proposal"},"payload":{}}',
      },
    };
    deltaPush("sub-1", 1, {
      added: [
        {
          agentId: "agent-1",
          messageId: "0190a200-asst",
          role: "assistant",
          block: {
            type: "tool_result",
            id: "0190a200-asst:1",
            tool_use_id: "call-1",
            output: [],
            is_error: false,
          },
        },
        // Standalone proposal block, appended by the daemon's tool_delta.
        { agentId: "agent-1", messageId: "0190a200-asst", role: "assistant", block: proposalResource },
      ],
      updated: [],
      removedIds: [],
    });

    // Terminal reconcile: the AtTurnEnd question block arrives as `added`
    // (never seen live — questions are drained at turn finalization).
    const questionResource = {
      type: "resource",
      id: "0190a200-asst:3",
      resource: {
        uri: "intent-question://tar-3f9c2a81d0b4",
        name: "Auth method",
        mimeType: "application/vnd.intent.question+json",
        text: '{"attachmentId":"tar-3f9c2a81d0b4","header":"Auth method","question":"Which auth?","options":[{"label":"OAuth"},{"label":"API key"}],"multiSelect":false}',
      },
    };
    deltaPush("sub-1", 2, {
      added: [
        {
          agentId: "agent-1",
          messageId: "0190a200-asst",
          role: "assistant",
          messageSeq: 1,
          timestamp: "2026-06-27T01:00:05.000Z",
          streamingComplete: true,
          block: questionResource,
        },
      ],
      updated: [],
      removedIds: [],
    });

    const last = seen[seen.length - 1];
    const asst = last.messages[1] as { contentBlocks: Array<Record<string, unknown>> };
    // Faithful rendering pin: the daemon-synthesized blocks are stored
    // verbatim — no FE healing, renaming, or re-derivation.
    expect(asst.contentBlocks[1]).toEqual(proposalResource);
    expect(asst.contentBlocks[2]).toEqual(questionResource);
    off();
  });

  it("fan-out isolation: a delta on a foreign agent's subscription never mutates the viewed transcript", async () => {
    mockChatSubscribe();
    const client = new LiveChatClient();
    const seenA: Array<{ messages: unknown[] }> = [];
    const seenB: Array<{ messages: unknown[] }> = [];
    const offA = client.subscribe("agent-1", (t) => seenA.push(t));
    await flush();
    const offB = client.subscribe("agent-2", (t) => seenB.push(t));
    await flush();

    snapshotPush("sub-1", 0, SEEDED_SNAPSHOT);
    snapshotPush("sub-2", 0, { agentId: "agent-2", messages: [], truncated: false, totalMessages: 0 });

    // A turn streams on agent-2's subscription only.
    deltaPush("sub-2", 1, {
      added: [
        {
          agentId: "agent-2",
          messageId: "0190b100-asst",
          role: "assistant",
          block: { type: "text", id: "0190b100-asst:0", text: "foreign turn" },
        },
      ],
      updated: [],
      removedIds: [],
    });

    // agent-1's transcript is untouched — no emit past its snapshot, no
    // foreign message bleed-through.
    expect(seenA).toHaveLength(1);
    expect(seenA[0].messages.map((m) => (m as { id: string }).id)).toEqual(["0190a1b2-user"]);
    // agent-2's transcript got exactly the foreign turn.
    const lastB = seenB[seenB.length - 1];
    expect(lastB.messages.map((m) => (m as { id: string }).id)).toEqual(["0190b100-asst"]);
    offA();
    offB();
  });
});
