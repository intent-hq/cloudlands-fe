import type { AgentMessage, AgentSession, AgentStatus } from "$shared/types";
import { describe, expect, it } from "vitest";
import type { StoreState } from "../../types";
import { createCollection } from "../../utils/collection-utils";
import { selectAgentQueuedMessages } from "../agent-session/agent-session-selectors";
import {
  agentQueueReducer,
  initialState as initialAgentQueueState,
  replaceAgentQueue,
} from "../agent-queue/agent-queue-slice";
import {
  selectAgentById,
  selectActiveAgent,
  selectAllWorkspaceAgents,
  selectAgentsLoaded,
  selectForegroundWorkspaceAgents,
  selectInitialAgentConfig,
  selectInitialAgentConfigProcessed,
  selectInitialAgentId,
  selectIsInitialSpecWriteInProgress,
  selectIsLoadingAgents,
  selectIsNewlyCreatedWorkspace,
  selectRecentlyCreatedAgents,
} from "./workspace-agents-selectors";
import {
  addAgent,
  agentsLoaded,
  clearInitialAgentConfig,
  createAgentRequested,
  createAgentWithSpecialistRequested,
  emptyWorkspaceAgentState,
  initialState,
  type InitialAgentConfig,
  markAgentRecentlyCreated,
  removeWorkspaceAgentState,
  removeAgent,
  setActiveAgentId,
  setDiskMessageCount,
  recordAgentCreatedEvent,
  cleanupAgentCreatedEvents,
  setAgents,
  setAgentsLoaded,
  setInitialAgentConfig,
  setInitialAgentConfigProcessed,
  setInitialAgentId,
  setInitialSpecWriteInProgress,
  setIsLoadingAgents,
  setWaitingForFirstMessage,
  upsertAgentSession,
  workspaceAgentsReducer,
} from "./workspace-agents-slice";

const WS_1 = "ws-1";
const WS_2 = "ws-2";

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

/**
 * Build a mock StoreState with both workspaceAgents and agentSessions data.
 * Session data now lives in agentSessions; workspaceAgents only tracks IDs.
 */
function mockState(
  overrides: Partial<StoreState["workspaceAgents"]> = {},
  sessions: AgentSession[] = [],
): StoreState {
  const byAgentId: Record<string, any> = {};
  for (const s of sessions) {
    // The agent-session slice stores `messages` as a Collection. Convert the
    // array-backed mock session here so selectors that materialize messages
    // (via getItems) don't blow up on an Array-shaped input.
    const messages = Array.isArray((s as any).messages) ? (s as any).messages : [];
    byAgentId[s.id] = {
      ...s,
      messages: createCollection<AgentMessage, "id">("id", messages),
    };
  }
  return {
    workspaceAgents: {
      ...initialState,
      ...overrides,
    },
    agentSessions: {
      byAgentId,
    },
  } as StoreState;
}

