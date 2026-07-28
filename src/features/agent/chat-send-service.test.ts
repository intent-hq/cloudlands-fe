import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentStatus } from "$shared/types/agent.types";
import type { AgentMessage, AgentSession, QueuedMessage, Workspace } from "$shared/types";

// FAKE seams: agent-stream-lifecycle.sendMessage, appClient.agents.queue, and
// appClient.agents.removeQueued are all spied so no IPC/daemon call (and never
// the real backend pipeline) happens. The service runs against the REAL
// configured store so the middleware wiring, workspace resolution, the
// BE-state in-flight read, the chatSendStarted dispatch, the queue-on-send
// branch, and the queue-removal optimistic-delete branch are exercised end to
// end. vi.hoisted() keeps the spies in scope of the hoisted vi.mock factories.
const {
  lifecycleSendMessage,
  agentsQueue,
  agentsRemoveQueued,
  agentsStop,
  agentsRename,
  loadChatTranscriptSpy,
} = vi.hoisted(() => ({
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
  agentsRename: vi.fn(() =>
    Promise.resolve({ success: true } as { success: boolean; error?: string }),
  ),
  loadChatTranscriptSpy: vi.fn(() => Promise.resolve()),
}));
vi.mock("$features/agent/agent-stream-lifecycle", () => ({
  sendMessage: lifecycleSendMessage,
}));
// STAB-55: the send path hydrates a non-hydrated agent via the chat-read
// service before deciding queue-vs-send; spied so the tests can assert
// hydration ordering without a daemon call. Partial mock — the middleware
// chain still needs the real createChatReadMiddleware export.
vi.mock("$features/agent/chat-read-service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("$features/agent/chat-read-service")>();
  return { ...actual, loadChatTranscript: loadChatTranscriptSpy };
});
vi.mock("$lib/client", () => ({
  appClient: {
    agents: {
      queue: agentsQueue,
      removeQueued: agentsRemoveQueued,
      stop: agentsStop,
      rename: agentsRename,
    },
  },
}));
// The retry no-op path lazily `import("svelte-sonner")` for user feedback;
// stub it so no real toast component is mounted.
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
import { setWorkspaceEntity } from "$store/renderer/slices/workspace/workspace-slice";
import {
  agentSessionRetryLastMessageRequested,
  agentSessionRetryWithModelRequested,
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
  chatLastAttemptedMessageSet,
  chatReset,
  sendMessage,
} from "$store/renderer/slices/chat-state/chat-state-slice";
import { selectChatAgentState } from "$store/renderer/slices/chat-state/chat-state-selectors";
import { agentStreamUpdateReceived } from "$store/renderer/slices/workspace-agents/workspace-agents-slice";
import { eventReceived } from "$store/renderer/slices/workspace-events/workspace-events-slice";
import type { AgentIdleEvent } from "$features/events/types";
import { selectAgentQueueMessages } from "$store/renderer/slices/agent-queue/agent-queue-selectors";
import { CHIEF_WORKSPACE_ID } from "$store/renderer/slices/sidebar-nav/sidebar-nav-types";
import { selectChiefThreads } from "$store/renderer/slices/sidebar-nav/sidebar-nav-selectors";

