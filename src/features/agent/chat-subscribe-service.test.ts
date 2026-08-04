import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { AgentStatus } from "$shared/types/agent.types";
import type { AgentMessage, AgentSession } from "$shared/types";
import type { ChatLiveStreamPhase, ChatTranscript } from "$lib/client/app-client";

// FAKE seam: chat.subscribe is stubbed so no daemon call happens; each call
// records its handler (so tests can push §7.1-shaped reconciled transcripts)
// and returns a spy disposer. agents.get/getConversation + subscribeSnapshot
// keep the sibling chat-read middleware (same initializeChatRequested
// trigger, real store) inert. READ-ONLY: never a mutation.
vi.mock("$lib/client", () => {
  const subscriptions: Array<{
    agentId: string;
    handler: (transcript: ChatTranscript) => void;
    onPhase?: (phase: string) => void;
    unsubscribe: ReturnType<typeof vi.fn>;
  }> = [];
  return {
    appClient: {
      agents: {
        get: vi.fn(() => Promise.resolve(null)),
        getConversation: vi.fn(() =>
          Promise.resolve({ messages: [], truncated: false, totalMessages: 0, nextToken: null }),
        ),
      },
      chat: {
        subscribeSnapshot: vi.fn(() =>
          Promise.resolve({ messages: [], truncated: false, totalMessages: 0 }),
        ),
        subscribe: vi.fn(
          (
            agentId: string,
            handler: (transcript: ChatTranscript) => void,
            onPhase?: (phase: string) => void,
          ) => {
            const unsubscribe = vi.fn();
            subscriptions.push({ agentId, handler, onPhase, unsubscribe });
            return unsubscribe;
          },
        ),
      },
    },
    __chatSubscriptions: subscriptions,
  };
});

import * as clientModule from "$lib/client";
import { appClient } from "$lib/client";
import { store as appStore } from "$store/renderer/store";
import {
  initializeChatRequested,
  transcriptHydrationSettled,
} from "$store/renderer/slices/chat-state/chat-state-slice";
import {
  addMessage,
  bulkUpsertSessions,
  clearAllSessions,
  removeSession,
  removeWorkspaceSessions,
  updateSession,
} from "$store/renderer/slices/agent-session/agent-session-slice";
import { CHIEF_WORKSPACE_ID } from "$shared/types/branded-ids";
import { workspaceDeleted } from "$store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice";
import { selectChatLiveStreamPhase } from "$store/renderer/slices/chat-state/chat-state-selectors";
import {
  selectAgentMessages,
  selectAgentSession,
} from "$store/renderer/slices/agent-session/agent-session-selectors";
import {
  clearCurrentlyViewedAgent,
  markAgentAsViewed,
} from "$store/renderer/slices/unread-tracking/unread-tracking-slice";
import {
  __resetChatSubscribeServiceForTests,
  hasLiveChatSubscription,
} from "./chat-subscribe-service";
import {
  clearPendingAgentDeletions,
  removePendingAgentDeletion,
  setPendingAgentDeletion,
} from "./utils/pending-agent-deletions";
import { shouldShowStoppedIndicator } from "$lib/components/chat/message-display-utils";

type FakeSubscription = {
  agentId: string;
  handler: (transcript: ChatTranscript) => void;
  onPhase?: (phase: ChatLiveStreamPhase) => void;
  unsubscribe: ReturnType<typeof vi.fn>;
};

const fakeSubscriptions = (
  clientModule as unknown as { __chatSubscriptions: FakeSubscription[] }
).__chatSubscriptions;
const chatApi = appClient.chat as unknown as { subscribe: ReturnType<typeof vi.fn> };

const WS = "ws-chat-sub-1";

function makeSession(agentId: string, overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id: agentId,
    backendSessionId: null,
    workspaceId: WS,
    name: "Agent Sub",
    status: AgentStatus.Active,
    messages: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as AgentSession;
}

function makeMessage(id: string, text: string, overrides: Partial<AgentMessage> = {}): AgentMessage {
  return {
    id,
    role: "assistant",
    timestamp: "2026-01-01T00:00:01.000Z",
    contentBlocks: [{ type: "text", id: `${id}:0`, text }],
    ...overrides,
  };
}

function transcript(messages: AgentMessage[], isStreaming = false): ChatTranscript {
  return { messages, truncated: false, totalMessages: messages.length, isStreaming };
}

function seedSession(agentId: string, overrides: Partial<AgentSession> = {}): void {
  appStore.dispatch(bulkUpsertSessions([makeSession(agentId, overrides)]));
}

function openChat(agentId: string): FakeSubscription {
  appStore.dispatch(initializeChatRequested(agentId, { wsId: WS }));
  const sub = fakeSubscriptions.find((s) => s.agentId === agentId);
  if (!sub) throw new Error(`no chat.subscribe recorded for ${agentId}`);
  return sub;
}

