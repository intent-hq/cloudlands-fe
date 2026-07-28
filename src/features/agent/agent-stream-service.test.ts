import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AgentStatus } from "$shared/types/agent.types";
import type { AgentMessage, AgentSession, ContentBlock } from "$shared/types";

import { store as appStore } from "$store/renderer/store";
import {
  bulkUpsertSessions,
  setAgentStreaming,
} from "$store/renderer/slices/agent-session/agent-session-slice";
import {
  selectAgentIsResponding,
  selectAgentMessages,
} from "$store/renderer/slices/agent-session/agent-session-selectors";
import {
  chatLastAttemptedMessageSet,
  chatSendStarted,
} from "$store/renderer/slices/chat-state/chat-state-slice";
import { selectChatAgentState } from "$store/renderer/slices/chat-state/chat-state-selectors";
import {
  agentStreamUpdateReceived,
  type AgentStreamUpdatePayload,
} from "$store/renderer/slices/workspace-agents/workspace-agents-stream-slice";
import { eventReceived } from "$store/renderer/slices/workspace-events/workspace-events-slice";
import type { AgentIdleEvent } from "$features/events/types";

const WS = "ws-stream-1";
const AGENT = "agent-stream-1";
const APP_MSG = "app-stream-1";
const MSG_ID = "msg-stream-1";

function makeSession(messages: AgentMessage[] = []): AgentSession {
  return {
    id: AGENT,
    backendSessionId: null,
    workspaceId: WS,
    name: "Agent Stream",
    // RuntimeIdle so `isActiveAgentThread` is driven solely by the session
    // streaming flags — this is the post-daemon-idle state where the
    // persistent "Thinking" bug actually shows up.
    status: AgentStatus.RuntimeIdle,
    messages,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  } as AgentSession;
}

function makePayload(overrides: Partial<AgentStreamUpdatePayload>): AgentStreamUpdatePayload {
  return {
    agentId: AGENT,
    workspaceId: WS,
    handlerSessionId: "handler-1",
    source: "sendMessage",
    eventType: "chunk",
    assistantMessageId: MSG_ID,
    assistantAppMessageId: APP_MSG,
    ...overrides,
  } as AgentStreamUpdatePayload;
}

function textBlocks(text: string): ContentBlock[] {
  return [{ type: "text", text }];
}

function getMessages(): AgentMessage[] {
  return selectAgentMessages.select(appStore.state, AGENT);
}

/**
 * Simulate the real send flow: chatSendStarted sets session-level
 * isStreaming=true AND isProcessing=true. Without finalize clearing both,
 * `selectAgentIsResponding` stays true forever — the persistent "Thinking" bug.
 */
function simulateSendInFlight(): void {
  appStore.dispatch(chatSendStarted(AGENT, WS));
  appStore.dispatch(setAgentStreaming(AGENT, true));
}

