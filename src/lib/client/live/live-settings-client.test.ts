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
  it("getMcpServers reads mcp.servers.list (§5.22) and maps transport/enabled → type/disabled", async () => {
    mockedRequest.mockResolvedValueOnce({
      servers: [
        {
          id: "srv-fs",
          name: "filesystem",
          transport: "stdio",
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-filesystem"],
          env: { API_KEY: "********" },
          enabled: true,
        },
        { id: "srv-gh", name: "github", transport: "http", url: "https://mcp.github.com/mcp", enabled: false },
      ],
    });
    const client = new LiveSettingsClient();

    const result = await client.getMcpServers();
    expect(mockedRequest).toHaveBeenCalledWith("mcp.servers.list");
    expect(result).toEqual([
      {
        id: "srv-fs",
        name: "filesystem",
        type: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-filesystem"],
        env: { API_KEY: "********" },
      },
      { id: "srv-gh", name: "github", type: "http", url: "https://mcp.github.com/mcp", disabled: true },
    ]);
  });

  it("getMcpServers folds a transport failure to an empty list", async () => {
    mockedRequest.mockRejectedValueOnce(new Error("boom"));
    const client = new LiveSettingsClient();
    expect(await client.getMcpServers()).toEqual([]);
  });

  it("setMcpServers diffs against mcp.servers.list: creates new, deletes missing", async () => {
    mockedRequest.mockResolvedValueOnce({
      servers: [{ id: "srv-old", name: "old-server", transport: "stdio", command: "old", enabled: true }],
    });
    mockedRequest.mockResolvedValue({});
    const client = new LiveSettingsClient();

    const result = await client.setMcpServers([
      { name: "fresh", type: "stdio", command: "npx", args: ["serve"] },
    ]);

    expect(mockedRequest).toHaveBeenNthCalledWith(1, "mcp.servers.list");
    expect(mockedRequest).toHaveBeenNthCalledWith(2, "mcp.servers.delete", { serverId: "srv-old" });
    expect(mockedRequest).toHaveBeenNthCalledWith(3, "mcp.servers.create", {
      config: { name: "fresh", transport: "stdio", enabled: true, command: "npx", args: ["serve"] },
    });
    expect(result).toEqual({ success: true });
  });

  it("setMcpServers updates a changed body and toggles a changed enabled flag", async () => {
    mockedRequest.mockResolvedValueOnce({
      servers: [
        { id: "srv-a", name: "alpha", transport: "stdio", command: "alpha-cmd", enabled: true },
        { id: "srv-b", name: "beta", transport: "stdio", command: "beta-cmd", enabled: true },
      ],
    });
    mockedRequest.mockResolvedValue({});
    const client = new LiveSettingsClient();

    const result = await client.setMcpServers([
      { name: "alpha", type: "stdio", command: "alpha-cmd-v2" },
      { name: "beta", type: "stdio", command: "beta-cmd", disabled: true },
    ]);

    expect(mockedRequest).toHaveBeenNthCalledWith(2, "mcp.servers.update", {
      serverId: "srv-a",
      config: { name: "alpha", transport: "stdio", enabled: true, command: "alpha-cmd-v2", id: "srv-a" },
    });
    expect(mockedRequest).toHaveBeenNthCalledWith(3, "mcp.servers.toggle", {
      serverId: "srv-b",
      enabled: false,
    });
    expect(mockedRequest).toHaveBeenCalledTimes(3);
    expect(result).toEqual({ success: true });
  });

  it("setMcpServers issues no update for an unchanged round-tripped server (secrets preserved)", async () => {
    const wire = {
      id: "srv-fs",
      name: "filesystem",
      transport: "stdio" as const,
      command: "npx",
      env: { TOKEN: "********" },
      enabled: true,
    };
    mockedRequest.mockResolvedValueOnce({ servers: [wire] });
    const client = new LiveSettingsClient();

    const result = await client.setMcpServers([
      { name: "filesystem", type: "stdio", command: "npx", env: { TOKEN: "********" } },
    ]);

    expect(mockedRequest).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ success: true });
  });

  it("setMcpServers folds a wire failure to { success: false, error }", async () => {
    mockedRequest.mockResolvedValueOnce({ servers: [] });
    mockedRequest.mockRejectedValueOnce(new Error("mcp server already exists: srv-x"));
    const client = new LiveSettingsClient();

    const result = await client.setMcpServers([{ name: "x", type: "stdio", command: "x" }]);
    expect(result).toEqual({ success: false, error: "mcp server already exists: srv-x" });
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


  it("getMcpServers preserves the daemon-assigned id so status events can resolve name", async () => {
    // The `mcp.servers:status-changed` bridge (§6.5) receives `{ serverId, status }`
    // and looks the config up by id in the slice. `fromWireMcpConfig` must
    // therefore carry the id through — this pins that shape.
    mockedRequest.mockResolvedValueOnce({
      servers: [
        {
          id: "srv-fs",
          name: "filesystem",
          transport: "stdio",
          command: "npx",
          enabled: true,
        },
      ],
    });
    const client = new LiveSettingsClient();

    const result = await client.getMcpServers();
    expect(result).toEqual([
      { id: "srv-fs", name: "filesystem", type: "stdio", command: "npx" },
    ]);
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

describe("LiveSettingsClient user-rule accessors (rules.* — PROTOCOL §5.21)", () => {
  it("getUserRule forwards rules.get with the global-sentinel workspaceId + ruleType", async () => {
    mockedRequest.mockResolvedValueOnce({
      enabled: true,
      content: "Always write tests.",
      updatedAt: 1750000000000,
    });
    const client = new LiveSettingsClient();

    const rule = await client.getUserRule("base-system-prompt");

    expect(mockedRequest).toHaveBeenCalledWith("rules.get", {
      workspaceId: "global",
      ruleType: "base-system-prompt",
    });
    expect(rule).toEqual({
      enabled: true,
      content: "Always write tests.",
      updatedAt: 1750000000000,
    });
  });

  it("getUserRule surfaces the daemon's absent-override default verbatim", async () => {
    // §5.21: an absent type reads back as a disabled empty default — not null.
    mockedRequest.mockResolvedValueOnce({ enabled: false, content: "", updatedAt: 0 });
    const client = new LiveSettingsClient();
    expect(await client.getUserRule("base-system-prompt")).toEqual({
      enabled: false,
      content: "",
      updatedAt: 0,
    });
  });

  it("getUserRule folds a failed wire probe to null (visible load-error path)", async () => {
    mockedRequest.mockRejectedValueOnce(new Error("boom"));
    const client = new LiveSettingsClient();
    expect(await client.getUserRule("base-system-prompt")).toBeNull();
  });

  it("updateUserRule forwards rules.update with workspaceId/ruleType/content", async () => {
    mockedRequest.mockResolvedValueOnce({ rules: { rules: [] } });
    const client = new LiveSettingsClient();

    const result = await client.updateUserRule("base-system-prompt", "Be thorough.");

    expect(mockedRequest).toHaveBeenCalledWith("rules.update", {
      workspaceId: "global",
      ruleType: "base-system-prompt",
      content: "Be thorough.",
    });
    expect(result).toEqual({ success: true });
  });

  it("updateUserRule includes enabled only when the caller passes it", async () => {
    mockedRequest.mockResolvedValueOnce({ rules: { rules: [] } });
    const client = new LiveSettingsClient();

    await client.updateUserRule("base-system-prompt", "Be thorough.", false);

    expect(mockedRequest).toHaveBeenCalledWith("rules.update", {
      workspaceId: "global",
      ruleType: "base-system-prompt",
      content: "Be thorough.",
      enabled: false,
    });
  });

  it("updateUserRule surfaces a rejected update as { success:false, error }", async () => {
    mockedRequest.mockRejectedValueOnce(new Error("rule content exceeds 50000 characters"));
    const client = new LiveSettingsClient();

    const result = await client.updateUserRule("base-system-prompt", "x");

    expect(result.success).toBe(false);
    expect(result.error).toContain("rule content exceeds");
  });
});

