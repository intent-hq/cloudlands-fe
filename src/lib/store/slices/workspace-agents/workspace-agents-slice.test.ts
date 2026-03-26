import type { AgentSession, AgentStatus } from "$shared/types";
import { describe, expect, it } from "vitest";
import type { StoreState } from "../../types";
import { createCollection } from "../../utils/collection-utils";
import {
  selectAllWorkspaceAgents,
  selectAllWorkspaceAgentsCollection,
  selectAgentsLoaded,
  selectForegroundWorkspaceAgents,
  selectInitialAgentConfig,
  selectInitialAgentConfigProcessed,
  selectInitialAgentId,
  selectIsAgentRecentlyCreated,
  selectIsLoadingAgents,
  selectIsNewlyCreatedWorkspace,
  selectIsWaitingForFirstMessage,
  selectRecentlyCreatedAgents,
  selectWaitingForFirstMessageMap,
  selectWorkspaceAgentState,
  selectWorkspaceAgents,
  selectWorkspaceAgentsCollection,
} from "./workspace-agents-selectors";
import {
  addAgent,
  agentsLoaded,
  clearInitialAgentConfig,
  clearRecentlyCreatedAgent,
  clearWorkspaceAgents,
  createAgentRequested,
  createAgentWithSpecialistRequested,
  emptyWorkspaceAgentState,
  initialState,
  type InitialAgentConfig,
  loadAgentsRequested,
  markAgentRecentlyCreated,
  renameAgent,
  removeAgent,
  replaceWorkspaceAgentSnapshots,
  setAgents,
  setAgentsLoaded,
  setInitialAgentConfig,
  setInitialAgentConfigProcessed,
  setInitialAgentId,
  setIsLoadingAgents,
  setWaitingForFirstMessage,
  workspaceAgentsReducer,
} from "./workspace-agents-slice";

const WS_1 = "ws-1";
const WS_2 = "ws-2";

const asCollection = (agents: AgentSession[]) => createCollection<AgentSession, "id">("id", agents);

const mockAgent = (id: string, workspaceId = WS_1, name = "Agent"): AgentSession => ({
  id,
  backendSessionId: null,
  workspaceId,
  name,
  status: "active" as AgentStatus,
  messages: [],
  createdAt: "2026-03-19T00:00:00.000Z",
  updatedAt: "2026-03-19T00:00:00.000Z",
});

function mockState(overrides: Partial<StoreState["workspaceAgents"]> = {}): StoreState {
  return {
    workspaceAgents: {
      ...initialState,
      ...overrides,
    },
  } as StoreState;
}

