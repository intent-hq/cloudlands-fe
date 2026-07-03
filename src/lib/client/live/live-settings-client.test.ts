import { afterEach, describe, expect, it, vi } from "vitest";

// FAKE transport only: no settings RPC ever reaches the real daemon. The
// `runMutation` helper stays real so each domain mutator asserts the JSON-RPC
// method + params it forwards to the mocked transport.
vi.mock("./backend-transport", () => ({
  backendRequest: vi.fn(),
  backendSubscribe: vi.fn(() => Promise.resolve({ subscriptionId: "sub-set-1" })),
  backendUnsubscribe: vi.fn(() => Promise.resolve()),
  onBackendNotification: vi.fn(() => () => {}),
}));

import { backendRequest } from "./backend-transport";
import { LiveSettingsClient } from "./live-settings-client";

const mockedRequest = vi.mocked(backendRequest);

afterEach(() => vi.clearAllMocks());

describe("LiveSettingsClient wire requests (fake transport)", () => {
  it("list forwards settings.list with no params and surfaces the daemon's settings[] array", async () => {
    const fakeList = [
      {
        path: "server.port",
        label: "WS port",
        description: "TCP port for the WSS listener",
        category: "server",
        type: "number",
        min: 1024,
        max: 65535,
        defaultValue: 5180,
        value: 5180,
      },
    ];
    mockedRequest.mockResolvedValueOnce({ settings: fakeList });
    const client = new LiveSettingsClient();

    const result = await client.list();

    expect(mockedRequest).toHaveBeenCalledWith("settings.list");
    expect(result).toEqual(fakeList);
  });

  it("list folds transport failures to an empty array (boot stays resilient)", async () => {
    mockedRequest.mockRejectedValueOnce(new Error("boom"));
    const client = new LiveSettingsClient();
    expect(await client.list()).toEqual([]);
  });

  it("get forwards settings.get with { path } and merges the definition + value", async () => {
    mockedRequest.mockResolvedValueOnce({
      path: "sourceControl.activeProvider",
      value: "github",
      definition: {
        path: "sourceControl.activeProvider",
        label: "Source-control provider",
        description: "Active forge implementation",
        category: "sourceControl",
        type: "enum",
        enumValues: ["github"],
        defaultValue: "github",
      },
    });
    const client = new LiveSettingsClient();

    const entry = await client.get("sourceControl.activeProvider");

    expect(mockedRequest).toHaveBeenCalledWith("settings.get", {
      path: "sourceControl.activeProvider",
    });
    expect(entry).toEqual({
      path: "sourceControl.activeProvider",
      label: "Source-control provider",
      description: "Active forge implementation",
      category: "sourceControl",
      type: "enum",
      enumValues: ["github"],
      defaultValue: "github",
      value: "github",
    });
  });

  it("get folds an unknown-path transport error to null", async () => {
    mockedRequest.mockRejectedValueOnce(new Error("invalid params"));
    const client = new LiveSettingsClient();
    expect(await client.get("does.not.exist")).toBeNull();
  });

  it("update forwards settings.update with { changes } and returns the applied list", async () => {
    mockedRequest.mockResolvedValueOnce({
      applied: [{ path: "server.port", value: 5181 }],
    });
    const client = new LiveSettingsClient();

    const applied = await client.update([
      { path: "server.port", value: 5181 },
      { path: "sourceControl.github.tokenSource", value: "gh-cli", reason: "use gh auth token" },
    ]);

    expect(mockedRequest).toHaveBeenCalledWith("settings.update", {
      changes: [
        { path: "server.port", value: 5181 },
        { path: "sourceControl.github.tokenSource", value: "gh-cli", reason: "use gh auth token" },
      ],
    });
    expect(applied).toEqual([{ path: "server.port", value: 5181 }]);
  });

  it("update is a no-op when changes[] is empty (no wire call)", async () => {
    const client = new LiveSettingsClient();
    expect(await client.update([])).toEqual([]);
    expect(mockedRequest).not.toHaveBeenCalled();
  });

  it("reset forwards settings.reset with { path } and surfaces the restored value", async () => {
    mockedRequest.mockResolvedValueOnce({ path: "server.port", value: 5180 });
    const client = new LiveSettingsClient();

    const applied = await client.reset("server.port");

    expect(mockedRequest).toHaveBeenCalledWith("settings.reset", { path: "server.port" });
    expect(applied).toEqual({ path: "server.port", value: 5180 });
  });
});

describe("LiveSettingsClient domain accessors map FE shapes ↔ BE paths", () => {
  it("getMcpServers reads `mcp.servers` via settings.get and unwraps the value array", async () => {
    const servers = [
      { name: "github", type: "http" as const, url: "https://mcp.github.com/mcp" },
    ];
    mockedRequest.mockResolvedValueOnce({
      path: "mcp.servers",
      value: servers,
      definition: {
        path: "mcp.servers",
        label: "MCP servers",
        description: "External MCP server configs",
        category: "mcp",
        type: "string",
        sensitive: true,
      },
    });
    const client = new LiveSettingsClient();

    const result = await client.getMcpServers();
    expect(mockedRequest).toHaveBeenCalledWith("settings.get", { path: "mcp.servers" });
    expect(result).toEqual(servers);
  });

  it("setMcpServers writes the array via settings.update under path mcp.servers", async () => {
    mockedRequest.mockResolvedValueOnce({
      applied: [{ path: "mcp.servers", value: [] }],
    });
    const client = new LiveSettingsClient();

    const result = await client.setMcpServers([]);
    expect(mockedRequest).toHaveBeenCalledWith("settings.update", {
      changes: [{ path: "mcp.servers", value: [] }],
    });
    expect(result).toEqual({ success: true });
  });

  it("getProviderSettings folds providers.active + providers.enabled out of settings.list", async () => {
    mockedRequest.mockResolvedValueOnce({
      settings: [
        { path: "providers.active", label: "", description: "", category: "providers", type: "string", value: "auggie" },
        {
          path: "providers.enabled",
          label: "",
          description: "",
          category: "providers",
          type: "object",
          value: { auggie: true, "claude-code": false },
        },
      ],
    });
    const client = new LiveSettingsClient();

    const result = await client.getProviderSettings();
    expect(result).toEqual({
      activeProviderId: "auggie",
      enabledProviders: { auggie: true, "claude-code": false },
    });
  });

  it("setProviderSettings only forwards the fields the caller actually changed", async () => {
    mockedRequest.mockResolvedValueOnce({ applied: [] });
    const client = new LiveSettingsClient();

    await client.setProviderSettings({ activeProviderId: "codex" });
    expect(mockedRequest).toHaveBeenCalledWith("settings.update", {
      changes: [{ path: "providers.active", value: "codex" }],
    });
  });

  it("getWorkspaceSettings reads git.autoCommit and maps to { autoCommitEnabled }", async () => {
    mockedRequest.mockResolvedValueOnce({
      path: "git.autoCommit",
      value: false,
      definition: {
        path: "git.autoCommit",
        label: "Auto-commit",
        description: "",
        category: "git",
        type: "boolean",
        defaultValue: true,
      },
    });
    const client = new LiveSettingsClient();
    expect(await client.getWorkspaceSettings("ws-1")).toEqual({ autoCommitEnabled: false });
  });
});

