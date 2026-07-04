import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentStatus } from "$shared/types/agent.types";
import type { AgentMessage, AgentSession } from "$shared/types";

// Fake the live backend transport so the bridge installs against in-memory
// fakes (no Electron). `vi.hoisted` keeps the spies visible to the hoisted
// vi.mock factory.
const { onBackendNotificationSpy, backendRequestSpy, capturedHandlers } = vi.hoisted(() => ({
  onBackendNotificationSpy: vi.fn(),
  backendRequestSpy: vi.fn(),
  capturedHandlers: [] as Array<(n: { method: string; params?: unknown }) => void>,
}));
vi.mock("$lib/client/live/backend-transport", () => ({
  onBackendNotification: (handler: (n: { method: string; params?: unknown }) => void) => {
    onBackendNotificationSpy(handler);
    capturedHandlers.push(handler);
    return () => {
      const idx = capturedHandlers.indexOf(handler);
      if (idx >= 0) capturedHandlers.splice(idx, 1);
    };
  },
  backendRequest: (method: string, params?: unknown) => {
    backendRequestSpy(method, params);
    return Promise.resolve({ subscriptionId: "sub-1" });
  },
}));

import { store as appStore } from "$store/renderer/store";
import {
  bulkUpsertSessions,
  clearAllSessions,
  setAgentStreaming,
} from "$store/renderer/slices/agent-session/agent-session-slice";
import { selectAgentIsResponding } from "$store/renderer/slices/agent-session/agent-session-selectors";
import { __resetDaemonEventsBridgeForTests } from "$features/events/daemon-events-bridge";
import { chatReset } from "$store/renderer/slices/chat-state/chat-state-slice";
import type { StatusEvent } from "$store/renderer/slices/chat-state/chat-state-types";
import {
  clearAgentQueue,
  removeQueuedMessageFromAgentQueue,
} from "$store/renderer/slices/agent-queue/agent-queue-slice";
import { selectAgentQueueMessages } from "$store/renderer/slices/agent-queue/agent-queue-selectors";
import type { QueuedMessage } from "$shared/types";
import { addMockIpcListener, resetMockIpcRouter } from "$shared/ipc-mock-router";

function readStatusEvents(): StatusEvent[] {
  const state = appStore.state as {
    chatState?: { byAgentId: Record<string, { statusEvents: StatusEvent[] }> };
  };
  return state.chatState?.byAgentId[AGENT]?.statusEvents ?? [];
}

const MESSAGE_ID = "msg_assistant_1";
const STREAM_ID = "stream_1";

/** Build a PROTOCOL §6.3 `events.event` notification envelope. */
function notification(eventType: string, data: Record<string, unknown>) {
  return {
    method: "events.event" as const,
    params: {
      event: {
        id: `evt-${eventType}-${Math.random().toString(36).slice(2, 8)}`,
        workspaceId: WS,
        timestamp: "2026-01-02T00:00:00.000Z",
        type: eventType,
        actor: { type: "agent", id: AGENT },
        data,
      },
    },
  };
}

/**
 * Variant carrying the wire-level `params.subscriptionId` the daemon attaches
 * when fanning a domain event out per matching subscription (PROTOCOL §6.3 /
 * intent-transport `build_event_notification`). Used to exercise the bridge's
 * fan-out scope gate.
 */
function notificationWithSub(
  eventType: string,
  data: Record<string, unknown>,
  subscriptionId: string,
) {
  const base = notification(eventType, data);
  return {
    method: base.method,
    params: { ...base.params, subscriptionId },
  };
}

function readSession(): AgentSession | undefined {
  const state = appStore.state as {
    agentSessions?: { byAgentId: Record<string, AgentSession> };
  };
  return state.agentSessions?.byAgentId[AGENT];
}

function readAssistantMessages(): AgentMessage[] {
  return (readSession()?.messages ?? []).filter((m) => m.role === "assistant");
}

const WS = "ws-bridge-1";
const AGENT = "agent-bridge-1";
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function seedSession(overrides: Partial<AgentSession> = {}): void {
  appStore.dispatch(
    bulkUpsertSessions([
      {
        id: AGENT,
        backendSessionId: "backend-1",
        workspaceId: WS,
        name: "A",
        status: AgentStatus.Pending,
        messages: [],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        ...overrides,
      } as AgentSession,
    ]),
  );
}