const WS = "ws-chat-send-1";
const AGENT = "agent-chat-send-1";
const CHIEF_AGENT = "agent-chief-send-1";
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
    agentsRename.mockReset();
    agentsRename.mockImplementation(() => Promise.resolve({ success: true }));
    loadChatTranscriptSpy.mockReset();
    loadChatTranscriptSpy.mockImplementation(() => Promise.resolve());
    appStore.dispatch(clearAllSessions());
    appStore.dispatch(clearAgentQueue(AGENT));
    // #999: parked queuedRetryRecords (and any stale active record) must not
    // leak across tests — a later `replaceAgentQueue` snapshot would promote
    // them into lastAttemptedMessage mid-test.
    appStore.dispatch(chatReset(AGENT));
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

  it("queue-on-send: forwards imageBlocks to agents.queue so attachments survive queuing (§5.5)", async () => {
    // PROTOCOL §5.5: agent.queueMessage accepts optional imageBlocks. The
    // queue-on-send branch must pass the composer's attachments through the
    // seam (options object, mirroring the force-send shape) — otherwise
    // images are silently dropped when the agent is mid-turn.
    seedSession({ isStreaming: true, status: AgentStatus.Active });
    const imageBlocks = [{ type: "image" as const, data: "aGVsbG8=", mimeType: "image/png" }];

    appStore.dispatch(sendMessage(AGENT, { wsId: WS, text: "queue me", imageBlocks }));
    await flush();
    await flush();

    expect(lifecycleSendMessage).not.toHaveBeenCalled();
    expect(agentsQueue).toHaveBeenCalledTimes(1);
    expect(agentsQueue).toHaveBeenCalledWith(AGENT, "queue me", { imageBlocks });
  });

  it("queue-on-send: retains imageBlocks from the PROTOCOL-shaped queuedMessage response in the agent-queue slice", async () => {
    // Mock a PROTOCOL §5.5-shaped `{ success, queuedMessage }` response where
    // the daemon echoes the persisted imageBlocks; the slice entry seeded via
    // replaceAgentQueue must retain them so QueuedMessageList can render the
    // thumbnail without an extra hydration round trip.
    seedSession({ isResponding: true, status: AgentStatus.Active });
    const imageBlocks = [{ type: "image" as const, data: "aGVsbG8=", mimeType: "image/png" }];
    const queued: QueuedMessage = {
      id: "q-img-1",
      content: "queue me",
      position: 0,
      queuedAt: "2026-01-01T00:00:00.000Z",
      imageBlocks,
    };
    agentsQueue.mockImplementationOnce(() =>
      Promise.resolve({ success: true, queuedMessage: queued }),
    );

    appStore.dispatch(sendMessage(AGENT, { wsId: WS, text: "queue me", imageBlocks }));
    await flush();
    await flush();

    const stored = selectAgentQueueMessages.select(appStore.state, AGENT);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.id).toBe("q-img-1");
    expect(stored[0]?.imageBlocks).toEqual(imageBlocks);
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

  it("regression (Bugs 20/14): the FE middleware never sends an initial message on create — the daemon owns initial-message delivery, so no lifecycle send fires without an explicit ChatPanel `sendMessage` dispatch", async () => {
    // Prior wiring: agent-factory's fire-and-forget send + ChatPanel's
    // mount-time `sendInitialMessageRequested` dispatch could race and
    // double-send. Both paths are gone — the daemon harvests
    // `metadata.initialMessage` on workspace.create and calls
    // `AgentManager::send_message` itself. The FE must not attempt any
    // send purely as a side-effect of workspace/agent creation.
    await flush();
    await flush();

    expect(lifecycleSendMessage).not.toHaveBeenCalled();
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

  it("forceSubmit bypasses queue-on-send check and passes priority:interrupt to lifecycle.sendMessage", async () => {
    // STAB-38 regression test: when agent is in-flight and user force-sends,
    // the middleware must NOT route through agent.queueMessage — it must call
    // lifecycle.sendMessage with priority: "interrupt" so the daemon preempts
    // the active turn per PROTOCOL.md §5.5.
    seedSession({ isStreaming: true, status: AgentStatus.Active });

    appStore.dispatch(
      sendMessage(AGENT, { wsId: WS, text: "interrupt now", forceSubmit: true, skipQueueCheck: true }),
    );
    await flush();
    await flush();

    // Must NOT queue
    expect(agentsQueue).not.toHaveBeenCalled();

    // MUST call lifecycle.sendMessage
    expect(lifecycleSendMessage).toHaveBeenCalledTimes(1);
    const [agentIdArg, contentArg, workspaceArg, optionsArg] = lifecycleSendMessage.mock.calls[0] as [
      string,
      string,
      Workspace,
      { priority?: string; imageBlocks?: unknown; noteIds?: string[] },
    ];
    expect(agentIdArg).toBe(AGENT);
    expect(contentArg).toBe("interrupt now");
    expect(workspaceArg.id).toBe(WS);
    // The key regression assertion: priority must be "interrupt"
    expect(optionsArg.priority).toBe("interrupt");
  });

  // -------------------------------------------------------------------------
  // STAB-55: sending to a non-hydrated agent must hydrate first, not clobber
  // -------------------------------------------------------------------------

  it("STAB-55: send to an agent with NO session in the store hydrates via loadChatTranscript before the lifecycle send", async () => {
    // Repro shape: workspace selected before a daemon restart — the store has
    // no session for the agent (or a stale one) and ChatPanel never re-fired
    // initializeChatRequested. The send path must trigger hydration itself.
    appStore.dispatch(clearAllSessions());

    appStore.dispatch(sendMessage(AGENT, { wsId: WS, text: "hello cold" }));
    await flush();
    await flush();

    expect(loadChatTranscriptSpy).toHaveBeenCalledTimes(1);
    expect(loadChatTranscriptSpy).toHaveBeenCalledWith(AGENT);
    expect(lifecycleSendMessage).toHaveBeenCalledTimes(1);
    // Hydration must complete BEFORE the lifecycle send fires.
    expect(loadChatTranscriptSpy.mock.invocationCallOrder[0]).toBeLessThan(
      lifecycleSendMessage.mock.invocationCallOrder[0],
    );
  });

  it("STAB-55: send to a session with an EMPTY transcript hydrates first (empty messages = not hydrated)", async () => {
    // seedSession() seeds messages: [] — the AgentLite projection shape that
    // `agent.list`/`agent.get` return. An empty transcript is indistinguishable
    // from "never hydrated", so the send path must run the transcript load.
    appStore.dispatch(sendMessage(AGENT, { wsId: WS, text: "hello empty" }));
    await flush();
    await flush();

    expect(loadChatTranscriptSpy).toHaveBeenCalledWith(AGENT);
    expect(lifecycleSendMessage).toHaveBeenCalledTimes(1);
  });

  it("STAB-55: send to an already-hydrated session (non-empty transcript) skips the extra hydration", async () => {
    seedSession({
      messages: [
        {
          id: "m-prior",
          role: "assistant",
          timestamp: "2026-01-01T00:00:00.000Z",
          contentBlocks: [{ type: "text", text: "prior history" }],
        },
      ] as AgentSession["messages"],
    });

    appStore.dispatch(sendMessage(AGENT, { wsId: WS, text: "hello warm" }));
    await flush();
    await flush();

    expect(loadChatTranscriptSpy).not.toHaveBeenCalled();
    expect(lifecycleSendMessage).toHaveBeenCalledTimes(1);
  });

  it("STAB-55: queue-vs-send decision reads the POST-hydration streaming flags", async () => {
    // The stale pre-restart store says idle, but hydration reveals the daemon
    // is actually mid-turn — the refreshed flags must route the message
    // through agent.queueMessage, not the lifecycle send.
    appStore.dispatch(clearAllSessions());
    loadChatTranscriptSpy.mockImplementationOnce(async () => {
      seedSession({ isStreaming: true, isResponding: true, status: AgentStatus.Active });
    });

    appStore.dispatch(sendMessage(AGENT, { wsId: WS, text: "queue after hydrate" }));
    await flush();
    await flush();

    expect(loadChatTranscriptSpy).toHaveBeenCalledTimes(1);
    expect(lifecycleSendMessage).not.toHaveBeenCalled();
    expect(agentsQueue).toHaveBeenCalledWith(AGENT, "queue after hydrate");
  });

  it("STAB-55: a failed hydration still proceeds with the send (degrades, never blocks)", async () => {
    // loadChatTranscript swallows errors internally; even if it unexpectedly
    // rejects, the send path must not wedge the composer — the middleware
    // guards the await and proceeds with the send.
    appStore.dispatch(clearAllSessions());
    loadChatTranscriptSpy.mockImplementationOnce(() => Promise.reject(new Error("read boom")));

    appStore.dispatch(sendMessage(AGENT, { wsId: WS, text: "still send" }));
    await flush();
    await flush();

    expect(loadChatTranscriptSpy).toHaveBeenCalledTimes(1);
    expect(lifecycleSendMessage).toHaveBeenCalledTimes(1);
    expect(lifecycleSendMessage.mock.calls[0]?.[1]).toBe("still send");
  });

  // -------------------------------------------------------------------------
  // STAB-68: queuedMessageId triggers queue removal before the lifecycle send
  // -------------------------------------------------------------------------

  it("STAB-68: queuedMessageId triggers queue removal BEFORE the lifecycle send (correct wire ordering)", async () => {
    // Regression test for STAB-68: when user clicks "Send now" on a queued
    // message, ChatPanel dispatches sendMessage with queuedMessageId. The
    // middleware MUST remove the queued entry (optimistic local delete +
    // agent.removeQueuedMessage wire call) and AWAIT it BEFORE dispatching
    // the lifecycle send with priority: "interrupt". Without the await, the
    // daemon's interrupt turn completes, queue drains, and the same message
    // is delivered a second time.
    const seeded: QueuedMessage[] = [
      { id: "q-replay", content: "send me now", position: 0, queuedAt: "2026-01-01T00:00:01.000Z" },
    ];
    appStore.dispatch(replaceAgentQueue(AGENT, seeded));

    appStore.dispatch(
      sendMessage(AGENT, {
        wsId: WS,
        text: "send me now",
        queuedMessageId: "q-replay",
        forceSubmit: true,
        skipQueueCheck: true,
      }),
    );
    await flush();
    await flush();

    // Order assertion: agent.removeQueuedMessage MUST be called BEFORE lifecycle.sendMessage
    expect(agentsRemoveQueued).toHaveBeenCalledTimes(1);
    expect(agentsRemoveQueued).toHaveBeenCalledWith(AGENT, "q-replay");
    expect(lifecycleSendMessage).toHaveBeenCalledTimes(1);

    // Critical: removal call order MUST be < lifecycle send call order
    expect(agentsRemoveQueued.mock.invocationCallOrder[0]).toBeLessThan(
      lifecycleSendMessage.mock.invocationCallOrder[0],
    );

    // The lifecycle send must still pass priority: "interrupt"
    const optionsArg = lifecycleSendMessage.mock.calls[0]?.[3] as
      | { priority?: string }
      | undefined;
    expect(optionsArg?.priority).toBe("interrupt");

    // The local queue must be cleared immediately (optimistic removal)
    expect(selectAgentQueueMessages.select(appStore.state, AGENT)).toEqual([]);
  });

  it("STAB-68: queue removal failure does NOT block the lifecycle send (removal is idempotent)", async () => {
    // Even if the daemon reports a non-success or the seam throws, the
    // middleware must log it and proceed with the send — the worst case
    // matches today's behavior (duplicate delivery), and the BE's idempotency
    // contract means a failed removal cannot corrupt state.
    const seeded: QueuedMessage[] = [
      { id: "q-fail", content: "fail and send", position: 0, queuedAt: "2026-01-01T00:00:01.000Z" },
    ];
    appStore.dispatch(replaceAgentQueue(AGENT, seeded));
    agentsRemoveQueued.mockImplementationOnce(() =>
      Promise.resolve({ success: false, error: "not found" }),
    );

    appStore.dispatch(
      sendMessage(AGENT, {
        wsId: WS,
        text: "fail and send",
        queuedMessageId: "q-fail",
        forceSubmit: true,
        skipQueueCheck: true,
      }),
    );
    await flush();
    await flush();

    // The removal was attempted
    expect(agentsRemoveQueued).toHaveBeenCalledWith(AGENT, "q-fail");

    // The lifecycle send MUST still happen
    expect(lifecycleSendMessage).toHaveBeenCalledTimes(1);
    expect(lifecycleSendMessage.mock.calls[0]?.[1]).toBe("fail and send");
  });

  it("STAB-68: queue removal throwing does NOT block the lifecycle send", async () => {
    const seeded: QueuedMessage[] = [
      { id: "q-throw", content: "throw and send", position: 0, queuedAt: "2026-01-01T00:00:01.000Z" },
    ];
    appStore.dispatch(replaceAgentQueue(AGENT, seeded));
    agentsRemoveQueued.mockImplementationOnce(() => Promise.reject(new Error("ipc boom")));

    appStore.dispatch(
      sendMessage(AGENT, {
        wsId: WS,
        text: "throw and send",
        queuedMessageId: "q-throw",
        forceSubmit: true,
        skipQueueCheck: true,
      }),
    );
    await flush();
    await flush();

    expect(agentsRemoveQueued).toHaveBeenCalledWith(AGENT, "q-throw");
    expect(lifecycleSendMessage).toHaveBeenCalledTimes(1);
    expect(lifecycleSendMessage.mock.calls[0]?.[1]).toBe("throw and send");
  });

  // -------------------------------------------------------------------------
  // Chief first-message rename: when a chief thread has a user message and the
  // daemon-side name is still the creation placeholder, the daemon agent is
  // renamed to the sidebar-derived title via the `agent.rename` seam with
  // `skipIfExplicitlySet: true` (PROTOCOL §5.5). Edge-case hardening tracked
  // in monorepo#745.
  // -------------------------------------------------------------------------

  function seedChiefWorkspace(): void {
    appStore.dispatch(
      setWorkspaceEntity({
        id: CHIEF_WORKSPACE_ID,
        title: "Chief of Staff",
        branch: "",
        status: "active",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        changesets: [],
        timeline: [],
        conversationInfo: [],
      } as unknown as Workspace),
    );
  }

  function userMessage(text: string, id: string): AgentMessage {
    return {
      id,
      role: "user",
      contentBlocks: [{ type: "text", text }],
      timestamp: "2026-01-01T00:00:01.000Z",
    } as AgentMessage;
  }

  function seedChiefSession(
    messages: AgentMessage[] = [],
    overrides: Partial<AgentSession> = {},
  ): void {
    appStore.dispatch(
      bulkUpsertSessions([
        {
          id: CHIEF_AGENT,
          backendSessionId: "backend-chief-1",
          workspaceId: CHIEF_WORKSPACE_ID,
          // Creation placeholder (ChiefCard: formatChiefThreadName, with
          // nameExplicitlySet: false on the daemon side).
          name: "New chat with Intent",
          status: AgentStatus.Idle,
          messages,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          ...overrides,
        } as AgentSession,
      ]),
    );
  }

  it("chief first user message renames the agent to the sidebar-derived title with skipIfExplicitlySet", async () => {
    seedChiefWorkspace();
    seedChiefSession();
    // Mirror the real lifecycle send: the optimistic user message lands in the
    // session store before sendMessage resolves.
    lifecycleSendMessage.mockImplementation(() => {
      seedChiefSession([userMessage("check my ~/intent/ workspaces", "m-user-1")]);
      return Promise.resolve();
    });

    appStore.dispatch(
      sendMessage(CHIEF_AGENT, { wsId: CHIEF_WORKSPACE_ID, text: "check my ~/intent/ workspaces" }),
    );
    await flush();
    await flush();
    await flush();

    // Regression: the rename must carry exactly the title the sidebar shows
    // (same shared derivation — getChiefThreadTitle).
    const sidebarTitle = selectChiefThreads
      .select(appStore.state)
      .find((thread) => thread.agentId === CHIEF_AGENT)?.title;
    expect(sidebarTitle).toBe("check my ~/intent/ workspaces");
    expect(agentsRename).toHaveBeenCalledTimes(1);
    expect(agentsRename).toHaveBeenCalledWith(CHIEF_AGENT, sidebarTitle, undefined, {
      skipIfExplicitlySet: true,
    });
  });

  it("chief thread does NOT re-rename on subsequent sends once the daemon-side name is real", async () => {
    seedChiefWorkspace();
    // The first-message rename already landed: `agent:renamed` refreshed the
    // session name to the real title.
    seedChiefSession([userMessage("first message", "m-user-1")], { name: "first message" });

    appStore.dispatch(
      sendMessage(CHIEF_AGENT, { wsId: CHIEF_WORKSPACE_ID, text: "second message" }),
    );
    await flush();
    await flush();
    await flush();

    expect(lifecycleSendMessage).toHaveBeenCalledTimes(1);
    expect(agentsRename).not.toHaveBeenCalled();
  });

  it("queue-path first chief message still renames the daemon agent (monorepo#745 edge 1)", async () => {
    // Regression (monorepo#745): when the very FIRST user message of a chief
    // thread takes the queue path (agent busy), the rename must still fire —
    // the queued text becomes the thread's first user message, so the daemon
    // name is derived from it.
    seedChiefWorkspace();
    seedChiefSession([], { isStreaming: true, status: AgentStatus.Active });

    appStore.dispatch(
      sendMessage(CHIEF_AGENT, { wsId: CHIEF_WORKSPACE_ID, text: "plan my week" }),
    );
    await flush();
    await flush();
    await flush();

    expect(lifecycleSendMessage).not.toHaveBeenCalled();
    expect(agentsQueue).toHaveBeenCalledTimes(1);
    expect(agentsRename).toHaveBeenCalledTimes(1);
    expect(agentsRename).toHaveBeenCalledWith(CHIEF_AGENT, "plan my week", undefined, {
      skipIfExplicitlySet: true,
    });
  });

  it("retroactively renames on a later send when the daemon-side name is still the placeholder (monorepo#745 edge 1)", async () => {
    // Regression (monorepo#745): a thread that missed its first-message
    // rename (e.g. the trigger never fired) is fixed on the next send — and
    // the title comes from the thread's FIRST user message, not the one just
    // sent.
    seedChiefWorkspace();
    seedChiefSession([userMessage("first message", "m-user-1")]);
    lifecycleSendMessage.mockImplementation(() => {
      seedChiefSession([
        userMessage("first message", "m-user-1"),
        userMessage("second message", "m-user-2"),
      ]);
      return Promise.resolve();
    });

    appStore.dispatch(
      sendMessage(CHIEF_AGENT, { wsId: CHIEF_WORKSPACE_ID, text: "second message" }),
    );
    await flush();
    await flush();
    await flush();

    expect(agentsRename).toHaveBeenCalledTimes(1);
    expect(agentsRename).toHaveBeenCalledWith(CHIEF_AGENT, "first message", undefined, {
      skipIfExplicitlySet: true,
    });
  });

  it("degraded hydration cannot re-fire the rename with a later message's text (monorepo#745 edge 2)", async () => {
    // Regression (monorepo#745): a swallowed hydration failure leaves the
    // local transcript empty even though the thread was already renamed
    // daemon-side (session.name refreshed by `agent:renamed`). The next send
    // must NOT re-fire the rename with the later message's text.
    seedChiefWorkspace();
    seedChiefSession([], { name: "check my ~/intent/ workspaces" });
    lifecycleSendMessage.mockImplementation(() => {
      seedChiefSession([userMessage("a much later message", "m-user-9")], {
        name: "check my ~/intent/ workspaces",
      });
      return Promise.resolve();
    });

    appStore.dispatch(
      sendMessage(CHIEF_AGENT, { wsId: CHIEF_WORKSPACE_ID, text: "a much later message" }),
    );
    await flush();
    await flush();
    await flush();

    expect(lifecycleSendMessage).toHaveBeenCalledTimes(1);
    expect(agentsRename).not.toHaveBeenCalled();
  });

  it("image-only first chief message skips the same-name wire rename (monorepo#745 edge 3)", async () => {
    // Regression (monorepo#745): an image-only first message derives the
    // placeholder title ("New chat with Intent") — issuing a wire rename to
    // the same placeholder is pointless and must be skipped.
    seedChiefWorkspace();
    seedChiefSession();
    lifecycleSendMessage.mockImplementation(() => {
      seedChiefSession([
        {
          id: "m-user-img",
          role: "user",
          contentBlocks: [{ type: "image", data: "aGVsbG8=", mimeType: "image/png" }],
          timestamp: "2026-01-01T00:00:01.000Z",
        } as unknown as AgentMessage,
      ]);
      return Promise.resolve();
    });

    appStore.dispatch(
      sendMessage(CHIEF_AGENT, {
        wsId: CHIEF_WORKSPACE_ID,
        text: " ",
        imageBlocks: [{ type: "image", data: "aGVsbG8=", mimeType: "image/png" }],
      }),
    );
    await flush();
    await flush();
    await flush();

    expect(lifecycleSendMessage).toHaveBeenCalledTimes(1);
    expect(agentsRename).not.toHaveBeenCalled();
  });

  it("non-chief workspaces never trigger the first-message rename", async () => {
    // Default seeded session (WS/AGENT) has zero user messages — the 0 → 1
    // transition happens, but the workspace is not the chief workspace.
    appStore.dispatch(sendMessage(AGENT, { wsId: WS, text: "hello non-chief" }));
    await flush();
    await flush();
    await flush();

    expect(lifecycleSendMessage).toHaveBeenCalledTimes(1);
    expect(agentsRename).not.toHaveBeenCalled();
  });

  it("chief rename is skipped when the lifecycle send fails", async () => {
    seedChiefWorkspace();
    seedChiefSession();
    lifecycleSendMessage.mockImplementation(() => Promise.reject(new Error("send boom")));

    appStore.dispatch(
      sendMessage(CHIEF_AGENT, { wsId: CHIEF_WORKSPACE_ID, text: "will not deliver" }),
    );
    await flush();
    await flush();
    await flush();

    expect(agentsRename).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // #941: retry-after-failure resends the recorded lastAttemptedMessage
  // -------------------------------------------------------------------------

  it("#941: the lifecycle send records lastAttemptedMessage with the final content (context prefix included)", async () => {
    appStore.dispatch(
      sendMessage(AGENT, {
        wsId: WS,
        text: "do work",
        workspaceContextStr: "CTX",
        noteIds: ["note-1"],
      }),
    );
    await flush();
    await flush();

    expect(selectChatAgentState.select(appStore.state, AGENT)?.lastAttemptedMessage).toEqual({
      text: "CTX\n\ndo work",
      options: { noteIds: ["note-1"] },
    });
  });

  it("#941: agentSessionRetryLastMessageRequested resends the recorded message through the lifecycle send without re-prefixing", async () => {
    appStore.dispatch(
      chatLastAttemptedMessageSet(AGENT, {
        text: "CTX\n\nedited text",
        options: { noteIds: ["note-1"] },
      }),
    );

    const action = agentSessionRetryLastMessageRequested(AGENT, WS);
    appStore.dispatch(action);
    await action.promise;

    expect(lifecycleSendMessage).toHaveBeenCalledTimes(1);
    const [agentIdArg, contentArg, workspaceArg, optionsArg] = lifecycleSendMessage.mock.calls[0] as [
      string,
      string,
      Workspace,
      { noteIds?: string[] },
    ];
    expect(agentIdArg).toBe(AGENT);
    // The recorded text already carries the context prefix — resent verbatim.
    expect(contentArg).toBe("CTX\n\nedited text");
    expect(workspaceArg.id).toBe(WS);
    expect(optionsArg.noteIds).toEqual(["note-1"]);
  });

  it("#941: retry with no recorded lastAttemptedMessage resolves as a no-op with user feedback", async () => {
    const { toast } = await import("svelte-sonner");
    appStore.dispatch(chatLastAttemptedMessageSet(AGENT, null));

    const action = agentSessionRetryLastMessageRequested(AGENT, WS);
    appStore.dispatch(action);
    await action.promise;
    await flush();

    expect(lifecycleSendMessage).not.toHaveBeenCalled();
    expect(agentsQueue).not.toHaveBeenCalled();
    expect(toast.info).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // #964: retry-with-model resends the recorded message with the suggested
  // model as a one-shot send-option override
  // -------------------------------------------------------------------------

  it("#964: agentSessionRetryWithModelRequested resends the recorded message with the suggested model", async () => {
    appStore.dispatch(
      chatLastAttemptedMessageSet(AGENT, {
        text: "CTX\n\nedited text",
        options: { noteIds: ["note-1"] },
      }),
    );

    const action = agentSessionRetryWithModelRequested(AGENT, WS, "fast-model");
    appStore.dispatch(action);
    await action.promise;

    expect(lifecycleSendMessage).toHaveBeenCalledTimes(1);
    const [agentIdArg, contentArg, workspaceArg, optionsArg] = lifecycleSendMessage.mock.calls[0] as [
      string,
      string,
      Workspace,
      { noteIds?: string[]; model?: string },
    ];
    expect(agentIdArg).toBe(AGENT);
    // The recorded text already carries the context prefix — resent verbatim.
    expect(contentArg).toBe("CTX\n\nedited text");
    expect(workspaceArg.id).toBe(WS);
    expect(optionsArg.noteIds).toEqual(["note-1"]);
    // The suggested model rides the lifecycle send options; the lifecycle
    // resolves the wire model as options.model ?? session.model.
    expect(optionsArg.model).toBe("fast-model");
  });

  it("#964: retry-with-model records the model on lastAttemptedMessage so a later Try again keeps it", async () => {
    appStore.dispatch(chatLastAttemptedMessageSet(AGENT, { text: "edited text" }));

    const action = agentSessionRetryWithModelRequested(AGENT, WS, "fast-model");
    appStore.dispatch(action);
    await action.promise;

    expect(selectChatAgentState.select(appStore.state, AGENT)?.lastAttemptedMessage).toEqual({
      text: "edited text",
      options: { model: "fast-model" },
    });
  });

  it("#964: retry-with-model with no recorded lastAttemptedMessage resolves as a no-op with user feedback", async () => {
    const { toast } = await import("svelte-sonner");
    appStore.dispatch(chatLastAttemptedMessageSet(AGENT, null));

    const action = agentSessionRetryWithModelRequested(AGENT, WS, "fast-model");
    appStore.dispatch(action);
    await action.promise;
    await flush();

    expect(lifecycleSendMessage).not.toHaveBeenCalled();
    expect(agentsQueue).not.toHaveBeenCalled();
    expect(toast.info).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // #965: retry resends the recorded image attachments
  // -------------------------------------------------------------------------

  const IMAGE_BLOCKS = [
    { type: "image" as const, data: "aGVsbG8=", mimeType: "image/png" },
  ];

  // -------------------------------------------------------------------------
  // #969: queue-on-send records lastAttemptedMessage ONLY in the enqueue
  // FAILURE branches (rejection/throw), pairing the banner with exactly the
  // message that failed to queue. A SUCCESSFUL enqueue must leave the
  // in-flight turn's record alone: the queued message drains FIFO
  // daemon-side anyway, so if the in-flight turn fails, "Try again" must
  // retry the failed message — resending the queued one would deliver it
  // twice.
  // -------------------------------------------------------------------------

  it("#969: a failed enqueue records the full retry payload (context prefix included) and options", async () => {
    seedSession({ isStreaming: true, status: AgentStatus.Active });
    agentsQueue.mockImplementationOnce(() =>
      Promise.resolve({ success: false, error: "no can do" }),
    );

    appStore.dispatch(
      sendMessage(AGENT, {
        wsId: WS,
        text: "queue me",
        workspaceContextStr: "CTX",
        noteIds: ["note-1"],
        imageBlocks: IMAGE_BLOCKS,
      }),
    );
    await flush();
    await flush();

    expect(lifecycleSendMessage).not.toHaveBeenCalled();
    expect(agentsQueue).toHaveBeenCalledTimes(1);
    expect(selectChatAgentState.select(appStore.state, AGENT)?.lastAttemptedMessage).toEqual({
      text: "CTX\n\nqueue me",
      options: { noteIds: ["note-1"], imageBlocks: IMAGE_BLOCKS },
    });
  });

  it("#969: a successful enqueue does NOT overwrite the in-flight turn's record — a failed turn A stays retryable (no duplicate B delivery)", async () => {
    // Regression test for the review's blocking finding: A is in flight
    // (recorded), B enqueues successfully (B is in the daemon queue and will
    // drain FIFO). If A's turn then FAILS, "Try again" must retry A — not
    // resend B, which would be delivered twice.
    appStore.dispatch(chatLastAttemptedMessageSet(AGENT, { text: "message A" }));
    seedSession({ isStreaming: true, status: AgentStatus.Active });

    appStore.dispatch(sendMessage(AGENT, { wsId: WS, text: "message B" }));
    await flush();
    await flush();

    expect(agentsQueue).toHaveBeenCalledTimes(1);
    // Successful enqueue: A's record is untouched.
    expect(selectChatAgentState.select(appStore.state, AGENT)?.lastAttemptedMessage).toEqual({
      text: "message A",
    });

    // A's turn fails — the reducer preserves the record, so Try again
    // retries A.
    appStore.dispatch(
      agentStreamUpdateReceived({
        agentId: AGENT,
        handlerSessionId: AGENT,
        source: "sendMessage",
        eventType: "error",
        error: "turn A blew up",
      }),
    );
    expect(selectChatAgentState.select(appStore.state, AGENT)?.lastAttemptedMessage).toEqual({
      text: "message A",
    });
  });

  it("#969/#999: a successful enqueue parks B's record; the drain snapshot promotes it and the drained queue's agent:idle clears it", async () => {
    // When in-flight A ends, its `agent:stream:end` (mapped to eventType
    // 'complete') is disposition-neutral and no longer clears the record
    // (#984); with B queued ready-to-send the daemon also withholds
    // `agent:idle` until the drain finishes. With turn-scoped records (#999)
    // B's payload parks under its QueuedMessage id, the drain snapshot
    // (`agent:queue:updated` without the id) promotes it into
    // `lastAttemptedMessage`, and the final turn's `agent:idle` performs the
    // success-clear.
    appStore.dispatch(chatLastAttemptedMessageSet(AGENT, { text: "message A" }));
    seedSession({ isStreaming: true, status: AgentStatus.Active });

    const queuedB: QueuedMessage = {
      id: "qm-B",
      content: "message B",
      position: 0,
      queuedAt: "2026-01-01T00:00:00.000Z",
    };
    agentsQueue.mockImplementationOnce(() =>
      Promise.resolve({ success: true, queuedMessage: queuedB }),
    );
    appStore.dispatch(sendMessage(AGENT, { wsId: WS, text: "message B" }));
    await flush();
    await flush();
    expect(agentsQueue).toHaveBeenCalledTimes(1);
    // Successful enqueue: A's active record untouched, B parked by id.
    expect(selectChatAgentState.select(appStore.state, AGENT)?.lastAttemptedMessage).toEqual({
      text: "message A",
    });
    expect(selectChatAgentState.select(appStore.state, AGENT)?.queuedRetryRecords).toEqual({
      "qm-B": { seq: 1, record: { text: "message B" } },
    });

    appStore.dispatch(
      agentStreamUpdateReceived({
        agentId: AGENT,
        handlerSessionId: AGENT,
        source: "sendMessage",
        eventType: "complete",
      }),
    );
    // Disposition-neutral terminal — the active record survives (#984).
    expect(selectChatAgentState.select(appStore.state, AGENT)?.lastAttemptedMessage).toEqual({
      text: "message A",
    });

    // The daemon dequeues B to run it and publishes the shrunk snapshot —
    // the parked record is promoted to the active slot (#999).
    appStore.dispatch(replaceAgentQueue(AGENT, []));
    expect(selectChatAgentState.select(appStore.state, AGENT)?.lastAttemptedMessage).toEqual({
      text: "message B",
    });
    expect(selectChatAgentState.select(appStore.state, AGENT)?.queuedRetryRecords).toEqual({});

    // The drained queue's terminal `agent:idle` performs the success-clear.
    const idleEvent: AgentIdleEvent = {
      id: "evt-idle-drain-1",
      type: "agent:idle",
      timestamp: "2026-01-01T00:00:00.000Z",
      workspaceId: WS,
      actor: { type: "agent", id: AGENT },
      data: {
        agentId: AGENT,
        agentName: "Test Agent",
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
    expect(selectChatAgentState.select(appStore.state, AGENT)?.lastAttemptedMessage).toBeNull();
  });

  it("#999: a failed DRAINED turn retries the drained message B, not the already-succeeded in-flight A", async () => {
    // The issue's core scenario: A in flight (recorded), B queued
    // successfully. A completes, the daemon drains B, and B's turn FAILS.
    // "Try again" must resend B — resending A would be a duplicate delivery.
    appStore.dispatch(chatLastAttemptedMessageSet(AGENT, { text: "message A" }));
    seedSession({ isStreaming: true, status: AgentStatus.Active });

    const queuedB: QueuedMessage = {
      id: "qm-B",
      content: "message B",
      position: 0,
      queuedAt: "2026-01-01T00:00:00.000Z",
    };
    agentsQueue.mockImplementationOnce(() =>
      Promise.resolve({ success: true, queuedMessage: queuedB }),
    );
    appStore.dispatch(sendMessage(AGENT, { wsId: WS, text: "message B" }));
    await flush();
    await flush();

    // A's disposition-neutral terminal, then the drain snapshot for B.
    appStore.dispatch(
      agentStreamUpdateReceived({
        agentId: AGENT,
        handlerSessionId: AGENT,
        source: "sendMessage",
        eventType: "complete",
      }),
    );
    appStore.dispatch(replaceAgentQueue(AGENT, []));

    // B's drained turn fails — the failure banner appears with B recorded.
    appStore.dispatch(
      agentStreamUpdateReceived({
        agentId: AGENT,
        handlerSessionId: AGENT,
        source: "sendMessage",
        eventType: "error",
        error: "turn B blew up",
      }),
    );
    expect(selectChatAgentState.select(appStore.state, AGENT)?.lastAttemptedMessage).toEqual({
      text: "message B",
    });

    // "Try again" resends B through the lifecycle path.
    seedSession({ isStreaming: false, status: AgentStatus.Idle });
    const action = agentSessionRetryLastMessageRequested(AGENT, WS);
    appStore.dispatch(action);
    await action.promise;
    expect(lifecycleSendMessage).toHaveBeenCalledTimes(1);
    expect(lifecycleSendMessage.mock.calls[0]?.[1]).toBe("message B");
  });

  it("#999: removing a queued message drops its parked record without promotion", async () => {
    appStore.dispatch(chatLastAttemptedMessageSet(AGENT, { text: "message A" }));
    seedSession({ isStreaming: true, status: AgentStatus.Active });

    const queuedB: QueuedMessage = {
      id: "qm-B",
      content: "message B",
      position: 0,
      queuedAt: "2026-01-01T00:00:00.000Z",
    };
    agentsQueue.mockImplementationOnce(() =>
      Promise.resolve({ success: true, queuedMessage: queuedB }),
    );
    appStore.dispatch(sendMessage(AGENT, { wsId: WS, text: "message B" }));
    await flush();
    await flush();
    expect(selectChatAgentState.select(appStore.state, AGENT)?.queuedRetryRecords).toEqual({
      "qm-B": { seq: 1, record: { text: "message B" } },
    });

    // User deletes the queued entry — B will never drain, so its record is
    // dropped and A's active record stays authoritative.
    appStore.dispatch(removeQueuedMessageRequested(AGENT, "qm-B"));
    await flush();
    expect(selectChatAgentState.select(appStore.state, AGENT)?.queuedRetryRecords).toEqual({});
    expect(selectChatAgentState.select(appStore.state, AGENT)?.lastAttemptedMessage).toEqual({
      text: "message A",
    });
  });

  it("#969: two rapid queue failures — the record pairs with the LAST failed message", async () => {
    seedSession({ isStreaming: true, status: AgentStatus.Active });
    agentsQueue
      .mockImplementationOnce(() => Promise.resolve({ success: false, error: "rejected" }))
      .mockImplementationOnce(() => Promise.resolve({ success: false, error: "rejected" }));

    appStore.dispatch(sendMessage(AGENT, { wsId: WS, text: "message A" }));
    await flush();
    await flush();
    appStore.dispatch(sendMessage(AGENT, { wsId: WS, text: "message B" }));
    await flush();
    await flush();

    expect(agentsQueue).toHaveBeenCalledTimes(2);
    expect(selectChatAgentState.select(appStore.state, AGENT)?.lastAttemptedMessage).toEqual({
      text: "message B",
    });
  });

  it("#969: queue-on-send rejection pairs the banner with the message that failed to queue, not a stale prior attempt", async () => {
    // Message A was recorded by an earlier direct send that is now in flight;
    // message B fails to queue. The banner's "Try again" must resend B.
    appStore.dispatch(chatLastAttemptedMessageSet(AGENT, { text: "message A" }));
    seedSession({ isStreaming: true, status: AgentStatus.Active });
    agentsQueue.mockImplementationOnce(() =>
      Promise.resolve({ success: false, error: "no can do" }),
    );

    appStore.dispatch(sendMessage(AGENT, { wsId: WS, text: "message B" }));
    await flush();
    await flush();

    const chatState = selectChatAgentState.select(appStore.state, AGENT);
    expect(chatState?.error).toBe("no can do");
    expect(chatState?.lastAttemptedMessage).toEqual({ text: "message B" });
  });

  it("#969: a thrown queue call also leaves the failed message recorded for retry", async () => {
    appStore.dispatch(chatLastAttemptedMessageSet(AGENT, { text: "message A" }));
    seedSession({ isStreaming: true, status: AgentStatus.Active });
    agentsQueue.mockImplementationOnce(() => Promise.reject(new Error("ipc boom")));

    appStore.dispatch(sendMessage(AGENT, { wsId: WS, text: "message B" }));
    await flush();
    await flush();

    const chatState = selectChatAgentState.select(appStore.state, AGENT);
    expect(chatState?.error).toContain("ipc boom");
    expect(chatState?.lastAttemptedMessage).toEqual({ text: "message B" });
  });

  it("#969: retry-with-model landing on the queue path and FAILING to enqueue records the one-shot override without mutating session model state", async () => {
    // Race from the #483 review: selectAgentIsResponding flips true between
    // the "Retry with <model>" click and the send, so the resend takes the
    // queue path. agent.queueMessage has no model param (PROTOCOL §5.5), so
    // the override cannot ride the queued delivery — but when the enqueue
    // FAILS, the override must stay recorded so a post-failure "Try again"
    // re-sends it, and the session model must never be mutated.
    appStore.dispatch(chatLastAttemptedMessageSet(AGENT, { text: "edited text" }));
    seedSession({ isStreaming: true, status: AgentStatus.Active, model: "session-model" });
    agentsQueue.mockImplementationOnce(() =>
      Promise.resolve({ success: false, error: "queue full" }),
    );

    const action = agentSessionRetryWithModelRequested(AGENT, WS, "fast-model");
    appStore.dispatch(action);
    await action.promise;
    await flush();

    expect(lifecycleSendMessage).not.toHaveBeenCalled();
    expect(agentsQueue).toHaveBeenCalledTimes(1);
    expect(agentsQueue).toHaveBeenCalledWith(AGENT, "edited text");
    expect(selectChatAgentState.select(appStore.state, AGENT)?.lastAttemptedMessage).toEqual({
      text: "edited text",
      options: { model: "fast-model" },
    });
    // One-shot semantics: the session's model is untouched.
    const session = (appStore.state as {
      agentSessions?: { byAgentId: Record<string, AgentSession> };
    }).agentSessions?.byAgentId[AGENT];
    expect(session?.model).toBe("session-model");
  });

  // -------------------------------------------------------------------------
  // #483 review test gaps: recorded-model forwarding and one-shot no-leak
  // -------------------------------------------------------------------------

  it("#483: plain Try again forwards the recorded model to lifecycle.sendMessage (end-to-end seam)", async () => {
    appStore.dispatch(
      chatLastAttemptedMessageSet(AGENT, {
        text: "edited text",
        options: { model: "fast-model" },
      }),
    );

    const action = agentSessionRetryLastMessageRequested(AGENT, WS);
    appStore.dispatch(action);
    await action.promise;

    expect(lifecycleSendMessage).toHaveBeenCalledTimes(1);
    const [, contentArg, , optionsArg] = lifecycleSendMessage.mock.calls[0] as [
      string,
      string,
      Workspace,
      { model?: string },
    ];
    expect(contentArg).toBe("edited text");
    expect(optionsArg.model).toBe("fast-model");
  });

  it("#483: a subsequent normal send does NOT inherit a previously recorded model (one-shot no-leak)", async () => {
    // A retry-with-model recorded a model override; the next normal send has
    // no model of its own — the override must not leak into it, and the
    // fresh record must overwrite the old one without a model.
    appStore.dispatch(
      chatLastAttemptedMessageSet(AGENT, {
        text: "old text",
        options: { model: "fast-model" },
      }),
    );

    appStore.dispatch(sendMessage(AGENT, { wsId: WS, text: "next message" }));
    await flush();
    await flush();

    expect(lifecycleSendMessage).toHaveBeenCalledTimes(1);
    const [, contentArg, , optionsArg] = lifecycleSendMessage.mock.calls[0] as [
      string,
      string,
      Workspace,
      { model?: string },
    ];
    expect(contentArg).toBe("next message");
    expect(optionsArg.model).toBeUndefined();
    expect(selectChatAgentState.select(appStore.state, AGENT)?.lastAttemptedMessage).toEqual({
      text: "next message",
    });
  });

  it("#965: the lifecycle send records imageBlocks on lastAttemptedMessage", async () => {
    appStore.dispatch(
      sendMessage(AGENT, {
        wsId: WS,
        text: "look at this",
        imageBlocks: IMAGE_BLOCKS,
      }),
    );
    await flush();
    await flush();

    expect(selectChatAgentState.select(appStore.state, AGENT)?.lastAttemptedMessage).toEqual({
      text: "look at this",
      options: { imageBlocks: IMAGE_BLOCKS },
    });
  });

  it("#965: agentSessionRetryLastMessageRequested forwards the recorded imageBlocks to the lifecycle send", async () => {
    appStore.dispatch(
      chatLastAttemptedMessageSet(AGENT, {
        text: "look at this",
        options: { imageBlocks: IMAGE_BLOCKS },
      }),
    );

    const action = agentSessionRetryLastMessageRequested(AGENT, WS);
    appStore.dispatch(action);
    await action.promise;

    expect(lifecycleSendMessage).toHaveBeenCalledTimes(1);
    const [, , , optionsArg] = lifecycleSendMessage.mock.calls[0] as [
      string,
      string,
      Workspace,
      { imageBlocks?: Array<{ type: "image"; data: string; mimeType: string }> },
    ];
    expect(optionsArg.imageBlocks).toEqual(IMAGE_BLOCKS);
  });

  it("#965: agentSessionRetryWithModelRequested forwards the recorded imageBlocks alongside the model", async () => {
    appStore.dispatch(
      chatLastAttemptedMessageSet(AGENT, {
        text: "look at this",
        options: { imageBlocks: IMAGE_BLOCKS },
      }),
    );

    const action = agentSessionRetryWithModelRequested(AGENT, WS, "fast-model");
    appStore.dispatch(action);
    await action.promise;

    expect(lifecycleSendMessage).toHaveBeenCalledTimes(1);
    const [, , , optionsArg] = lifecycleSendMessage.mock.calls[0] as [
      string,
      string,
      Workspace,
      { model?: string; imageBlocks?: Array<{ type: "image"; data: string; mimeType: string }> },
    ];
    expect(optionsArg.imageBlocks).toEqual(IMAGE_BLOCKS);
    expect(optionsArg.model).toBe("fast-model");
    // The re-recorded lastAttemptedMessage keeps the attachments so a later
    // Try again still carries them.
    expect(selectChatAgentState.select(appStore.state, AGENT)?.lastAttemptedMessage).toEqual({
      text: "look at this",
      options: { model: "fast-model", imageBlocks: IMAGE_BLOCKS },
    });
  });

  it("#965: retry without recorded attachments still sends with imageBlocks undefined", async () => {
    appStore.dispatch(
      chatLastAttemptedMessageSet(AGENT, {
        text: "plain text",
        options: { noteIds: ["note-1"] },
      }),
    );

    const action = agentSessionRetryLastMessageRequested(AGENT, WS);
    appStore.dispatch(action);
    await action.promise;

    expect(lifecycleSendMessage).toHaveBeenCalledTimes(1);
    const [, contentArg, , optionsArg] = lifecycleSendMessage.mock.calls[0] as [
      string,
      string,
      Workspace,
      { noteIds?: string[]; imageBlocks?: unknown },
    ];
    expect(contentArg).toBe("plain text");
    expect(optionsArg.noteIds).toEqual(["note-1"]);
    expect(optionsArg.imageBlocks).toBeUndefined();
  });
});
