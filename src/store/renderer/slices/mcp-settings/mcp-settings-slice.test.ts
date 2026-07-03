import {
  describe,
  expect,
  it,
} from "vitest";
import { workspaceUnmounted } from "../workspace-lifecycle/workspace-lifecycle-slice";
import {
  applyWorkspaceDisabledServers,
  initialState,
  mcpSettingsReducer,
  setAdvancedSaveStatus,
  setServerErrorMessage,
  setServerStatus,
  setServers,
  toggleWorkspaceMcpServer,
} from "./mcp-settings-slice";
import type { McpServerConfig } from "./mcp-settings-types";

const servers: McpServerConfig[] = [
  { name: "filesystem", type: "stdio", command: "npx" },
  { name: "linear", type: "http", url: "https://mcp.linear.app" },
];

describe("mcpSettingsReducer", () => {
  it("stores server configuration in the unified MCP state", () => {
    const state = mcpSettingsReducer(initialState, setServers(servers));

    expect(state.servers).toEqual(servers);
  });

  it("stores runtime status and error data in the unified MCP state", () => {
    let state = mcpSettingsReducer(initialState, setServerStatus("linear", "error"));
    state = mcpSettingsReducer(state, setServerErrorMessage("linear", "Unauthorized"));

    expect(state.statusMap.linear).toBe("error");
    expect(state.errorMessages.linear).toBe("Unauthorized");
  });

  it("tracks the advanced-editor save status and clears the error on non-error states", () => {
    expect(initialState.advancedSaveStatus).toBe("idle");

    let state = mcpSettingsReducer(initialState, setAdvancedSaveStatus("error", "bad JSON"));
    expect(state.advancedSaveStatus).toBe("error");
    expect(state.advancedSaveError).toBe("bad JSON");

    state = mcpSettingsReducer(state, setAdvancedSaveStatus("saved"));
    expect(state.advancedSaveStatus).toBe("saved");
    expect(state.advancedSaveError).toBeNull();
  });

  it("applies workspace disabled server names without enabled booleans", () => {
    const state = mcpSettingsReducer(
      initialState,
      applyWorkspaceDisabledServers("ws-1", ["linear", "filesystem"])
    );

    expect(state.byWorkspaceId["ws-1"].disabledServers).toEqual({
      linear: true,
      filesystem: true,
    });
  });

  it("toggles workspace server enabled state by adding and removing disabled names", () => {
    let state = mcpSettingsReducer(
      initialState,
      toggleWorkspaceMcpServer("ws-1", "linear", false)
    );

    expect(state.byWorkspaceId["ws-1"].disabledServers).toEqual({ linear: true });

    state = mcpSettingsReducer(state, toggleWorkspaceMcpServer("ws-1", "linear", true));

    expect(state.byWorkspaceId["ws-1"].disabledServers).toEqual({});
  });

  it("returns the same reference when a workspace toggle does not change state", () => {
    const state = mcpSettingsReducer(
      initialState,
      toggleWorkspaceMcpServer("ws-1", "linear", false)
    );
    const nextState = mcpSettingsReducer(
      state,
      toggleWorkspaceMcpServer("ws-1", "linear", false)
    );

    expect(nextState).toBe(state);
  });

  it("clears workspace MCP state when a workspace unmounts", () => {
    let state = mcpSettingsReducer(
      initialState,
      applyWorkspaceDisabledServers("ws-1", ["linear"])
    );
    state = mcpSettingsReducer(state, applyWorkspaceDisabledServers("ws-2", ["filesystem"]));

    const nextState = mcpSettingsReducer(state, workspaceUnmounted("ws-1"));

    expect(nextState.byWorkspaceId["ws-1"]).toBeUndefined();
    expect(nextState.byWorkspaceId["ws-2"]).toBeDefined();
  });
});