/** Trigger the bridge to install — middleware runs lazily on first dispatch. */
async function primeBridge(): Promise<void> {
  // setAgentStreaming(false) is a harmless action that runs through the
  // configured middleware chain and triggers the bridge's lazy install.
  appStore.dispatch(setAgentStreaming(AGENT, false));
  // installSubscriptionOnce is async; let the microtask settle.
  await flush();
}

describe("daemonEventsBridge (wire contract — agent:idle clears the spinner)", () => {
  beforeAll(() => {
    appStore.init();
  });

  beforeEach(async () => {
    appStore.dispatch(clearAllSessions());
    onBackendNotificationSpy.mockClear();
    backendRequestSpy.mockClear();
    __resetDaemonEventsBridgeForTests();
    capturedHandlers.length = 0;
    seedSession();
  });

  afterEach(() => vi.clearAllMocks());

  it("registers a notification listener and subscribes to agent:* + activity-timeline + settings/usage + legacy-relay families on first dispatch", async () => {
    await primeBridge();

    expect(onBackendNotificationSpy).toHaveBeenCalledTimes(1);
    // The settings-hydration middleware also fires `settings.list` lazily, so
    // we assert the bridge's events.subscribe call explicitly instead of the
    // total spy count.
    expect(backendRequestSpy).toHaveBeenCalledWith("events.subscribe", {
      eventTypes: [
        "agent:*",
        "file:*",
        "note:*",
        "comment:*",
        "script:*",
        "settings:changed",
        "workspace:tokenUsage-changed",
        "workspace:updated",
        "task:ready-tasks-changed",
        "changes:git-status",
        "changes:tracked",
        "pr:*",
      ],
    });
  });

  it("agent:idle notification flips selectAgentIsResponding from true → false", async () => {
    // Optimistic chatSendStarted-style flag: the FE reducer marks isStreaming
    // true while the user message is being sent.
    seedSession({ isStreaming: true, status: AgentStatus.Active });
    expect(selectAgentIsResponding.select(appStore.state, AGENT)).toBe(true);

    await primeBridge();
    const handler = capturedHandlers[0];
    expect(handler).toBeTypeOf("function");

    // PROTOCOL §7 notification envelope: `events.event` with the WorkspaceEvent
    // nested in `params.event`. The bridge must extract `params.event` and
    // dispatch eventReceived(workspaceId, event) — that drives the
    // agentSession reducer's canonicalFieldsFromWorkspaceEvent path which
    // clears isStreaming/isProcessing/isResponding and sets status='idle'.
    handler!({
      method: "events.event",
      params: {
        event: {
          id: "evt-1",
          workspaceId: WS,
          timestamp: "2026-01-02T00:00:00.000Z",
          type: "agent:idle",
          actor: { type: "agent", id: AGENT },
          data: { agentId: AGENT, status: "idle", isActive: false },
        },
      },
    });

    expect(selectAgentIsResponding.select(appStore.state, AGENT)).toBe(false);
  });

  it("ignores non-events.event methods, and forwards non-lifecycle events.event notifications into workspaceEvents without changing agent-session flags", async () => {
    seedSession({ isStreaming: true, status: AgentStatus.Active });
    await primeBridge();
    const handler = capturedHandlers[0]!;

    // Unrelated method — no-op.
    handler({ method: "agent.stream:chunk", params: { agentId: AGENT } });
    expect(selectAgentIsResponding.select(appStore.state, AGENT)).toBe(true);

    // events.event carrying a non-lifecycle domain event — still stored in the
    // workspaceEvents buffer (activity timeline) but never flips the
    // agent-session isResponding flag, which is owned by the lifecycle subset.
    handler({
      method: "events.event",
      params: {
        event: {
          id: "evt-2",
          workspaceId: WS,
          timestamp: "2026-01-02T00:00:00.000Z",
          type: "note:updated",
          actor: { type: "system" },
          data: { agentId: AGENT },
        },
      },
    });
    expect(selectAgentIsResponding.select(appStore.state, AGENT)).toBe(true);
    const state = appStore.state as {
      workspaceEvents: { byWorkspaceId: Record<string, { events: Array<{ id: string }> }> };
    };
    expect(state.workspaceEvents.byWorkspaceId[WS]?.events.map((event) => event.id)).toContain(
      "evt-2",
    );
  });

  it("drops events without a workspaceId rather than guessing", async () => {
    seedSession({ isStreaming: true, status: AgentStatus.Active });
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler({
      method: "events.event",
      params: {
        event: {
          id: "evt-3",
          timestamp: "2026-01-02T00:00:00.000Z",
          type: "agent:idle",
          actor: { type: "agent", id: AGENT },
          data: { agentId: AGENT, status: "idle" },
        },
      },
    });
    expect(selectAgentIsResponding.select(appStore.state, AGENT)).toBe(true);
  });

  it("routes settings:changed (workspace-less) through applySettingsChanges into the mcp-settings slice", async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler({
      method: "events.event",
      params: {
        event: {
          id: "evt-set-1",
          timestamp: "2026-01-02T00:00:00.000Z",
          type: "settings:changed",
          actor: { type: "system" },
          data: {
            changes: [
              { path: "mcp.enableUserServers", value: true },
            ],
          },
        },
      },
    });

    const state = appStore.state as { mcpSettings: { enabled: boolean } };
    expect(state.mcpSettings.enabled).toBe(true);
  });
});

