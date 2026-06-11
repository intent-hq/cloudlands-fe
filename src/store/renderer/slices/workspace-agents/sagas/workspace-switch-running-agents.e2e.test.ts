/**
 * End-to-end regression test (Task D): workspace switch while agents are streaming.
 *
 * Covers the combined behavior of Tasks A/B/C by running the real
 * `chatStateSaga` alongside the real `agentSessionReducer`,
 * `chatStateReducer`, and `workspaceAgentsReducer` while dispatching the
 * full workspace-switch sequence.
 *
 * Scenario:
 *  1. Mount workspace A. Create parent agent P and delegated sub-agent S
 *     (S.metadata.createdByAgentId === P.id).
 *  2. Start streaming for both agents (chatSendStarted) → watchdog tasks fork.
 *  3. Switch workspaces: workspaceUnmounted(A) + workspaceMounted(B) while
 *     both agents are still streaming/processing.
 *     - Task C: per-agent watchdog tasks must remain alive.
 *  4. Dispatch streaming chunks for both agents through agent-session actions.
 *  5. Dispatch streamCompleted for both agents.
 *     - Task B (sanity): every state-mutating action carries the agent's
 *       owning workspace id (ws-A), never the active one (ws-B).
 *     - Flags cleared; Task C: watchdog tasks cancelled and map entry gone.
 *  6. Switch back: workspaceUnmounted(B) + workspaceMounted(A).
 *     - Task A (sanity): sub-agent metadata still references the parent.
 *     - Parent message stream is intact (no dropped chunks).
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import * as sagaEffects from "redux-saga/effects";
import {
  runSaga,
  stdChannel,
} from "redux-saga";
import type { AgentSession } from "$shared/types";

// -------------------------------------------------------------------------
// Mocks — mirror chat-state-saga.test.ts so the saga runs in isolation.
// -------------------------------------------------------------------------

vi.mock("typed-redux-saga", () => ({
  actionChannel: function* (pattern: any, buffer: any) {
    return yield sagaEffects.actionChannel(pattern, buffer);
  },
  call: function* (fnOrDescriptor: any, ...args: any[]) {
    return yield Array.isArray(fnOrDescriptor)
      ? sagaEffects.call(fnOrDescriptor as [any, any], ...args)
      : sagaEffects.call(fnOrDescriptor, ...args);
  },
  put: function* (action: any) {
    return yield sagaEffects.put(action);
  },
  take: function* (pattern: any) {
    return yield sagaEffects.take(pattern);
  },
  takeEvery: function* (pattern: any, worker: any) {
    return yield sagaEffects.takeEvery(pattern, worker);
  },
  fork: function* (fn: any, ...args: any[]) {
    return yield sagaEffects.fork(fn, ...args);
  },
  flush: function* (channel: any) {
    return yield sagaEffects.flush(channel);
  },
  cancel: function* (task: any) {
    return yield sagaEffects.cancel(task);
  },
  delay: function* (ms: any) {
    return yield sagaEffects.delay(ms);
  },
  select: function* (selector: any, ...args: any[]) {
    return yield sagaEffects.select(selector, ...args);
  },
}));

vi.mock("$lib/utils/safe-local-storage-saga", () => ({
  getLocalStorageJSON: vi.fn(),
  setLocalStorageJSON: vi.fn(),
  removeLocalStorageItem: vi.fn(),
}));

vi.mock("../../../utils/safe-local-storage-saga", () => ({
  getLocalStorageJSON: vi.fn(),
  setLocalStorageJSON: vi.fn(),
  removeLocalStorageItem: vi.fn(),
}));

vi.mock("$lib/utils/client-logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock("../../chat-state/sagas/initialize-chat-saga", () => ({
  initializeChatSaga: function* () { yield; },
}));

vi.mock("../../chat-state/sagas/send-message-saga", () => ({
  watchSendMessage: function* () { yield; },
}));

vi.mock("../../chat-state/sagas/chat-lifecycle-saga", () => ({
  chatLifecycleSaga: function* () { yield; },
}));

// Selectors the saga reads — forwarded to the live composed state below.
const selectAgentSessionMock = vi.fn();
const selectAllWorkspaceAgentsMock = vi.fn();
vi.mock("../workspace-agents-selectors", () => ({
  selectAgentSession: {
    select: (state: any, agentId: string) => selectAgentSessionMock(state, agentId),
    effect: function* (agentId: string) { return yield sagaEffects.select(selectAgentSessionMock, agentId); },
  },
  selectAllWorkspaceAgents: {
    select: (state: any, wsId: string) => selectAllWorkspaceAgentsMock(state, wsId),
    effect: function* (wsId: string) { return yield sagaEffects.select(selectAllWorkspaceAgentsMock, wsId); },
  },
}));

// -------------------------------------------------------------------------
// Imports (after mocks)
// -------------------------------------------------------------------------
import {
  agentSessionReducer,
  initialState as agentSessionInitialState,
  addMessage as addAgentSessionMessage,
  upsertSession,
  bulkUpsertSessions,
} from "../../agent-session/agent-session-slice";
import {
  chatStateReducer,
  initialState as chatStateInitialState,
  chatSendStarted,
  streamCompleted,
} from "../../chat-state/chat-state-slice";
import {
  workspaceAgentsReducer,
  initialState as workspaceAgentsInitialState,
} from "../workspace-agents-slice";

import {
  workspaceMounted,
  workspaceUnmounted,
} from "../../workspace-lifecycle/workspace-lifecycle-slice";

// -------------------------------------------------------------------------
// Test helpers
// -------------------------------------------------------------------------

type State = {
  agentSessions: ReturnType<typeof agentSessionReducer>;
  chatState: ReturnType<typeof chatStateReducer>;
  workspaceAgents: ReturnType<typeof workspaceAgentsReducer>;
};

function makeSession(
  id: string,
  workspaceId: string,
  opts: Partial<AgentSession> = {},
): AgentSession {
  const now = new Date("2026-01-01T00:00:00Z").toISOString();
  return {
    id: id as AgentSession["id"],
    backendSessionId: null,
    workspaceId: workspaceId as AgentSession["workspaceId"],
    name: id,
    status: "active" as any,
    messages: [],
    isStreaming: false,
    isProcessing: false,
    createdAt: now,
    updatedAt: now,
    ...opts,
  };
}

function makeChunkMessage(agentId: string, index: number) {
  return {
    id: `${agentId}-msg-${index}`,
    agentId: agentId as any,
    role: "assistant" as const,
    contentBlocks: [{ type: "text" as const, text: `chunk-${index}` }],
    timestamp: new Date(2026, 0, 1, 0, 0, index).toISOString(),
  };
}

describe("workspace switch while agents are streaming (Task D)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    selectAgentSessionMock.mockReset();
    selectAllWorkspaceAgentsMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("preserves messages, flags, metadata, and watchdog tasks across a full workspace switch cycle", async () => {
    const { chatStateSaga, __getActiveSendTasksForTesting } = await import(
      "../../chat-state/sagas/chat-state-saga"
    );
    const { agentSessionSaga } = await import("../../agent-session/sagas/agent-session-saga");
    __getActiveSendTasksForTesting().clear();

    const PARENT_ID = "agent-parent";
    const SUB_ID = "agent-sub";
    const WS_A = "ws-A";
    const WS_B = "ws-B";

    // ---- Live state, maintained by real reducers --------------------------
    let state: State = {
      agentSessions: agentSessionInitialState,
      chatState: chatStateInitialState,
      workspaceAgents: workspaceAgentsInitialState,
    };
    const reduce = (s: State, action: any): State => ({
      agentSessions: agentSessionReducer(s.agentSessions, action),
      chatState: chatStateReducer(s.chatState, action),
      workspaceAgents: workspaceAgentsReducer(s.workspaceAgents, action),
    });

    // Wire selectors to read the current composed state.
    selectAgentSessionMock.mockImplementation((_state: any, agentId: string) =>
      state.agentSessions.byAgentId[agentId],
    );
    selectAllWorkspaceAgentsMock.mockImplementation((_state: any, wsId: string) => {
      const ws = state.workspaceAgents.byWorkspaceId[wsId];
      if (!ws) return [];
      return ws.agentIds
        .map((id) => state.agentSessions.byAgentId[id])
        .filter((s): s is AgentSession => !!s);
    });

    const dispatched: any[] = [];
    const channel = stdChannel();
    const dispatch = (action: any) => {
      dispatched.push(action);
      state = reduce(state, action);
      channel.put(action);
    };

    const chatTask = runSaga({ channel, dispatch, getState: () => state }, chatStateSaga);
    const agentSessionTask = runSaga({ channel, dispatch, getState: () => state }, agentSessionSaga);

    // 1. Mount workspace A and seed parent + sub agent.
    dispatch(workspaceMounted(WS_A));

    const parent = makeSession(PARENT_ID, WS_A, { name: "Coordinator" });
    const sub = makeSession(SUB_ID, WS_A, {
      name: "Sub",
      metadata: { createdByAgentId: PARENT_ID } as any,
    });
    dispatch(upsertSession({ ...parent, workspaceId: WS_A as AgentSession["workspaceId"] }));
    dispatch(upsertSession({ ...sub, workspaceId: WS_A as AgentSession["workspaceId"] }));
    await vi.advanceTimersByTimeAsync(120);

    expect(state.agentSessions.byAgentId[SUB_ID].metadata?.createdByAgentId).toBe(PARENT_ID);

    // 2. Both agents start streaming.
    dispatch(chatSendStarted(PARENT_ID, WS_A));
    dispatch(chatSendStarted(SUB_ID, WS_A));
    await vi.advanceTimersByTimeAsync(20);

    expect(state.agentSessions.byAgentId[PARENT_ID].isStreaming).toBe(true);
    expect(state.agentSessions.byAgentId[PARENT_ID].isProcessing).toBe(true);
    expect(state.agentSessions.byAgentId[SUB_ID].isStreaming).toBe(true);
    expect(state.agentSessions.byAgentId[SUB_ID].isProcessing).toBe(true);

    const activeTasks = __getActiveSendTasksForTesting();
    expect(activeTasks.has(PARENT_ID)).toBe(true);
    expect(activeTasks.has(SUB_ID)).toBe(true);
    const parentTasksBeforeSwitch = activeTasks.get(PARENT_ID)!;
    const subTasksBeforeSwitch = activeTasks.get(SUB_ID)!;
    expect(parentTasksBeforeSwitch.every((t) => t.isRunning())).toBe(true);
    expect(subTasksBeforeSwitch.every((t) => t.isRunning())).toBe(true);

    // 3. Switch: unmount A, mount B — while both are still streaming.
    dispatch(workspaceUnmounted(WS_A));
    dispatch(workspaceMounted(WS_B));
    await vi.advanceTimersByTimeAsync(20);

    // Task C: watchdog tasks must remain alive across unmount.
    const activeTasksAfterSwitch = __getActiveSendTasksForTesting();
    expect(activeTasksAfterSwitch.has(PARENT_ID)).toBe(true);
    expect(activeTasksAfterSwitch.has(SUB_ID)).toBe(true);
    expect(activeTasksAfterSwitch.get(PARENT_ID)).toBe(parentTasksBeforeSwitch);
    expect(activeTasksAfterSwitch.get(SUB_ID)).toBe(subTasksBeforeSwitch);
    expect(parentTasksBeforeSwitch.every((t) => t.isRunning())).toBe(true);
    expect(subTasksBeforeSwitch.every((t) => t.isRunning())).toBe(true);

    // 4. Dispatch chunks while we're on workspace B. Message updates are
    //    agent-session scoped and do not depend on the active workspace.
    const parentChunks = [0, 1, 2, 3].map((i) => makeChunkMessage(PARENT_ID, i));
    const subChunks = [0, 1].map((i) => makeChunkMessage(SUB_ID, i));
    for (const msg of parentChunks) {
      dispatch(addAgentSessionMessage(PARENT_ID, msg));
    }
    for (const msg of subChunks) {
      dispatch(addAgentSessionMessage(SUB_ID, msg));
    }

    // 5. Both streams complete.
    dispatch(streamCompleted(PARENT_ID, { lastAttemptedMessage: null, modelUnavailable: null }));
    dispatch(streamCompleted(SUB_ID, { lastAttemptedMessage: null, modelUnavailable: null }));
    await vi.advanceTimersByTimeAsync(50);

    // Flags cleared on both agents.
    expect(state.agentSessions.byAgentId[PARENT_ID].isStreaming).toBe(false);
    expect(state.agentSessions.byAgentId[PARENT_ID].isProcessing).toBe(false);
    expect(state.agentSessions.byAgentId[SUB_ID].isStreaming).toBe(false);
    expect(state.agentSessions.byAgentId[SUB_ID].isProcessing).toBe(false);

    // Task C cleanup: watchdog tasks cancelled and map entries cleared.
    const activeTasksAfterComplete = __getActiveSendTasksForTesting();
    expect(activeTasksAfterComplete.has(PARENT_ID)).toBe(false);
    expect(activeTasksAfterComplete.has(SUB_ID)).toBe(false);
    expect(parentTasksBeforeSwitch.every((t) => !t.isRunning())).toBe(true);
    expect(subTasksBeforeSwitch.every((t) => !t.isRunning())).toBe(true);

    // Complete message stream is present on the parent session — no drops.
    const parentMessages = state.agentSessions.byAgentId[PARENT_ID].messages;
    expect(parentMessages.map((m) => m.id)).toEqual(parentChunks.map((c) => c.id));

    const subMessages = state.agentSessions.byAgentId[SUB_ID].messages;
    expect(subMessages.map((m) => m.id)).toEqual(subChunks.map((c) => c.id));

    // Task B sanity: every workspace-scoped action we dispatched was
    // addressed to the owning workspace, never to the "active" ws-B.
    const ownedByWsA = dispatched.filter((a) => a.type === upsertSession.type);
    expect(ownedByWsA.length).toBeGreaterThan(0);
    expect(ownedByWsA.every((a) => a.payload[0].workspaceId === WS_A)).toBe(true);
    const storedForWsA = dispatched.filter((a) => a.type === bulkUpsertSessions.type);
    expect(storedForWsA.length).toBeGreaterThan(0);
    expect(
      storedForWsA.every((a) =>
        a.payload[0].every((s: AgentSession) => s.workspaceId === WS_A),
      ),
    ).toBe(true);

    // 6. Switch back to A.
    dispatch(workspaceUnmounted(WS_B));
    dispatch(workspaceMounted(WS_A));
    await vi.advanceTimersByTimeAsync(20);

    // Task A sanity: sub-agent metadata still links to parent after the
    // round trip, and both sessions are still resolvable in state.
    const finalSub = state.agentSessions.byAgentId[SUB_ID];
    const finalParent = state.agentSessions.byAgentId[PARENT_ID];
    expect(finalSub).toBeDefined();
    expect(finalParent).toBeDefined();
    expect(finalSub.metadata?.createdByAgentId).toBe(finalParent.id);

    // Parent message stream survives the switch back.
    expect(finalParent.messages.map((m) => m.id)).toEqual(parentChunks.map((c) => c.id));

    // No stuck flags after the whole scenario.
    expect(finalParent.isStreaming).toBe(false);
    expect(finalParent.isProcessing).toBe(false);
    expect(finalSub.isStreaming).toBe(false);
    expect(finalSub.isProcessing).toBe(false);

    chatTask.cancel();
    agentSessionTask.cancel();
    await Promise.all([chatTask.toPromise(), agentSessionTask.toPromise()]);
  });
});

