import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentStatus } from "$shared/types/agent.types";
import type { AgentSession, QueuedMessage, Workspace } from "$shared/types";

// FAKE seams: agent-stream-lifecycle.sendMessage, appClient.agents.queue, and
// appClient.agents.removeQueued are all spied so no IPC/daemon call (and never
// the real backend pipeline) happens. The service runs against the REAL
// configured store so the middleware wiring, workspace resolution, the
// BE-state in-flight read, the chatSendStarted dispatch, the queue-on-send
// branch, and the queue-removal optimistic-delete branch are exercised end to
// end. vi.hoisted() keeps the spies in scope of the hoisted vi.mock factories.
const { lifecycleSendMessage, agentsQueue, agentsRemoveQueued, agentsStop } = vi.hoisted(() => ({
  lifecycleSendMessage: vi.fn(() => Promise.resolve()),
  agentsQueue: vi.fn(() =>
    Promise.resolve({ success: true } as { success: boolean; queuedMessage?: unknown }),
  ),
  agentsRemoveQueued: vi.fn(() =>
    Promise.resolve({ success: true } as { success: boolean; error?: string }),
  ),
  agentsStop: vi.fn(() =>
    Promise.resolve({ success: true } as { success: boolean; error?: string }),
  ),
}));
vi.mock("$features/agent/agent-stream-lifecycle", () => ({
  sendMessage: lifecycleSendMessage,
}));
vi.mock("$lib/client", () => ({
  appClient: {
    agents: { queue: agentsQueue, removeQueued: agentsRemoveQueued, stop: agentsStop },
  },
}));

import { store as appStore } from "$store/renderer/store";
import { setWorkspaceEntity } from "$store/renderer/slices/workspace/workspace-slice";
import {
  agentSessionStopChatRequested,
  bulkUpsertSessions,
  clearAllSessions,
} from "$store/renderer/slices/agent-session/agent-session-slice";
import {
  clearAgentQueue,
  removeQueuedMessageRequested,
  replaceAgentQueue,
} from "$store/renderer/slices/agent-queue/agent-queue-slice";
import {
  sendMessage,
  sendInitialMessageRequested,
} from "$store/renderer/slices/chat-state/chat-state-slice";
import { selectChatAgentState } from "$store/renderer/slices/chat-state/chat-state-selectors";
import { selectAgentQueueMessages } from "$store/renderer/slices/agent-queue/agent-queue-selectors";

const WS = "ws-chat-send-1";
const AGENT = "agent-chat-send-1";
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function seedWorkspace(): void {
  appStore.dispatch(
    setWorkspaceEntity({
      id: WS,
      title: "WS",
      branch: "main",
      status: "active",
      repositoryPath: "/tmp/repo",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      changesets: [],
      timeline: [],
      conversationInfo: [],
    } as unknown as Workspace),
  );
}

function seedSession(overrides: Partial<AgentSession> = {}): void {
  appStore.dispatch(
    bulkUpsertSessions([
      {
        id: AGENT,
        backendSessionId: "backend-1",
        workspaceId: WS,
        name: "A",
        status: AgentStatus.Idle,
        messages: [],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        ...overrides,
      } as AgentSession,
    ]),
  );
}

async function warmDeps(): Promise<void> {
  await Promise.all([
    import("$store/renderer/slices/workspace/workspace-selectors"),
    import("$store/renderer/slices/agent-session/agent-session-selectors"),
    import("$store/renderer/slices/agent-queue/agent-queue-selectors"),
    import("$features/agent/agent-stream-lifecycle"),
  ]);
}