describe("workspaceAgentsReducer", () => {
  it("returns the initial state", () => {
    expect(workspaceAgentsReducer(undefined, { type: "@@INIT" })).toEqual(initialState);
  });

  it("stores the agent list for a workspace", () => {
    const agents = [mockAgent("agent-1"), mockAgent("agent-2")];

    expect(workspaceAgentsReducer(initialState, setAgents(WS_1, agents))).toEqual({
      byWorkspaceId: {
        [WS_1]: {
          ...emptyWorkspaceAgentState,
          agents: asCollection(agents),
        },
      },
    });
  });

  it("adds agents without affecting other workspaces", () => {
    let state = workspaceAgentsReducer(initialState, addAgent(WS_1, mockAgent("agent-1")));
    state = workspaceAgentsReducer(state, addAgent(WS_2, mockAgent("agent-2", WS_2, "Setup")));

    expect(state.byWorkspaceId[WS_1].agents).toEqual(asCollection([mockAgent("agent-1")]));
    expect(state.byWorkspaceId[WS_2].agents).toEqual(asCollection([mockAgent("agent-2", WS_2, "Setup")]));
  });

  it("does not duplicate an existing agent", () => {
    const previousState = workspaceAgentsReducer(initialState, addAgent(WS_1, mockAgent("agent-1")));

    expect(workspaceAgentsReducer(previousState, addAgent(WS_1, mockAgent("agent-1")))).toBe(
      previousState
    );
  });

  it("removes an agent and clears related metadata", () => {
    let state = workspaceAgentsReducer(
      initialState,
      setAgents(WS_1, [mockAgent("agent-1"), mockAgent("agent-2")])
    );
    state = workspaceAgentsReducer(state, setInitialAgentId(WS_1, "agent-1"));
    state = workspaceAgentsReducer(state, markAgentRecentlyCreated(WS_1, "agent-1"));
    state = workspaceAgentsReducer(state, setWaitingForFirstMessage(WS_1, "agent-1", true));

    expect(workspaceAgentsReducer(state, removeAgent(WS_1, "agent-1"))).toEqual({
      byWorkspaceId: {
        [WS_1]: {
          ...emptyWorkspaceAgentState,
          agents: asCollection([mockAgent("agent-2")]),
        },
      },
    });
  });

  it("renames an agent within the workspace", () => {
    const previousState = workspaceAgentsReducer(
      initialState,
      setAgents(WS_1, [mockAgent("agent-1", WS_1, "Before")])
    );

    const nextState = workspaceAgentsReducer(previousState, renameAgent(WS_1, "agent-1", "After"));

    expect(nextState.byWorkspaceId[WS_1].agents).toEqual(
      asCollection([mockAgent("agent-1", WS_1, "After")])
    );
  });

  it("normalizes Date values before storing agents in Redux", () => {
    const createdAt = new Date("2026-03-19T01:00:00.000Z");
    const updatedAt = new Date("2026-03-19T02:00:00.000Z");
    const messageTimestamp = new Date("2026-03-19T03:00:00.000Z");
    const fileTimestamp = new Date("2026-03-19T04:00:00.000Z");
    const lastActivity = new Date("2026-03-19T05:00:00.000Z");
    const lastViewedAt = new Date("2026-03-19T06:00:00.000Z");
    const startedAt = new Date("2026-03-19T07:00:00.000Z");
    const endedAt = new Date("2026-03-19T08:00:00.000Z");
    const agent = {
      ...mockAgent("agent-1"),
      createdAt,
      updatedAt,
      lastActivity,
      lastViewedAt,
      startedAt,
      endedAt,
      messages: [{ id: "msg-1", role: "assistant", timestamp: messageTimestamp, contentBlocks: [] }],
      fileChanges: [{ path: "src/example.ts", type: "modify", timestamp: fileTimestamp }],
    } satisfies AgentSession;

    const state = workspaceAgentsReducer(initialState, addAgent(WS_1, agent));
    const storedAgent = state.byWorkspaceId[WS_1].agents.map["agent-1"];

    expect(storedAgent.createdAt).toBe(createdAt.toISOString());
    expect(storedAgent.updatedAt).toBe(updatedAt.toISOString());
    expect(storedAgent.lastActivity).toBe(lastActivity.toISOString());
    expect(storedAgent.lastViewedAt).toBe(lastViewedAt.toISOString());
    expect(storedAgent.startedAt).toBe(startedAt.toISOString());
    expect(storedAgent.endedAt).toBe(endedAt.toISOString());
    expect(storedAgent.messages[0]?.timestamp).toBe(messageTimestamp.toISOString());
    expect(storedAgent.fileChanges?.[0]?.timestamp).toBe(fileTimestamp.toISOString());
  });

  it("tracks recently created agents per workspace", () => {
    let state = workspaceAgentsReducer(initialState, markAgentRecentlyCreated(WS_1, "agent-1"));
    state = workspaceAgentsReducer(state, markAgentRecentlyCreated(WS_1, "agent-1"));
    state = workspaceAgentsReducer(state, markAgentRecentlyCreated(WS_1, "agent-2"));

    expect(state.byWorkspaceId[WS_1].recentlyCreatedAgents).toEqual(["agent-1", "agent-2"]);
  });

  it("clears a recently created agent id", () => {
    const previousState = workspaceAgentsReducer(
      initialState,
      markAgentRecentlyCreated(WS_1, "agent-1")
    );

    expect(
      workspaceAgentsReducer(previousState, clearRecentlyCreatedAgent(WS_1, "agent-1"))
    ).toEqual({
      byWorkspaceId: {
        [WS_1]: emptyWorkspaceAgentState,
      },
    });
  });

  it("updates loading and initialization flags for a workspace", () => {
    let state = workspaceAgentsReducer(initialState, setIsLoadingAgents(WS_1, true));
    state = workspaceAgentsReducer(state, setAgentsLoaded(WS_1, true));
    state = workspaceAgentsReducer(state, setInitialAgentId(WS_1, "agent-1"));
    state = workspaceAgentsReducer(state, setInitialAgentConfigProcessed(WS_1, true));

    expect(state.byWorkspaceId[WS_1]).toEqual({
      ...emptyWorkspaceAgentState,
      isLoadingAgents: true,
      agentsLoaded: true,
      initialAgentId: "agent-1",
      initialAgentConfigProcessed: true,
    });
  });

  it("stores waiting-for-first-message per agent and clears it when false", () => {
    let state = workspaceAgentsReducer(initialState, setWaitingForFirstMessage(WS_1, "agent-1", true));

    expect(state.byWorkspaceId[WS_1].isWaitingForFirstMessage).toEqual({ "agent-1": true });

    state = workspaceAgentsReducer(state, setWaitingForFirstMessage(WS_1, "agent-1", false));

    expect(state.byWorkspaceId[WS_1].isWaitingForFirstMessage).toEqual({});
  });

  it("reconciles agent-scoped metadata when replacing the agent list", () => {
    let state = workspaceAgentsReducer(initialState, addAgent(WS_1, mockAgent("agent-1")));
    state = workspaceAgentsReducer(state, addAgent(WS_1, mockAgent("agent-2")));
    state = workspaceAgentsReducer(state, markAgentRecentlyCreated(WS_1, "agent-1"));
    state = workspaceAgentsReducer(state, markAgentRecentlyCreated(WS_1, "agent-2"));
    state = workspaceAgentsReducer(state, setWaitingForFirstMessage(WS_1, "agent-1", true));
    state = workspaceAgentsReducer(state, setWaitingForFirstMessage(WS_1, "agent-2", true));

    const nextState = workspaceAgentsReducer(state, setAgents(WS_1, [mockAgent("agent-2")]));

    expect(nextState.byWorkspaceId[WS_1].recentlyCreatedAgents).toEqual(["agent-2"]);
    expect(nextState.byWorkspaceId[WS_1].isWaitingForFirstMessage).toEqual({ "agent-2": true });
  });

  it("clears workspaces omitted by a later snapshot while preserving workspace metadata", () => {
    let state = workspaceAgentsReducer(initialState, setAgents(WS_1, [mockAgent("agent-1")]));
    state = workspaceAgentsReducer(state, setAgents(WS_2, [mockAgent("agent-2", WS_2)]));
    state = workspaceAgentsReducer(state, setInitialAgentId(WS_2, "agent-2"));
    state = workspaceAgentsReducer(state, setAgentsLoaded(WS_2, true));
    state = workspaceAgentsReducer(state, markAgentRecentlyCreated(WS_2, "agent-2"));
    state = workspaceAgentsReducer(state, setWaitingForFirstMessage(WS_2, "agent-2", true));

    const nextState = workspaceAgentsReducer(
      state,
      replaceWorkspaceAgentSnapshots({
        [WS_1]: [mockAgent("agent-3")],
      })
    );

    expect(nextState.byWorkspaceId[WS_1].agents).toEqual(asCollection([mockAgent("agent-3")]));
    expect(nextState.byWorkspaceId[WS_2].agents).toEqual(emptyWorkspaceAgentState.agents);
    expect(nextState.byWorkspaceId[WS_2]).toEqual({
      ...emptyWorkspaceAgentState,
      agentsLoaded: true,
      initialAgentId: "agent-2",
    });
  });

  it("stores initial agent config for a workspace", () => {
    const config: InitialAgentConfig = {
      agentId: "agent-1",
      config: { model: "opus", specialist: "implementor", isInitialAgent: true },
      timestamp: 1700000000000,
    };

    const state = workspaceAgentsReducer(initialState, setInitialAgentConfig(WS_1, config));

    expect(state.byWorkspaceId[WS_1].initialAgentConfig).toEqual(config);
  });

  it("clears initial agent config", () => {
    const config: InitialAgentConfig = {
      agentId: "agent-1",
      config: { model: "opus" },
      timestamp: 1700000000000,
    };
    const previousState = workspaceAgentsReducer(
      initialState,
      setInitialAgentConfig(WS_1, config)
    );

    const state = workspaceAgentsReducer(previousState, clearInitialAgentConfig(WS_1));

    expect(state.byWorkspaceId[WS_1].initialAgentConfig).toBeNull();
  });

  it("returns same state reference when clearing already-null initial agent config", () => {
    const previousState = workspaceAgentsReducer(initialState, addAgent(WS_1, mockAgent("agent-1")));

    expect(workspaceAgentsReducer(previousState, clearInitialAgentConfig(WS_1))).toBe(
      previousState
    );
  });

  it("clears all agent state for a workspace", () => {
    let state = workspaceAgentsReducer(initialState, addAgent(WS_1, mockAgent("agent-1")));
    state = workspaceAgentsReducer(state, addAgent(WS_2, mockAgent("agent-2", WS_2)));

    const nextState = workspaceAgentsReducer(state, clearWorkspaceAgents(WS_1));

    expect(nextState.byWorkspaceId[WS_1]).toBeUndefined();
    expect(nextState.byWorkspaceId[WS_2].agents).toEqual(asCollection([mockAgent("agent-2", WS_2)]));
  });
});