describe("workspaceAgentsReducer", () => {
  it("returns the initial state", () => {
    expect(workspaceAgentsReducer(undefined, { type: "@@INIT" })).toEqual(initialState);
  });

  it("stores agent IDs for a workspace", () => {
    const agents = [mockAgent("agent-1"), mockAgent("agent-2")];

    expect(workspaceAgentsReducer(initialState, setAgents(WS_1, agents))).toEqual({
      byWorkspaceId: {
        [WS_1]: {
          ...emptyWorkspaceAgentState,
          agentIds: ["agent-1", "agent-2"],
        },
      },
    });
  });

  it("adds agent IDs without affecting other workspaces", () => {
    let state = workspaceAgentsReducer(initialState, addAgent(WS_1, mockAgent("agent-1")));
    state = workspaceAgentsReducer(state, addAgent(WS_2, mockAgent("agent-2", WS_2, "Setup")));

    expect(state.byWorkspaceId[WS_1].agentIds).toEqual(["agent-1"]);
    expect(state.byWorkspaceId[WS_2].agentIds).toEqual(["agent-2"]);
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
          agentIds: ["agent-2"],
        },
      },
    });
  });

  it("tracks recently created agents per workspace", () => {
    let state = workspaceAgentsReducer(initialState, markAgentRecentlyCreated(WS_1, "agent-1"));
    state = workspaceAgentsReducer(state, markAgentRecentlyCreated(WS_1, "agent-1"));
    state = workspaceAgentsReducer(state, markAgentRecentlyCreated(WS_1, "agent-2"));

    expect(state.byWorkspaceId[WS_1].recentlyCreatedAgents).toEqual(["agent-1", "agent-2"]);
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

  it("reconciles agent-scoped metadata when merging agent list from disk", () => {
    let state = workspaceAgentsReducer(initialState, addAgent(WS_1, mockAgent("agent-1")));
    state = workspaceAgentsReducer(state, addAgent(WS_1, mockAgent("agent-2")));
    state = workspaceAgentsReducer(state, markAgentRecentlyCreated(WS_1, "agent-1"));
    state = workspaceAgentsReducer(state, markAgentRecentlyCreated(WS_1, "agent-2"));
    state = workspaceAgentsReducer(state, setWaitingForFirstMessage(WS_1, "agent-1", true));
    state = workspaceAgentsReducer(state, setWaitingForFirstMessage(WS_1, "agent-2", true));

    // Disk only has agent-2, but agent-1 was added via IPC and should be preserved
    const nextState = workspaceAgentsReducer(state, setAgents(WS_1, [mockAgent("agent-2")]));

    expect(nextState.byWorkspaceId[WS_1].agentIds).toEqual(["agent-1", "agent-2"]);
    expect(nextState.byWorkspaceId[WS_1].recentlyCreatedAgents).toEqual(["agent-1", "agent-2"]);
    expect(nextState.byWorkspaceId[WS_1].isWaitingForFirstMessage).toEqual({ "agent-1": true, "agent-2": true });
  });

  it("preserves IPC-added agents when setAgents loads disk agents that don't include them", () => {
    // 1. Coordinator created and added to state
    let state = workspaceAgentsReducer(initialState, addAgent(WS_1, mockAgent("coordinator")));
    // 2. Subagent arrives via IPC (upsertAgentSession)
    state = workspaceAgentsReducer(state, upsertAgentSession(WS_1, mockAgent("subagent")));
    expect(state.byWorkspaceId[WS_1].agentIds).toEqual(["coordinator", "subagent"]);

    // 3. loadAgentsFromDiskSaga finishes — disk only has coordinator
    state = workspaceAgentsReducer(state, setAgents(WS_1, [mockAgent("coordinator")]));

    // subagent must NOT be wiped
    expect(state.byWorkspaceId[WS_1].agentIds).toEqual(["coordinator", "subagent"]);
  });

  it("adds new disk-loaded agents not already in agentIds", () => {
    let state = workspaceAgentsReducer(initialState, addAgent(WS_1, mockAgent("agent-1")));

    // Disk has agent-1 (already known) + agent-2 (new from disk)
    state = workspaceAgentsReducer(state, setAgents(WS_1, [mockAgent("agent-1"), mockAgent("agent-2")]));

    expect(state.byWorkspaceId[WS_1].agentIds).toEqual(["agent-1", "agent-2"]);
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

    expect(selectAllWorkspaceAgents.select(state, WS_1)).toEqual([]);
    expect(selectForegroundWorkspaceAgents.select(state, WS_1)).toEqual([]);
    expect(selectAgentsLoaded.select(state, WS_1)).toBe(false);
    expect(selectIsLoadingAgents.select(state, WS_1)).toBe(false);
    expect(selectInitialAgentId.select(state, WS_1)).toBeNull();
    expect(selectInitialAgentConfigProcessed.select(state, WS_1)).toBe(false);
    expect(selectRecentlyCreatedAgents.select(state, WS_1)).toEqual([]);
    expect(selectInitialAgentConfig.select(state, WS_1)).toBeNull();
  });

  it("returns per-workspace agent values (sessions from agent-session slice)", () => {
    const foregroundAgent = mockAgent("agent-1");
    const backgroundAgent = {
      ...mockAgent("agent-2"),
      isBackground: true,
    } satisfies AgentSession;
    const workspaceState = {
      agentIds: ["agent-1", "agent-2"],
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
    const state = mockState(
      { byWorkspaceId: { [WS_1]: workspaceState as any } },
      [foregroundAgent, backgroundAgent],
    );

    expect(selectAllWorkspaceAgents.select(state, WS_1)).toEqual([foregroundAgent, backgroundAgent]);
    expect(selectForegroundWorkspaceAgents.select(state, WS_1)).toEqual([foregroundAgent]);
    expect(selectAgentsLoaded.select(state, WS_1)).toBe(true);
    expect(selectIsLoadingAgents.select(state, WS_1)).toBe(true);
    expect(selectInitialAgentId.select(state, WS_1)).toBe("agent-1");
    expect(selectInitialAgentConfigProcessed.select(state, WS_1)).toBe(true);
    expect(selectRecentlyCreatedAgents.select(state, WS_1)).toEqual(["agent-1"]);
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
    const state = mockState(
      {
        byWorkspaceId: {
          [WS_1]: {
            ...emptyWorkspaceAgentState,
            agentIds: ["agent-1", "agent-2", "agent-3"],
          },
        },
      },
      [foregroundAgent, backgroundAgent, metadataBackgroundAgent],
    );

    expect(selectAllWorkspaceAgents.select(state, WS_1)).toEqual([
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

  // -----------------------------------------------------------------------
  // New actions for unified-state-store migration
  // -----------------------------------------------------------------------

  describe("setActiveAgentId", () => {
    it("sets the active agent for a workspace", () => {
      const state = workspaceAgentsReducer(initialState, setActiveAgentId(WS_1, "agent-1"));
      expect(state.byWorkspaceId[WS_1].activeAgentId).toBe("agent-1");
    });

    it("clears the active agent", () => {
      let state = workspaceAgentsReducer(initialState, setActiveAgentId(WS_1, "agent-1"));
      state = workspaceAgentsReducer(state, setActiveAgentId(WS_1, null));
      expect(state.byWorkspaceId[WS_1].activeAgentId).toBeNull();
    });

    it("returns same reference when value unchanged", () => {
      const state = workspaceAgentsReducer(initialState, setActiveAgentId(WS_1, "agent-1"));
      const next = workspaceAgentsReducer(state, setActiveAgentId(WS_1, "agent-1"));
      expect(next).toBe(state);
    });
  });

  describe("upsertAgentSession", () => {
    it("adds agent ID when session is new", () => {
      const agent = mockAgent("agent-1");
      const state = workspaceAgentsReducer(initialState, upsertAgentSession(WS_1, agent));
      expect(state.byWorkspaceId[WS_1].agentIds).toContain("agent-1");
    });

    it("does not duplicate agent ID when session already tracked", () => {
      let state = workspaceAgentsReducer(initialState, upsertAgentSession(WS_1, mockAgent("agent-1")));
      const before = state.byWorkspaceId[WS_1].agentIds.length;
      state = workspaceAgentsReducer(state, upsertAgentSession(WS_1, mockAgent("agent-1")));
      expect(state.byWorkspaceId[WS_1].agentIds.length).toBe(before);
    });
  });

  describe("setInitialSpecWriteInProgress", () => {
    it("sets and clears the flag", () => {
      let state = workspaceAgentsReducer(initialState, setInitialSpecWriteInProgress(WS_1, true));
      expect(selectIsInitialSpecWriteInProgress.select(mockState(state), WS_1)).toBe(true);
      state = workspaceAgentsReducer(state, setInitialSpecWriteInProgress(WS_1, false));
      expect(selectIsInitialSpecWriteInProgress.select(mockState(state), WS_1)).toBe(false);
    });
  });

  describe("removeWorkspaceAgentState", () => {
    it("removes entire workspace state entry", () => {
      let state = workspaceAgentsReducer(initialState, addAgent(WS_1, mockAgent("agent-1")));
      state = workspaceAgentsReducer(state, removeWorkspaceAgentState(WS_1));
      expect(state.byWorkspaceId[WS_1]).toBeUndefined();
    });
  });

  describe("selectAgentById (reads from agent-session)", () => {
    it("returns agent from agent-session slice", () => {
      const agent = mockAgent("agent-1");
      const state = mockState(
        { byWorkspaceId: { [WS_1]: { ...emptyWorkspaceAgentState, agentIds: ["agent-1"] } } },
        [agent],
      );
      expect(selectAgentById.select(state, "agent-1")).toEqual(agent);
    });

    it("returns undefined for unknown agent", () => {
      const state = mockState();
      expect(selectAgentById.select(state, "unknown")).toBeUndefined();
    });
  });

  describe("selectAgentQueuedMessages (deprecated agentQueue bridge)", () => {
    it("returns queued messages from agentQueue slice", () => {
      const queued = [{ id: "q1", content: "hi", queuedAt: "2024-01-01", position: 0 }];
      const state = {
        ...mockState(
          { byWorkspaceId: { [WS_1]: { ...emptyWorkspaceAgentState, agentIds: ["agent-1"] } } },
          [mockAgent("agent-1")],
        ),
        agentQueue: agentQueueReducer(initialAgentQueueState, replaceAgentQueue("agent-1", queued)),
      } as StoreState;
      expect(selectAgentQueuedMessages.select(state, "agent-1")).toEqual(queued);
    });

    it("returns empty array when no session", () => {
      const state = mockState();
      expect(selectAgentQueuedMessages.select(state, "agent-1")).toEqual([]);
    });
  });

  describe("selectActiveAgent (reads from agent-session)", () => {
    it("returns the active agent session from agent-session slice", () => {
      const agent = mockAgent("agent-1");
      const state = mockState(
        { byWorkspaceId: { [WS_1]: { ...emptyWorkspaceAgentState, agentIds: ["agent-1"], activeAgentId: "agent-1" } } },
        [agent],
      );
      const active = selectActiveAgent.select(state, WS_1);
      expect(active?.id).toBe("agent-1");
    });

    it("returns undefined when no active agent", () => {
      const agent = mockAgent("agent-1");
      const state = mockState(
        { byWorkspaceId: { [WS_1]: { ...emptyWorkspaceAgentState, agentIds: ["agent-1"] } } },
        [agent],
      );
      const active = selectActiveAgent.select(state, WS_1);
      expect(active).toBeUndefined();
    });
  });

  describe("setDiskMessageCount", () => {
    it("stores the disk message count for an agent", () => {
      const state = workspaceAgentsReducer(initialState, setDiskMessageCount(WS_1, "agent-1", 42));
      expect(state.byWorkspaceId[WS_1].diskMessageCounts["agent-1"]).toBe(42);
    });

    it("returns same state when count unchanged", () => {
      const state = workspaceAgentsReducer(initialState, setDiskMessageCount(WS_1, "agent-1", 10));
      const next = workspaceAgentsReducer(state, setDiskMessageCount(WS_1, "agent-1", 10));
      expect(next).toBe(state);
    });
  });

  describe("recordAgentCreatedEvent", () => {
    it("records a timestamp for agent-created deduplication", () => {
      const ts = 1700000000000;
      const state = workspaceAgentsReducer(initialState, recordAgentCreatedEvent(WS_1, "agent-1", ts));
      expect(state.byWorkspaceId[WS_1].recentAgentCreatedEvents["agent-1"]).toBe(ts);
    });
  });

  describe("cleanupAgentCreatedEvents", () => {
    it("removes entries older than cutoff", () => {
      let state = workspaceAgentsReducer(initialState, recordAgentCreatedEvent(WS_1, "agent-old", 1000));
      state = workspaceAgentsReducer(state, recordAgentCreatedEvent(WS_1, "agent-new", 5000));
      state = workspaceAgentsReducer(state, cleanupAgentCreatedEvents(WS_1, 3000));
      expect(state.byWorkspaceId[WS_1].recentAgentCreatedEvents["agent-old"]).toBeUndefined();
      expect(state.byWorkspaceId[WS_1].recentAgentCreatedEvents["agent-new"]).toBe(5000);
    });

    it("returns same state when nothing to clean", () => {
      const state = workspaceAgentsReducer(initialState, recordAgentCreatedEvent(WS_1, "agent-1", 5000));
      const next = workspaceAgentsReducer(state, cleanupAgentCreatedEvents(WS_1, 1000));
      expect(next).toBe(state);
    });
  });
});