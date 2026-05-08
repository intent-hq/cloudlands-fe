import { describe, expect, it } from "vitest";
import type { AgentMessage, AgentSession } from "$shared/types";
import type { InteractionEvent } from "$lib/components/agent-overview/types";
import type { StoreState } from "../../types";
import { createCollection } from "../../utils/collection-utils";
import {
  agentOverviewReducer,
  initialState,
  processWorkspaceEvents,
  addRealtimeEvent,
  clearAgentOverview,
} from "./agent-overview-slice";
import { selectGraphState } from "./agent-overview-selectors";

const WS = "ws-test";

function makeOverviewState(session: AgentSession): StoreState {
  return {
    agentOverview: {
      byWorkspaceId: {
        [WS]: { events: [], currentTime: "2026-03-20T14:00:00.000Z", isLive: true },
      },
    },
    agentSessions: {
      byAgentId: {
        [session.id]: {
          ...session,
          messages: createCollection<AgentMessage, "id">("id", session.messages),
        },
      },
    },
    workspaceAgents: {
      byWorkspaceId: {
        [WS]: {
          agentIds: [String(session.id)],
          agentsLoaded: true,
          isLoadingAgents: false,
          initialAgentId: null,
          initialAgentConfigProcessed: false,
          recentlyCreatedAgents: [],
          isWaitingForFirstMessage: {},
          initialAgentConfig: null,
          activeAgentId: null,
          isInitialSpecWriteInProgress: false,
          diskMessageCounts: {},
          recentAgentCreatedEvents: {},
        },
      },
    },
    changes: { byWorkspaceId: {}, fileListViewMode: "flat", mainPanelView: null, agentStats: {} },
    workspaceNotes: { byWorkspaceId: {} },
  } as unknown as StoreState;
}

describe("agentOverviewReducer", () => {
  it("returns the initial state", () => {
    expect(agentOverviewReducer(undefined, { type: "@@INIT" })).toEqual(initialState);
  });

  it("stores and sorts events via processWorkspaceEvents", () => {
    const events: InteractionEvent[] = [
      { type: "file-write", timestamp: "2026-03-20T13:00:00.000Z", agentId: "a1" },
      { type: "file-read", timestamp: "2026-03-20T12:00:00.000Z", agentId: "a1" },
    ];

    const state = agentOverviewReducer(initialState, processWorkspaceEvents(WS, events));
    const ws = state.byWorkspaceId[WS];

    expect(ws.events).toHaveLength(2);
    // Events should be sorted chronologically
    expect(ws.events[0].timestamp).toBe("2026-03-20T12:00:00.000Z");
    expect(ws.events[1].timestamp).toBe("2026-03-20T13:00:00.000Z");
  });

  it("appends event and updates currentTime when live via addRealtimeEvent", () => {
    const event: InteractionEvent = {
      type: "file-write",
      timestamp: "2026-03-20T14:00:00.000Z",
      agentId: "a1",
    };

    const state = agentOverviewReducer(initialState, addRealtimeEvent(WS, event));
    const ws = state.byWorkspaceId[WS];

    expect(ws.events).toHaveLength(1);
    expect(ws.events[0]).toEqual(event);
    // isLive defaults to true, so currentTime should be updated
    expect(ws.currentTime).toBeTruthy();
    expect(ws.isLive).toBe(true);
  });

  it("clears workspace state via clearAgentOverview", () => {
    // First add some data
    const events: InteractionEvent[] = [
      { type: "file-write", timestamp: "2026-03-20T13:00:00.000Z", agentId: "a1" },
    ];
    let state = agentOverviewReducer(initialState, processWorkspaceEvents(WS, events));
    expect(state.byWorkspaceId[WS]).toBeDefined();

    // Clear it
    state = agentOverviewReducer(state, clearAgentOverview(WS));
    expect(state.byWorkspaceId[WS]).toBeUndefined();
  });
});

describe("selectGraphState", () => {
  it("uses the centralized agent responding selector for graph status without re-exposing transport flags", () => {
    const session: AgentSession = {
      id: "a1" as any,
      backendSessionId: null,
      workspaceId: WS as any,
      name: "Agent a1",
      status: "idle" as any,
      isStreaming: true,
      messages: [],
      createdAt: "2026-03-20T13:00:00.000Z",
      updatedAt: "2026-03-20T13:00:00.000Z",
    };

    const graph = selectGraphState.select(makeOverviewState(session), WS);
    const agentNode = graph.nodes.find((node) => node.type === "agent" && node.agentId === "a1");

    expect(agentNode?.status).toBe("responding");
    expect(agentNode && "isResponding" in agentNode).toBe(false);
    expect(agentNode && "isThinking" in agentNode).toBe(false);
    expect(agentNode && "isWaiting" in agentNode).toBe(false);
    expect(agentNode && "isWaitingForOtherAgents" in agentNode).toBe(false);
  });

  it("maps AgentStatus.Waiting active-thread sessions through selector-derived waiting state", () => {
    const session: AgentSession = {
      id: "a1" as any,
      backendSessionId: null,
      workspaceId: WS as any,
      name: "Agent a1",
      status: "Waiting" as any,
      messages: [],
      createdAt: "2026-03-20T13:00:00.000Z",
      updatedAt: "2026-03-20T13:00:00.000Z",
    };

    const graph = selectGraphState.select(makeOverviewState(session), WS);
    const agentNode = graph.nodes.find((node) => node.type === "agent" && node.agentId === "a1");

    expect(agentNode?.status).toBe("responding");
    expect(agentNode && "isWaiting" in agentNode).toBe(false);
    expect(agentNode && "isWaitingForOtherAgents" in agentNode).toBe(false);
  });

  it("marks unresolved tool calls as selector-derived waiting without changing Thinking label eligibility", () => {
    const session: AgentSession = {
      id: "a1" as any,
      backendSessionId: null,
      workspaceId: WS as any,
      name: "Agent a1",
      status: "idle" as any,
      messages: [
        {
          id: "m1",
          role: "assistant",
          timestamp: "2026-03-20T13:00:00.000Z",
          contentBlocks: [{ type: "tool_use", id: "tool-1", name: "read_file", input: {} }],
        } as any,
      ],
      createdAt: "2026-03-20T13:00:00.000Z",
      updatedAt: "2026-03-20T13:00:00.000Z",
    };

    const graph = selectGraphState.select(makeOverviewState(session), WS);
    const agentNode = graph.nodes.find((node) => node.type === "agent" && node.agentId === "a1");

    expect(agentNode?.status).toBe("responding");
    expect(agentNode && "isWaiting" in agentNode).toBe(false);
    expect(agentNode && "isWaitingForOtherAgents" in agentNode).toBe(false);
  });

  it("keeps explicit waiting-for-other-agents graph status distinct via the canonical selector", () => {
    const session: AgentSession = {
      id: "a1" as any,
      backendSessionId: null,
      workspaceId: WS as any,
      name: "Agent a1",
      status: "Waiting" as any,
      metadata: { waitingForAgentIds: ["a2"] } as any,
      messages: [],
      createdAt: "2026-03-20T13:00:00.000Z",
      updatedAt: "2026-03-20T13:00:00.000Z",
    };

    const graph = selectGraphState.select(makeOverviewState(session), WS);
    const agentNode = graph.nodes.find((node) => node.type === "agent" && node.agentId === "a1");

    expect(agentNode?.status).toBe("waiting");
    expect(agentNode?.waitingForAgentIds).toEqual(["a2"]);
    expect(agentNode && "isWaiting" in agentNode).toBe(false);
    expect(agentNode && "isWaitingForOtherAgents" in agentNode).toBe(false);
  });
});

