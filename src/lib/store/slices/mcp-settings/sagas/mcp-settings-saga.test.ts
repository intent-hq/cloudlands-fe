import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { runSaga } from "redux-saga";

vi.mock(
  "typed-redux-saga",
  async () => await import("$lib/store/utils/test-helpers/typed-redux-saga-mock"),
);

vi.mock("$lib/utils/client-logger", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

import {
  handleLoadServers,
  handleMcpServerError,
} from "./mcp-settings-saga";
import {
  initialState,
  setDisabledServers,
  setServerErrorMessage,
  setServerStatus,
} from "../mcp-settings-slice";
import type { McpServerConfig } from "../mcp-settings-types";

const mockInvoke = vi.fn();

type DispatchedAction = ReturnType<typeof setDisabledServers> | { type: string; payload?: unknown };

function installElectronApi(): void {
  Object.defineProperty(window, "electronAPI", {
    configurable: true,
    value: { invoke: mockInvoke },
  });
}

function mockLoadResponses(disabledResponse: unknown): void {
  mockInvoke.mockImplementation(async (channel: string, data?: { key?: string }) => {
    if (channel === "settings:get" && data?.key === "enableUserMcpServers") {
      return { success: true, data: true };
    }
    if (channel === "settings:get" && data?.key === "disabledMcpServers") {
      return disabledResponse;
    }
    if (channel === "user-mcp:mcp-list") {
      return { success: true, data: [] };
    }
    return { success: false, error: `Unexpected IPC call: ${channel}` };
  });
}

async function collectLoadActions(disabledResponse: unknown): Promise<DispatchedAction[]> {
  const dispatched: DispatchedAction[] = [];
  mockLoadResponses(disabledResponse);

  await runSaga(
    {
      dispatch: (action: DispatchedAction) => dispatched.push(action),
      getState: () => ({
        mcpSettings: {
          ...initialState,
          disabledServers: { existing: true },
        },
      }),
    },
    handleLoadServers,
  ).toPromise();

  return dispatched;
}

beforeEach(() => {
  vi.clearAllMocks();
  installElectronApi();
});

describe("handleLoadServers", () => {
  it("does not clear disabled servers when the persisted payload is malformed", async () => {
    const dispatched = await collectLoadActions({ success: true, data: { malformed: true } });

    expect(dispatched.filter((action) => action.type === setDisabledServers.type)).toEqual([]);
  });

  it("dispatches normalized disabled servers when the persisted payload is an array", async () => {
    const dispatched = await collectLoadActions({ success: true, data: ["alpha", 42, " beta "] });

    expect(dispatched).toContainEqual(setDisabledServers({ alpha: true, beta: true }));
  });
});

describe("handleMcpServerError", () => {
  it("dispatches status and message updates for direct server-name errors", async () => {
    const dispatched: DispatchedAction[] = [];

    await runSaga(
      { dispatch: (action: DispatchedAction) => dispatched.push(action), getState: () => ({}) },
      handleMcpServerError,
      { serverName: "alpha", errorMessage: "401 Unauthorized" },
    ).toPromise();

    expect(dispatched).toContainEqual(setServerStatus("alpha", "auth_required"));
    expect(dispatched).toContainEqual(
      setServerErrorMessage("alpha", "Authentication required — check your credentials or reauthenticate"),
    );
  });

  it("matches command errors against MCP servers through selector effects", async () => {
    const dispatched: DispatchedAction[] = [];
    const servers: McpServerConfig[] = [
      { name: "stdio-server", type: "stdio", command: "node", args: ["server.js"] },
    ];

    await runSaga(
      {
        dispatch: (action: DispatchedAction) => dispatched.push(action),
        getState: () => ({ mcpSettings: { ...initialState, servers } }),
      },
      handleMcpServerError,
      { command: "/usr/bin/node server.js", errorMessage: "spawn failed" },
    ).toPromise();

    expect(dispatched).toContainEqual(setServerStatus("stdio-server", "error"));
    expect(dispatched).toContainEqual(setServerErrorMessage("stdio-server", "spawn failed"));
  });
});