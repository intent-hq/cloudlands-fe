import {
  describe,
  expect,
  it,
} from "vitest";
import type { StoreState } from "../../types";
import { initialState } from "./mcp-settings-slice";
import type { McpSettingsState, McpServerConfig } from "./mcp-settings-types";
import {
  selectMcpServerErrorMessage,
  selectMcpServersWithStatus,
  selectWorkspaceDisabledMcpServerNamesByWorkspaceId,
} from "./mcp-settings-selectors";

const servers: McpServerConfig[] = [
  { name: "filesystem", type: "stdio", command: "npx" },
  { name: "linear", type: "http", url: "https://mcp.linear.app" },
];

function mockState(
  mcpSettings: Partial<McpSettingsState> = {},
  activeWorkspaceId: string | null = "ws-1"
) {
  return {
    mcpSettings: {
      ...initialState,
      servers,
      ...mcpSettings,
    },
    workspace: { activeWorkspaceId },
  } as StoreState;
}

describe("mcp-settings selectors", () => {
  it("derives server status view models without storing them", () => {
    const state = mockState({
      disabledServers: { linear: true },
      statusMap: { filesystem: "configured", linear: "connected" },
      toolsMap: { filesystem: [{ name: "read_file" }] },
      errorMessages: { filesystem: "tool failed" },
    });

    expect(selectMcpServersWithStatus.select(state)).toEqual([
      {
        ...servers[0],
        disabled: false,
        status: "configured",
        tools: [{ name: "read_file" }],
        toolCount: 1,
        errorMessage: "tool failed",
      },
      {
        ...servers[1],
        disabled: true,
        status: "disabled",
        tools: [],
        toolCount: 0,
        errorMessage: undefined,
      },
    ]);
  });

  it("derives workspace disabled names from the unified state", () => {
    const state = mockState({
      byWorkspaceId: {
        "ws-1": { disabledServers: { linear: true } },
      },
    });

    expect(selectWorkspaceDisabledMcpServerNamesByWorkspaceId.select(state, "ws-1")).toEqual([
      "linear",
    ]);
  });

  it("selects per-server error messages from the unified runtime error map", () => {
    const state = mockState({ errorMessages: { linear: "Unauthorized" } });

    expect(selectMcpServerErrorMessage.select(state, "linear")).toBe("Unauthorized");
    expect(selectMcpServerErrorMessage.select(state, "filesystem")).toBeUndefined();
  });
});