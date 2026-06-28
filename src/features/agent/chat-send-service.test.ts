import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentStatus } from "$shared/types/agent.types";
import type { AgentSession, Workspace } from "$shared/types";

// FAKE seam: agent-stream-lifecycle.sendMessage is spied so no IPC/daemon
// call (and never the real backend pipeline) happens. The service runs
// against the REAL configured store so the middleware wiring, workspace
// resolution, the streaming-guard read, and the chatSendStarted dispatch are
// exercised end to end.
const lifecycleSendMessage = vi.fn(() => Promise.resolve());
vi.mock("$features/agent/agent-stream-lifecycle", () => ({
  sendMessage: lifecycleSendMessage,
}));

import { store as appStore } from "$store/renderer/store";
import { setWorkspaceEntity } from "$store/renderer/slices/workspace/workspace-slice";
import {
  bulkUpsertSessions,
  clearAllSessions,
} from "$store/renderer/slices/agent-session/agent-session-slice";
import {
  sendMessage,
  sendInitialMessageRequested,
} from "$store/renderer/slices/chat-state/chat-state-slice";
import { selectChatAgentState } from "$store/renderer/slices/chat-state/chat-state-selectors";

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
    appStore.dispatch(clearAllSessions());
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

  it("guard: skips sending when the agent is currently responding (no double-send)", async () => {
    seedSession({ isStreaming: true });

    appStore.dispatch(sendMessage(AGENT, { wsId: WS, text: "racey" }));
    await flush();
    await flush();

    expect(lifecycleSendMessage).not.toHaveBeenCalled();
  });

  it("no-ops when the workspace is not in the store", async () => {
    appStore.dispatch(sendMessage(AGENT, { wsId: "ws-missing", text: "hello" }));
    await flush();
    await flush();

    expect(lifecycleSendMessage).not.toHaveBeenCalled();
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
