/**
 * Tests for handleStreamingSafetyCheck.
 *
 * Regression (Task B): the saga must NOT fall back to selectActiveWorkspaceId
 * when session.workspaceId is missing. Falling back would land stale flags
 * in a workspace the agent doesn't belong to.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runSaga } from "redux-saga";
import * as sagaEffects from "redux-saga/effects";
import type { AgentSession, AgentMessage } from "$shared/types";
import { createCollection } from "../../../utils/collection-utils";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(async () => ({ success: true, data: [] })),
}));

vi.stubGlobal("window", {
  dispatchEvent: vi.fn(),
  CustomEvent: class CustomEvent { constructor(public type: string) {} },
});

vi.mock("typed-redux-saga", () => ({
  call: function* (fnOrDescriptor: any, ...args: any[]) {
    return yield Array.isArray(fnOrDescriptor)
      ? sagaEffects.call(fnOrDescriptor as [any, any], ...args)
      : sagaEffects.call(fnOrDescriptor, ...args);
  },
  put: function* (action: any) {
    return yield sagaEffects.put(action);
  },
  select: function* (selector: any, ...args: any[]) {
    return yield sagaEffects.select(selector, ...args);
  },
  delay: function* (ms: any) {
    return yield sagaEffects.delay(ms);
  },
  takeLatest: function* (pattern: any, worker: any) {
    return yield sagaEffects.takeLatest(pattern, worker);
  },
}));

vi.mock("$lib/electron-bridge", () => ({
  invoke: invokeMock,
}));

vi.mock("$lib/utils/client-logger", () => ({
  createLogger: () => ({
    debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
  }),
}));

vi.mock("$lib/logging/logger.svelte", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
  LogCategory: { AGENT: "AGENT" },
}));

vi.mock("$features/agent/utils/stream-handler-registry", () => ({
  getStreamHandlerKeys: () => [],
  cleanupStreamHandler: vi.fn(),
}));

vi.mock("../../workspace/workspace-selectors", () => ({
  selectActiveWorkspaceId: { select: () => "ws-B-active" },
}));

// Import after mocks
import { handleStreamingSafetyCheck } from "./agent-stream-saga";
import { setAgentStreaming, upsertAgentSession } from "../workspace-agents-slice";
import { upsertSession as upsertAgentSessionAction } from "../../agent-session/agent-session-slice";

type State = {
  agentSessions: { byAgentId: Record<string, AgentSession> };
  workspaceAgents: { byWorkspaceId: Record<string, { agentIds: string[] }> };
};

function makeState(session: AgentSession, wsHolding: string = session.workspaceId || "ws-A"): State {
  return {
    agentSessions: { byAgentId: { [session.id as string]: session } },
    workspaceAgents: { byWorkspaceId: { [wsHolding]: { agentIds: [session.id as string] } } },
  };
}

const triggerAction = { type: "workspaceAgents/triggerStreamingSafetyCheck", payload: [] as unknown[] } as any;

describe("handleStreamingSafetyCheck — Task B regression", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    invokeMock.mockClear();
    invokeMock.mockImplementation(async () => ({ success: true, data: [] }));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("writes to session.workspaceId (A), never to active workspace (B)", async () => {
    const session: AgentSession = {
      id: "agent-1", name: "Agent", workspaceId: "ws-A" as any,
      messages: createCollection<AgentMessage, "id">("id") as unknown as AgentMessage[],
      isStreaming: true, isProcessing: true,
    } as AgentSession;
    const state = makeState(session, "ws-A");

    const dispatched: any[] = [];
    const task = runSaga(
      { dispatch: (a: any) => dispatched.push(a), getState: () => state },
      handleStreamingSafetyCheck,
      triggerAction,
    );
    await vi.advanceTimersByTimeAsync(11_000);
    await task.toPromise();

    const streamingActions = dispatched.filter((a) => a.type === setAgentStreaming.type);
    expect(streamingActions).toHaveLength(1);
    expect(streamingActions[0].payload[0]).toBe("ws-A");
    expect(streamingActions[0].payload[0]).not.toBe("ws-B-active");

    const wsUpserts = dispatched.filter((a) => a.type === upsertAgentSession.type);
    expect(wsUpserts.every((a) => a.payload[0] === "ws-A")).toBe(true);
    expect(wsUpserts.every((a) => a.payload[0] !== "ws-B-active")).toBe(true);
  });

  it("skips when session.workspaceId is missing — no state change lands on workspace B", async () => {
    const session: AgentSession = {
      id: "agent-1", name: "Agent", workspaceId: "" as any,
      messages: createCollection<AgentMessage, "id">("id") as unknown as AgentMessage[],
      isStreaming: true, isProcessing: true,
    } as AgentSession;
    // The session lives under "ws-A" in workspaceAgents.byWorkspaceId but its
    // session.workspaceId is empty. Active workspace is "ws-B-active".
    const state = makeState(session, "ws-A");

    const dispatched: any[] = [];
    const task = runSaga(
      { dispatch: (a: any) => dispatched.push(a), getState: () => state },
      handleStreamingSafetyCheck,
      triggerAction,
    );
    await vi.advanceTimersByTimeAsync(11_000);
    await task.toPromise();

    // No setAgentStreaming / upsertAgentSession / upsertSession dispatches at all
    expect(dispatched.filter((a) => a.type === setAgentStreaming.type)).toHaveLength(0);
    expect(dispatched.filter((a) => a.type === upsertAgentSession.type)).toHaveLength(0);
    expect(dispatched.filter((a) => a.type === upsertAgentSessionAction.type)).toHaveLength(0);
    // And definitely nothing touched workspace B
    expect(dispatched.some((a) => JSON.stringify(a.payload ?? "").includes("ws-B-active"))).toBe(false);
  });
});

