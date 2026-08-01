import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { AgentStatus } from "$shared/types/agent.types";
import type { AgentSession, AgentMessage } from "$shared/types";

// FAKE seam: appClient.agents.get + agents.getConversation are stubbed so no
// daemon call (and never a mutation) happens. The service runs against the
// REAL configured store so the initializeChatRequested middleware and upsert
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
    chat: {
      // Standing subscription (chat-subscribe-service, same
      // initializeChatRequested trigger): inert here so this suite exercises
      // the read path alone.
      subscribe: vi.fn(() => () => {}),
    },
  },
}));

import { appClient } from "$lib/client";
import { store as appStore } from "$store/renderer/store";
import { initializeChatRequested } from "$store/renderer/slices/chat-state/chat-state-slice";
import { bulkUpsertSessions } from "$store/renderer/slices/agent-session/agent-session-slice";
import {
  selectAgentMessages,
  selectAgentSession,
  selectAgentIsResponding,
  selectAgentIsThinking,
} from "$store/renderer/slices/agent-session/agent-session-selectors";
import { selectTranscriptHydration } from "$store/renderer/slices/chat-state/chat-state-selectors";
import { loadChatTranscript } from "./chat-read-service";
import {
  clearPendingAgentDeletions,
  removePendingAgentDeletion,
  setPendingAgentDeletion,
} from "./utils/pending-agent-deletions";
import { shouldShowStoppedIndicator } from "$lib/components/chat/message-display-utils";

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
    clearPendingAgentDeletions();
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

  // Regression: with a soft-hidden deletion pending, the daemon still returns
  // the agent from `agent.get`, so a transcript load (e.g. via
  // initializeChatRequested from a lingering mount) used to re-upsert the
  // deleted session into the store.
  it("is a no-op while a soft-hidden deletion is pending for the agent", async () => {
    const agentId = "agent-chat-pending-del";
    setPendingAgentDeletion({
      wsId: WS,
      agentId,
      snapshot: makeSession({ id: agentId }),
      timer: null,
    });
    try {
      await loadChatTranscript(agentId);
      expect(agentsApi.get).not.toHaveBeenCalled();
      expect(agentsApi.getConversation).not.toHaveBeenCalled();
      expect(selectAgentSession.select(appStore.state, agentId)).toBeUndefined();
    } finally {
      removePendingAgentDeletion(agentId);
    }

    // Once the pending entry is gone (undo or commit), loads work again.
    agentsApi.get.mockResolvedValueOnce(makeSession({ id: agentId }) as never);
    agentsApi.getConversation.mockResolvedValueOnce(conversation([makeMessage("after", "a")]) as never);
    await loadChatTranscript(agentId);
    expect(agentsApi.get).toHaveBeenCalledWith(agentId);
    expect(selectAgentMessages.select(appStore.state, agentId).map((m) => m.id)).toEqual(["after"]);
  });

  // Regression (PR review): if the deletion becomes pending WHILE the load is
  // in flight (session already fetched, transcript paging underway), the
  // hydrated result must be discarded rather than upserted.
  it("discards an in-flight transcript load when a deletion becomes pending mid-request", async () => {
    const agentId = "agent-chat-midflight-del";
    agentsApi.get.mockResolvedValueOnce(makeSession({ id: agentId }) as never);
    let resolveConversation!: (value: unknown) => void;
    agentsApi.getConversation.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveConversation = resolve;
      }) as never,
    );

    const load = loadChatTranscript(agentId);
    await flush(); // let agent.get resolve; paging now blocked on getConversation
    setPendingAgentDeletion({
      wsId: WS,
      agentId,
      snapshot: makeSession({ id: agentId }),
      timer: null,
    });
    try {
      resolveConversation(conversation([makeMessage("stale", "s")]));
      await load;
      expect(selectAgentSession.select(appStore.state, agentId)).toBeUndefined();
      expect(selectAgentMessages.select(appStore.state, agentId)).toEqual([]);
    } finally {
      removePendingAgentDeletion(agentId);
    }
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

  it("coalesces concurrent loads into one shared fetch", async () => {
    agentsApi.get.mockResolvedValue(makeSession() as never);
    agentsApi.getConversation.mockResolvedValue(conversation([makeMessage("c", "shared")]) as never);

    // Requests arriving while a load is in flight share the in-flight read —
    // post-hydration convergence is owned by the standing chat.subscribe
    // delta reconcile, so no follow-up rerun is scheduled.
    await Promise.all([
      loadChatTranscript(AGENT),
      loadChatTranscript(AGENT),
      loadChatTranscript(AGENT),
    ]);

    expect(agentsApi.getConversation).toHaveBeenCalledTimes(1);
  });

  it("dispatching initializeChatRequested triggers a load (middleware wiring)", async () => {
    // Own agent id: keeps this wiring assertion independent of transcript
    // state that earlier tests left behind for the shared AGENT.
    const agentId = "agent-middleware-wiring";
    agentsApi.get.mockResolvedValueOnce(makeSession({ id: agentId }) as never);
    agentsApi.getConversation.mockResolvedValueOnce(conversation([makeMessage("via-action", "x")]) as never);

    appStore.dispatch(initializeChatRequested(agentId, { wsId: WS }));
    await flush();

    expect(agentsApi.getConversation).toHaveBeenCalledWith(agentId, 200, undefined);
    expect(selectAgentMessages.select(appStore.state, agentId).map((m) => m.id)).toEqual(["via-action"]);
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

  // Regression: re-entering a conversation mid-turn briefly rendered the
  // in-flight streamed text (from the chat.subscribe seq-0 snapshot) and then
  // it DISAPPEARED until the next delta. Root cause: this read pages
  // agent.getConversation, which returns PERSISTED rows only (PROTOCOL §5.5 —
  // the live partial turn is carried solely by the chat.subscribe snapshot,
  // §7.1), and its full-list upsert landed AFTER the snapshot, clobbering the
  // snapshot-delivered partial assistant message. The read must preserve the
  // stream-owned in-flight message it cannot see.
  it("tab-switch mid-turn keeps the snapshot-delivered in-flight message (persisted-only read must not clobber it)", async () => {
    const agentId = "agent-tabswitch-inflight";
    const session = makeSession({
      id: agentId,
      status: AgentStatus.Active,
      isResponding: true,
      isProcessing: true,
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

    // Seed the store as the standing chat.subscribe seq-0 snapshot does on
    // re-entry: full session with the synthetic in-flight assistant message
    // and the in-flight flag pair set.
    appStore.dispatch(bulkUpsertSessions([{ ...session, messages: [userTurn, partial] }]));
    expect(selectAgentMessages.select(appStore.state, agentId).map((m) => m.id)).toEqual([
      "u1",
      "a1",
    ]);

    // The persisted read races in AFTER the snapshot: agent.getConversation
    // carries only the persisted user row — never the live partial turn.
    agentsApi.get.mockResolvedValue(session as never);
    agentsApi.getConversation.mockResolvedValue({
      messages: [userTurn],
      truncated: false,
      totalMessages: 1,
      nextToken: null,
    } as never);

    await loadChatTranscript(agentId);

    const after = selectAgentMessages.select(appStore.state, agentId);
    expect(after.map((m) => m.id)).toEqual(["u1", "a1"]);
    const streamed = after[1] as AgentMessage & { isStreaming?: boolean };
    expect(streamed.isStreaming).toBe(true);
    expect(streamed.contentBlocks?.[0]).toMatchObject({ type: "text", text: "Working" });
  });

  // Regression (monorepo#1160): a daemon crash mid-turn leaves a renderer-
  // local stream-owned partial in the store that the daemon never persisted.
  // On the next hydrate the fresh session reports IDLE (no turnInFlight /
  // isResponding / isStreaming), so preservation must not apply — otherwise
  // the ghost row survives every rehydrate forever.
  it("drops a stale stream-owned ghost when the fresh session reports no turn in flight", async () => {
    const agentId = "agent-stale-ghost-idle";
    const userTurn: AgentMessage = {
      id: "gu1",
      role: "user",
      timestamp: "2026-01-01T00:00:00.000Z",
      contentBlocks: [{ type: "text", text: "hi" }],
    };
    const ghostPartial = {
      id: "ga1",
      role: "assistant",
      timestamp: "2026-01-01T00:00:00.500Z",
      isStreaming: true,
      contentBlocks: [{ type: "text", id: "ga1:0", text: "Working" }],
    } as unknown as AgentMessage;

    // Seed the store as a pre-crash snapshot did: in-flight session with the
    // synthetic stream-owned assistant message.
    appStore.dispatch(
      bulkUpsertSessions([
        {
          ...makeSession({
            id: agentId,
            status: AgentStatus.Active,
            isResponding: true,
            isStreaming: true,
          }),
          messages: [userTurn, ghostPartial],
        },
      ]),
    );

    // Post-restart daemon state (PROTOCOL §5.5 AgentLite): the session is
    // idle and the persisted transcript never contains the partial row.
    agentsApi.get.mockResolvedValue(
      makeSession({
        id: agentId,
        status: AgentStatus.Idle,
        isResponding: false,
        isStreaming: false,
      }) as never,
    );
    agentsApi.getConversation.mockResolvedValue({
      messages: [userTurn],
      truncated: false,
      totalMessages: 1,
      nextToken: null,
    } as never);

    await loadChatTranscript(agentId);

    // The ghost partial is evicted — only the persisted row remains. (Runtime
    // flag convergence on upsert is slice behavior owned elsewhere; this test
    // covers the message-preservation gate only.)
    const after = selectAgentMessages.select(appStore.state, agentId);
    expect(after.map((m) => m.id)).toEqual(["gu1"]);
  });

  it("does not resurrect a finalized turn: fetched persisted row with the same id wins over the stale streaming copy", async () => {
    // If the turn finalized between the snapshot and the read completing, the
    // persisted read already carries the final row under the SAME message id.
    // The fetched (final) copy must win — no duplicate, no stale partial.
    const agentId = "agent-finalized-during-read";
    const userTurn: AgentMessage = {
      id: "fu1",
      role: "user",
      timestamp: "2026-01-01T00:00:00.000Z",
      contentBlocks: [{ type: "text", text: "go" }],
    };
    const stalePartial = {
      id: "fa1",
      role: "assistant",
      timestamp: "2026-01-01T00:00:00.500Z",
      isStreaming: true,
      contentBlocks: [{ type: "text", id: "fa1:0", text: "Work" }],
    } as unknown as AgentMessage;
    const finalRow: AgentMessage = {
      id: "fa1",
      role: "assistant",
      timestamp: "2026-01-01T00:00:00.500Z",
      contentBlocks: [
        { type: "text", text: "Work complete" },
        { type: "text", text: "All checks passed." },
      ],
    };
    appStore.dispatch(
      bulkUpsertSessions([
        {
          ...makeSession({
            id: agentId,
            status: AgentStatus.Active,
            isProcessing: true,
            isStreaming: true,
          }),
          messages: [userTurn, stalePartial],
        },
      ]),
    );

    agentsApi.get.mockResolvedValue(makeSession({ id: agentId }) as never);
    agentsApi.getConversation.mockResolvedValue({
      messages: [userTurn, finalRow],
      truncated: false,
      totalMessages: 2,
      nextToken: null,
    } as never);

    await loadChatTranscript(agentId);

    const after = selectAgentMessages.select(appStore.state, agentId);
    expect(after.map((m) => m.id)).toEqual(["fu1", "fa1"]);
    expect(after[1].contentBlocks?.[0]).toMatchObject({ type: "text", text: "Work complete" });
    expect((after[1] as AgentMessage & { isStreaming?: boolean }).isStreaming).toBeUndefined();
  });

  // Regression (intentd#336): after a user interrupts mid-stream, the daemon
  // persists the streamed-so-far partial as an interrupted assistant row
  // (`metadata.interrupted: true` + `metadata.stopReason: "interrupted"`, the
  // turn's minted message id). Hydration must render that row as-is — blocks
  // AND metadata intact — so the transcript keeps the partial output and the
  // Stopped indicator shows.
  it("hydrates a persisted interrupted partial row verbatim (blocks + interrupted metadata → Stopped indicator)", async () => {
    const agentId = "agent-interrupted-partial";
    agentsApi.get.mockResolvedValueOnce(
      makeSession({
        id: agentId,
        status: AgentStatus.Idle,
        isResponding: false,
        isStreaming: false,
      }) as never,
    );
    const userTurn: AgentMessage = {
      id: "0190c1d2-user",
      role: "user",
      timestamp: "2026-07-22T10:00:00.000Z",
      contentBlocks: [{ type: "text", text: "Summarize the repo" }],
    };
    // Wire shape per intentd#336 (flush_partial_turn_on_interruption): the
    // partial turn persisted under the turn's minted message id with the
    // interrupted metadata pair.
    const interruptedPartial = {
      id: "0190c1d2-asst",
      role: "assistant",
      timestamp: "2026-07-22T10:00:01.000Z",
      contentBlocks: [
        { type: "text", id: "0190c1d2-asst:0", text: "The repo contains" },
        {
          type: "tool_use",
          id: "0190c1d2-asst:1",
          name: "Read",
          toolCallId: "call-int",
          input: { path: "README.md" },
        },
      ],
      metadata: { interrupted: true, stopReason: "interrupted" },
    } as unknown as AgentMessage;
    agentsApi.getConversation.mockResolvedValueOnce(
      conversation([userTurn, interruptedPartial]) as never,
    );

    await loadChatTranscript(agentId);

    const rendered = selectAgentMessages.select(appStore.state, agentId);
    expect(rendered.map((m) => m.id)).toEqual(["0190c1d2-user", "0190c1d2-asst"]);
    const stored = rendered[1] as AgentMessage & { isStreaming?: boolean };
    // The streamed-so-far deltas are NOT erased.
    expect(stored.contentBlocks?.map((b) => b.type)).toEqual(["text", "tool_use"]);
    expect(stored.contentBlocks?.[0]).toMatchObject({
      type: "text",
      text: "The repo contains",
    });
    // Metadata rendered verbatim → the Stopped indicator condition holds.
    expect(stored.metadata).toMatchObject({
      interrupted: true,
      stopReason: "interrupted",
    });
    expect(stored.isStreaming).toBeUndefined();
    expect(shouldShowStoppedIndicator({ message: stored, isStreaming: false })).toBe(true);
    expect(selectAgentIsResponding.select(appStore.state, agentId)).toBe(false);
  });

  // Transcript hydration status tracking tests
  it("dispatches loading→settled on successful load", async () => {
    const agentId = "agent-hydration-success";
    agentsApi.get.mockResolvedValueOnce(makeSession({ id: agentId }) as never);
    agentsApi.getConversation.mockResolvedValueOnce(
      conversation([makeMessage("m1", "hello")]) as never,
    );

    // Before load starts, status is undefined
    expect(selectTranscriptHydration.select(appStore.state, agentId)).toBeUndefined();

    const loadPromise = loadChatTranscript(agentId);

    // After call (synchronously), status should be 'loading'
    expect(selectTranscriptHydration.select(appStore.state, agentId)).toBe("loading");

    await loadPromise;

    // After completion, status should be 'settled'
    expect(selectTranscriptHydration.select(appStore.state, agentId)).toBe("settled");
  });

  it("dispatches loading→settled even on error (errors are swallowed)", async () => {
    const agentId = "agent-hydration-error";
    agentsApi.get.mockResolvedValueOnce(makeSession({ id: agentId }) as never);
    agentsApi.getConversation.mockRejectedValueOnce(new Error("network failure") as never);

    expect(selectTranscriptHydration.select(appStore.state, agentId)).toBeUndefined();

    const loadPromise = loadChatTranscript(agentId);
    expect(selectTranscriptHydration.select(appStore.state, agentId)).toBe("loading");

    await loadPromise;

    // Even on error, status should be 'settled' (errors are swallowed in finally)
    expect(selectTranscriptHydration.select(appStore.state, agentId)).toBe("settled");
  });

  it("coalesced loads share hydration status correctly", async () => {
    const agentId = "agent-hydration-coalesced";
    agentsApi.get.mockResolvedValue(makeSession({ id: agentId }) as never);
    agentsApi.getConversation.mockResolvedValue(
      conversation([makeMessage("c1", "shared")]) as never,
    );

    expect(selectTranscriptHydration.select(appStore.state, agentId)).toBeUndefined();

    const [p1, p2, p3] = [
      loadChatTranscript(agentId),
      loadChatTranscript(agentId),
      loadChatTranscript(agentId),
    ];

    // All see loading status immediately (synchronous)
    expect(selectTranscriptHydration.select(appStore.state, agentId)).toBe("loading");

    await Promise.all([p1, p2, p3]);

    // All complete with settled status
    expect(selectTranscriptHydration.select(appStore.state, agentId)).toBe("settled");
    // All three calls share the single in-flight fetch.
    expect(agentsApi.getConversation).toHaveBeenCalledTimes(1);
  });

  it("failed hydration for existing conversation marks settled with empty messages", async () => {
    const agentId = "agent-existing-failed-hydration";
    // Session exists (backend would have returned backendSessionId !== null)
    // but hydration fails leaving messages empty in the FE store
    const existingSession = makeSession({
      id: agentId,
      backendSessionId: "sess_existing123", // Non-null indicates prior messages exist on backend
    });

    agentsApi.get.mockResolvedValueOnce(existingSession as never);
    agentsApi.getConversation.mockRejectedValueOnce(new Error("fetch failed") as never);

    expect(selectTranscriptHydration.select(appStore.state, agentId)).toBeUndefined();

    const loadPromise = loadChatTranscript(agentId);
    expect(selectTranscriptHydration.select(appStore.state, agentId)).toBe("loading");

    await loadPromise;

    // After failure, status is 'settled' (errors are swallowed)
    expect(selectTranscriptHydration.select(appStore.state, agentId)).toBe("settled");

    // Messages remain empty (no upsert happened due to error)
    const messages = selectAgentMessages.select(appStore.state, agentId);
    expect(messages).toHaveLength(0);

    // The returned session from agents.get had a non-null backendSessionId,
    // which is the signal ChatPanel uses to distinguish "new session (never
    // had messages)" from "existing session (hydration failed)". This test
    // exercises the service-level hydration lifecycle; the ChatPanel guard
    // logic is tested separately in component tests.
  });

  // BE-truncation convergence: the hydration read replaces the transcript
  // with the fetched set as-is, so a BE-side truncation (edit/regenerate
  // refetch convergence, iOS editAndRegenerate, daemon agent.replaceMessages)
  // SHRINKS the transcript instead of leaving ghost rows.
  it("shrinks the transcript when a refetch returns a BE-truncated set", async () => {
    const agentId = "agent-truncation-converge";
    const userTurn: AgentMessage = {
      id: "trunc-user",
      role: "user",
      timestamp: "2026-01-01T00:00:00.000Z",
      contentBlocks: [{ type: "text", text: "keep me" }],
    };
    agentsApi.get.mockResolvedValue(makeSession({ id: agentId }) as never);
    agentsApi.getConversation.mockResolvedValueOnce(
      conversation([userTurn, makeMessage("trunc-asst-old", "dropped by BE")]) as never,
    );
    await loadChatTranscript(agentId);
    expect(selectAgentMessages.select(appStore.state, agentId).map((m) => m.id)).toEqual([
      "trunc-user",
      "trunc-asst-old",
    ]);

    // BE truncated the transcript (e.g. edit/regenerate); the refetch returns
    // [user] only. trunc-asst-old must be dropped, not retained as a ghost.
    agentsApi.getConversation.mockResolvedValueOnce(conversation([userTurn]) as never);
    await loadChatTranscript(agentId);

    expect(selectAgentMessages.select(appStore.state, agentId).map((m) => m.id)).toEqual([
      "trunc-user",
    ]);
  });
});

