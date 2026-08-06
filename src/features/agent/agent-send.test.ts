/**
 * Wire-level regression suite for the agent send pipeline (`agent-send.ts`),
 * ported from the deleted `agent-stream-lifecycle.send-wire.test.ts` after the
 * firehose accumulator removal (monorepo#1127).
 *
 * Drives the REAL `sendMessage()` against the REAL configured store and REAL
 * mutation middleware — only `backend-transport.backendRequest` is mocked,
 * returning PROTOCOL.md §5.5-shaped daemon payloads captured from a live
 * daemon (a fresh `pending` agent projection with no acpSessionId).
 *
 * `sendMessage()` calls `backendRequest("agent.sendMessage", …)` directly on
 * the BackendTransport seam (no mock-IPC hop). Asserts the daemon receives
 * `agent.sendMessage` with the exact PROTOCOL.md §5.5 params, and covers the
 * success, queued ({success:true, queued:true}) and error envelopes plus
 * transport-level rejections. Streaming/terminal state is out of scope here —
 * it arrives via the standing chat.subscribe delta stream (§7.1).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { backendRequestMock } = vi.hoisted(() => ({
  backendRequestMock: vi.fn(),
}));
vi.mock("$lib/client/live/backend-transport", () => ({
  backendRequest: backendRequestMock,
  backendSubscribe: vi.fn(async () => ({})),
  backendUnsubscribe: vi.fn(async () => {}),
  onBackendNotification: vi.fn(() => () => {}),
  onBackendReconnected: vi.fn(() => () => {}),
  detectLiveStateCapability: vi.fn(async () => false),
  isBackendAvailable: () => true,
  BackendError: class BackendError extends Error {},
}));

import { store as appStore } from "$store/renderer/store";
import { setWorkspaceEntity } from "$store/renderer/slices/workspace/workspace-slice";
import {
  bulkUpsertSessions,
  clearAllSessions,
} from "$store/renderer/slices/agent-session/agent-session-slice";
import { sendMessage } from "./agent-send";
import { AgentStatus } from "$shared/types";
import type { AgentSession, Workspace, QueuedMessage } from "$shared/types";
import { selectAgentQueueMessages } from "$store/renderer/slices/agent-queue/agent-queue-selectors";
import {
  chatLastAttemptedMessageSet,
  chatReset,
} from "$store/renderer/slices/chat-state/chat-state-slice";
import { IN_FLIGHT_PROMPT_DROPPED_ERROR } from "$shared/constants/agent-streaming";

const WS = "c6df5dce-f8c6-44fe-8a2d-227a8815f2af";
const AGENT = "agent-373f33d3-0a26-4b8b-9ecf-f114bfa47df4";

/** Daemon agent projection exactly as `agent.get` returns it for a fresh agent. */
const daemonPendingAgent = {
  id: AGENT,
  workspaceId: WS,
  name: "Coordinator",
  nameExplicitlySet: true,
  status: "pending",
  provider: "auggie",
  model: "opus4.7",
  isActive: false,
  isProcessing: false,
  isResponding: false,
  isStreaming: false,
  isWaitingOnTool: false,
  isWaitingForOtherAgents: false,
  waitingForAgentIds: [],
  messageCount: 0,
  metadata: { isBackground: false },
  createdAt: "2026-07-03T14:35:35.924892Z",
  updatedAt: "2026-07-03T14:35:35.924892Z",
  lastActivity: "2026-07-03T14:35:35.924892Z",
};

function workspace(): Workspace {
  return {
    id: WS,
    title: "intent",
    branch: "main",
    status: "active",
    path: "/Users/clement/src/intent",
    repositoryPath: "/Users/clement/src/intent",
    createdAt: "2026-06-24T13:18:22.961Z",
    updatedAt: "2026-06-24T13:18:22.961Z",
    changesets: [],
    timeline: [],
    conversationInfo: [],
  } as unknown as Workspace;
}

function seedPendingSession(): void {
  appStore.dispatch(
    bulkUpsertSessions([
      {
        id: AGENT,
        backendSessionId: null,
        workspaceId: WS,
        name: "Coordinator",
        status: AgentStatus.Pending,
        messages: [],
        createdAt: "2026-07-03T14:35:35.924Z",
        updatedAt: "2026-07-03T14:35:35.924Z",
      } as unknown as AgentSession,
    ]),
  );
}

