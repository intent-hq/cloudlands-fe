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
import { chatSendStarted } from "$store/renderer/slices/chat-state/chat-state-slice";
import {
  agentStreamUpdateReceived,
  type AgentStreamUpdatePayload,
} from "$store/renderer/slices/workspace-agents/workspace-agents-stream-slice";

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
});
