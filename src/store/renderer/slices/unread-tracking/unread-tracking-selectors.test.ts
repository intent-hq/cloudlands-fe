import {
  describe,
  expect,
  it,
} from "vitest";
import type { StoreState } from "../../types";
import {
  selectUnreadAgentIdsByWorkspace,
  selectUnreadAgentIdsForWorkspace,
} from "./unread-tracking-selectors";

function mockState(): StoreState {
  return {
    unreadTracking: {
      unreadAgentIds: ["agent-2", "missing-agent", "agent-1", "agent-3"],
      currentlyViewedAgentId: null,
    },
    workspaceAgents: {
      byWorkspaceId: {
        "ws-1": { agentIds: ["agent-1", "agent-2"] },
        "ws-2": { agentIds: ["agent-3"] },
        "ws-empty": { agentIds: ["agent-4"] },
      },
    },
    agentSessions: {
      byAgentId: {
        "agent-1": { workspaceId: "ws-1" },
        "agent-2": { workspaceId: "ws-1" },
        "agent-3": { workspaceId: "ws-2" },
        "agent-4": { workspaceId: "ws-empty" },
      },
      agentIdsByWorkspace: {
        "ws-1": ["agent-1", "agent-2"],
        "ws-2": ["agent-3"],
        "ws-empty": ["agent-4"],
      },
    },
  } as StoreState;
}

describe("unread-tracking selectors", () => {
  it("derives unread agent IDs for a workspace from agent sessions", () => {
    expect(selectUnreadAgentIdsForWorkspace.select(mockState(), "ws-1")).toEqual([
      "agent-2",
      "agent-1",
    ]);
  });

  it("groups unread agent IDs by workspace from agent sessions", () => {
    expect(selectUnreadAgentIdsByWorkspace.select(mockState())).toEqual({
      "ws-1": ["agent-2", "agent-1"],
      "ws-2": ["agent-3"],
    });
  });
});