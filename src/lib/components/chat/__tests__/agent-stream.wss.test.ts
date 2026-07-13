/**
 * Suite 3 — streaming-chunk rendering pipeline (PROTOCOL §6.3 / §7).
 *
 * Cross-cutting suite: daemon `agent:stream:*` notifications flow through the
 * `MockBackendTransport` fixture, into `daemon-events-bridge.ts`, into the
 * `workspace-agents` + `chat-state` reducers, into the shape the message DOM
 * renders. The renderer is a thin presenter over the daemon (see
 * `packages/cloudlands-fe/AGENTS.md`), so the assistant message's
 * `contentBlocks` is exactly what `AgentMessageList` / `StreamingMessageContent`
 * render — asserting on the store state faithfully proves the DOM grows on
 * each chunk without dragging in the markdown/Tiptap render stack.
 *
 * Also codifies the "chunk-echo" fan-out gate the existing bridge test
 * documents: the same chunk delivered under a foreign subscriptionId must NOT
 * append.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("$lib/client/live/backend-transport", async () => {
  const mod = await import("../../../../test/mocks/backend-transport.mock");
  return mod.mockBackendTransportModule;
});

import { store as appStore } from "$store/renderer/store";
import {
  bulkUpsertSessions,
  clearAllSessions,
  setAgentStreaming,
} from "$store/renderer/slices/agent-session/agent-session-slice";
import { chatReset } from "$store/renderer/slices/chat-state/chat-state-slice";
import { __resetDaemonEventsBridgeForTests } from "$features/events/daemon-events-bridge";
import { AgentStatus } from "$shared/types/agent.types";
import type { AgentMessage, AgentSession } from "$shared/types";
import type { StatusEvent } from "$store/renderer/slices/chat-state/chat-state-types";
import {
  installMockBackend,
  resetMockBackend,
  type MockBackendHandle,
} from "../../../../test/mocks/backend-transport.mock";

const WORKSPACE_ID = "ws-stream";
const AGENT_ID = "agent-stream-1";
const MESSAGE_ID = "msg_assistant_stream";
const STREAM_ID = "stream_stream";
const SUBSCRIPTION_ID = "sub-stream-1";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function seedSession(): void {
  // Seed a session with an EMPTY assistant message placeholder so the chunk
  // accumulator has a target to grow. Matches the `createInitialPlaceholder`
  // path the workspaceAgents reducer normally installs at `chatSendStarted`.
  appStore.dispatch(
    bulkUpsertSessions([
      {
        id: AGENT_ID,
        backendSessionId: "backend-stream-1",
        workspaceId: WORKSPACE_ID,
        name: "Streaming Impl",
        status: AgentStatus.Active,
        isStreaming: true,
        messages: [],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      } as AgentSession,
    ]),
  );
}

function readSession(): AgentSession | undefined {
  const state = appStore.state as {
    agentSessions?: { byAgentId: Record<string, AgentSession> };
  };
  return state.agentSessions?.byAgentId[AGENT_ID];
}

function readAssistantMessages(): AgentMessage[] {
  return (readSession()?.messages ?? []).filter((m) => m.role === "assistant");
}

function readStatusEvents(): StatusEvent[] {
  const state = appStore.state as {
    chatState?: { byAgentId: Record<string, { statusEvents: StatusEvent[] }> };
  };
  return state.chatState?.byAgentId[AGENT_ID]?.statusEvents ?? [];
}

function pushChunk(backend: MockBackendHandle, delta: string): void {
  backend.pushEvent({
    type: "agent:stream:chunk",
    data: {
      agentId: AGENT_ID,
      content: delta,
      messageId: MESSAGE_ID,
      blockIndex: 0,
      blockId: `${MESSAGE_ID}:0`,
      blockType: "text",
      streamId: STREAM_ID,
    },
    workspaceId: WORKSPACE_ID,
    actor: { type: "agent", id: AGENT_ID },
    subscriptionId: SUBSCRIPTION_ID,
  });
}

describe("agent-stream.wss — chunk accumulation → transcript growth", () => {
  let backend: MockBackendHandle;

  beforeAll(() => {
    appStore.init();
  });

  beforeEach(async () => {
    // Reset bridge singletons BEFORE any dispatch — otherwise a lingering
    // `installed=true` from a prior test's install (whose async subscribe
    // hadn't resolved when the previous reset ran) leaves a stale notification
    // handler attached to the mock, and the next install adds a second one,
    // causing every chunk to be applied twice ("HelloHello" symptom).
    __resetDaemonEventsBridgeForTests();
    backend = installMockBackend();
    // `events.subscribe` is the only backend call the bridge makes — resolve it
    // with a deterministic id so the fan-out scope gate accepts our pushEvents
    // tagged with the same id.
    backend.onRequest("events.subscribe", () => ({ subscriptionId: SUBSCRIPTION_ID }));
    // The task note calls out an `agent.getConversation` hydration script; we
    // register a handler that returns the seeded transcript so any consumer
    // that reaches for it gets a PROTOCOL-shaped response rather than the
    // fixture's MOCK_UNHANDLED_METHOD error.
    backend.onRequest("agent.getConversation", (params) => {
      expect(params).toMatchObject({ agentId: AGENT_ID });
      return {
        messages: (readSession()?.messages ?? []) as AgentMessage[],
      };
    });

    appStore.dispatch(clearAllSessions());
    appStore.dispatch(chatReset(AGENT_ID));
    seedSession();
    // `setAgentStreaming` runs through the middleware chain and triggers the
    // bridge's lazy install. Awaiting the microtask lets `events.subscribe`
    // resolve so `ownSubscriptionId` is captured before any pushEvent runs.
    appStore.dispatch(setAgentStreaming(AGENT_ID, true));
    await flush();
  });

  afterEach(() => {
    resetMockBackend();
    vi.clearAllMocks();
  });

  it("grows the assistant message per chunk and clears statusEvents on stream:end", async () => {
    // Baseline: seeded session has no assistant message yet, no status hints.
    expect(readAssistantMessages()).toHaveLength(0);
    expect(readStatusEvents()).toEqual([]);

    // Chunk 1 — first delta. Creates the assistant message, and the chunk
    // reducer arms the "Streaming response…" status hint on the first text
    // chunk (see chat-state-slice.reduceChunkReceived).
    pushChunk(backend, "Hello");
    let messages = readAssistantMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0].id).toBe(MESSAGE_ID);
    expect(messages[0].isStreaming).toBe(true);
    expect(messages[0].contentBlocks?.[0]).toMatchObject({
      type: "text",
      text: "Hello",
    });
    expect(readStatusEvents().map((e) => e.phase)).toEqual(["streaming"]);

    // Chunk 2 — second delta. The bridge coalesces consecutive text chunks at
    // the same blockIndex into a single text block, mirroring the daemon's
    // `Transcript.push_text` (crates/intent-services/src/agent_session.rs).
    pushChunk(backend, " world");
    messages = readAssistantMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0].contentBlocks?.[0]).toMatchObject({
      type: "text",
      text: "Hello world",
    });

    // Chunk 3 — final delta. Still exactly one assistant message, still one
    // text block; `chat message DOM grows per chunk` in the thin-presenter
    // sense (this is the same `contentBlocks` array `StreamingMessageContent`
    // hands to `MarkdownViewer`).
    pushChunk(backend, "!");
    messages = readAssistantMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0].contentBlocks).toHaveLength(1);
    expect(messages[0].contentBlocks?.[0]).toMatchObject({
      type: "text",
      text: "Hello world!",
    });
    // Final concatenated deltas must equal the sum of the pushed deltas.
    expect((messages[0].contentBlocks?.[0] as { text: string }).text).toBe(
      ["Hello", " world", "!"].join(""),
    );

    // stream:end finalizes the transcript and — per §5 chat-state contract —
    // clears the status hints on the chatState side.
    backend.pushEvent({
      type: "agent:stream:end",
      data: { agentId: AGENT_ID, streamId: STREAM_ID },
      workspaceId: WORKSPACE_ID,
      actor: { type: "agent", id: AGENT_ID },
      subscriptionId: SUBSCRIPTION_ID,
    });

    messages = readAssistantMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0].isStreaming).toBe(false);
    expect(messages[0].streamingComplete).toBe(true);
    expect(messages[0].contentBlocks?.[0]).toMatchObject({
      type: "text",
      text: "Hello world!",
    });
    expect(readStatusEvents()).toEqual([]);
  });

  it("does not echo when the same chunk arrives on a foreign fan-out subscription", async () => {
    // Chunk-echo regression: with an overlapping `agent:*` subscription on the
    // same socket the daemon delivers ONE notification per matching sub. The
    // bridge's scope gate (see daemon-events-bridge.ts header) drops copies
    // whose envelope subscriptionId != our own so `priorText + content` runs
    // exactly once. If the gate breaks, "TodayTodayToday" is the symptom.
    backend.pushEvent({
      type: "agent:stream:chunk",
      data: {
        agentId: AGENT_ID,
        content: "Today",
        messageId: MESSAGE_ID,
        blockIndex: 0,
        blockId: `${MESSAGE_ID}:0`,
        blockType: "text",
        streamId: STREAM_ID,
      },
      workspaceId: WORKSPACE_ID,
      actor: { type: "agent", id: AGENT_ID },
      subscriptionId: SUBSCRIPTION_ID,
    });
    // Same delta, foreign subscription id — MUST be dropped.
    backend.pushEvent({
      type: "agent:stream:chunk",
      data: {
        agentId: AGENT_ID,
        content: "Today",
        messageId: MESSAGE_ID,
        blockIndex: 0,
        blockId: `${MESSAGE_ID}:0`,
        blockType: "text",
        streamId: STREAM_ID,
      },
      workspaceId: WORKSPACE_ID,
      actor: { type: "agent", id: AGENT_ID },
      subscriptionId: "sub-foreign",
    });

    const messages = readAssistantMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0].contentBlocks?.[0]).toMatchObject({
      type: "text",
      text: "Today",
    });
  });
});
