import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { AgentStatus } from "$shared/types/agent.types";
import type { AgentSession, AgentMessage } from "$shared/types";

// FAKE seam: appClient.agents.get + agents.getConversation are stubbed so no
// daemon call (and never a mutation) happens. The service runs against the REAL
// configured store so the initializeChatRequested middleware, dedup, and upsert
// hydration are exercised end to end. READ-ONLY: only `get`/`getConversation`.
vi.mock("$lib/client", () => ({
  appClient: {
    agents: {
      get: vi.fn(() => Promise.resolve(null as AgentSession | null)),
      getConversation: vi.fn(() =>
        Promise.resolve({
          messages: [] as AgentMessage[],
          truncated: false,
          totalMessages: 0,
          nextToken: null as string | null,
        }),
      ),
    },
  },
}));

import { appClient } from "$lib/client";
import { store as appStore } from "$store/renderer/store";
import { initializeChatRequested } from "$store/renderer/slices/chat-state/chat-state-slice";
import {
  selectAgentMessages,
  selectAgentSession,
  selectAgentIsResponding,
  selectAgentIsThinking,
} from "$store/renderer/slices/agent-session/agent-session-selectors";
import { loadChatTranscript } from "./chat-read-service";

const agentsApi = appClient.agents as unknown as Record<string, ReturnType<typeof vi.fn>>;
const WS = "ws-chat-read-1";
const AGENT = "agent-chat-read-1";
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function makeSession(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id: AGENT,
    backendSessionId: null,
    workspaceId: WS,
    name: "Agent One",
    status: AgentStatus.Active,
    messages: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as AgentSession;
}

function makeMessage(id: string, text: string): AgentMessage {
  return {
    id,
    role: "assistant",
    timestamp: "2026-01-01T00:00:00.000Z",
    contentBlocks: [{ type: "text", text }],
  };
}

const conversation = (
  messages: AgentMessage[],
  nextToken: string | null = null,
) => ({
  messages,
  truncated: nextToken !== null,
  totalMessages: messages.length,
  nextToken,
});

