import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { AgentStatus } from "$shared/types/agent.types";
import type { AgentSession, AgentMessage } from "$shared/types";

// FAKE seam: appClient.agents.get + getConversation are stubbed so no daemon
// call (and never a mutation) happens. The service runs against the REAL
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
        }),
      ),
    },
  },
}));

// Stream handler registry: controlled per-test to exercise both the
// hasLiveHandler=false (hydration demotes phantom Active → Idle) and
// hasLiveHandler=true (genuine live stream preserved) branches.
vi.mock("./utils/stream-handler-registry", () => ({
  hasStreamHandler: vi.fn(() => false),
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
import { hasStreamHandler } from "./utils/stream-handler-registry";
import { loadChatTranscript } from "./chat-read-service";

const hasStreamHandlerMock = hasStreamHandler as unknown as ReturnType<typeof vi.fn>;

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

const conversation = (messages: AgentMessage[]) => ({
  messages,
  truncated: false,
  totalMessages: messages.length,
});

describe("chatReadService (fake seam, real store)", () => {
  beforeAll(() => appStore.init());
  afterEach(() => {
    vi.clearAllMocks();
    agentsApi.get.mockResolvedValue(null as never);
    agentsApi.getConversation.mockResolvedValue(conversation([]) as never);
    hasStreamHandlerMock.mockReturnValue(false);
  });

  it("loadChatTranscript fetches session + transcript and hydrates messages", async () => {
    agentsApi.get.mockResolvedValueOnce(makeSession() as never);
    agentsApi.getConversation.mockResolvedValueOnce(conversation([makeMessage("m1", "hi")]) as never);

    await loadChatTranscript(AGENT);

    expect(agentsApi.get).toHaveBeenCalledWith(AGENT);
    expect(agentsApi.getConversation).toHaveBeenCalledWith(AGENT);
    expect(selectAgentMessages.select(appStore.state, AGENT).map((m) => m.id)).toEqual(["m1"]);
  });

  it("skips hydration when the session read returns null (no fabricated session)", async () => {
    const agentId = "agent-chat-null";
    agentsApi.get.mockResolvedValueOnce(null as never);
    agentsApi.getConversation.mockResolvedValueOnce(conversation([makeMessage("x", "y")]) as never);

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

    expect(agentsApi.getConversation).toHaveBeenCalledWith(AGENT);
    expect(selectAgentMessages.select(appStore.state, AGENT).map((m) => m.id)).toEqual(["via-action"]);
  });

  it("normalizes phantom streaming flags: hydrating Active with no live handler demotes to Idle", async () => {
    // Mirror the daemon-persisted mid-turn case: status=Active, isResponding=true,
    // no streaming message, and no live ACP handler. Without normalization the
    // selectors would report "Thinking" forever and the send guard would silently
    // drop composer messages.
    const agentId = "agent-hydration-idle";
    hasStreamHandlerMock.mockReturnValue(false);
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
    expect(stored?.status).toBe(AgentStatus.Idle);
    expect(stored?.isResponding).toBe(false);
    expect(stored?.isProcessing).toBe(false);
    expect(stored?.isStreaming).toBe(false);
    expect(selectAgentIsResponding.select(appStore.state, agentId)).toBe(false);
    expect(selectAgentIsThinking.select(appStore.state, agentId)).toBe(false);
  });

  it("preserves Active status when a live stream handler is attached for the agent", async () => {
    const agentId = "agent-hydration-live";
    hasStreamHandlerMock.mockReturnValue(true);
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
});
