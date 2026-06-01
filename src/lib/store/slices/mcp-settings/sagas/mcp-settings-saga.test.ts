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
  handleRestartServer,
} from "./mcp-settings-saga";
import {
  initialState,
  setDisabledServers,
  setServerStatus,
  setServerErrorMessage,
  clearServerErrorMessage,
  restartServer,
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

async function collectRestartActions(
  servers: McpServerConfig[],
  name: string,
): Promise<DispatchedAction[]> {
  const dispatched: DispatchedAction[] = [];

  await runSaga(
    {
      dispatch: (action: DispatchedAction) => dispatched.push(action),
      getState: () => ({
        mcpSettings: {
          ...initialState,
          servers,
        },
      }),
    },
    handleRestartServer,
    restartServer(name),
  ).toPromise();

  return dispatched;
}

describe("handleRestartServer", () => {
  it("clears the prior error and re-validates an unknown server as a no-op", async () => {
    const dispatched = await collectRestartActions([], "ghost");

    expect(dispatched).toEqual([]);
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("optimistically clears the error and marks a stdio server configured without testing a connection", async () => {
    const servers: McpServerConfig[] = [
      { name: "filesystem", type: "stdio", command: "node", args: ["server.js"] },
    ];

    const dispatched = await collectRestartActions(servers, "filesystem");

    expect(dispatched).toContainEqual(clearServerErrorMessage("filesystem"));
    expect(dispatched).toContainEqual(setServerStatus("filesystem", "configured"));
    expect(mockInvoke).not.toHaveBeenCalledWith("user-mcp:test-connection", expect.anything());
  });

  it("re-tests the connection for a remote server with a url", async () => {
    mockInvoke.mockResolvedValue({ success: true, data: {} });
    const servers: McpServerConfig[] = [
      { name: "linear", type: "http", url: "https://mcp.linear.app/sse" },
    ];

    const dispatched = await collectRestartActions(servers, "linear");

    expect(dispatched).toContainEqual(clearServerErrorMessage("linear"));
    expect(dispatched).toContainEqual(setServerStatus("linear", "configured"));
    expect(mockInvoke).toHaveBeenCalledWith(
      "user-mcp:test-connection",
      expect.objectContaining({ name: "linear", url: "https://mcp.linear.app/sse" }),
    );
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

  it("classifies a non-auth server-name error as stopped", async () => {
    const dispatched: DispatchedAction[] = [];

    await runSaga(
      { dispatch: (action: DispatchedAction) => dispatched.push(action), getState: () => ({}) },
      handleMcpServerError,
      { serverName: "filesystem", errorMessage: "spawn ENOENT" },
    ).toPromise();

    expect(dispatched).toContainEqual(setServerStatus("filesystem", "stopped"));
    expect(dispatched).toContainEqual(setServerErrorMessage("filesystem", "spawn ENOENT"));
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

    expect(dispatched).toContainEqual(setServerStatus("stdio-server", "stopped"));
    expect(dispatched).toContainEqual(setServerErrorMessage("stdio-server", "spawn failed"));
  });

  it("ignores events without an error message", async () => {
    const dispatched: DispatchedAction[] = [];

    await runSaga(
      { dispatch: (action: DispatchedAction) => dispatched.push(action), getState: () => ({}) },
      handleMcpServerError,
      { serverName: "filesystem" },
    ).toPromise();

    expect(dispatched).toEqual([]);
  });

  it("does not dispatch when the error cannot be matched to a server", async () => {
    const dispatched: DispatchedAction[] = [];

    await runSaga(
      {
        dispatch: (action: DispatchedAction) => dispatched.push(action),
        getState: () => ({ mcpSettings: { ...initialState, servers: [] } }),
      },
      handleMcpServerError,
      { command: "unknown-binary", errorMessage: "boom" },
    ).toPromise();

    expect(dispatched).toEqual([]);
  });
});