describe("workspace-agents actions", () => {
  it("creates a createAgentRequested action", () => {
    expect(createAgentRequested(WS_1, "chat")).toEqual({
      type: createAgentRequested.type,
      payload: [WS_1, "chat"],
    });
  });

  it("creates a createAgentWithSpecialistRequested action", () => {
    expect(createAgentWithSpecialistRequested(WS_1, "implementor")).toEqual({
      type: createAgentWithSpecialistRequested.type,
      payload: [WS_1, "implementor"],
    });
  });

  it("creates a loadAgentsRequested action", () => {
    expect(loadAgentsRequested(WS_1)).toEqual({
      type: loadAgentsRequested.type,
      payload: [WS_1],
    });
  });

  it("creates an agentsLoaded action", () => {
    expect(agentsLoaded(WS_1)).toEqual({
      type: agentsLoaded.type,
      payload: [WS_1],
    });
  });
});

describe("workspace-agents selectors", () => {
  it("returns empty defaults for a workspace with no agent state", () => {
    const state = mockState();

    expect(selectWorkspaceAgentState.select(state, WS_1)).toEqual(emptyWorkspaceAgentState);
    expect(selectAllWorkspaceAgentsCollection.select(state, WS_1)).toEqual(emptyWorkspaceAgentState.agents);
    expect(selectWorkspaceAgentsCollection.select(state, WS_1)).toEqual(emptyWorkspaceAgentState.agents);
    expect(selectAllWorkspaceAgents.select(state, WS_1)).toEqual([]);
    expect(selectForegroundWorkspaceAgents.select(state, WS_1)).toEqual([]);
    expect(selectWorkspaceAgents.select(state, WS_1)).toEqual([]);
    expect(selectAgentsLoaded.select(state, WS_1)).toBe(false);
    expect(selectIsLoadingAgents.select(state, WS_1)).toBe(false);
    expect(selectInitialAgentId.select(state, WS_1)).toBeNull();
    expect(selectInitialAgentConfigProcessed.select(state, WS_1)).toBe(false);
    expect(selectRecentlyCreatedAgents.select(state, WS_1)).toEqual([]);
    expect(selectIsAgentRecentlyCreated.select(state, WS_1, "agent-1")).toBe(false);
    expect(selectWaitingForFirstMessageMap.select(state, WS_1)).toEqual({});
    expect(selectIsWaitingForFirstMessage.select(state, WS_1, "agent-1")).toBe(false);
    expect(selectInitialAgentConfig.select(state, WS_1)).toBeNull();
  });

  it("returns per-workspace agent values", () => {
    const foregroundAgent = mockAgent("agent-1");
    const backgroundAgent = {
      ...mockAgent("agent-2"),
      isBackground: true,
    } satisfies AgentSession;
    const workspaceState = {
      agents: asCollection([foregroundAgent, backgroundAgent]),
      agentsLoaded: true,
      isLoadingAgents: true,
      initialAgentId: "agent-1",
      initialAgentConfigProcessed: true,
      recentlyCreatedAgents: ["agent-1"],
      isWaitingForFirstMessage: { "agent-1": true },
      initialAgentConfig: {
        agentId: "agent-1",
        config: { model: "opus" },
        timestamp: 1700000000000,
      },
    };
    const state = mockState({
      byWorkspaceId: {
        [WS_1]: workspaceState,
      },
    });

    expect(selectAllWorkspaceAgentsCollection.select(state, WS_1)).toEqual(workspaceState.agents);
    expect(selectWorkspaceAgentsCollection.select(state, WS_1)).toEqual(workspaceState.agents);
    expect(selectAllWorkspaceAgents.select(state, WS_1)).toEqual([foregroundAgent, backgroundAgent]);
    expect(selectForegroundWorkspaceAgents.select(state, WS_1)).toEqual([foregroundAgent]);
    expect(selectWorkspaceAgents.select(state, WS_1)).toEqual([foregroundAgent, backgroundAgent]);
    expect(selectAgentsLoaded.select(state, WS_1)).toBe(true);
    expect(selectIsLoadingAgents.select(state, WS_1)).toBe(true);
    expect(selectInitialAgentId.select(state, WS_1)).toBe("agent-1");
    expect(selectInitialAgentConfigProcessed.select(state, WS_1)).toBe(true);
    expect(selectRecentlyCreatedAgents.select(state, WS_1)).toEqual(["agent-1"]);
    expect(selectIsAgentRecentlyCreated.select(state, WS_1, "agent-1")).toBe(true);
    expect(selectWaitingForFirstMessageMap.select(state, WS_1)).toEqual({ "agent-1": true });
    expect(selectIsWaitingForFirstMessage.select(state, WS_1, "agent-1")).toBe(true);
    expect(selectInitialAgentConfig.select(state, WS_1)).toEqual(workspaceState.initialAgentConfig);
  });

  it("keeps raw selectors inclusive while foreground selectors hide background agents from both flag sources", () => {
    const foregroundAgent = mockAgent("agent-1");
    const backgroundAgent = {
      ...mockAgent("agent-2"),
      isBackground: true,
    } satisfies AgentSession;
    const metadataBackgroundAgent = {
      ...mockAgent("agent-3"),
      metadata: { isBackground: true } as AgentSession["metadata"],
    } satisfies AgentSession;
    const state = mockState({
      byWorkspaceId: {
        [WS_1]: {
          ...emptyWorkspaceAgentState,
          agents: asCollection([foregroundAgent, backgroundAgent, metadataBackgroundAgent]),
        },
      },
    });

    expect(selectAllWorkspaceAgents.select(state, WS_1)).toEqual([
      foregroundAgent,
      backgroundAgent,
      metadataBackgroundAgent,
    ]);
    expect(selectWorkspaceAgents.select(state, WS_1)).toEqual([
      foregroundAgent,
      backgroundAgent,
      metadataBackgroundAgent,
    ]);
    expect(selectForegroundWorkspaceAgents.select(state, WS_1)).toEqual([foregroundAgent]);
  });

  describe("selectIsNewlyCreatedWorkspace", () => {
    it("returns false when no initialAgentConfig is set", () => {
      const state = mockState();
      expect(selectIsNewlyCreatedWorkspace.select(state, WS_1)).toBe(false);
    });

    it("returns true after setInitialAgentConfig is dispatched", () => {
      const config: InitialAgentConfig = {
        agentId: "agent-1",
        config: { model: "opus" },
      };
      const reducedState = workspaceAgentsReducer(initialState, setInitialAgentConfig(WS_1, config));
      const state = mockState(reducedState);
      expect(selectIsNewlyCreatedWorkspace.select(state, WS_1)).toBe(true);
    });

    it("returns false after clearInitialAgentConfig is dispatched", () => {
      const config: InitialAgentConfig = {
        agentId: "agent-1",
        config: { model: "opus" },
      };
      const withConfig = workspaceAgentsReducer(initialState, setInitialAgentConfig(WS_1, config));
      const cleared = workspaceAgentsReducer(withConfig, clearInitialAgentConfig(WS_1));
      const state = mockState(cleared);
      expect(selectIsNewlyCreatedWorkspace.select(state, WS_1)).toBe(false);
    });
  });
});