import {
  describe,
  expect,
  it,
} from "vitest";
import type { AgentSession } from "$shared/types";
import type { WorkspaceEvent } from "$features/events/types";
import type { StoreState } from "../../types";
import { selectGraphState } from "./agent-overview-selectors";

const WS = "ws-test";

function makeOverviewState(session: AgentSession, workspaceEvents: WorkspaceEvent[] = []): StoreState {
  return {
    agentSessions: {
      byAgentId: {
        [session.id]: {
          ...session,
          messages: session.messages,
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
    workspaceEvents: {
      byWorkspaceId: workspaceEvents.length > 0
        ? { [WS]: { events: workspaceEvents, loading: false } }
        : {},
    },
  } as unknown as StoreState;
}

function makeWorkspaceEvent(overrides: Partial<WorkspaceEvent>): WorkspaceEvent {
  return {
    id: "event-1",
    workspaceId: WS,
    timestamp: "2026-03-20T13:30:00.000Z",
    type: "file:changed",
    actor: { type: "agent", id: "a1", name: "Agent a1" },
    data: {
      path: "src/actual.ts",
      relativePath: "src/actual.ts",
      action: "modify",
    },
    ...overrides,
  } as WorkspaceEvent;
}

describe("selectGraphState", () => {
  it("derives graph interactions from canonical workspace events via .select", () => {
    const session: AgentSession = {
      id: "a1" as any,
      backendSessionId: null,
      workspaceId: WS as any,
      name: "Agent a1",
      status: "idle" as any,
      messages: [],
      createdAt: "2026-03-20T13:00:00.000Z",
      updatedAt: "2026-03-20T13:00:00.000Z",
    };

    const graph = selectGraphState.select(
      makeOverviewState(session, [makeWorkspaceEvent({ id: "file-event" })]),
      WS,
    );

    expect(graph.nodes).toContainEqual(expect.objectContaining({ type: "file", path: "src/actual.ts" }));
    expect(graph.edges).toContainEqual(
      expect.objectContaining({ type: "file-write", agentId: "a1", filePath: "src/actual.ts" }),
    );
  });

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

  it("marks daemon tool-waiting turns as selector-derived waiting without changing Thinking label eligibility", () => {
    const session: AgentSession = {
      id: "a1" as any,
      backendSessionId: null,
      workspaceId: WS as any,
      name: "Agent a1",
      status: "idle" as any,
      isWaitingOnTool: true,
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

  it("keeps explicit waiting-for-other-agents graph status distinct via the canonical selector", () => {
    const session: AgentSession = {
      id: "a1" as any,
      backendSessionId: null,
      workspaceId: WS as any,
      name: "Agent a1",
      status: "Waiting" as any,
      isWaitingForOtherAgents: true,
      waitingForAgentIds: ["a2"],
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