describe("daemonEventsBridge (live stream wire contract — agent:stream:* → transcript)", () => {
  beforeAll(() => {
    appStore.init();
  });

  beforeEach(async () => {
    appStore.dispatch(clearAllSessions());
    appStore.dispatch(chatReset(AGENT));
    onBackendNotificationSpy.mockClear();
    backendRequestSpy.mockClear();
    __resetDaemonEventsBridgeForTests();
    capturedHandlers.length = 0;
    seedSession({ isStreaming: true, status: AgentStatus.Active });
  });

  afterEach(() => vi.clearAllMocks());

  it("accumulates agent:stream:chunk into a live assistant message and finalizes on stream:end + idle", async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    // Two consecutive text chunks at the same blockIndex must coalesce into a
    // single text block, mirroring the BE's Transcript.push_text behaviour.
    handler(
      notification("agent:stream:chunk", {
        agentId: AGENT,
        content: "Hello ",
        messageId: MESSAGE_ID,
        blockIndex: 0,
        blockId: `${MESSAGE_ID}:0`,
        blockType: "text",
        streamId: STREAM_ID,
      }),
    );

    let assistantMessages = readAssistantMessages();
    expect(assistantMessages).toHaveLength(1);
    expect(assistantMessages[0].id).toBe(MESSAGE_ID);
    expect(assistantMessages[0].isStreaming).toBe(true);
    expect(assistantMessages[0].contentBlocks?.[0]).toMatchObject({
      type: "text",
      text: "Hello ",
    });

    handler(
      notification("agent:stream:chunk", {
        agentId: AGENT,
        content: "world",
        messageId: MESSAGE_ID,
        blockIndex: 0,
        blockId: `${MESSAGE_ID}:0`,
        blockType: "text",
        streamId: STREAM_ID,
      }),
    );

    assistantMessages = readAssistantMessages();
    expect(assistantMessages).toHaveLength(1);
    expect(assistantMessages[0].contentBlocks?.[0]).toMatchObject({
      type: "text",
      text: "Hello world",
    });
    expect(selectAgentIsResponding.select(appStore.state, AGENT)).toBe(true);

    handler(
      notification("agent:stream:end", { agentId: AGENT, streamId: STREAM_ID }),
    );

    assistantMessages = readAssistantMessages();
    expect(assistantMessages).toHaveLength(1);
    expect(assistantMessages[0].isStreaming).toBe(false);
    expect(assistantMessages[0].streamingComplete).toBe(true);

    handler(
      notification("agent:idle", {
        agentId: AGENT,
        status: "idle",
        isActive: false,
        reason: "stream_complete",
        finishReason: "stop",
      }),
    );

    expect(selectAgentIsResponding.select(appStore.state, AGENT)).toBe(false);
  });

  it("renders agent:tool:call as tool_use + tool_result blocks after the tool completes", async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler(
      notification("agent:stream:chunk", {
        agentId: AGENT,
        content: "Looking",
        messageId: MESSAGE_ID,
        blockIndex: 0,
        blockId: `${MESSAGE_ID}:0`,
        blockType: "text",
        streamId: STREAM_ID,
      }),
    );
    handler(
      notification("agent:tool:call", {
        agentId: AGENT,
        toolName: "Read",
        toolKind: "file",
        toolCallId: "t1",
        input: { path: "src/lib.rs" },
        status: "started",
        messageId: MESSAGE_ID,
        blockIndex: 1,
        blockId: `${MESSAGE_ID}:1`,
      }),
    );

    let blocks = readAssistantMessages()[0]?.contentBlocks ?? [];
    expect(blocks.map((b) => b.type)).toEqual(["text", "tool_use"]);
    expect(blocks[1]).toMatchObject({
      type: "tool_use",
      toolCallId: "t1",
      name: "Read",
    });

    handler(
      notification("agent:tool:call", {
        agentId: AGENT,
        toolName: "Read",
        toolKind: "file",
        toolCallId: "t1",
        input: { path: "src/lib.rs" },
        status: "completed",
        output: "ok",
        messageId: MESSAGE_ID,
        blockIndex: 1,
        blockId: `${MESSAGE_ID}:1`,
      }),
    );

    blocks = readAssistantMessages()[0]?.contentBlocks ?? [];
    expect(blocks.map((b) => b.type)).toEqual(["text", "tool_use", "tool_result"]);
    expect(blocks[2]).toMatchObject({ type: "tool_result", tool_use_id: "t1", output: "ok" });

    handler(
      notification("agent:stream:end", { agentId: AGENT, streamId: STREAM_ID }),
    );
    handler(
      notification("agent:idle", {
        agentId: AGENT,
        status: "idle",
        isActive: false,
        reason: "stream_complete",
      }),
    );

    expect(readAssistantMessages()[0]?.isStreaming).toBe(false);
    expect(selectAgentIsResponding.select(appStore.state, AGENT)).toBe(false);
  });

  it("does not duplicate the assistant message when getConversation hydration follows the live stream", async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler(
      notification("agent:stream:chunk", {
        agentId: AGENT,
        content: "Done.",
        messageId: MESSAGE_ID,
        blockIndex: 0,
        blockId: `${MESSAGE_ID}:0`,
        blockType: "text",
        streamId: STREAM_ID,
      }),
    );
    handler(
      notification("agent:stream:end", { agentId: AGENT, streamId: STREAM_ID }),
    );
    handler(
      notification("agent:idle", {
        agentId: AGENT,
        status: "idle",
        isActive: false,
        reason: "stream_complete",
      }),
    );

    // Simulate the chat-read-service.getConversation hydration: a session
    // upsert carrying the BE-canonical assistant message with the same id.
    const session = readSession();
    expect(session).toBeDefined();
    appStore.dispatch(
      bulkUpsertSessions([
        {
          ...session!,
          messages: [
            ...(session!.messages ?? []).filter((m) => m.role !== "assistant"),
            {
              id: MESSAGE_ID,
              role: "assistant",
              contentBlocks: [{ type: "text", text: "Done." }],
              timestamp: "2026-01-02T00:00:00.001Z",
            } as AgentMessage,
          ],
        },
      ]),
    );

    expect(readAssistantMessages()).toHaveLength(1);
    expect(readAssistantMessages()[0].id).toBe(MESSAGE_ID);
  });

  it("agent:failed finalizes the in-flight stream and clears the spinner", async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler(
      notification("agent:stream:chunk", {
        agentId: AGENT,
        content: "Working",
        messageId: MESSAGE_ID,
        blockIndex: 0,
        blockId: `${MESSAGE_ID}:0`,
        blockType: "text",
        streamId: STREAM_ID,
      }),
    );
    handler(
      notification("agent:failed", {
        agentId: AGENT,
        error: "boom",
        status: "failed",
        isActive: false,
      }),
    );

    const assistant = readAssistantMessages()[0];
    expect(assistant).toBeDefined();
    expect(assistant.isStreaming).toBe(false);
    expect(assistant.streamingComplete).toBe(true);
    expect(selectAgentIsResponding.select(appStore.state, AGENT)).toBe(false);
  });

  it("emits status hint transitions: 'Streaming response…' on first chunk → 'Calling tool' on tool:call → cleared on stream:end/idle", async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    // First text chunk arms the "Streaming response…" status entry via the
    // chunk reducer (no explicit dispatch needed from the bridge).
    handler(
      notification("agent:stream:chunk", {
        agentId: AGENT,
        content: "Looking",
        messageId: MESSAGE_ID,
        blockIndex: 0,
        blockId: `${MESSAGE_ID}:0`,
        blockType: "text",
        streamId: STREAM_ID,
      }),
    );

    let events = readStatusEvents();
    expect(events.map((e) => ({ phase: e.phase, message: e.message }))).toEqual([
      { phase: "streaming", message: "Streaming response…" },
    ]);

    // tool:call (started) → "Calling tool" entry, resetting receivedFirstChunk
    // so the next text chunk re-arms the streaming hint.
    handler(
      notification("agent:tool:call", {
        agentId: AGENT,
        toolName: "Read",
        toolKind: "file",
        toolCallId: "t1",
        input: { path: "src/lib.rs" },
        status: "started",
        messageId: MESSAGE_ID,
        blockIndex: 1,
        blockId: `${MESSAGE_ID}:1`,
      }),
    );

    events = readStatusEvents();
    expect(events.map((e) => ({ phase: e.phase, message: e.message }))).toEqual([
      { phase: "streaming", message: "Streaming response…" },
      { phase: "tool-call", message: "Calling tool" },
    ]);

    // tool:call (completed) does NOT append a second status entry — the hint
    // returns to "Streaming response…" when the next text chunk arrives.
    handler(
      notification("agent:tool:call", {
        agentId: AGENT,
        toolName: "Read",
        toolKind: "file",
        toolCallId: "t1",
        input: { path: "src/lib.rs" },
        status: "completed",
        output: "ok",
        messageId: MESSAGE_ID,
        blockIndex: 1,
        blockId: `${MESSAGE_ID}:1`,
      }),
    );
    expect(readStatusEvents()).toHaveLength(2);

    handler(
      notification("agent:stream:chunk", {
        agentId: AGENT,
        content: "Done.",
        messageId: MESSAGE_ID,
        blockIndex: 2,
        blockId: `${MESSAGE_ID}:2`,
        blockType: "text",
        streamId: STREAM_ID,
      }),
    );

    events = readStatusEvents();
    expect(events.map((e) => ({ phase: e.phase, message: e.message }))).toEqual([
      { phase: "streaming", message: "Streaming response…" },
      { phase: "tool-call", message: "Calling tool" },
      { phase: "streaming", message: "Streaming response…" },
    ]);

    // Terminal: stream:end clears the status hints; subsequent agent:idle is
    // a no-op for statusEvents (already cleared).
    handler(
      notification("agent:stream:end", { agentId: AGENT, streamId: STREAM_ID }),
    );
    expect(readStatusEvents()).toEqual([]);

    handler(
      notification("agent:idle", {
        agentId: AGENT,
        status: "idle",
        isActive: false,
        reason: "stream_complete",
      }),
    );
    expect(readStatusEvents()).toEqual([]);
  });
});