describe("chatReadService (fake seam, real store)", () => {
  beforeAll(() => appStore.init());
  afterEach(() => {
    vi.clearAllMocks();
    agentsApi.get.mockResolvedValue(null as never);
    agentsApi.getConversation.mockResolvedValue(conversation([]) as never);
  });

  it("loadChatTranscript fetches session + transcript and hydrates messages", async () => {
    agentsApi.get.mockResolvedValueOnce(makeSession() as never);
    agentsApi.getConversation.mockResolvedValueOnce(conversation([makeMessage("m1", "hi")]) as never);

    await loadChatTranscript(AGENT);

    expect(agentsApi.get).toHaveBeenCalledWith(AGENT);
    expect(agentsApi.getConversation).toHaveBeenCalledWith(AGENT, 200, undefined);
    expect(selectAgentMessages.select(appStore.state, AGENT).map((m) => m.id)).toEqual(["m1"]);
  });

  it("preserves the seq-0 user message when hydrating a real transcript", async () => {
    // Wire shape mirrors what `agent.getConversation` returns for an existing
    // agent whose initial user message was persisted by the daemon (PROTOCOL
    // §5.5). The FE must NOT drop it.
    const agentId = "agent-seq0-user";
    agentsApi.get.mockResolvedValueOnce(makeSession({ id: agentId }) as never);
    const initialUser: AgentMessage = {
      id: "019f3d27-user-seq0",
      role: "user",
      timestamp: "2026-07-07T15:17:03.908Z",
      contentBlocks: [{ type: "text", text: "describe the repo" }],
    };
    const firstAssistant: AgentMessage = {
      id: "019f3d27-asst-seq1",
      role: "assistant",
      timestamp: "2026-07-07T15:17:04.100Z",
      contentBlocks: [{ type: "text", text: "here is the repo description" }],
    };
    agentsApi.getConversation.mockResolvedValueOnce(
      conversation([initialUser, firstAssistant]) as never,
    );

    await loadChatTranscript(agentId);

    const stored = selectAgentMessages.select(appStore.state, agentId);
    expect(stored.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(stored.map((m) => m.id)).toEqual([
      "019f3d27-user-seq0",
      "019f3d27-asst-seq1",
    ]);
  });

  it("skips hydration when the session read returns null (no fabricated session)", async () => {
    const agentId = "agent-chat-null";
    agentsApi.get.mockResolvedValueOnce(null as never);
    // No need to mock getConversation — loadChatTranscript returns early when
    // agents.get returns null (line 66 in chat-read-service.ts).

    await loadChatTranscript(agentId);

    expect(selectAgentMessages.select(appStore.state, agentId)).toEqual([]);
  });

  it("leaves any prior transcript intact when the conversation read fails", async () => {
    const agentId = "agent-chat-prior";
    agentsApi.get.mockResolvedValue(makeSession({ id: agentId }) as never);
    agentsApi.getConversation.mockResolvedValueOnce(conversation([makeMessage("prior", "p")]) as never);
    await loadChatTranscript(agentId);
    expect(selectAgentMessages.select(appStore.state, agentId).map((m) => m.id)).toEqual(["prior"]);

    agentsApi.getConversation.mockRejectedValueOnce(new Error("boom") as never);
    await loadChatTranscript(agentId);

    expect(selectAgentMessages.select(appStore.state, agentId).map((m) => m.id)).toEqual(["prior"]);
  });

  it("coalesces concurrent loads for the same agent into one fetch", async () => {
    agentsApi.get.mockResolvedValue(makeSession() as never);
    agentsApi.getConversation.mockResolvedValue(conversation([makeMessage("c", "shared")]) as never);

    await Promise.all([
      loadChatTranscript(AGENT),
      loadChatTranscript(AGENT),
      loadChatTranscript(AGENT),
    ]);

    expect(agentsApi.getConversation).toHaveBeenCalledTimes(1);
  });

  it("dispatching initializeChatRequested triggers a load (middleware wiring)", async () => {
    agentsApi.get.mockResolvedValueOnce(makeSession() as never);
    agentsApi.getConversation.mockResolvedValueOnce(conversation([makeMessage("via-action", "x")]) as never);

    appStore.dispatch(initializeChatRequested(AGENT, { wsId: WS }));
    await flush();

    expect(agentsApi.getConversation).toHaveBeenCalledWith(AGENT, 200, undefined);
    expect(selectAgentMessages.select(appStore.state, AGENT).map((m) => m.id)).toEqual(["via-action"]);
  });

  it("hydrating a COMPLETED session renders BE state as-is (Idle => not Thinking, composer ungated)", async () => {
    // BE single-source-of-truth contract (post-heal): a completed turn comes
    // back from the daemon with status=Idle, isStreaming/isResponding=false,
    // and a finalized assistant message (no isStreaming flag, streamingComplete:true).
    // The FE must render that state verbatim — no client-side healing.
    const agentId = "agent-hydration-completed";
    agentsApi.get.mockResolvedValueOnce(
      makeSession({
        id: agentId,
        status: AgentStatus.Idle,
        isResponding: false,
        isProcessing: false,
        isStreaming: false,
      }) as never,
    );
    const completedAssistant: AgentMessage = {
      id: "m-done",
      role: "assistant",
      timestamp: "2026-01-01T00:00:00.000Z",
      contentBlocks: [{ type: "text", text: "all done" }],
    };
    agentsApi.getConversation.mockResolvedValueOnce(conversation([completedAssistant]) as never);

    await loadChatTranscript(agentId);

    const stored = selectAgentSession.select(appStore.state, agentId);
    expect(stored?.status).toBe(AgentStatus.Idle);
    expect(stored?.isResponding).toBe(false);
    expect(stored?.isStreaming).toBe(false);
    expect(selectAgentIsResponding.select(appStore.state, agentId)).toBe(false);
    expect(selectAgentIsThinking.select(appStore.state, agentId)).toBe(false);
  });

  it("hydrating a GENUINELY in-flight session renders BE Active state as-is (Thinking shows)", async () => {
    // The BE post-heal returns isStreaming:true ONLY when a worker is genuinely
    // active. The FE must surface that state verbatim so the composer enters
    // the queue-on-send mode.
    const agentId = "agent-hydration-active";
    agentsApi.get.mockResolvedValueOnce(
      makeSession({
        id: agentId,
        status: AgentStatus.Active,
        isResponding: true,
        isProcessing: true,
        isStreaming: true,
      }) as never,
    );
    agentsApi.getConversation.mockResolvedValueOnce(conversation([]) as never);

    await loadChatTranscript(agentId);

    const stored = selectAgentSession.select(appStore.state, agentId);
    expect(stored?.status).toBe(AgentStatus.Active);
    expect(stored?.isResponding).toBe(true);
    expect(stored?.isStreaming).toBe(true);
    expect(selectAgentIsResponding.select(appStore.state, agentId)).toBe(true);
  });

  it("hydrates the synthetic in-flight assistant message", async () => {
    // When a turn is streaming, the daemon may include a synthetic assistant
    // message (`isStreaming: true`) with the current partial blocks. The FE
    // must ingest that as-is.
    const agentId = "agent-midturn-hydrate";
    agentsApi.get.mockResolvedValueOnce(
      makeSession({
        id: agentId,
        status: AgentStatus.Active,
        isResponding: true,
        isStreaming: true,
      }) as never,
    );
    const userTurn: AgentMessage = {
      id: "0190a1b2-user",
      role: "user",
      timestamp: "2026-01-01T00:00:00.000Z",
      contentBlocks: [{ type: "text", text: "Run the tests" }],
    };
    const inFlight = {
      id: "0190a200-asst",
      role: "assistant",
      timestamp: "2026-01-01T00:00:00.001Z",
      isStreaming: true,
      contentBlocks: [
        { type: "text", id: "0190a200-asst:0", text: "Let me check the logs" },
        {
          type: "tool_use",
          id: "0190a200-asst:1",
          name: "read_file",
          toolCallId: "call-1",
          input: { path: "log" },
        },
      ],
    } as unknown as AgentMessage;
    agentsApi.getConversation.mockResolvedValueOnce({
      messages: [userTurn, inFlight],
      truncated: false,
      totalMessages: 2,
      nextToken: null,
    } as never);

    await loadChatTranscript(agentId);

    const rendered = selectAgentMessages.select(appStore.state, agentId);
    expect(rendered.map((m) => m.id)).toEqual(["0190a1b2-user", "0190a200-asst"]);
    const inFlightRendered = rendered[1] as AgentMessage & { isStreaming?: boolean };
    expect(inFlightRendered.isStreaming).toBe(true);
    expect(inFlightRendered.contentBlocks?.map((b) => b.type)).toEqual(["text", "tool_use"]);
  });

  // Regression (STAB-15): chat transcript flicker/truncation when conversation
  // has > 50 messages. Root cause: loadChatTranscript was using
  // chat.subscribeSnapshot (which returns only the newest ~50 messages, one
  // page) instead of agent.getConversation with pagination. Fix: page through
  // getConversation with limit=200 per page, looping on nextToken until the
  // complete conversation is assembled.
  it("pages through getConversation to assemble full transcript (>50 messages regression)", async () => {
    const agentId = "agent-pagination";
    agentsApi.get.mockResolvedValueOnce(makeSession({ id: agentId }) as never);

    // Simulate a conversation with 125 messages (3 pages).
    // The first call (no token) returns the NEWEST page, then nextToken walks
    // backward to older pages (PROTOCOL §5.5, app-client.ts:287-288).
    // Page 1 (no token): messages 101-125 (newest 25, nextToken="page2")
    // Page 2 (token="page2"): messages 51-100 (middle 50, nextToken="page3")
    // Page 3 (token="page3"): messages 1-50 (oldest 50, nextToken=null)
    const page1Newest = Array.from({ length: 25 }, (_, i) =>
      makeMessage(`msg-${i + 101}`, `message ${i + 101}`),
    );
    const page2Middle = Array.from({ length: 50 }, (_, i) =>
      makeMessage(`msg-${i + 51}`, `message ${i + 51}`),
    );
    const page3Oldest = Array.from({ length: 50 }, (_, i) =>
      makeMessage(`msg-${i + 1}`, `message ${i + 1}`),
    );

    // getConversation is called three times with the pagination token.
    agentsApi.getConversation
      .mockResolvedValueOnce({ ...conversation(page1Newest, "page2") } as never)
      .mockResolvedValueOnce({ ...conversation(page2Middle, "page3") } as never)
      .mockResolvedValueOnce({ ...conversation(page3Oldest, null) } as never);

    await loadChatTranscript(agentId);

    // Verify three calls with correct pagination.
    expect(agentsApi.getConversation).toHaveBeenCalledTimes(3);
    expect(agentsApi.getConversation).toHaveBeenNthCalledWith(1, agentId, 200, undefined);
    expect(agentsApi.getConversation).toHaveBeenNthCalledWith(2, agentId, 200, "page2");
    expect(agentsApi.getConversation).toHaveBeenNthCalledWith(3, agentId, 200, "page3");

    // All 125 messages should be in the store, oldest-first.
    const stored = selectAgentMessages.select(appStore.state, agentId);
    expect(stored.length).toBe(125);
    expect(stored.map((m) => m.id)).toEqual(
      Array.from({ length: 125 }, (_, i) => `msg-${i + 1}`),
    );
  });

  it("tab-switch mid-turn keeps interim blocks via full transcript reload", async () => {
    // The in-flight assistant message may be included in the conversation
    // transcript when the daemon has it. A re-mount re-hydrates it.
    const agentId = "agent-tabswitch-inflight";
    const session = makeSession({
      id: agentId,
      status: AgentStatus.Active,
      isResponding: true,
      isStreaming: true,
    });
    const userTurn: AgentMessage = {
      id: "u1",
      role: "user",
      timestamp: "2026-01-01T00:00:00.000Z",
      contentBlocks: [{ type: "text", text: "hi" }],
    };
    const partial = {
      id: "a1",
      role: "assistant",
      timestamp: "2026-01-01T00:00:00.500Z",
      isStreaming: true,
      contentBlocks: [{ type: "text", id: "a1:0", text: "Working" }],
    } as unknown as AgentMessage;

    agentsApi.get.mockResolvedValue(session as never);
    agentsApi.getConversation.mockResolvedValue({
      messages: [userTurn, partial],
      truncated: false,
      totalMessages: 2,
      nextToken: null,
    } as never);

    // First mount hydrates the transcript.
    await loadChatTranscript(agentId);
    expect(selectAgentMessages.select(appStore.state, agentId).map((m) => m.id)).toEqual([
      "u1",
      "a1",
    ]);

    // Simulate switching away and back — a fresh mount dispatches
    // initializeChatRequested again, which re-runs loadChatTranscript.
    await loadChatTranscript(agentId);
    const after = selectAgentMessages.select(appStore.state, agentId);
    expect(after.map((m) => m.id)).toEqual(["u1", "a1"]);
    const streamed = after[1] as AgentMessage & { isStreaming?: boolean };
    expect(streamed.isStreaming).toBe(true);
    expect(streamed.contentBlocks?.[0]).toMatchObject({ type: "text", text: "Working" });
  });
});
