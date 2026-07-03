/**
 * Wire-level regression test for the INITIAL-message send path.
 *
 * Regression: ChatPanel's activation fallback dispatched
 * `sendInitialMessageRequested(agentId, { wsId })` with no `message` field and
 * the chat-send middleware silently no-oped — the initial message never
 * reached `agent.sendMessage` and was never persisted by the daemon.
 *
 * This suite drives the REAL store (real chat-send middleware), the REAL
 * agent-stream-lifecycle, and the REAL agent IPC bridge seeder — only
 * `backend-transport.backendRequest` is mocked with PROTOCOL.md §5.5-shaped
 * daemon payloads — asserting the dispatch → middleware → wire chain.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

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
import { sendInitialMessageRequested } from "$store/renderer/slices/chat-state/chat-state-slice";
import { selectChatAgentState } from "$store/renderer/slices/chat-state/chat-state-selectors";
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

describe("initial-message send path (dispatch → middleware → wire)", () => {
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
    appStore.dispatch(clearAllSessions());
    appStore.dispatch(setWorkspaceEntity(workspace()));
    seedPendingSession();
  });

  it("sendInitialMessageRequested WITH a message reaches agent.sendMessage on the wire", async () => {
    appStore.dispatch(
      sendInitialMessageRequested(AGENT, { wsId: WS, message: "kickoff prompt" }),
    );

    // The daemon MUST receive the initial send — this is the regression.
    await vi.waitFor(
      () => {
        expect(backendRequestMock.mock.calls.map((c) => c[0])).toContain("agent.sendMessage");
      },
      { timeout: 15000 },
    );
    const sendCall = backendRequestMock.mock.calls.find((c) => c[0] === "agent.sendMessage")!;
    expect(sendCall[1]).toMatchObject({
      agentId: AGENT,
      workspaceId: WS,
      content: "kickoff prompt",
    });
  }, 30000);

  it("sendInitialMessageRequested WITHOUT a message never hits the wire but surfaces chatSendFailed", async () => {
    appStore.dispatch(sendInitialMessageRequested(AGENT, { wsId: WS }));

    // The loud-failure guard dispatches chatSendFailed synchronously in the
    // middleware; give the microtask queue a beat, then assert.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(backendRequestMock.mock.calls.map((c) => c[0])).not.toContain("agent.sendMessage");
    expect(selectChatAgentState.select(appStore.state, AGENT)?.error).toContain("message");
  }, 30000);
});