describe("daemonEventsBridge (queue wire contract — agent:queue:updated → replaceAgentQueue)", () => {
  beforeAll(() => {
    appStore.init();
  });

  beforeEach(async () => {
    appStore.dispatch(clearAllSessions());
    appStore.dispatch(clearAgentQueue(AGENT));
    onBackendNotificationSpy.mockClear();
    backendRequestSpy.mockClear();
    __resetDaemonEventsBridgeForTests();
    capturedHandlers.length = 0;
    seedSession();
  });

  afterEach(() => vi.clearAllMocks());

  it("renders the BE queue snapshot from a PROTOCOL §5.5 agent:queue:updated payload", async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    const queue: QueuedMessage[] = [
      { id: "q-1", content: "first", queuedAt: "2026-01-02T00:00:01.000Z", position: 0 },
      { id: "q-2", content: "second", queuedAt: "2026-01-02T00:00:02.000Z", position: 1 },
    ];

    handler(notification("agent:queue:updated", { agentId: AGENT, queue }));

    expect(
      selectAgentQueueMessages.select(appStore.state, AGENT).map((m) => ({
        id: m.id,
        position: m.position,
      })),
    ).toEqual([
      { id: "q-1", position: 0 },
      { id: "q-2", position: 1 },
    ]);
  });

  it("replaces the local queue when a follow-up agent:queue:updated arrives (read-through view)", async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler(
      notification("agent:queue:updated", {
        agentId: AGENT,
        queue: [
          { id: "q-1", content: "first", queuedAt: "2026-01-02T00:00:01.000Z", position: 0 },
        ],
      }),
    );
    handler(
      notification("agent:queue:updated", {
        agentId: AGENT,
        queue: [
          { id: "q-2", content: "second", queuedAt: "2026-01-02T00:00:02.000Z", position: 0 },
        ],
      }),
    );

    expect(
      selectAgentQueueMessages.select(appStore.state, AGENT).map((m) => m.id),
    ).toEqual(["q-2"]);
  });

  it("suppresses a recently-removed message when a stale agent:queue:updated snapshot still carries it", async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    // Simulate the optimistic delete the queue-mutation handler performs
    // before the BE catches up — this writes a tombstone for "q-1".
    appStore.dispatch(removeQueuedMessageFromAgentQueue(AGENT, "q-1"));

    // BE has not yet self-drained, so its next snapshot still includes q-1.
    handler(
      notification("agent:queue:updated", {
        agentId: AGENT,
        queue: [
          { id: "q-1", content: "first", queuedAt: "2026-01-02T00:00:01.000Z", position: 0 },
          { id: "q-2", content: "second", queuedAt: "2026-01-02T00:00:02.000Z", position: 1 },
        ],
      }),
    );

    // The tombstone must hold — q-1 stays hidden, q-2 surfaces at position 0.
    expect(
      selectAgentQueueMessages.select(appStore.state, AGENT).map((m) => ({
        id: m.id,
        position: m.position,
      })),
    ).toEqual([{ id: "q-2", position: 0 }]);
  });

  it("ignores agent:queue:updated payloads without a queue array (FE never invents data)", async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    // Seed a known good snapshot first so we can verify the malformed one is a no-op.
    handler(
      notification("agent:queue:updated", {
        agentId: AGENT,
        queue: [
          { id: "q-1", content: "first", queuedAt: "2026-01-02T00:00:01.000Z", position: 0 },
        ],
      }),
    );
    handler(notification("agent:queue:updated", { agentId: AGENT, queue: undefined }));

    expect(
      selectAgentQueueMessages.select(appStore.state, AGENT).map((m) => m.id),
    ).toEqual(["q-1"]);
  });
});


