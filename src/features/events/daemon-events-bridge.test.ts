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

  it("registers a notification listener and subscribes to agent:* on first dispatch", async () => {
    await primeBridge();

    expect(onBackendNotificationSpy).toHaveBeenCalledTimes(1);
    expect(backendRequestSpy).toHaveBeenCalledTimes(1);
    expect(backendRequestSpy).toHaveBeenCalledWith("events.subscribe", {
      eventTypes: ["agent:*"],
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

  it("ignores notifications that are not events.event or not agent-lifecycle", async () => {
    seedSession({ isStreaming: true, status: AgentStatus.Active });
    await primeBridge();
    const handler = capturedHandlers[0]!;

    // Unrelated method — no-op.
    handler({ method: "agent.stream:chunk", params: { agentId: AGENT } });
    expect(selectAgentIsResponding.select(appStore.state, AGENT)).toBe(true);

    // events.event but not a lifecycle type — no-op.
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
});

describe("daemonEventsBridge (live stream wire contract — agent:stream:* → transcript)", () => {
  beforeAll(() => {
    appStore.init();
  });

  beforeEach(async () => {
    appStore.dispatch(clearAllSessions());
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
});