describe("agentStreamService (real store)", () => {
  beforeAll(() => appStore.init());
  beforeEach(() => {
    appStore.dispatch(bulkUpsertSessions([makeSession()]));
  });
  afterEach(() => {
    appStore.dispatch(bulkUpsertSessions([makeSession()]));
  });

  it("creates an in-flight placeholder on the first stream event", () => {
    appStore.dispatch(
      agentStreamUpdateReceived(
        makePayload({ eventType: "started", contentBlocks: textBlocks("hello") }),
      ),
    );

    const [message] = getMessages();
    expect(message.id).toBe(MSG_ID);
    expect(message.appMessageId).toBe(APP_MSG);
    expect(message.role).toBe("assistant");
    expect(message.isStreaming).toBe(true);
    expect(message.streamingComplete).toBe(false);
    expect(message.contentBlocks).toEqual(textBlocks("hello"));
  });

  it("updates the placeholder in place on subsequent chunks (no duplicate messages)", () => {
    appStore.dispatch(
      agentStreamUpdateReceived(makePayload({ eventType: "started", contentBlocks: textBlocks("a") })),
    );
    appStore.dispatch(
      agentStreamUpdateReceived(makePayload({ eventType: "chunk", contentBlocks: textBlocks("ab") })),
    );

    const messages = getMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0].id).toBe(MSG_ID);
    expect(messages[0].contentBlocks).toEqual(textBlocks("ab"));
    expect(messages[0].isStreaming).toBe(true);
  });

  it("finalizes the in-flight message on complete (isStreaming=false, streamingComplete=true)", () => {
    appStore.dispatch(
      agentStreamUpdateReceived(makePayload({ eventType: "started", contentBlocks: textBlocks("a") })),
    );
    appStore.dispatch(
      agentStreamUpdateReceived(
        makePayload({ eventType: "complete", contentBlocks: textBlocks("abc") }),
      ),
    );

    const [message] = getMessages();
    expect(message.contentBlocks).toEqual(textBlocks("abc"));
    expect(message.isStreaming).toBe(false);
    expect(message.streamingComplete).toBe(true);
  });

  it("clears session-level streaming flags on complete (selectAgentIsResponding === false)", () => {
    simulateSendInFlight();
    expect(selectAgentIsResponding.select(appStore.state, AGENT)).toBe(true);

    appStore.dispatch(
      agentStreamUpdateReceived(makePayload({ eventType: "started", contentBlocks: textBlocks("a") })),
    );
    appStore.dispatch(
      agentStreamUpdateReceived(
        makePayload({ eventType: "complete", contentBlocks: textBlocks("abc") }),
      ),
    );

    expect(selectAgentIsResponding.select(appStore.state, AGENT)).toBe(false);
  });

  it("clears session-level streaming flags on error (selectAgentIsResponding === false)", () => {
    simulateSendInFlight();
    appStore.dispatch(
      agentStreamUpdateReceived(
        makePayload({ eventType: "chunk", contentBlocks: textBlocks("partial") }),
      ),
    );
    expect(selectAgentIsResponding.select(appStore.state, AGENT)).toBe(true);

    appStore.dispatch(agentStreamUpdateReceived(makePayload({ eventType: "error" })));

    expect(selectAgentIsResponding.select(appStore.state, AGENT)).toBe(false);
  });

  it("#941: a failed turn (error finalize) preserves lastAttemptedMessage for the retry banner", () => {
    simulateSendInFlight();
    appStore.dispatch(chatLastAttemptedMessageSet(AGENT, { text: "edited text" }));
    appStore.dispatch(
      agentStreamUpdateReceived(
        makePayload({ eventType: "chunk", contentBlocks: textBlocks("partial") }),
      ),
    );

    appStore.dispatch(
      agentStreamUpdateReceived(makePayload({ eventType: "error", error: "stream failed" })),
    );

    const chatState = selectChatAgentState.select(appStore.state, AGENT);
    expect(chatState?.error).toBe("stream failed");
    expect(chatState?.lastAttemptedMessage).toEqual({ text: "edited text" });
  });

  it("#941: a successful turn clears lastAttemptedMessage on the follow-up agent:idle (#984)", () => {
    simulateSendInFlight();
    appStore.dispatch(chatLastAttemptedMessageSet(AGENT, { text: "edited text" }));
    appStore.dispatch(
      agentStreamUpdateReceived(
        makePayload({ eventType: "chunk", contentBlocks: textBlocks("partial") }),
      ),
    );

    appStore.dispatch(
      agentStreamUpdateReceived(
        makePayload({ eventType: "complete", contentBlocks: textBlocks("done") }),
      ),
    );

    // `complete` maps the disposition-neutral `agent:stream:end` — the record
    // survives it (#984); the success-clear rides the follow-up `agent:idle`.
    expect(selectChatAgentState.select(appStore.state, AGENT)?.lastAttemptedMessage).toEqual({
      text: "edited text",
    });

    const idleEvent: AgentIdleEvent = {
      id: "evt-idle-stream-1",
      type: "agent:idle",
      timestamp: "2026-01-01T00:00:00.000Z",
      workspaceId: WS,
      actor: { type: "agent", id: AGENT },
      data: {
        agentId: AGENT,
        agentName: "Agent Stream",
        reason: "stream_complete",
        finishReason: "end_turn",
        status: "idle",
        activationState: null,
        isActive: false,
        isStreaming: false,
        isProcessing: false,
        isResponding: false,
        stopReason: null,
      },
    };
    appStore.dispatch(eventReceived(WS, idleEvent));
    expect(
      selectChatAgentState.select(appStore.state, AGENT)?.lastAttemptedMessage,
    ).toBeNull();
  });

  it("#964: a model-unavailable complete survives the streamCompleted finalize (banner state preserved)", () => {
    simulateSendInFlight();
    appStore.dispatch(chatLastAttemptedMessageSet(AGENT, { text: "edited text" }));

    appStore.dispatch(
      agentStreamUpdateReceived(
        makePayload({
          eventType: "complete",
          contentBlocks: [],
          completeMessage: {
            role: "assistant",
            metadata: {
              modelUnavailable: true,
              failedModel: "slow-model",
              nextAvailableModel: "fast-model",
            },
          },
        }),
      ),
    );

    // The reducer derived modelUnavailable from the complete event, and the
    // middleware's streamCompleted finalize (which previously hardcoded
    // modelUnavailable: null) must pass it through from post-reducer state.
    const chatState = selectChatAgentState.select(appStore.state, AGENT);
    expect(chatState?.modelUnavailable).toEqual({
      failedModel: "slow-model",
      nextAvailableModel: "fast-model",
    });
    // The retry payload survives too, so "Retry with <model>" has a message
    // to resend.
    expect(chatState?.lastAttemptedMessage).toEqual({ text: "edited text" });
    expect(selectAgentIsResponding.select(appStore.state, AGENT)).toBe(false);
  });

  it("#964: a normal successful complete leaves modelUnavailable null", () => {
    simulateSendInFlight();
    appStore.dispatch(
      agentStreamUpdateReceived(
        makePayload({ eventType: "complete", contentBlocks: textBlocks("done") }),
      ),
    );

    expect(selectChatAgentState.select(appStore.state, AGENT)?.modelUnavailable).toBeNull();
  });

  it("clears session-level streaming flags on timeout (selectAgentIsResponding === false)", () => {
    simulateSendInFlight();
    appStore.dispatch(
      agentStreamUpdateReceived(
        makePayload({ eventType: "chunk", contentBlocks: textBlocks("partial") }),
      ),
    );
    expect(selectAgentIsResponding.select(appStore.state, AGENT)).toBe(true);

    appStore.dispatch(agentStreamUpdateReceived(makePayload({ eventType: "timeout" })));

    expect(selectAgentIsResponding.select(appStore.state, AGENT)).toBe(false);
  });

  it("skips placeholder creation when a finalized assistant for that appMessageId already exists", () => {
    const finalized: AgentMessage = {
      id: "msg-prior",
      appMessageId: APP_MSG,
      role: "assistant",
      contentBlocks: textBlocks("done"),
      timestamp: "2026-01-01T00:00:00.000Z",
      isStreaming: false,
      streamingComplete: true,
    };
    appStore.dispatch(bulkUpsertSessions([makeSession([finalized])]));

    appStore.dispatch(
      agentStreamUpdateReceived(
        makePayload({ eventType: "started", contentBlocks: textBlocks("new") }),
      ),
    );

    const messages = getMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0].id).toBe("msg-prior");
    expect(messages[0].contentBlocks).toEqual(textBlocks("done"));
  });

  it("finalizes the in-flight message on error/timeout without erasing accumulated content", () => {
    appStore.dispatch(
      agentStreamUpdateReceived(
        makePayload({ eventType: "chunk", contentBlocks: textBlocks("partial") }),
      ),
    );

    appStore.dispatch(agentStreamUpdateReceived(makePayload({ eventType: "error" })));

    const [message] = getMessages();
    expect(message.contentBlocks).toEqual(textBlocks("partial"));
    expect(message.isStreaming).toBe(false);
    expect(message.streamingComplete).toBe(true);
  });

  // Interrupted finalize (PROTOCOL §7 `agent:stream:end` with
  // `stopReason: "interrupted"`): the daemon persisted the partial row with
  // `metadata.interrupted` + `stopReason`; mirror it locally so the Stopped
  // indicator renders live.
  it("merges interrupted metadata onto the in-flight message on complete with stopReason=interrupted", () => {
    appStore.dispatch(
      agentStreamUpdateReceived(
        makePayload({ eventType: "chunk", contentBlocks: textBlocks("partial") }),
      ),
    );
    appStore.dispatch(
      agentStreamUpdateReceived(
        makePayload({
          eventType: "complete",
          contentBlocks: textBlocks("partial"),
          stopReason: "interrupted",
        }),
      ),
    );

    const [message] = getMessages();
    expect(message.contentBlocks).toEqual(textBlocks("partial"));
    expect(message.isStreaming).toBe(false);
    expect(message.streamingComplete).toBe(true);
    expect(message.metadata).toMatchObject({ interrupted: true, stopReason: "interrupted" });
  });

  it("does NOT add interrupted metadata on a normal complete (no stopReason)", () => {
    appStore.dispatch(
      agentStreamUpdateReceived(
        makePayload({ eventType: "chunk", contentBlocks: textBlocks("partial") }),
      ),
    );
    appStore.dispatch(
      agentStreamUpdateReceived(
        makePayload({ eventType: "complete", contentBlocks: textBlocks("partial done") }),
      ),
    );

    const [message] = getMessages();
    expect(message.metadata?.interrupted).toBeUndefined();
    expect(message.metadata?.stopReason).toBeUndefined();
  });

  // Pre-first-token stop: complete arrives with stopReason=interrupted and a
  // messageId but no prior stream events — create the finalized empty
  // interrupted placeholder mirroring the daemon's synthetic persisted row.
  it("creates a finalized interrupted placeholder when complete(stopReason=interrupted) arrives with no prior stream state", () => {
    appStore.dispatch(
      agentStreamUpdateReceived(
        makePayload({
          eventType: "complete",
          contentBlocks: [],
          stopReason: "interrupted",
        }),
      ),
    );

    const [message] = getMessages();
    expect(message.id).toBe(MSG_ID);
    expect(message.role).toBe("assistant");
    expect(message.contentBlocks).toEqual([]);
    expect(message.isStreaming).toBe(false);
    expect(message.streamingComplete).toBe(true);
    expect(message.metadata).toMatchObject({ interrupted: true, stopReason: "interrupted" });
  });

  // Q&A live delivery hardening: a bridge-dispatched complete carries only the
  // canonical assistantMessageId (no assistantAppMessageId). A stale in-flight
  // assistant already bound to a DIFFERENT canonical id must not absorb the
  // payload's blocks — the payload gets its own placeholder under its own id
  // so the later getConversation reconcile dedupes by message id.
  it("does not merge a canonical-id-only complete onto a stale in-flight assistant of a different canonical id", () => {
    const staleId = "msg_stale_turn";
    const canonicalId = "msg_new_turn";
    const stale: AgentMessage = {
      id: staleId,
      role: "assistant",
      contentBlocks: textBlocks("abandoned partial"),
      timestamp: "2026-01-01T00:00:00.000Z",
      isStreaming: true,
      streamingComplete: false,
    };
    appStore.dispatch(bulkUpsertSessions([makeSession([stale])]));

    appStore.dispatch(
      agentStreamUpdateReceived(
        makePayload({
          eventType: "complete",
          assistantMessageId: canonicalId,
          assistantAppMessageId: undefined,
          contentBlocks: [{ type: "resource", resource: { uri: "q://1" } } as ContentBlock],
        }),
      ),
    );

    const messages = getMessages();
    expect(messages.map((m) => m.id)).toEqual([staleId, canonicalId]);
    const fresh = messages.find((m) => m.id === canonicalId)!;
    expect(fresh.contentBlocks).toEqual([{ type: "resource", resource: { uri: "q://1" } }]);
    expect(fresh.streamingComplete).toBe(true);
    const untouched = messages.find((m) => m.id === staleId)!;
    expect(untouched.contentBlocks).toEqual(textBlocks("abandoned partial"));
  });
});