describe("chatSendService (fake lifecycle seam, real store)", () => {
  beforeAll(async () => {
    appStore.init();
    await warmDeps();
  });
  beforeEach(() => {
    lifecycleSendMessage.mockReset();
    lifecycleSendMessage.mockImplementation(() => Promise.resolve());
    agentsQueue.mockReset();
    agentsQueue.mockImplementation(() => Promise.resolve({ success: true }));
    agentsRemoveQueued.mockReset();
    agentsRemoveQueued.mockImplementation(() => Promise.resolve({ success: true }));
    agentsStop.mockReset();
    agentsStop.mockImplementation(() => Promise.resolve({ success: true }));
    appStore.dispatch(clearAllSessions());
    appStore.dispatch(clearAgentQueue(AGENT));
    seedWorkspace();
    seedSession();
  });
  afterEach(() => vi.clearAllMocks());

  it("sendMessage trigger invokes lifecycle.sendMessage with mapped args and dispatches chatSendStarted", async () => {
    appStore.dispatch(
      sendMessage(AGENT, {
        wsId: WS,
        text: "hello world",
        noteIds: ["note-1"],
        imageBlocks: [{ type: "image", data: "abc", mimeType: "image/png" }],
      }),
    );
    await flush();
    await flush();

    expect(lifecycleSendMessage).toHaveBeenCalledTimes(1);
    const [agentIdArg, contentArg, workspaceArg, optionsArg] = lifecycleSendMessage.mock.calls[0] as [
      string,
      string,
      Workspace,
      { imageBlocks?: unknown; noteIds?: string[] },
    ];
    expect(agentIdArg).toBe(AGENT);
    expect(contentArg).toBe("hello world");
    expect(workspaceArg.id).toBe(WS);
    expect(optionsArg.noteIds).toEqual(["note-1"]);
    expect(optionsArg.imageBlocks).toEqual([
      { type: "image", data: "abc", mimeType: "image/png" },
    ]);

    expect(selectChatAgentState.select(appStore.state, AGENT)?.streamingStartTime).toBeGreaterThan(0);
  });

  it("prepends workspaceContextStr to the message content", async () => {
    appStore.dispatch(
      sendMessage(AGENT, {
        wsId: WS,
        text: "do work",
        workspaceContextStr: "CTX",
      }),
    );
    await flush();
    await flush();

    expect(lifecycleSendMessage).toHaveBeenCalledTimes(1);
    expect(lifecycleSendMessage.mock.calls[0]?.[1]).toBe("CTX\n\ndo work");
  });

  it("queue-on-send: when BE reports the agent in-flight, routes through agents.queue (not lifecycle.send)", async () => {
    // BE single-source-of-truth contract: when the daemon snapshot says the
    // turn is in-flight (isStreaming=true here, but selectAgentIsResponding
    // also reads isResponding / status), the FE must NOT call the normal
    // lifecycle send (which would race the active stream) — it routes the
    // composer text through `agent.queueMessage` instead.
    seedSession({ isStreaming: true, status: AgentStatus.Active });

    appStore.dispatch(sendMessage(AGENT, { wsId: WS, text: "queue me" }));
    await flush();
    await flush();

    expect(lifecycleSendMessage).not.toHaveBeenCalled();
    expect(agentsQueue).toHaveBeenCalledTimes(1);
    expect(agentsQueue).toHaveBeenCalledWith(AGENT, "queue me");
  });

  it("queue-on-send: seeds the local agent-queue slice from the returned queuedMessage", async () => {
    // The seam returns the persisted queue entry on success; the service
    // must dispatch replaceAgentQueue so the queued-UI lights up immediately
    // without waiting for a hydration round trip.
    seedSession({ isResponding: true, status: AgentStatus.Active });
    const queued: QueuedMessage = {
      id: "q-1",
      content: "queue me",
      position: 0,
      queuedAt: "2026-01-01T00:00:00.000Z",
    };
    agentsQueue.mockImplementationOnce(() =>
      Promise.resolve({ success: true, queuedMessage: queued }),
    );

    appStore.dispatch(sendMessage(AGENT, { wsId: WS, text: "queue me" }));
    await flush();
    await flush();

    const stored = selectAgentQueueMessages.select(appStore.state, AGENT);
    expect(stored.map((m) => m.id)).toEqual(["q-1"]);
  });

  it("queue-on-send: leaves the local queue untouched when the daemon returns no queuedMessage", async () => {
    seedSession({ isResponding: true, status: AgentStatus.Active });
    agentsQueue.mockImplementationOnce(() => Promise.resolve({ success: true }));

    appStore.dispatch(sendMessage(AGENT, { wsId: WS, text: "queue me" }));
    await flush();
    await flush();

    expect(agentsQueue).toHaveBeenCalledTimes(1);
    expect(selectAgentQueueMessages.select(appStore.state, AGENT)).toEqual([]);
  });

  it("queue-on-send: rejection from the daemon does NOT fall back to lifecycle.send and surfaces chatSendFailed (AUDIT-P0-2)", async () => {
    seedSession({ isResponding: true, status: AgentStatus.Active });
    agentsQueue.mockImplementationOnce(() =>
      Promise.resolve({ success: false, error: "no can do" }),
    );

    appStore.dispatch(sendMessage(AGENT, { wsId: WS, text: "queue me" }));
    await flush();
    await flush();

    expect(agentsQueue).toHaveBeenCalledTimes(1);
    expect(lifecycleSendMessage).not.toHaveBeenCalled();
    // AUDIT-P0-2: the daemon-rejected queue attempt must dispatch
    // chatSendFailed so the UI renders the error verbatim.
    expect(selectChatAgentState.select(appStore.state, AGENT)?.error).toBe("no can do");
  });

  it("queue-on-send: a thrown queue call dispatches chatSendFailed (AUDIT-P0-2)", async () => {
    seedSession({ isResponding: true, status: AgentStatus.Active });
    agentsQueue.mockImplementationOnce(() => Promise.reject(new Error("ipc boom")));

    appStore.dispatch(sendMessage(AGENT, { wsId: WS, text: "queue me" }));
    await flush();
    await flush();

    expect(lifecycleSendMessage).not.toHaveBeenCalled();
    expect(selectChatAgentState.select(appStore.state, AGENT)?.error).toContain("ipc boom");
  });

  it("lifecycle.sendMessage throwing dispatches chatSendFailed (AUDIT-P0-2)", async () => {
    lifecycleSendMessage.mockImplementationOnce(() => Promise.reject(new Error("lifecycle exploded")));

    appStore.dispatch(sendMessage(AGENT, { wsId: WS, text: "hello" }));
    await flush();
    await flush();

    expect(lifecycleSendMessage).toHaveBeenCalledTimes(1);
    expect(selectChatAgentState.select(appStore.state, AGENT)?.error).toBe("lifecycle exploded");
  });

  it("dispatches chatSendFailed when the workspace is not in the store (AUDIT-P0-2)", async () => {
    appStore.dispatch(sendMessage(AGENT, { wsId: "ws-missing", text: "hello" }));
    await flush();
    await flush();

    expect(lifecycleSendMessage).not.toHaveBeenCalled();
    // AUDIT-P0-2: the missing-workspace case must not be a silent void.
    expect(selectChatAgentState.select(appStore.state, AGENT)?.error).toContain("ws-missing");
  });

  it("sendInitialMessageRequested routes through lifecycle when a message is present", async () => {
    appStore.dispatch(
      sendInitialMessageRequested(AGENT, {
        wsId: WS,
        message: "kickoff",
        imageBlocks: null,
        contextReferences: null,
      }),
    );
    await flush();
    await flush();

    expect(lifecycleSendMessage).toHaveBeenCalledTimes(1);
    expect(lifecycleSendMessage.mock.calls[0]?.[1]).toBe("kickoff");
  });

  it("sendInitialMessageRequested with alreadySent=true is a no-op", async () => {
    appStore.dispatch(
      sendInitialMessageRequested(AGENT, {
        wsId: WS,
        message: "already done",
        alreadySent: true,
      }),
    );
    await flush();
    await flush();

    expect(lifecycleSendMessage).not.toHaveBeenCalled();
  });

  it("sendInitialMessageRequested WITHOUT a message fails loudly via chatSendFailed (regression: silent no-op)", async () => {
    // Regression: ChatPanel's activation fallback used to dispatch
    // `sendInitialMessageRequested(agentId, { wsId })` with no `message`, and
    // the middleware silently ignored it — the initial message never reached
    // agent.sendMessage. The malformed dispatch must now surface as a send
    // failure instead of vanishing.
    appStore.dispatch(sendInitialMessageRequested(AGENT, { wsId: WS }));
    await flush();
    await flush();

    expect(lifecycleSendMessage).not.toHaveBeenCalled();
    expect(selectChatAgentState.select(appStore.state, AGENT)?.error).toContain("message");
  });

  it("sendInitialMessageRequested WITHOUT a wsId fails loudly via chatSendFailed", async () => {
    appStore.dispatch(
      sendInitialMessageRequested(AGENT, {
        message: "kickoff",
      } as Parameters<typeof sendInitialMessageRequested>[1]),
    );
    await flush();
    await flush();

    expect(lifecycleSendMessage).not.toHaveBeenCalled();
    expect(selectChatAgentState.select(appStore.state, AGENT)?.error).toContain("wsId");
  });

  it("sendInitialMessageRequested with imageBlocks but no text still routes through lifecycle", async () => {
    // Mirrors the activation path: an image-only initial config is sendable.
    appStore.dispatch(
      sendInitialMessageRequested(AGENT, {
        wsId: WS,
        message: "",
        imageBlocks: [{ type: "image", data: "abc", mimeType: "image/png" }],
      }),
    );
    await flush();
    await flush();

    expect(lifecycleSendMessage).toHaveBeenCalledTimes(1);
    const [, contentArg, , optionsArg] = lifecycleSendMessage.mock.calls[0] as [
      string,
      string,
      Workspace,
      { imageBlocks?: unknown },
    ];
    expect(contentArg).toBe("");
    expect(optionsArg.imageBlocks).toEqual([{ type: "image", data: "abc", mimeType: "image/png" }]);
  });

  it("removeQueuedMessageRequested optimistically removes the entry and calls appClient.agents.removeQueued", async () => {
    const seeded: QueuedMessage[] = [
      { id: "q-1", content: "first", position: 0, queuedAt: "2026-01-01T00:00:01.000Z" },
      { id: "q-2", content: "second", position: 1, queuedAt: "2026-01-01T00:00:02.000Z" },
    ];
    appStore.dispatch(replaceAgentQueue(AGENT, seeded));

    appStore.dispatch(removeQueuedMessageRequested(AGENT, "q-1"));
    // Optimistic removal happens synchronously inside the middleware.
    expect(selectAgentQueueMessages.select(appStore.state, AGENT).map((m) => m.id)).toEqual([
      "q-2",
    ]);
    await flush();

    // The seam is called with PROTOCOL §5.5 params.
    expect(agentsRemoveQueued).toHaveBeenCalledTimes(1);
    expect(agentsRemoveQueued).toHaveBeenCalledWith(AGENT, "q-1");
  });

  it("removeQueuedMessageRequested does NOT roll back when the daemon reports the message as already gone (idempotent)", async () => {
    const seeded: QueuedMessage[] = [
      { id: "q-1", content: "first", position: 0, queuedAt: "2026-01-01T00:00:01.000Z" },
    ];
    appStore.dispatch(replaceAgentQueue(AGENT, seeded));

    // The daemon is **idempotent** (§5.5): when the messageId is unknown to
    // the BE (FE/BE drift, daemon restart, race with self-drain) the response
    // is STILL `{ success: true }`. The FE must NOT rollback by re-adding
    // the message — the tombstone in the reducer keeps it suppressed even
    // against a stale `agent:queue:updated` snapshot.
    agentsRemoveQueued.mockImplementationOnce(() => Promise.resolve({ success: true }));

    appStore.dispatch(removeQueuedMessageRequested(AGENT, "q-1"));
    await flush();
    await flush();

    expect(agentsRemoveQueued).toHaveBeenCalledWith(AGENT, "q-1");
    expect(selectAgentQueueMessages.select(appStore.state, AGENT)).toEqual([]);
  });

  it("removeQueuedMessageRequested keeps the optimistic delete in place even when the seam reports a non-success error", async () => {
    const seeded: QueuedMessage[] = [
      { id: "q-1", content: "first", position: 0, queuedAt: "2026-01-01T00:00:01.000Z" },
    ];
    appStore.dispatch(replaceAgentQueue(AGENT, seeded));

    // Simulate a hypothetical legacy "not found" failure — the FE must STILL
    // treat the delete as successful (no re-add / rollback) per the new
    // BE idempotency contract.
    agentsRemoveQueued.mockImplementationOnce(() =>
      Promise.resolve({ success: false, error: "Message not found" }),
    );

    appStore.dispatch(removeQueuedMessageRequested(AGENT, "q-1"));
    await flush();
    await flush();

    expect(selectAgentQueueMessages.select(appStore.state, AGENT)).toEqual([]);
  });

  it("removeQueuedMessageRequested keeps the optimistic delete in place even when the seam throws", async () => {
    const seeded: QueuedMessage[] = [
      { id: "q-1", content: "first", position: 0, queuedAt: "2026-01-01T00:00:01.000Z" },
    ];
    appStore.dispatch(replaceAgentQueue(AGENT, seeded));

    agentsRemoveQueued.mockImplementationOnce(() => Promise.reject(new Error("ipc boom")));

    appStore.dispatch(removeQueuedMessageRequested(AGENT, "q-1"));
    await flush();
    await flush();

    expect(selectAgentQueueMessages.select(appStore.state, AGENT)).toEqual([]);
  });

  it("removeQueuedMessageRequested is a no-op when agentId or messageId are missing/empty", async () => {
    appStore.dispatch(removeQueuedMessageRequested("", "q-1"));
    appStore.dispatch(removeQueuedMessageRequested(AGENT, ""));
    await flush();

    expect(agentsRemoveQueued).not.toHaveBeenCalled();
  });

  it("agentSessionStopChatRequested calls agent.stop with the agentId and settles the promise", async () => {
    const action = agentSessionStopChatRequested(AGENT);
    appStore.dispatch(action);
    await action.promise;

    expect(agentsStop).toHaveBeenCalledTimes(1);
    expect(agentsStop).toHaveBeenCalledWith(AGENT);
    expect(selectChatAgentState.select(appStore.state, AGENT)?.isInterrupting).toBe(false);
  });

  it("agentSessionStopChatRequested resolves without a wire call when the session is unknown", async () => {
    const action = agentSessionStopChatRequested("agent-does-not-exist");
    appStore.dispatch(action);
    await action.promise;

    expect(agentsStop).not.toHaveBeenCalled();
  });

  it("agentSessionStopChatRequested still completes (no wedged interrupting flag) on a non-success stop", async () => {
    // The seam folds RPC throws into MutationResult, so non-success is a
    // transport-level failure; the flow must still complete — the daemon's
    // terminal agent:stream:end is the authoritative convergence signal.
    agentsStop.mockImplementationOnce(() =>
      Promise.resolve({ success: false, error: "transport down" }),
    );

    const action = agentSessionStopChatRequested(AGENT);
    appStore.dispatch(action);
    await action.promise;

    expect(agentsStop).toHaveBeenCalledWith(AGENT);
    expect(selectChatAgentState.select(appStore.state, AGENT)?.isInterrupting).toBe(false);
  });

  it("agentSessionStopChatRequested clears the interrupting flag and rejects when the seam throws", async () => {
    agentsStop.mockImplementationOnce(() => Promise.reject(new Error("stop boom")));

    const action = agentSessionStopChatRequested(AGENT);
    appStore.dispatch(action);

    await expect(action.promise).rejects.toThrow("stop boom");
    expect(selectChatAgentState.select(appStore.state, AGENT)?.isInterrupting).toBe(false);
  });
});