describe("daemonEventsBridge (fan-out scope gate — subscriptionId-aware delivery)", () => {
  beforeAll(() => {
    appStore.init();
  });

  beforeEach(async () => {
    appStore.dispatch(clearAllSessions());
    appStore.dispatch(chatReset(AGENT));
    onBackendNotificationSpy.mockClear();
    backendRequestSpy.mockClear();
    __resetDaemonEventsBridgeForTests();
    capturedHandlers.length = 0;
    seedSession({ isStreaming: true, status: AgentStatus.Active });
  });

  afterEach(() => vi.clearAllMocks());

  it("applies a chunk exactly once when the daemon fans the same chunk out across N subscriptions on the socket", async () => {
    // Mock backendRequest resolves events.subscribe with `{ subscriptionId: "sub-1" }`
    // (top-of-file vi.mock factory). That id is the bridge's own subscription.
    // The daemon emits ONE `events.event` notification per matching subscription
    // on the socket (PROTOCOL §6.3 / intent-transport `build_event_notification`),
    // each carrying that subscription's id. If another live-* client subscribes
    // to an overlapping `agent:*` filter, the chunk is delivered three times to
    // the socket-level notification handler — once tagged "sub-1" (ours), once
    // "sub-foreign-a", once "sub-foreign-b". Without the scope gate the bridge
    // would `priorText + content` three times and echo as "TodayTodayToday" —
    // the symptom this fix targets.
    await primeBridge();
    const handler = capturedHandlers[0]!;

    const data = {
      agentId: AGENT,
      content: "Today",
      messageId: MESSAGE_ID,
      blockIndex: 0,
      blockId: `${MESSAGE_ID}:0`,
      blockType: "text",
      streamId: STREAM_ID,
    };

    handler(notificationWithSub("agent:stream:chunk", data, "sub-1"));
    handler(notificationWithSub("agent:stream:chunk", data, "sub-foreign-a"));
    handler(notificationWithSub("agent:stream:chunk", data, "sub-foreign-b"));

    const assistantMessages = readAssistantMessages();
    expect(assistantMessages).toHaveLength(1);
    expect(assistantMessages[0].contentBlocks?.[0]).toMatchObject({
      type: "text",
      text: "Today",
    });
  });

  it("drops a notification whose envelope subscriptionId does not match the bridge's own", async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    // Foreign subscription on the same socket — another consumer's overlapping
    // `agent:*` subscribe. The bridge must NOT append text from these copies.
    handler(
      notificationWithSub(
        "agent:stream:chunk",
        {
          agentId: AGENT,
          content: "leaked",
          messageId: MESSAGE_ID,
          blockIndex: 0,
          blockId: `${MESSAGE_ID}:0`,
          blockType: "text",
          streamId: STREAM_ID,
        },
        "sub-foreign",
      ),
    );

    expect(readAssistantMessages()).toHaveLength(0);
  });

  it("still applies legacy/flat envelopes with no subscriptionId (back-compat)", async () => {
    await primeBridge();
    const handler = capturedHandlers[0]!;

    // No `params.subscriptionId` on the envelope — older transports / tests
    // never tagged the wire copy. Must continue to apply.
    handler(
      notification("agent:stream:chunk", {
        agentId: AGENT,
        content: "Legacy ok",
        messageId: MESSAGE_ID,
        blockIndex: 0,
        blockId: `${MESSAGE_ID}:0`,
        blockType: "text",
        streamId: STREAM_ID,
      }),
    );

    const assistantMessages = readAssistantMessages();
    expect(assistantMessages).toHaveLength(1);
    expect(assistantMessages[0].contentBlocks?.[0]).toMatchObject({
      type: "text",
      text: "Legacy ok",
    });
  });

  it("install is idempotent — repeated primeBridge dispatches register one notification listener and one events.subscribe call", async () => {
    await primeBridge();
    await primeBridge();
    await primeBridge();

    expect(onBackendNotificationSpy).toHaveBeenCalledTimes(1);
    const subscribeCalls = backendRequestSpy.mock.calls.filter(
      ([method]) => method === "events.subscribe",
    );
    expect(subscribeCalls).toHaveLength(1);
    expect(subscribeCalls[0][1]).toEqual({
      eventTypes: [
        "agent:*",
        "file:*",
        "note:*",
        "comment:*",
        "script:*",
        "settings:changed",
        "workspace:tokenUsage-changed",
        "workspace:updated",
        "task:ready-tasks-changed",
        "changes:git-status",
        "changes:tracked",
        "pr:*",
      ],
    });
  });
});

