import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { AgentStatus } from "$shared/types/agent.types";
import type { AgentMessage, AgentSession } from "$shared/types";

// FAKE seam: `appClient.agents.editAndRegenerate` is stubbed. The middleware
// runs against the REAL configured store so the async action resolves through
// the real action.success/failure path, and the optimistic local truncation is
// asserted on real reducer state.
const { editAndRegenerate } = vi.hoisted(() => ({ editAndRegenerate: vi.fn() }));
vi.mock("$lib/client", () => ({
  appClient: { agents: { editAndRegenerate } },
}));

// The handler lazily `import("svelte-sonner")` for error toasts; stub it so no
// real toast component is mounted.
vi.mock("svelte-sonner", () => ({
  toast: Object.assign(vi.fn(), {
    warning: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

import { store as appStore } from "$store/renderer/store";
import { toast } from "svelte-sonner";
import {
  agentSessionEditAndRegenerateRequested,
  bulkUpsertSessions,
} from "$store/renderer/slices/agent-session/agent-session-slice";
import {
  chatLastAttemptedMessageSet,
  chatQueuedRetryRecordSet,
  chatReset,
  chatSendFailed,
} from "$store/renderer/slices/chat-state/chat-state-slice";
import { replaceAgentQueue } from "$store/renderer/slices/agent-queue/agent-queue-slice";
import type { ChatAgentState } from "$store/renderer/slices/chat-state/chat-state-types";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function makeMessage(id: string, role: "user" | "assistant", text: string): AgentMessage {
  return {
    id,
    role,
    timestamp: "2026-01-01T00:00:00.000Z",
    contentBlocks: [{ type: "text", text }],
  } as AgentMessage;
}

function seedSession(agentId: string, wsId: string, messages: AgentMessage[]): void {
  appStore.dispatch(
    bulkUpsertSessions([
      {
        id: agentId,
        backendSessionId: "backend-" + agentId,
        workspaceId: wsId,
        name: "Agent",
        status: AgentStatus.Active,
        messages,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      } as AgentSession,
    ]),
  );
}

function readMessages(agentId: string): AgentMessage[] {
  const state = appStore.state as {
    agentSessions?: { byAgentId: Record<string, AgentSession> };
  };
  return state.agentSessions?.byAgentId[agentId]?.messages ?? [];
}

function readChatState(agentId: string): ChatAgentState | undefined {
  const state = appStore.state as {
    chatState?: { byAgentId: Record<string, ChatAgentState> };
  };
  return state.chatState?.byAgentId[agentId];
}

describe("editRegenerateService (fake appClient.agents.editAndRegenerate, real store)", () => {
  beforeAll(() => appStore.init());
  afterEach(() => {
    editAndRegenerate.mockReset();
    vi.clearAllMocks();
  });

  it("forwards the §5.5 params, resolves, and truncates the local transcript at the edited message", async () => {
    const WS = "ws-edit-happy";
    const AGENT = "agent-edit-happy";
    seedSession(AGENT, WS, [
      makeMessage("m1", "user", "first"),
      makeMessage("m2", "assistant", "reply 1"),
      makeMessage("m3", "user", "second"),
      makeMessage("m4", "assistant", "reply 2"),
    ]);
    editAndRegenerate.mockResolvedValueOnce({ success: true });

    const action = agentSessionEditAndRegenerateRequested(AGENT, WS, "m3", "edited second");
    appStore.dispatch(action);
    await action.promise;

    expect(editAndRegenerate).toHaveBeenCalledWith({
      agentId: AGENT,
      workspaceId: WS,
      messageId: "m3",
      content: "edited second",
    });
    // Optimistic truncation drops the edited message and everything after it.
    expect(readMessages(AGENT).map((m) => m.id)).toEqual(["m1", "m2"]);
  });

  it("passes options.model through as the per-request model override", async () => {
    const WS = "ws-edit-model";
    const AGENT = "agent-edit-model";
    seedSession(AGENT, WS, [makeMessage("m1", "user", "first")]);
    editAndRegenerate.mockResolvedValueOnce({ success: true });

    const action = agentSessionEditAndRegenerateRequested(AGENT, WS, "m1", "edited", {
      model: "opus",
    });
    appStore.dispatch(action);
    await action.promise;

    expect(editAndRegenerate).toHaveBeenCalledWith(
      expect.objectContaining({ model: "opus" }),
    );
  });

  it("rejects, toasts, and leaves the transcript untouched on a non-success result", async () => {
    const WS = "ws-edit-fail";
    const AGENT = "agent-edit-fail";
    const messages = [
      makeMessage("m1", "user", "first"),
      makeMessage("m2", "assistant", "reply"),
    ];
    seedSession(AGENT, WS, messages);
    editAndRegenerate.mockResolvedValueOnce({ success: false, error: "bad message id" });

    const action = agentSessionEditAndRegenerateRequested(AGENT, WS, "m1", "edited");
    appStore.dispatch(action);
    await expect(action.promise).rejects.toThrow("bad message id");

    await flush();
    expect(toast.error).toHaveBeenCalledWith("bad message id");
    expect(readMessages(AGENT).map((m) => m.id)).toEqual(["m1", "m2"]);
  });

  it("clears a stale chat error and starts the loading state on success", async () => {
    const WS = "ws-edit-chatstate";
    const AGENT = "agent-edit-chatstate";
    seedSession(AGENT, WS, [
      makeMessage("m1", "user", "first"),
      makeMessage("m2", "assistant", "reply"),
    ]);
    appStore.dispatch(chatSendFailed(AGENT, "provider exploded"));
    expect(readChatState(AGENT)?.error).toBe("provider exploded");
    editAndRegenerate.mockResolvedValueOnce({ success: true });

    const action = agentSessionEditAndRegenerateRequested(AGENT, WS, "m1", "edited");
    appStore.dispatch(action);
    await action.promise;

    const chatState = readChatState(AGENT);
    expect(chatState?.error).toBeNull();
    expect(chatState?.streamingStartTime).toEqual(expect.any(Number));
  });

  it("records the EDITED content as lastAttemptedMessage on success so retry-after-failure resends it (#941)", async () => {
    const WS = "ws-edit-retry";
    const AGENT = "agent-edit-retry";
    seedSession(AGENT, WS, [
      makeMessage("m1", "user", "pre-edit text"),
      makeMessage("m2", "assistant", "reply"),
    ]);
    // A stale retry payload from a pre-edit send attempt.
    appStore.dispatch(chatLastAttemptedMessageSet(AGENT, { text: "pre-edit text" }));
    editAndRegenerate.mockResolvedValueOnce({ success: true });

    const action = agentSessionEditAndRegenerateRequested(AGENT, WS, "m1", "edited text");
    appStore.dispatch(action);
    await action.promise;

    expect(readChatState(AGENT)?.lastAttemptedMessage).toEqual({ text: "edited text" });
  });

  it("drops parked queued-retry records on success so a late clear-queue snapshot cannot promote a discarded entry (#999)", async () => {
    // agent.editAndRegenerate calls clear_queue daemon-side and publishes an
    // EMPTY queue snapshot. With exactly ONE parked record the empty snapshot
    // is indistinguishable from a genuine drain (the drainedCount>1 signature
    // cannot fire), so without the flow-site clear the DISCARDED entry's
    // payload would be promoted over the fresh edited text.
    const WS = "ws-edit-discard";
    const AGENT = "agent-edit-discard";
    appStore.dispatch(chatReset(AGENT));
    seedSession(AGENT, WS, [
      makeMessage("m1", "user", "pre-edit text"),
      makeMessage("m2", "assistant", "reply"),
    ]);
    appStore.dispatch(chatQueuedRetryRecordSet(AGENT, "qm-1", { text: "queued discarded" }));
    editAndRegenerate.mockResolvedValueOnce({ success: true });

    const action = agentSessionEditAndRegenerateRequested(AGENT, WS, "m1", "edited text");
    appStore.dispatch(action);
    await action.promise;

    // The flow site knows deterministically the queue was discarded — all
    // parked records are dropped without promotion.
    expect(readChatState(AGENT)?.queuedRetryRecords).toEqual({});
    // The daemon's late-arriving empty clear_queue snapshot finds nothing to
    // promote; the edited text stays the retry payload.
    appStore.dispatch(replaceAgentQueue(AGENT, []));
    expect(readChatState(AGENT)?.lastAttemptedMessage).toEqual({ text: "edited text" });
  });

  it("drops ALL parked records on a multi-entry queue discard (#999)", async () => {
    const WS = "ws-edit-discard-multi";
    const AGENT = "agent-edit-discard-multi";
    appStore.dispatch(chatReset(AGENT));
    seedSession(AGENT, WS, [makeMessage("m1", "user", "pre-edit text")]);
    appStore.dispatch(chatQueuedRetryRecordSet(AGENT, "qm-1", { text: "queued 1" }));
    appStore.dispatch(chatQueuedRetryRecordSet(AGENT, "qm-2", { text: "queued 2" }));
    editAndRegenerate.mockResolvedValueOnce({ success: true });

    const action = agentSessionEditAndRegenerateRequested(AGENT, WS, "m1", "edited text");
    appStore.dispatch(action);
    await action.promise;

    expect(readChatState(AGENT)?.queuedRetryRecords).toEqual({});
    appStore.dispatch(replaceAgentQueue(AGENT, []));
    expect(readChatState(AGENT)?.lastAttemptedMessage).toEqual({ text: "edited text" });
  });

  it("leaves parked records untouched on a non-success result (#999)", async () => {
    const WS = "ws-edit-discard-fail";
    const AGENT = "agent-edit-discard-fail";
    appStore.dispatch(chatReset(AGENT));
    seedSession(AGENT, WS, [makeMessage("m1", "user", "pre-edit text")]);
    appStore.dispatch(chatQueuedRetryRecordSet(AGENT, "qm-1", { text: "still queued" }));
    editAndRegenerate.mockResolvedValueOnce({ success: false, error: "bad message id" });

    const action = agentSessionEditAndRegenerateRequested(AGENT, WS, "m1", "edited text");
    appStore.dispatch(action);
    await expect(action.promise).rejects.toThrow("bad message id");

    // No daemon-side clear happened — the queue (and its parked record)
    // survives, so a later genuine drain still promotes it.
    expect(readChatState(AGENT)?.queuedRetryRecords).toEqual({
      "qm-1": { seq: 1, record: { text: "still queued" } },
    });
  });

  it("leaves a previously recorded lastAttemptedMessage untouched on a non-success result (#941)", async () => {
    const WS = "ws-edit-retry-fail";
    const AGENT = "agent-edit-retry-fail";
    seedSession(AGENT, WS, [makeMessage("m1", "user", "pre-edit text")]);
    appStore.dispatch(chatLastAttemptedMessageSet(AGENT, { text: "pre-edit text" }));
    editAndRegenerate.mockResolvedValueOnce({ success: false, error: "bad message id" });

    const action = agentSessionEditAndRegenerateRequested(AGENT, WS, "m1", "edited text");
    appStore.dispatch(action);
    await expect(action.promise).rejects.toThrow("bad message id");

    expect(readChatState(AGENT)?.lastAttemptedMessage).toEqual({ text: "pre-edit text" });
  });

  it("leaves chat-state untouched on a non-success result", async () => {
    const WS = "ws-edit-chatstate-fail";
    const AGENT = "agent-edit-chatstate-fail";
    seedSession(AGENT, WS, [makeMessage("m1", "user", "first")]);
    appStore.dispatch(chatSendFailed(AGENT, "original error"));
    editAndRegenerate.mockResolvedValueOnce({ success: false, error: "bad message id" });

    const action = agentSessionEditAndRegenerateRequested(AGENT, WS, "m1", "edited");
    appStore.dispatch(action);
    await expect(action.promise).rejects.toThrow("bad message id");

    const chatState = readChatState(AGENT);
    expect(chatState?.error).toBe("original error");
    expect(chatState?.streamingStartTime).toBeNull();
  });

  it("leaves chat-state untouched on a thrown transport error", async () => {
    const WS = "ws-edit-chatstate-throw";
    const AGENT = "agent-edit-chatstate-throw";
    seedSession(AGENT, WS, [makeMessage("m1", "user", "first")]);
    appStore.dispatch(chatSendFailed(AGENT, "original error"));
    editAndRegenerate.mockRejectedValueOnce(new Error("transport boom"));

    const action = agentSessionEditAndRegenerateRequested(AGENT, WS, "m1", "edited");
    appStore.dispatch(action);
    await expect(action.promise).rejects.toThrow("transport boom");

    const chatState = readChatState(AGENT);
    expect(chatState?.error).toBe("original error");
    expect(chatState?.streamingStartTime).toBeNull();
  });

  it("rejects, toasts, and leaves the transcript untouched on a thrown transport error", async () => {
    const WS = "ws-edit-throw";
    const AGENT = "agent-edit-throw";
    seedSession(AGENT, WS, [makeMessage("m1", "user", "first")]);
    editAndRegenerate.mockRejectedValueOnce(new Error("transport boom"));

    const action = agentSessionEditAndRegenerateRequested(AGENT, WS, "m1", "edited");
    appStore.dispatch(action);
    await expect(action.promise).rejects.toThrow("transport boom");

    await flush();
    expect(toast.error).toHaveBeenCalledWith("transport boom");
    expect(readMessages(AGENT).map((m) => m.id)).toEqual(["m1"]);
  });
});
