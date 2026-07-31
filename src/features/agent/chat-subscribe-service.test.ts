import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { AgentStatus } from "$shared/types/agent.types";
import type { AgentMessage, AgentSession } from "$shared/types";
import type { ChatTranscript } from "$lib/client/app-client";

// FAKE seam: chat.subscribe is stubbed so no daemon call happens; each call
// records its handler (so tests can push §7.1-shaped reconciled transcripts)
// and returns a spy disposer. agents.get/getConversation + subscribeSnapshot
// keep the sibling chat-read middleware (same initializeChatRequested
// trigger, real store) inert. READ-ONLY: never a mutation.
vi.mock("$lib/client", () => {
  const subscriptions: Array<{
    agentId: string;
    handler: (transcript: ChatTranscript) => void;
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
        subscribe: vi.fn((agentId: string, handler: (transcript: ChatTranscript) => void) => {
          const unsubscribe = vi.fn();
          subscriptions.push({ agentId, handler, unsubscribe });
          return unsubscribe;
        }),
      },
    },
    __chatSubscriptions: subscriptions,
  };
});

import * as clientModule from "$lib/client";
import { appClient } from "$lib/client";
import { store as appStore } from "$store/renderer/store";
import { initializeChatRequested } from "$store/renderer/slices/chat-state/chat-state-slice";
import {
  addMessage,
  bulkUpsertSessions,
  removeSession,
} from "$store/renderer/slices/agent-session/agent-session-slice";
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

});
