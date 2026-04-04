import { describe, it, expect } from "vitest";
import {
  mcpServersReducer,
  initialState,
  toggleMcpServer,
} from "./mcp-servers-slice";
import { workspaceUnmounted } from "../workspace-lifecycle/workspace-lifecycle-slice";

describe("mcpServersReducer", () => {
  it("workspaceUnmounted clears workspace state", () => {
    let state = mcpServersReducer(initialState, toggleMcpServer("ws-1", "server-a", true));
    state = mcpServersReducer(state, toggleMcpServer("ws-2", "server-b", true));

    const nextState = mcpServersReducer(state, workspaceUnmounted("ws-1"));

    expect(nextState.byWorkspaceId["ws-1"]).toBeUndefined();
    expect(nextState.byWorkspaceId["ws-2"]).toBeDefined();
  });
});