describe("daemonEventsBridge (usage wire contract — workspace:tokenUsage-changed → tokenUsage slice)", () => {
  beforeAll(() => {
    appStore.init();
  });

  beforeEach(async () => {
    onBackendNotificationSpy.mockClear();
    backendRequestSpy.mockClear();
    __resetDaemonEventsBridgeForTests();
    capturedHandlers.length = 0;
  });

  afterEach(() => vi.clearAllMocks());

  it("mirrors the pushed §5.23 TokenUsage rollup into the tokenUsage slice", async () => {
    await primeBridge();
    const handler = capturedHandlers[0];
    expect(handler).toBeTypeOf("function");

    // PROTOCOL §6.5: data = { workspaceId, tokenUsage } (self-sufficient §6.7).
    const tokenUsage = {
      byAgentId: {
        "agent-123": { inputTokens: 12000, outputTokens: 3400, cacheReadTokens: 8000, cacheCreationTokens: 1200 },
      },
      byModel: {
        "opus-4.8": { inputTokens: 12000, outputTokens: 3400, cacheReadTokens: 8000, cacheCreationTokens: 1200 },
      },
      totals: { inputTokens: 12000, outputTokens: 3400, cacheReadTokens: 8000, cacheCreationTokens: 1200 },
      lastScanAt: "2026-06-17T12:00:00Z",
    };
    handler!(
      notification("workspace:tokenUsage-changed", { workspaceId: WS, tokenUsage }),
    );

    const state = appStore.state as {
      tokenUsage: { byWorkspaceId: Record<string, unknown> };
    };
    expect(state.tokenUsage.byWorkspaceId[WS]).toEqual({
      ...tokenUsage,
      isStale: false,
    });
  });

  it("ignores a push without a tokenUsage object", async () => {
    await primeBridge();
    const handler = capturedHandlers[0];

    handler!(notification("workspace:tokenUsage-changed", { workspaceId: "ws-token-empty" }));

    const state = appStore.state as {
      tokenUsage: { byWorkspaceId: Record<string, unknown> };
    };
    expect(state.tokenUsage.byWorkspaceId["ws-token-empty"]).toBeUndefined();
  });
});

