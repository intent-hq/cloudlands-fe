import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentStatus } from "$shared/types/agent.types";
import type { AgentSession, QueuedMessage, Workspace } from "$shared/types";

// FAKE seams: agent-stream-lifecycle.sendMessage and appClient.agents.queue
// are both spied so no IPC/daemon call (and never the real backend pipeline)
// happens. The service runs against the REAL configured store so the
// middleware wiring, workspace resolution, the BE-state in-flight read, the
// chatSendStarted dispatch, and the queue-on-send branch are exercised end to
// end. vi.hoisted() keeps the spies in scope of the hoisted vi.mock factories.
const { lifecycleSendMessage, agentsQueue } = vi.hoisted(() => ({
  lifecycleSendMessage: vi.fn(() => Promise.resolve()),
  agentsQueue: vi.fn(() =>
    Promise.resolve({ success: true } as { success: boolean; queuedMessage?: unknown }),
  ),
}));
vi.mock("$features/agent/agent-stream-lifecycle", () => ({
  sendMessage: lifecycleSendMessage,
}));
vi.mock("$lib/client", () => ({
  appClient: { agents: { queue: agentsQueue } },
}));

import { store as appStore } from "$store/renderer/store";
import { setWorkspaceEntity } from "$store/renderer/slices/workspace/workspace-slice";
import {
  bulkUpsertSessions,
  clearAllSessions,
} from "$store/renderer/slices/agent-session/agent-session-slice";
import { clearAgentQueue } from "$store/renderer/slices/agent-queue/agent-queue-slice";
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
});
