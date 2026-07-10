/**
 * Wire-level regression test for the chat send path (empty-transcript bug).
 *
 * Drives the REAL agent-stream-lifecycle `sendMessage()` against the REAL
 * configured store, REAL mutation middleware, REAL live-agents-client, and the
 * REAL agent IPC bridge seeder — only `backend-transport.backendRequest` is
 * mocked, returning PROTOCOL.md §5.5-shaped daemon payloads captured from a
 * live daemon (a fresh `pending` agent projection with no acpSessionId).
 *
 * Asserts the daemon receives `agent.sendMessage` with the right params when
 * the user sends the first message to a freshly created (pending) agent.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { backendRequestMock } = vi.hoisted(() => ({
  backendRequestMock: vi.fn(),
}));
// test-setup.ts globally fakes `$lib/electron-bridge` with canned `{success:true}`
// responses — which HIDES a dropped send. Unmock it so the REAL invoke →
// ipc-mock-router → bridge-seeder → backendRequest chain runs.
vi.unmock("$lib/electron-bridge");
vi.mock("$lib/client/live/backend-transport", () => ({
  backendRequest: backendRequestMock,
  backendSubscribe: vi.fn(async () => ({})),
  backendUnsubscribe: vi.fn(async () => {}),
  onBackendNotification: vi.fn(() => () => {}),
  onBackendReconnected: vi.fn(() => () => {}),
  detectLiveStateCapability: vi.fn(async () => false),
  isBackendAvailable: () => true,
  BackendError: class BackendError extends Error {},
}));

// Register the real bridge (agent:backend:stream-message → agent.sendMessage).
import "$store/renderer/seeders/agent-ipc-bridge-seeder";
import { store as appStore } from "$store/renderer/store";
import { setWorkspaceEntity } from "$store/renderer/slices/workspace/workspace-slice";
import {
  bulkUpsertSessions,
  clearAllSessions,
} from "$store/renderer/slices/agent-session/agent-session-slice";
import { sendMessage as lifecycleSendMessage } from "$features/agent/agent-stream-lifecycle";
import { AgentStatus } from "$shared/types";
import type { AgentSession, Workspace } from "$shared/types";

const WS = "c6df5dce-f8c6-44fe-8a2d-227a8815f2af";
const AGENT = "agent-373f33d3-0a26-4b8b-9ecf-f114bfa47df4";

/** Daemon agent projection exactly as `agent.get` returns it for a fresh agent. */
const daemonPendingAgent = {
  id: AGENT,
  workspaceId: WS,
  name: "Coordinator",
  nameExplicitlySet: true,
  status: "pending",
  provider: "auggie",
  model: "opus4.7",
  isActive: false,
  isProcessing: false,
  isResponding: false,
  isStreaming: false,
  isWaitingOnTool: false,
  isWaitingForOtherAgents: false,
  waitingForAgentIds: [],
  messageCount: 0,
  metadata: { isBackground: false },
  createdAt: "2026-07-03T14:35:35.924892Z",
  updatedAt: "2026-07-03T14:35:35.924892Z",
  lastActivity: "2026-07-03T14:35:35.924892Z",
};

function workspace(): Workspace {
  return {
    id: WS,
    title: "intent",
    branch: "main",
    status: "active",
    path: "/Users/clement/src/intent",
    repositoryPath: "/Users/clement/src/intent",
    createdAt: "2026-06-24T13:18:22.961Z",
    updatedAt: "2026-06-24T13:18:22.961Z",
    changesets: [],
    timeline: [],
    conversationInfo: [],
  } as unknown as Workspace;
}

function seedPendingSession(): void {
  appStore.dispatch(
    bulkUpsertSessions([
      {
        id: AGENT,
        backendSessionId: null,
        workspaceId: WS,
        name: "Coordinator",
        status: AgentStatus.Pending,
        messages: [],
        createdAt: "2026-07-03T14:35:35.924Z",
        updatedAt: "2026-07-03T14:35:35.924Z",
      } as unknown as AgentSession,
    ]),
  );
}

describe("send path wire contract (pending agent, first message)", () => {
  beforeAll(() => {
    appStore.init();
  });
  beforeEach(() => {
    backendRequestMock.mockReset();
    backendRequestMock.mockImplementation(async (method: string) => {
      if (method === "agent.get") return { agent: daemonPendingAgent };
      if (method === "agent.sendMessage") {
        return { success: true, queued: false, messageId: "m-1" };
      }
      return {};
    });
    appStore.dispatch(setWorkspaceEntity(workspace()));
    seedPendingSession();
  });

  afterEach(() => {
    appStore.dispatch(clearAllSessions());
  });

  it("emits agent.sendMessage on the wire for a first send to a pending agent", async () => {
    await lifecycleSendMessage(AGENT, "persist me please", workspace(), {});

    const calls = backendRequestMock.mock.calls.map((c) => c[0]);
    // The daemon MUST receive the send — this is the empty-transcript regression.
    expect(calls).toContain("agent.sendMessage");
    const sendCall = backendRequestMock.mock.calls.find((c) => c[0] === "agent.sendMessage")!;
    expect(sendCall[1]).toMatchObject({
      agentId: AGENT,
      workspaceId: WS,
      content: "persist me please",
    });
  }, 30000);

  it("fails loudly (not silently) when the stream-message bridge is unregistered", async () => {
    // Pre-#7 regression shape: `agent:backend:stream-message` had no handler,
    // so the mock IPC router resolved to its `undefined` fallback and the send
    // silently succeeded while the daemon never saw agent.sendMessage.
    // NOTE: must stay the LAST test in this file — it unregisters the bridge
    // handler and the seeder only registers at (cached) module import time.
    const router = await import("$shared/ipc-mock-router");
    router.unregisterMockIpcHandler("agent:backend:stream-message");

    await expect(
      lifecycleSendMessage(AGENT, "will be dropped", workspace(), {}),
    ).rejects.toThrow();
    const calls = backendRequestMock.mock.calls.map((c) => c[0]);
    expect(calls).not.toContain("agent.sendMessage");
  }, 30000);
});
