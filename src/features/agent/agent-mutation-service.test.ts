import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { AgentStatus } from "$shared/types/agent.types";
import { AgentActivationState } from "$shared/types/agent-session";
import type { AgentSession } from "$shared/types/agent-session";

// FAKE seam: only `appClient.agents.get` is stubbed. The mutation middleware
// runs against the REAL configured store so the restore/activate/save async
// actions resolve through the real action.success/failure path and their
// promises settle exactly as agent-stream-lifecycle expects.
const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("$lib/client", () => ({
  appClient: { agents: { get } },
}));

import { store as appStore } from "$store/renderer/store";
import {
  bulkUpsertSessions,
  upsertSession,
} from "$store/renderer/slices/agent-session/agent-session-slice";
import {
  activateAgentRequested,
  restoreAgentSessionRequested,
  saveAgentSessionRequested,
} from "$store/renderer/slices/workspace-agents/workspace-agents-slice";

function makeSession(id: string, wsId: string, overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id,
    backendSessionId: "backend-" + id,
    workspaceId: wsId,
    name: "Agent",
    status: AgentStatus.Active,
    messages: [],
    model: "sonnet",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as AgentSession;
}

function readSession(agentId: string): AgentSession | undefined {
  return (appStore.state as { agentSessions?: { byAgentId: Record<string, AgentSession> } })
    .agentSessions?.byAgentId[agentId];
}

function seedSession(session: AgentSession): void {
  appStore.dispatch(bulkUpsertSessions([session]));
  appStore.dispatch(upsertSession(session));
}

describe("agentMutationService (fake appClient.agents.get, real store)", () => {
  beforeAll(() => {
    appStore.init();
  });
  afterEach(() => {
    get.mockReset();
  });

  it("restoreAgentSessionRequested resolves with the existing usable session (no fetch)", async () => {
    const WS = "ws-restore-cached";
    const AGENT = "agent-restore-cached";
    seedSession(makeSession(AGENT, WS));

    const action = restoreAgentSessionRequested(WS, AGENT);
    appStore.dispatch(action);
    const resolved = await action.promise;

    expect(get).not.toHaveBeenCalled();
    expect(resolved?.id).toBe(AGENT);
  });

  it("restoreAgentSessionRequested fetches via appClient.agents.get and persists", async () => {
    const WS = "ws-restore-fetch";
    const AGENT = "agent-restore-fetch";
    get.mockResolvedValueOnce(makeSession(AGENT, WS, { status: AgentStatus.Pending }));

    const action = restoreAgentSessionRequested(WS, AGENT);
    appStore.dispatch(action);
    const resolved = await action.promise;

    expect(get).toHaveBeenCalledWith(AGENT);
    expect(resolved?.id).toBe(AGENT);
    expect(readSession(AGENT)?.id).toBe(AGENT);
  });

  it("restoreAgentSessionRequested rejects via action.failure on get throw", async () => {
    const WS = "ws-restore-err";
    const AGENT = "agent-restore-err";
    get.mockRejectedValueOnce(new Error("boom"));

    const action = restoreAgentSessionRequested(WS, AGENT);
    appStore.dispatch(action);
    await expect(action.promise).rejects.toThrow("boom");
  });

  it("activateAgentRequested marks the session ACTIVE and resolves", async () => {
    const WS = "ws-activate";
    const AGENT = "agent-activate";
    seedSession(
      makeSession(AGENT, WS, {
        backendSessionId: null,
        status: AgentStatus.Pending,
        activationState: AgentActivationState.PENDING,
      }),
    );
    get.mockResolvedValueOnce(makeSession(AGENT, WS, { status: AgentStatus.Pending }));

    const action = activateAgentRequested(WS, AGENT);
    appStore.dispatch(action);
    const resolved = await action.promise;

    expect(resolved?.activationState).toBe(AgentActivationState.ACTIVE);
    expect(resolved?.status).toBe(AgentStatus.Active);
    expect(readSession(AGENT)?.activationState).toBe(AgentActivationState.ACTIVE);
  });

  it("activateAgentRequested is a no-op when the session is already Active", async () => {
    const WS = "ws-active-already";
    const AGENT = "agent-active-already";
    seedSession(makeSession(AGENT, WS, { status: AgentStatus.Active }));

    const action = activateAgentRequested(WS, AGENT);
    appStore.dispatch(action);
    const resolved = await action.promise;

    expect(get).not.toHaveBeenCalled();
    expect(resolved?.id).toBe(AGENT);
  });

  it("activateAgentRequested marks ERROR and rejects when the seam throws", async () => {
    const WS = "ws-activate-err";
    const AGENT = "agent-activate-err";
    seedSession(
      makeSession(AGENT, WS, {
        backendSessionId: null,
        status: AgentStatus.Pending,
        activationState: AgentActivationState.PENDING,
      }),
    );
    get.mockRejectedValueOnce(new Error("nope"));

    const action = activateAgentRequested(WS, AGENT);
    appStore.dispatch(action);
    await expect(action.promise).rejects.toThrow("nope");
    expect(readSession(AGENT)?.activationState).toBe(AgentActivationState.ERROR);
    expect(readSession(AGENT)?.lastActivationError).toBe("nope");
  });

  it("saveAgentSessionRequested resolves immediately (no persistence layer on the seam)", async () => {
    const action = saveAgentSessionRequested("ws-save", "agent-save");
    appStore.dispatch(action);
    await expect(action.promise).resolves.toBeUndefined();
  });
});