describe("chatSubscribeService (fake seam, real store)", () => {
  beforeAll(() => appStore.init());
  afterEach(() => {
    __resetChatSubscribeServiceForTests();
    clearPendingAgentDeletions();
    fakeSubscriptions.length = 0;
    vi.clearAllMocks();
  });

  it("initializeChatRequested opens exactly one standing subscription per agent", () => {
    const agentId = "agent-sub-open";
    seedSession(agentId);
    appStore.dispatch(initializeChatRequested(agentId, { wsId: WS }));
    appStore.dispatch(initializeChatRequested(agentId, { wsId: WS }));

    const calls = chatApi.subscribe.mock.calls.filter(([id]) => id === agentId);
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe(agentId);
  });

  it("hydrates the transcript from the seq-0 snapshot emit and live-updates on delta emits", () => {
    const agentId = "agent-sub-hydrate";
    seedSession(agentId);
    const sub = openChat(agentId);

    // seq-0 snapshot emit: user + assistant page.
    const user = makeMessage("0190a1b2-user", "Run the tests", {
      role: "user",
      timestamp: "2026-01-01T00:00:00.000Z",
    });
    const asst = makeMessage("0190a200-asst", "Let me check.");
    sub.handler(transcript([user, asst]));

    expect(hasLiveChatSubscription(agentId)).toBe(true);
    expect(selectAgentMessages.select(appStore.state, agentId).map((m) => m.id)).toEqual([
      "0190a1b2-user",
      "0190a200-asst",
    ]);

    // Delta emit: the assistant block grew (reconciler emits the full list).
    const grown = makeMessage("0190a200-asst", "Let me check the logs first.");
    sub.handler(transcript([user, grown], true));

    const messages = selectAgentMessages.select(appStore.state, agentId);
    expect(messages.map((m) => m.id)).toEqual(["0190a1b2-user", "0190a200-asst"]);
    expect(messages[1].contentBlocks?.[0]).toMatchObject({
      text: "Let me check the logs first.",
    });
  });

  it("dedups the optimistic user row against the canonical copy by appMessageId", () => {
    const agentId = "agent-sub-optimistic";
    seedSession(agentId);
    const sub = openChat(agentId);
    sub.handler(transcript([]));

    // Optimistic append (agent-send path): renderer-minted id +
    // client appMessageId.
    const appMessageId = "app-msg-opt-1";
    appStore.dispatch(
      addMessage(agentId, {
        id: "renderer-minted-user",
        appMessageId,
        role: "user",
        timestamp: "2026-01-01T00:00:02.000Z",
        contentBlocks: [{ type: "text", text: "hello" }],
      }),
    );

    // Daemon echoes the persisted user row with the same appMessageId lifted
    // (PROTOCOL §5.5 userAppMessageId) under the canonical row id.
    const canonical: AgentMessage = {
      id: "msg_canonical-user-1",
      appMessageId,
      role: "user",
      timestamp: "2026-01-01T00:00:02.100Z",
      contentBlocks: [{ type: "text", id: "msg_canonical-user-1:0", text: "hello" }],
    };
    sub.handler(transcript([canonical]));

    const messages = selectAgentMessages.select(appStore.state, agentId);
    const userRows = messages.filter((m) => m.role === "user");
    expect(userRows).toHaveLength(1);
    expect(userRows[0].id).toBe("msg_canonical-user-1");
    expect(userRows[0].appMessageId).toBe(appMessageId);
  });

  it("dedups the optimistic user row by appMessageId even when the canonical content differs (§7.1 delta path)", () => {
    // intentd#781: the daemon echoes appMessageId on §7.1 user-row deltas, so
    // the reconciled canonical copy carries the client-minted logical id.
    // Exact appMessageId matching wins over every content heuristic — the
    // rows collapse even when the daemon-persisted content was normalized
    // and no longer hashes equal to the optimistic copy.
    const agentId = "agent-sub-optimistic-appid-diff";
    seedSession(agentId);
    const sub = openChat(agentId);
    sub.handler(transcript([]));

    const appMessageId = "app-msg-opt-3";
    appStore.dispatch(
      addMessage(agentId, {
        id: "0190bbbb-optimistic-user",
        appMessageId,
        role: "user",
        timestamp: "2026-01-01T00:00:02.000Z",
        contentBlocks: [{ type: "text", text: "deploy now\r\n" }],
      }),
    );

    // Canonical delta echo: server-minted user-msg id, SAME appMessageId,
    // daemon-normalized content (differs from the optimistic copy).
    const canonical: AgentMessage = {
      id: "user-msg-aaaa1111-2222-3333-4444-555566667777",
      appMessageId,
      role: "user",
      timestamp: "2026-01-01T00:00:02.100Z",
      contentBlocks: [
        {
          type: "text",
          id: "user-msg-aaaa1111-2222-3333-4444-555566667777:0",
          text: "deploy now",
        },
      ],
    };
    sub.handler(transcript([canonical]));

    const messages = selectAgentMessages.select(appStore.state, agentId);
    const userRows = messages.filter((m) => m.role === "user");
    expect(userRows).toHaveLength(1);
    expect(userRows[0].id).toBe("user-msg-aaaa1111-2222-3333-4444-555566667777");
    expect(userRows[0].appMessageId).toBe(appMessageId);
  });

  it("keeps identical-content sends distinct when their appMessageIds differ (§7.1 delta path)", () => {
    // Two messages with the SAME text sent in quick succession are distinct
    // logical messages: each optimistic row and each canonical echo carries
    // its own appMessageId, so id matching pairs them one-to-one and the
    // content fallback (gated off when both sides carry an appMessageId)
    // never collapses them into one row.
    const agentId = "agent-sub-identical-content";
    seedSession(agentId);
    const sub = openChat(agentId);
    sub.handler(transcript([]));

    for (const [rendererId, appMessageId] of [
      ["0190cccc-optimistic-a", "app-msg-same-a"],
      ["0190cccc-optimistic-b", "app-msg-same-b"],
    ] as const) {
      appStore.dispatch(
        addMessage(agentId, {
          id: rendererId,
          appMessageId,
          role: "user",
          timestamp: "2026-01-01T00:00:02.000Z",
          contentBlocks: [{ type: "text", text: "run it again" }],
        }),
      );
    }

    // First echo lands alone: it must collapse ONLY its own optimistic row.
    const canonicalA: AgentMessage = {
      id: "user-msg-aaaa0000-1111-2222-3333-444444444444",
      appMessageId: "app-msg-same-a",
      role: "user",
      timestamp: "2026-01-01T00:00:02.050Z",
      contentBlocks: [
        {
          type: "text",
          id: "user-msg-aaaa0000-1111-2222-3333-444444444444:0",
          text: "run it again",
        },
      ],
    };
    sub.handler(transcript([canonicalA]));

    let userRows = selectAgentMessages
      .select(appStore.state, agentId)
      .filter((m) => m.role === "user");
    expect(userRows).toHaveLength(2);
    expect(userRows.map((m) => m.appMessageId).sort()).toEqual([
      "app-msg-same-a",
      "app-msg-same-b",
    ]);

    // Second echo arrives: both rows are canonical, still two messages.
    const canonicalB: AgentMessage = {
      id: "user-msg-bbbb0000-1111-2222-3333-444444444444",
      appMessageId: "app-msg-same-b",
      role: "user",
      timestamp: "2026-01-01T00:00:02.150Z",
      contentBlocks: [
        {
          type: "text",
          id: "user-msg-bbbb0000-1111-2222-3333-444444444444:0",
          text: "run it again",
        },
      ],
    };
    sub.handler(transcript([canonicalA, canonicalB]));

    userRows = selectAgentMessages
      .select(appStore.state, agentId)
      .filter((m) => m.role === "user");
    expect(userRows).toHaveLength(2);
    expect(userRows.map((m) => m.id)).toEqual([
      "user-msg-aaaa0000-1111-2222-3333-444444444444",
      "user-msg-bbbb0000-1111-2222-3333-444444444444",
    ]);
  });

  it("dedups the optimistic user row against a canonical user-msg echo lacking appMessageId (§7.1 delta path)", () => {
    // Version-skew fallback: an OLDER daemon's §7.1 user-row delta carries no
    // appMessageId, so the reconciled canonical copy arrives with only its
    // server-minted `user-msg-{uuid}` id. The optimistic row must still
    // collapse against it (content fallback recognizes the daemon-canonical
    // user-msg id), or every normal send — including structured-question
    // Q:/A: answers, which take the same send path — renders twice until a
    // refresh. The same shape applies to both, so one test covers them.
    const agentId = "agent-sub-optimistic-no-appid";
    seedSession(agentId);
    const sub = openChat(agentId);
    sub.handler(transcript([]));

    appStore.dispatch(
      addMessage(agentId, {
        id: "0190aaaa-optimistic-user",
        appMessageId: "app-msg-opt-2",
        role: "user",
        timestamp: "2026-01-01T00:00:02.000Z",
        contentBlocks: [{ type: "text", text: "Q: Deploy now?\nA: Yes" }],
      }),
    );

    // The delta-path echo: canonical daemon row id, same content, NO
    // appMessageId (entity_with_role does not include it).
    const canonical: AgentMessage = {
      id: "user-msg-7c1f4e0a-1111-2222-3333-444455556666",
      role: "user",
      timestamp: "2026-01-01T00:00:02.100Z",
      contentBlocks: [
        {
          type: "text",
          id: "user-msg-7c1f4e0a-1111-2222-3333-444455556666:0",
          text: "Q: Deploy now?\nA: Yes",
        },
      ],
    };
    sub.handler(transcript([canonical]));

    const messages = selectAgentMessages.select(appStore.state, agentId);
    const userRows = messages.filter((m) => m.role === "user");
    expect(userRows).toHaveLength(1);
    expect(userRows[0].id).toBe("user-msg-7c1f4e0a-1111-2222-3333-444455556666");
    // The optimistic side's logical id survives the merge.
    expect(userRows[0].appMessageId).toBe("app-msg-opt-2");
  });

  it("preserves store-only rows the snapshot page does not cover (older paged history)", () => {
    const agentId = "agent-sub-paged";
    // Full-history hydration (chat-read-service) landed an older message the
    // newest snapshot page no longer includes.
    const older = makeMessage("older-page-msg", "old history", {
      timestamp: "2025-12-31T23:00:00.000Z",
    });
    seedSession(agentId, { messages: [older] });
    const sub = openChat(agentId);

    const newest = makeMessage("newest-msg", "recent");
    sub.handler(transcript([newest]));

    expect(selectAgentMessages.select(appStore.state, agentId).map((m) => m.id)).toEqual([
      "older-page-msg",
      "newest-msg",
    ]);
  });

  it("edge-triggers streaming flags from transcript.isStreaming and never clobbers a fresh optimistic turn", () => {
    const agentId = "agent-sub-flags";
    // Simulate the optimistic send: both runtime flags on before the first emit.
    seedSession(agentId, { isStreaming: true, isProcessing: true });
    const sub = openChat(agentId);

    // First emit reports isStreaming=false (snapshot raced the turn start).
    // No falling edge has occurred — the optimistic flags must survive.
    sub.handler(transcript([makeMessage("m-1", "hi")]));
    let session = selectAgentSession.select(appStore.state, agentId);
    expect(session?.isStreaming).toBe(true);
    expect(session?.isProcessing).toBe(true);

    // Rising edge: a live delta says the turn is in flight.
    sub.handler(transcript([makeMessage("m-1", "hi there")], true));
    session = selectAgentSession.select(appStore.state, agentId);
    expect(session?.isStreaming).toBe(true);

    // Falling edge: terminal frame — all responding flags clear.
    sub.handler(transcript([makeMessage("m-1", "hi there!")], false));
    session = selectAgentSession.select(appStore.state, agentId);
    expect(session?.isStreaming).toBe(false);
    expect(session?.isProcessing).toBe(false);
    expect(session?.isResponding).toBe(false);
  });

  it("swaps subscriptions on agent switch without leaking the previous registration", () => {
    const agentA = "agent-sub-switch-a";
    const agentB = "agent-sub-switch-b";
    seedSession(agentA);
    seedSession(agentB);
    const subA = openChat(agentA);

    // Switching to B: ChatPanel dispatches markAgentAsViewed(B) (and its own
    // initializeChatRequested on mount).
    appStore.dispatch(markAgentAsViewed(agentB));
    expect(subA.unsubscribe).toHaveBeenCalledTimes(1);
    expect(hasLiveChatSubscription(agentA)).toBe(false);
    // B's subscription opened from the switch (session already in store).
    const subB = fakeSubscriptions.find((s) => s.agentId === agentB);
    expect(subB).toBeDefined();

    // A late push from A's disposed registration must not write.
    const before = selectAgentMessages.select(appStore.state, agentA);
    subA.handler(transcript([makeMessage("late-a", "stale")]));
    expect(selectAgentMessages.select(appStore.state, agentA)).toBe(before);
  });

  it("clears stale message-level streaming flags when a mid-turn subscription closes (navigate-away)", () => {
    // Viewed mid-turn then navigated away: the delta stream grew a message
    // with isStreaming: true, and nothing else rewrites it after the
    // subscription closes. The stale flag would keep the AgentCard tier-1
    // frozen buffer winning over the push-applied lastAgentResponse that IS
    // advancing (~1s activity pings), so closeChatSubscription normalizes
    // the flags on teardown.
    const agentA = "agent-sub-stale-a";
    const agentB = "agent-sub-stale-b";
    seedSession(agentA);
    seedSession(agentB);
    const subA = openChat(agentA);

    subA.handler(
      transcript(
        [makeMessage("partial-a", "streamed so far", { isStreaming: true })],
        true,
      ),
    );
    expect(
      selectAgentMessages.select(appStore.state, agentA).find((m) => m.id === "partial-a")
        ?.isStreaming,
    ).toBe(true);

    // Navigate away mid-turn: markAgentAsViewed(B) closes A's subscription.
    appStore.dispatch(markAgentAsViewed(agentB));
    expect(hasLiveChatSubscription(agentA)).toBe(false);

    const partial = selectAgentMessages
      .select(appStore.state, agentA)
      .find((m) => m.id === "partial-a");
    expect(partial?.isStreaming).toBe(false);
    expect(partial?.streamingComplete).toBe(true);
    // Content untouched — only the flags normalize.
    expect(partial?.contentBlocks?.[0]).toMatchObject({ text: "streamed so far" });
  });

  it("tears down all subscriptions when the chat closes (clearCurrentlyViewedAgent)", () => {
    const agentId = "agent-sub-close";
    seedSession(agentId);
    const sub = openChat(agentId);

    appStore.dispatch(clearCurrentlyViewedAgent());
    expect(sub.unsubscribe).toHaveBeenCalledTimes(1);
    expect(hasLiveChatSubscription(agentId)).toBe(false);
  });

  it("renders the interrupted partial row with Stopped metadata after the §7.2 terminal reconcile", () => {
    // Interrupt-send during streaming (cloudlands-fe#132): the daemon
    // persists the partial row before agent:stream:end, so the terminal
    // reconcile's transcript CONTAINS the streamed message tagged with
    // `metadata.interrupted` / `metadata.stopReason` (§7.2). The store must
    // keep the partial blocks and the Stopped indicator must render once the
    // stream is over. On an interrupt-priority send the interrupted row
    // precedes the new user message.
    const agentId = "agent-sub-interrupt";
    seedSession(agentId);
    const sub = openChat(agentId);

    // Live partial mid-turn.
    const partial = makeMessage("0190a200-asst", "Partial ");
    sub.handler(transcript([partial], true));
    expect(selectAgentSession.select(appStore.state, agentId)?.isStreaming).toBe(true);

    // Terminal reconcile after the interrupt-priority send: the persisted
    // interrupted row (same id, Stopped metadata) followed by the new user
    // message; isStreaming falls.
    const interrupted = makeMessage("0190a200-asst", "Partial ", {
      metadata: { interrupted: true, stopReason: "interrupted" },
    });
    const nextUser = makeMessage("0190a1c0-user2", "Do this instead", {
      role: "user",
      timestamp: "2026-01-01T00:00:03.000Z",
    });
    sub.handler(transcript([interrupted, nextUser]));

    const messages = selectAgentMessages.select(appStore.state, agentId);
    expect(messages.map((m) => m.id)).toEqual(["0190a200-asst", "0190a1c0-user2"]);
    // The partial output survives — not wiped, not replaced by a placeholder.
    expect(messages[0].contentBlocks?.[0]).toMatchObject({ text: "Partial " });
    expect(messages[0].metadata).toMatchObject({
      interrupted: true,
      stopReason: "interrupted",
    });
    const session = selectAgentSession.select(appStore.state, agentId);
    expect(session?.isStreaming).toBe(false);
    // The Stopped indicator renders from the persisted metadata now that the
    // stream is over (and stays hidden while one is still in flight).
    expect(
      shouldShowStoppedIndicator({ message: messages[0], isStreaming: false }),
    ).toBe(true);
    expect(
      shouldShowStoppedIndicator({ message: messages[0], isStreaming: true }),
    ).toBe(false);
  });

  it("does not open a subscription while a soft-hidden deletion is pending, and tears down on removeSession", () => {
    const agentId = "agent-sub-deleted";
    seedSession(agentId);
    setPendingAgentDeletion({
      wsId: WS,
      agentId,
      snapshot: makeSession(agentId),
      timer: null,
    });
    try {
      appStore.dispatch(initializeChatRequested(agentId, { wsId: WS }));
      expect(chatApi.subscribe.mock.calls.filter(([id]) => id === agentId)).toHaveLength(0);
    } finally {
      removePendingAgentDeletion(agentId);
    }

    // Once the pending entry is gone, opening works; the soft-hide dispatch
    // (removeSession) then closes it.
    const sub = openChat(agentId);
    appStore.dispatch(removeSession(agentId));
    expect(sub.unsubscribe).toHaveBeenCalledTimes(1);
    expect(hasLiveChatSubscription(agentId)).toBe(false);
  });

  it("re-applies the last reconciled transcript when a slower hydrate settles without the finalized row (monorepo#1161)", () => {
    // Hydrate/finalize race: the standing subscription's reconcile delivered
    // the finalized assistant row, then a slower chat-read hydrate (whose
    // paged fetch predates the finalize) lands a full-list upsert WITHOUT
    // that row — clobbering it. The persisted row is not stream-owned
    // (isStreaming false), so the read-side guard cannot preserve it; the
    // subscription must re-assert its canonical transcript on
    // transcriptHydrationSettled.
    const agentId = "agent-sub-hydrate-race";
    seedSession(agentId);
    const sub = openChat(agentId);

    const user = makeMessage("0190a1b2-user", "Run the tests", {
      role: "user",
      timestamp: "2026-01-01T00:00:00.000Z",
    });
    const finalized = makeMessage("0190a200-asst", "All tests pass.");
    sub.handler(transcript([user, finalized]));
    expect(selectAgentMessages.select(appStore.state, agentId).map((m) => m.id)).toEqual([
      "0190a1b2-user",
      "0190a200-asst",
    ]);

    // The stale hydrate lands: full-list upsert covering only the user row.
    appStore.dispatch(bulkUpsertSessions([makeSession(agentId, { messages: [user] })]));
    expect(selectAgentMessages.select(appStore.state, agentId).map((m) => m.id)).toEqual([
      "0190a1b2-user",
    ]);

    // Hydration settles: the subscription re-asserts its last transcript.
    appStore.dispatch(transcriptHydrationSettled(agentId));
    expect(selectAgentMessages.select(appStore.state, agentId).map((m) => m.id)).toEqual([
      "0190a1b2-user",
      "0190a200-asst",
    ]);
  });

  it("does not re-fire the streaming edge when re-applying on hydrate settle", () => {
    const agentId = "agent-sub-settle-no-edge";
    seedSession(agentId);
    const sub = openChat(agentId);

    // Rising then falling edge: the turn streamed and finalized.
    sub.handler(transcript([makeMessage("m-turn", "working")], true));
    const finalized = makeMessage("m-turn", "done");
    sub.handler(transcript([finalized], false));
    expect(selectAgentSession.select(appStore.state, agentId)?.isStreaming).toBe(false);

    // A fresh optimistic turn starts (chatSendStarted equivalent) before the
    // stale hydrate settles.
    appStore.dispatch(updateSession(agentId, { isStreaming: true, isProcessing: true }));
    appStore.dispatch(bulkUpsertSessions([makeSession(agentId, { messages: [] })]));

    appStore.dispatch(transcriptHydrationSettled(agentId));

    // The re-apply restores the finalized row without re-dispatching the
    // already-consumed falling edge — the fresh optimistic flags survive.
    expect(selectAgentMessages.select(appStore.state, agentId).map((m) => m.id)).toEqual([
      "m-turn",
    ]);
    const session = selectAgentSession.select(appStore.state, agentId);
    expect(session?.isStreaming).toBe(true);
    expect(session?.isProcessing).toBe(true);
  });

  it("treats transcriptHydrationSettled as a no-op with no live subscription or before the first emit", () => {
    // No subscription at all.
    const agentA = "agent-sub-settle-nosub";
    const seeded = makeMessage("seeded-a", "hydrated history");
    seedSession(agentA, { messages: [seeded] });
    appStore.dispatch(transcriptHydrationSettled(agentA));
    expect(selectAgentMessages.select(appStore.state, agentA).map((m) => m.id)).toEqual([
      "seeded-a",
    ]);

    // Subscription open but nothing emitted yet.
    const agentB = "agent-sub-settle-preemit";
    seedSession(agentB, { messages: [makeMessage("seeded-b", "hydrated history")] });
    openChat(agentB);
    appStore.dispatch(transcriptHydrationSettled(agentB));
    expect(hasLiveChatSubscription(agentB)).toBe(false);
    expect(selectAgentMessages.select(appStore.state, agentB).map((m) => m.id)).toEqual([
      "seeded-b",
    ]);
  });

  it("keeps the viewed agent's subscription open when a background panel's trailing clearCurrentlyViewedAgent lands after the handoff (missing-live-turn regression)", () => {
    // Two agent tabs mounted in ONE panel (the panel system keeps inactive
    // tabs mounted for PANEL_TAB_CACHE_TTL_MS before unmounting). This is the
    // exact action sequence the two ChatPanels emit:
    //
    //   1. Switching BACK to tab A (earlier in tree order), A's unread
    //      effect runs first: markAgentAsViewed(A) closes B's subscription
    //      and reopens A's.
    //   2. THEN B's panel emits clearCurrentlyViewedAgent — from its
    //      deactivation effect, and again ~30s later from onDestroy when the
    //      tab cache evicts the hidden tab.
    //
    // Neither trailing clear means "no chat is viewed": A is still the
    // visible, viewed chat. Each panel scopes its clear to its own agent, so
    // B's trailing clear is a reducer no-op (A is viewed) and the middleware
    // must NOT map it to closeAllChatSubscriptions() — otherwise A's
    // subscription (the sole transcript writer) dies and A's next live turn
    // renders NOTHING (no thinking, no stop button) until a remount
    // re-initializes the chat.
    const agentA = "agent-sub-handoff-a";
    const agentB = "agent-sub-handoff-b";
    seedSession(agentA);
    seedSession(agentB);

    // A's ChatPanel mounts and is viewed.
    openChat(agentA);
    appStore.dispatch(markAgentAsViewed(agentA));

    // Switch A → B: A's deactivating panel clears (scoped to its own agent),
    // B's activating panel views + mounts.
    appStore.dispatch(clearCurrentlyViewedAgent(agentA));
    appStore.dispatch(markAgentAsViewed(agentB));
    openChat(agentB);

    // Switch back B → A: A's panel activates first and reopens A's
    // subscription…
    appStore.dispatch(markAgentAsViewed(agentA));
    const reopened = [...fakeSubscriptions].reverse().find((s) => s.agentId === agentA);
    expect(reopened).toBeDefined();

    // …then B's still-mounted panel emits the trailing clear (deactivation
    // effect now, onDestroy again on cache eviction — same dispatch).
    appStore.dispatch(clearCurrentlyViewedAgent(agentB));

    // REGRESSION: the trailing clear must not close the viewed agent's
    // standing subscription.
    expect(reopened!.unsubscribe).not.toHaveBeenCalled();

    // A live emit for the viewed agent must still apply to the store.
    reopened!.handler(transcript([makeMessage("live-turn-msg", "thinking…")], true));
    expect(hasLiveChatSubscription(agentA)).toBe(true);
    expect(selectAgentMessages.select(appStore.state, agentA).map((m) => m.id)).toContain(
      "live-turn-msg",
    );
  });

  describe("chief-workspace exemption from the viewed-agent swap (monorepo#1421)", () => {
    const CHIEF_AGENT = "agent-sub-chief";

    function seedChiefSession(agentId: string): void {
      seedSession(agentId, { workspaceId: CHIEF_WORKSPACE_ID });
    }

    function openChiefChat(agentId: string): FakeSubscription {
      appStore.dispatch(initializeChatRequested(agentId, { wsId: CHIEF_WORKSPACE_ID }));
      const sub = fakeSubscriptions.find((s) => s.agentId === agentId);
      if (!sub) throw new Error(`no chat.subscribe recorded for ${agentId}`);
      return sub;
    }

    it("keeps the chief subscription open — and live — when a workspace agent is marked as viewed", () => {
      const workspaceAgent = "agent-sub-chief-ws-viewed";
      seedChiefSession(CHIEF_AGENT);
      seedSession(workspaceAgent);
      const chiefSub = openChiefChat(CHIEF_AGENT);

      // The user opens a workspace chat while the Chief sidebar panel stays
      // mounted. The viewed-agent swap must not tear down the chief stream.
      openChat(workspaceAgent);
      appStore.dispatch(markAgentAsViewed(workspaceAgent));

      expect(chiefSub.unsubscribe).not.toHaveBeenCalled();

      // A live emit for the chief agent must still apply to the store.
      chiefSub.handler(transcript([makeMessage("chief-live", "still streaming")], true));
      expect(hasLiveChatSubscription(CHIEF_AGENT)).toBe(true);
      expect(selectAgentMessages.select(appStore.state, CHIEF_AGENT).map((m) => m.id)).toContain(
        "chief-live",
      );
    });

    it("does not close the viewed workspace agent's subscription when the chief agent is marked as viewed (symmetric)", () => {
      const workspaceAgent = "agent-sub-chief-symmetric";
      seedChiefSession(CHIEF_AGENT);
      seedSession(workspaceAgent);
      const wsSub = openChat(workspaceAgent);
      appStore.dispatch(markAgentAsViewed(workspaceAgent));

      // Focusing the Chief panel marks its agent as viewed — the open
      // workspace chat's subscription must survive the swap.
      openChiefChat(CHIEF_AGENT);
      appStore.dispatch(markAgentAsViewed(CHIEF_AGENT));

      expect(wsSub.unsubscribe).not.toHaveBeenCalled();
      wsSub.handler(transcript([makeMessage("ws-live", "still streaming")], true));
      expect(hasLiveChatSubscription(workspaceAgent)).toBe(true);
    });

    it("viewing one chief thread still closes another chief thread's subscription", () => {
      const otherChiefThread = "agent-sub-chief-thread-b";
      seedChiefSession(CHIEF_AGENT);
      seedChiefSession(otherChiefThread);
      const threadASub = openChiefChat(CHIEF_AGENT);
      openChiefChat(otherChiefThread);

      appStore.dispatch(markAgentAsViewed(otherChiefThread));

      expect(threadASub.unsubscribe).toHaveBeenCalledTimes(1);
    });

    it("spares the chief subscription when closing the last viewed workspace chat clears the viewed agent", () => {
      const workspaceAgent = "agent-sub-chief-chat-close";
      seedChiefSession(CHIEF_AGENT);
      seedSession(workspaceAgent);
      const chiefSub = openChiefChat(CHIEF_AGENT);
      const wsSub = openChat(workspaceAgent);
      appStore.dispatch(markAgentAsViewed(workspaceAgent));

      // The chat area closes: the applied clear tears down workspace
      // subscriptions but the chief panel is still open in the sidebar.
      appStore.dispatch(clearCurrentlyViewedAgent(workspaceAgent));
      expect(wsSub.unsubscribe).toHaveBeenCalledTimes(1);
      expect(chiefSub.unsubscribe).not.toHaveBeenCalled();
    });

    it("a clear scoped to the chief agent closes exactly the chief subscription, even while a workspace agent stays viewed", () => {
      const workspaceAgent = "agent-sub-chief-scoped-clear";
      seedChiefSession(CHIEF_AGENT);
      seedSession(workspaceAgent);
      const chiefSub = openChiefChat(CHIEF_AGENT);
      const wsSub = openChat(workspaceAgent);
      appStore.dispatch(markAgentAsViewed(workspaceAgent));

      // ChiefCard collapse / thread-switch destroy: the swap exempts chief
      // subscriptions, so this scoped clear is their only viewed-lifecycle
      // teardown — and it must not touch the still-viewed workspace chat.
      appStore.dispatch(clearCurrentlyViewedAgent(CHIEF_AGENT));
      expect(chiefSub.unsubscribe).toHaveBeenCalledTimes(1);
      expect(wsSub.unsubscribe).not.toHaveBeenCalled();
    });

    it("a scoped chief clear while the chief agent is itself viewed spares the workspace subscription (applied clear + chief branch)", () => {
      const workspaceAgent = "agent-sub-chief-viewed-clear";
      seedChiefSession(CHIEF_AGENT);
      seedSession(workspaceAgent);
      const chiefSub = openChiefChat(CHIEF_AGENT);
      const wsSub = openChat(workspaceAgent);
      appStore.dispatch(markAgentAsViewed(CHIEF_AGENT));

      // ChiefCard collapse while focused: the reducer applies the clear
      // (viewed → null) AND the chief branch runs — the workspace chat's
      // still-mounted panel must keep its subscription (no close-all).
      appStore.dispatch(clearCurrentlyViewedAgent(CHIEF_AGENT));
      expect(chiefSub.unsubscribe).toHaveBeenCalledTimes(1);
      expect(wsSub.unsubscribe).not.toHaveBeenCalled();
    });

    it("classifies the chief agent from its stored session when no subscription entry exists (readSession fallback)", () => {
      const workspaceAgent = "agent-sub-chief-session-fallback";
      seedChiefSession(CHIEF_AGENT);
      seedSession(workspaceAgent);
      const wsSub = openChat(workspaceAgent);
      appStore.dispatch(markAgentAsViewed(workspaceAgent));

      // Chief agent viewed with a seeded session but NO prior chief
      // subscription: the swap must classify it as chief via the session's
      // workspaceId — sparing the workspace subscription — and (re)open the
      // chief subscription.
      appStore.dispatch(markAgentAsViewed(CHIEF_AGENT));
      expect(wsSub.unsubscribe).not.toHaveBeenCalled();
      expect(
        chatApi.subscribe.mock.calls.filter(([id]) => id === CHIEF_AGENT),
      ).toHaveLength(1);
    });

    it("still closes chief subscriptions on removeWorkspaceSessions for the chief workspace", () => {
      seedChiefSession(CHIEF_AGENT);
      const chiefSub = openChiefChat(CHIEF_AGENT);

      appStore.dispatch(removeWorkspaceSessions(CHIEF_WORKSPACE_ID));

      expect(chiefSub.unsubscribe).toHaveBeenCalledTimes(1);
    });
  });

  describe("live stream phase mirroring", () => {
    const phaseOf = (agentId: string) => selectChatLiveStreamPhase.select(appStore.state, agentId);

    it("mirrors onPhase reports into the chat-state slice", () => {
      const agentId = "agent-sub-phase-mirror";
      seedSession(agentId);
      const sub = openChat(agentId);
      expect(sub.onPhase).toBeDefined();

      sub.onPhase!("connecting");
      expect(phaseOf(agentId)).toBe("connecting");
      sub.onPhase!("awaiting-snapshot");
      expect(phaseOf(agentId)).toBe("awaiting-snapshot");
      sub.onPhase!("live");
      expect(phaseOf(agentId)).toBe("live");
      sub.onPhase!("resyncing");
      expect(phaseOf(agentId)).toBe("resyncing");
      sub.onPhase!("delayed");
      expect(phaseOf(agentId)).toBe("delayed");
    });

    it("resets the phase to null on every subscription teardown path", () => {
      // removeSession (agent-deletion soft-hide).
      const agentA = "agent-sub-phase-remove";
      seedSession(agentA);
      openChat(agentA).onPhase!("connecting");
      expect(phaseOf(agentA)).toBe("connecting");
      appStore.dispatch(removeSession(agentA));
      expect(phaseOf(agentA)).toBeNull();

      // clearAllSessions.
      const agentB = "agent-sub-phase-clearall";
      seedSession(agentB);
      openChat(agentB).onPhase!("awaiting-snapshot");
      expect(phaseOf(agentB)).toBe("awaiting-snapshot");
      appStore.dispatch(clearAllSessions());
      expect(phaseOf(agentB)).toBeNull();

      // workspaceDeleted (drops the whole chat-state entry too).
      const agentC = "agent-sub-phase-wsdel";
      seedSession(agentC);
      openChat(agentC).onPhase!("resyncing");
      expect(phaseOf(agentC)).toBe("resyncing");
      appStore.dispatch(workspaceDeleted(WS, [agentC]));
      expect(phaseOf(agentC)).toBeNull();

      // clearCurrentlyViewedAgent with no agent left viewed (chat close).
      const agentD = "agent-sub-phase-clearview";
      seedSession(agentD);
      appStore.dispatch(markAgentAsViewed(agentD));
      openChat(agentD).onPhase!("delayed");
      expect(phaseOf(agentD)).toBe("delayed");
      appStore.dispatch(clearCurrentlyViewedAgent(agentD));
      expect(phaseOf(agentD)).toBeNull();
    });

    it("resets the phase on agent switch (markAgentAsViewed closes the other agent's stream)", () => {
      const agentA = "agent-sub-phase-switch-a";
      const agentB = "agent-sub-phase-switch-b";
      seedSession(agentA);
      seedSession(agentB);
      openChat(agentA).onPhase!("awaiting-snapshot");
      expect(phaseOf(agentA)).toBe("awaiting-snapshot");

      appStore.dispatch(markAgentAsViewed(agentB));
      expect(phaseOf(agentA)).toBeNull();
    });

    it("ignores phase reports from a superseded subscription entry", () => {
      const agentId = "agent-sub-phase-stale";
      seedSession(agentId);
      const stale = openChat(agentId);
      stale.onPhase!("live");
      appStore.dispatch(removeSession(agentId));
      expect(phaseOf(agentId)).toBeNull();

      // A late report from the closed entry must not resurrect a phase.
      stale.onPhase!("delayed");
      expect(phaseOf(agentId)).toBeNull();
    });
  });

});