describe("daemonEventsBridge (legacy mock-IPC relay — daemon events → listenSync channels)", () => {
  beforeAll(() => {
    appStore.init();
  });

  beforeEach(async () => {
    onBackendNotificationSpy.mockClear();
    backendRequestSpy.mockClear();
    __resetDaemonEventsBridgeForTests();
    resetMockIpcRouter();
    capturedHandlers.length = 0;
  });

  afterEach(() => {
    resetMockIpcRouter();
    vi.clearAllMocks();
  });

  /** Register a mock-IPC listener and return the payloads it receives. */
  function listenOn(channel: string): unknown[] {
    const seen: unknown[] = [];
    addMockIpcListener(channel, (payload) => seen.push(payload));
    return seen;
  }

  it("re-emits task:ready-tasks-changed with the §5.4 TS-parity envelope (workspaceId + data.readyTaskIds)", async () => {
    await primeBridge();
    const seen = listenOn("task:ready-tasks-changed");

    const data = {
      readyTaskIds: ["note-1", "note-2"],
      triggeredBy: { noteId: "note-3", previousStatus: "in_progress", newStatus: "complete" },
      computedAt: "2026-01-02T00:00:00.000Z",
    };
    capturedHandlers[0]!(notification("task:ready-tasks-changed", data));

    expect(seen).toHaveLength(1);
    // The listener (WorkspaceProgressCard) reads payload.workspaceId and
    // payload.data.readyTaskIds — the daemon event envelope carries both.
    expect(seen[0]).toMatchObject({ workspaceId: WS, data });
  });

  it("re-emits changes:git-status as git:status-changed { workspaceId }", async () => {
    await primeBridge();
    const seen = listenOn("git:status-changed");

    capturedHandlers[0]!(
      notification("changes:git-status", { workspaceId: WS, status: { files: [] } }),
    );

    expect(seen).toEqual([{ workspaceId: WS }]);
  });

  it("re-emits changes:tracked as file-tracking:changes-updated { workspaceId }", async () => {
    await primeBridge();
    const seen = listenOn("file-tracking:changes-updated");

    capturedHandlers[0]!(notification("changes:tracked", { workspaceId: WS, changes: [] }));

    expect(seen).toEqual([{ workspaceId: WS }]);
  });

  it("re-emits workspace:updated with the event data as changes", async () => {
    await primeBridge();
    const seen = listenOn("workspace:updated");

    capturedHandlers[0]!(notification("workspace:updated", { title: "Renamed" }));

    expect(seen).toEqual([{ workspaceId: WS, changes: { title: "Renamed" } }]);
  });

  it("re-emits pr:updated as workspace:updated carrying the PR fields as changes", async () => {
    await primeBridge();
    const seen = listenOn("workspace:updated");

    // PROTOCOL §6.5 pr:updated → { workspaceId, prNumber, prStatus, activePullRequest }.
    capturedHandlers[0]!(
      notification("pr:updated", {
        workspaceId: WS,
        prNumber: 42,
        prStatus: "open",
        activePullRequest: { number: 42, url: "https://github.com/x/y/pull/42" },
      }),
    );

    expect(seen).toEqual([
      {
        workspaceId: WS,
        changes: {
          activePullRequest: { number: 42, url: "https://github.com/x/y/pull/42" },
          prNumber: 42,
          prStatus: "open",
        },
      },
    ]);
  });

  it("re-emits pr:unlinked as workspace:updated with a nulled activePullRequest", async () => {
    await primeBridge();
    const seen = listenOn("workspace:updated");

    capturedHandlers[0]!(notification("pr:unlinked", { workspaceId: WS }));

    expect(seen).toEqual([
      { workspaceId: WS, changes: { activePullRequest: null, prNumber: null, prStatus: null } },
    ]);
  });

  it("re-emits agent:status-changed and agent:idle onto their legacy channels (and still dispatches the lifecycle)", async () => {
    appStore.dispatch(clearAllSessions());
    seedSession({ isStreaming: true, status: AgentStatus.Active });
    await primeBridge();
    const statusSeen = listenOn("agent:status-changed");
    const idleSeen = listenOn("agent:idle");

    capturedHandlers[0]!(
      notification("agent:status-changed", { agentId: AGENT, status: "active" }),
    );
    capturedHandlers[0]!(notification("agent:idle", { agentId: AGENT }));

    // active-streams-tracker refetches on any delivery — payload is the event.
    expect(statusSeen).toHaveLength(1);
    expect(statusSeen[0]).toMatchObject({ type: "agent:status-changed", workspaceId: WS });
    expect(idleSeen).toHaveLength(1);
    expect(idleSeen[0]).toMatchObject({ type: "agent:idle", workspaceId: WS });
    // The relay is a side effect, not an early return: agent:idle still clears
    // the optimistic responding flag through the lifecycle dispatch.
    expect(selectAgentIsResponding.select(appStore.state, AGENT)).toBe(false);
  });

  it("does not relay events dropped by the fan-out scope gate", async () => {
    await primeBridge();
    const seen = listenOn("git:status-changed");

    const base = notification("changes:git-status", { workspaceId: WS, status: {} });
    capturedHandlers[0]!({
      method: base.method,
      params: { ...base.params, subscriptionId: "sub-foreign" },
    });

    expect(seen).toEqual([]);
  });
});