describe("agent-send wire contract (pending agent, first message)", () => {
  beforeAll(() => {
    appStore.init();
  });
  beforeEach(() => {
    backendRequestMock.mockReset();
    backendRequestMock.mockImplementation(async (method: string) => {
      if (method === "agent.get") return { agent: daemonPendingAgent };
      if (method === "agent.sendMessage") {
        return { success: true, queued: false, messageId: "m-1" };
      }
      return {};
    });
    appStore.dispatch(setWorkspaceEntity(workspace()));
    seedPendingSession();
  });

  afterEach(() => {
    appStore.dispatch(clearAllSessions());
    appStore.dispatch(chatReset(AGENT));
  });

  it("emits agent.sendMessage on the wire for a first send to a pending agent (§5.5 shape)", async () => {
    await sendMessage(AGENT, "persist me please", workspace(), {});

    const calls = backendRequestMock.mock.calls.map((c) => c[0]);
    // The daemon MUST receive the send — this is the empty-transcript regression.
    expect(calls).toContain("agent.sendMessage");
    const sendCall = backendRequestMock.mock.calls.find((c) => c[0] === "agent.sendMessage")!;
    expect(sendCall[1]).toMatchObject({
      agentId: AGENT,
      workspaceId: WS,
      content: "persist me please",
    });
    const params = sendCall[1] as Record<string, unknown>;
    // Renderer-minted identity trio rides along (PROTOCOL.md §5.5).
    expect(typeof params.assistantMessageId).toBe("string");
    expect(typeof params.assistantAppMessageId).toBe("string");
    expect(typeof params.userAppMessageId).toBe("string");
    // Legacy-only fields the daemon ignores must no longer be sent.
    expect(params).not.toHaveProperty("messages");
    expect(params).not.toHaveProperty("resetHistory");
    expect(params).not.toHaveProperty("behaviorPrompt");
    expect(params).not.toHaveProperty("specialist");
    expect(params).not.toHaveProperty("personality");
    expect(params).not.toHaveProperty("sessionId");
  }, 30000);

  it("handles queued response (auto-queue race) by clearing streaming and seeding the queue", async () => {
    // When agent.sendMessage returns { success: true, queued: true,
    // queuedMessage } (auto-queue race during interrupt), the FE must NOT
    // pretend a stream is starting. It should:
    // 1. Reset the isStreaming flag (no stale "Thinking")
    // 2. Seed the local queue with queuedMessage (like the chat-send-service
    //    queue-on-send path)
    const queuedMessage: QueuedMessage = {
      id: "queued-msg-1",
      content: "persist me please",
      queuedAt: "2026-07-17T14:00:00.000Z",
      position: 0,
    };

    backendRequestMock.mockImplementation(async (method: string) => {
      if (method === "agent.get") return { agent: daemonPendingAgent };
      if (method === "agent.sendMessage") {
        // Daemon auto-queued instead of preempting (race during turn startup)
        return { success: true, queued: true, queuedMessage };
      }
      return {};
    });

    await sendMessage(AGENT, "persist me please", workspace(), {
      priority: "interrupt",
    });

    // Assert the UI state reflects queued (not streaming)
    const session = appStore.state.agentSessions?.byAgentId[AGENT];
    expect(session?.isStreaming).toBe(false);

    // Assert no stale streaming placeholder remains in the transcript
    const stalePlaceholders = (session?.messages ?? []).filter(
      (m) => m.role === "assistant" && m.isStreaming === true,
    );
    expect(stalePlaceholders).toHaveLength(0);

    // Assert the local queue was seeded with the queuedMessage
    const queueMessages = selectAgentQueueMessages.select(appStore.state, AGENT);
    expect(queueMessages).toHaveLength(1);
    expect(queueMessages[0]).toMatchObject({
      id: "queued-msg-1",
      content: "persist me please",
    });
  }, 30000);

  it("parks the retry record under the echoed queuedMessage id instead of lastAttemptedMessage (#1011)", async () => {
    const queuedMessage: QueuedMessage = {
      id: "queued-msg-2",
      content: "auto-queued send",
      queuedAt: "2026-07-17T14:00:00.000Z",
      position: 0,
      turnId: "queued-msg-2",
    };
    backendRequestMock.mockImplementation(async (method: string) => {
      if (method === "agent.get") return { agent: daemonPendingAgent };
      if (method === "agent.sendMessage") {
        return { success: true, queued: true, queuedMessage };
      }
      return {};
    });

    // The send path (chat-send-service) records the attempt into the single
    // slot BEFORE the send call — reproduce that mid-turn overwrite.
    appStore.dispatch(chatLastAttemptedMessageSet(AGENT, { text: "auto-queued send" }));

    await sendMessage(AGENT, "auto-queued send", workspace(), {});

    const chatAgent = appStore.state.chatState.byAgentId[AGENT];
    // The record is parked turn-scoped under the daemon-echoed id…
    expect(chatAgent.queuedRetryRecords["queued-msg-2"]).toMatchObject({
      record: { text: "auto-queued send" },
    });
    // …and the mid-turn overwrite of the single slot is undone.
    expect(chatAgent.lastAttemptedMessage).toBeNull();
  }, 30000);

  it("parks the auto-queued record keyed by the response turnId (monorepo#1057)", async () => {
    // §5.5 queued arm: `{ success, queued: true, queuedMessage, turnId }` —
    // the turnId keys the parked record for exact agent:queue:processing
    // promotion / agent:failed pairing across retry redrives.
    const queuedMessage: QueuedMessage = {
      id: "queued-msg-3",
      content: "auto-queued with turn",
      queuedAt: "2026-07-17T14:00:00.000Z",
      position: 0,
      turnId: "queued-msg-3",
    };
    backendRequestMock.mockImplementation(async (method: string) => {
      if (method === "agent.get") return { agent: daemonPendingAgent };
      if (method === "agent.sendMessage") {
        return { success: true, queued: true, queuedMessage, turnId: "queued-msg-3" };
      }
      return {};
    });

    await sendMessage(AGENT, "auto-queued with turn", workspace(), {});

    const chatAgent = appStore.state.chatState.byAgentId[AGENT];
    expect(chatAgent.queuedRetryRecords["queued-msg-3"]).toMatchObject({
      record: { text: "auto-queued with turn" },
      turnId: "queued-msg-3",
    });
  }, 30000);

  it("parks nothing when the queued response carries NO turnId (monorepo#1057 guard)", async () => {
    // Unreachable against the pinned daemon (>=0.2.12 returns turnId on
    // every enqueue path); the guard skips the park (a record without a
    // turnId could never promote) and the queue is still seeded.
    const queuedMessage: QueuedMessage = {
      id: "queued-msg-4",
      content: "no turn id",
      queuedAt: "2026-07-17T14:00:00.000Z",
      position: 0,
    };
    backendRequestMock.mockImplementation(async (method: string) => {
      if (method === "agent.get") return { agent: daemonPendingAgent };
      if (method === "agent.sendMessage") {
        return { success: true, queued: true, queuedMessage };
      }
      return {};
    });

    await sendMessage(AGENT, "no turn id", workspace(), {});

    const chatAgent = appStore.state.chatState.byAgentId[AGENT];
    expect(chatAgent.queuedRetryRecords).toEqual({});
    const queueMessages = selectAgentQueueMessages.select(appStore.state, AGENT);
    expect(queueMessages.map((m) => m.id)).toContain("queued-msg-4");
  }, 30000);

  it("keeps lastAttemptedMessage when the daemon queues WITHOUT echoing the entry (#1011)", async () => {
    backendRequestMock.mockImplementation(async (method: string) => {
      if (method === "agent.get") return { agent: daemonPendingAgent };
      if (method === "agent.sendMessage") {
        // Older daemon / degenerate envelope: queued but no queuedMessage.
        return { success: true, queued: true };
      }
      return {};
    });

    appStore.dispatch(chatLastAttemptedMessageSet(AGENT, { text: "no echo" }));

    await sendMessage(AGENT, "no echo", workspace(), {});

    // No stable id to park under → current behavior preserved: the single
    // slot keeps the payload and no record is parked.
    const chatAgent = appStore.state.chatState.byAgentId[AGENT];
    expect(chatAgent.lastAttemptedMessage).toEqual({ text: "no echo" });
    expect(chatAgent.queuedRetryRecords).toEqual({});
  }, 30000);

  it("treats a duplicate in-flight prompt response as a benign no-op", async () => {
    // The daemon drops a duplicate prompt for an in-flight turn and surfaces
    // it via IN_FLIGHT_PROMPT_DROPPED_ERROR inside a success:false envelope —
    // the send must resolve without throwing and without a retry storm.
    backendRequestMock.mockImplementation(async (method: string) => {
      if (method === "agent.get") return { agent: daemonPendingAgent };
      if (method === "agent.sendMessage") {
        return {
          success: false,
          error: `Backend error: ${IN_FLIGHT_PROMPT_DROPPED_ERROR} (agent busy)`,
        };
      }
      return {};
    });

    await expect(sendMessage(AGENT, "duplicate prompt", workspace(), {})).resolves.toBeUndefined();
    // Exactly one wire attempt — the dedup response must not trigger retries.
    const sendCalls = backendRequestMock.mock.calls.filter(([m]) => m === "agent.sendMessage");
    expect(sendCalls).toHaveLength(1);
  }, 30000);

  it("throws on a raw daemon error envelope ({success:false, error:string})", async () => {
    backendRequestMock.mockImplementation(async (method: string) => {
      if (method === "agent.get") return { agent: daemonPendingAgent };
      if (method === "agent.sendMessage") {
        // Daemon surfaces errors as a plain string on the raw envelope.
        return { success: false, error: "Agent not found" };
      }
      return {};
    });

    await expect(sendMessage(AGENT, "will fail", workspace(), {})).rejects.toThrow();
    // The FE must NOT leave the UI stuck in "Thinking" after exhausting retries.
    const session = appStore.state.agentSessions?.byAgentId[AGENT];
    expect(session?.isStreaming).toBe(false);
  }, 30000);

  it("mirrors the Q&A answer tag on the optimistic user row for a successful send", async () => {
    await sendMessage(AGENT, "Q: ?\nA: yes", workspace(), {
      messageMetadata: { type: "question_answers", answeredQuestionsMessageId: "msg-a1" },
    });

    const userRow = (appStore.state.agentSessions?.byAgentId[AGENT]?.messages ?? []).find(
      (m) => m.role === "user",
    );
    expect(userRow?.metadata).toMatchObject({
      type: "question_answers",
      answeredQuestionsMessageId: "msg-a1",
    });
  }, 30000);

  it("strips the mirrored answer tag off the optimistic row when the send fails", async () => {
    // The failed row is RETAINED, so a lingering tag would resolve the
    // wizard's pending set even though the daemon never got the answer.
    backendRequestMock.mockImplementation(async (method: string) => {
      if (method === "agent.get") return { agent: daemonPendingAgent };
      if (method === "agent.sendMessage") return { success: false, error: "Agent not found" };
      return {};
    });

    await expect(
      sendMessage(AGENT, "Q: ?\nA: yes", workspace(), {
        messageMetadata: { type: "question_answers", answeredQuestionsMessageId: "msg-a1" },
      }),
    ).rejects.toThrow();

    const userRow = (appStore.state.agentSessions?.byAgentId[AGENT]?.messages ?? []).find(
      (m) => m.role === "user",
    );
    expect(userRow).toBeDefined();
    expect(userRow?.metadata).toEqual({});
  }, 30000);

  it("throws when the transport rejects (BackendError-style JSON-RPC failure)", async () => {
    backendRequestMock.mockImplementation(async (method: string) => {
      if (method === "agent.get") return { agent: daemonPendingAgent };
      if (method === "agent.sendMessage") {
        throw new Error("Invalid params: content is required (-32602)");
      }
      return {};
    });

    await expect(sendMessage(AGENT, "will be dropped", workspace(), {})).rejects.toThrow();
    const session = appStore.state.agentSessions?.byAgentId[AGENT];
    expect(session?.isStreaming).toBe(false);
  }, 30000);
});
