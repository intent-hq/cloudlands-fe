import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { McpServerConfig } from "$store/renderer/slices/mcp-settings/mcp-settings-types";

// FAKE seam: appClient.settings.* are stubbed so no IPC/daemon call happens. The
// service runs against the REAL configured store so the management middleware
// wiring, optimistic slice updates, and persistence calls are exercised end to
// end. Only the two MCP settings methods the seam exposes are stubbed.
vi.mock("$lib/client", () => ({
  appClient: {
    settings: {
      getMcpServers: vi.fn(() => Promise.resolve([] as McpServerConfig[])),
      setMcpServers: vi.fn(() => Promise.resolve({ success: true })),
    },
  },
}));

import { appClient } from "$lib/client";
import { store as appStore } from "$store/renderer/store";
import {
  addServer,
  loadServers,
  saveAdvancedJson,
  setAdvancedSaveStatus,
  setDisabledServers,
  setEnabled,
  setServers,
  setServerErrorMessage,
} from "$store/renderer/slices/mcp-settings/mcp-settings-slice";
import {
  addMcpServer,
  importMcpServersFromJson,
  refreshMcpServers,
  removeMcpServer,
  restartMcpServer,
  saveAdvancedMcpJson,
  testMcpServerConnection,
  toggleMcpServer,
} from "./mcp-management-service";

const settings = appClient.settings as unknown as Record<string, ReturnType<typeof vi.fn>>;
const flush = () => new Promise((r) => setTimeout(r, 0));
const mcp = () => appStore.state.mcpSettings;

function makeServer(overrides: Partial<McpServerConfig> = {}): McpServerConfig {
  return { name: "srv", type: "stdio", command: "npx", ...overrides };
}

describe("mcpManagementService (fake seam, real store)", () => {
  beforeAll(() => appStore.init());
  afterEach(() => {
    vi.clearAllMocks();
    settings.getMcpServers.mockResolvedValue([] as never);
    settings.setMcpServers.mockResolvedValue({ success: true } as never);
    appStore.dispatch(setServers([]));
    appStore.dispatch(setDisabledServers({}));
    appStore.dispatch(setEnabled(false));
    appStore.dispatch(setAdvancedSaveStatus("idle"));
  });

  it("refreshMcpServers fetches via the seam and converges the store", async () => {
    settings.getMcpServers.mockResolvedValueOnce([
      makeServer({ name: "fs" }),
      makeServer({ name: "gh", type: "http", url: "https://x" }),
    ] as never);

    await refreshMcpServers();

    expect(settings.getMcpServers).toHaveBeenCalledTimes(1);
    expect(mcp().servers.map((s) => s.name)).toEqual(["fs", "gh"]);
    expect(mcp().statusMap.fs).toBe("configured");
    expect(mcp().statusMap.gh).toBe("connected");
  });

  it("refresh leaves the prior list intact when the read fails", async () => {
    appStore.dispatch(setServers([makeServer({ name: "prior" })]));
    settings.getMcpServers.mockRejectedValueOnce(new Error("boom") as never);

    await refreshMcpServers();

    expect(mcp().servers.map((s) => s.name)).toEqual(["prior"]);
    expect(mcp().error).toBeTruthy();
  });

  it("addMcpServer optimistically adds, auto-enables, and persists", async () => {
    await addMcpServer(makeServer({ name: "added" }));

    expect(mcp().servers.map((s) => s.name)).toEqual(["added"]);
    expect(mcp().enabled).toBe(true);
    expect(settings.setMcpServers).toHaveBeenCalledTimes(1);
  });

  it("addMcpServer rejects a duplicate name without persisting", async () => {
    appStore.dispatch(setServers([makeServer({ name: "dup" })]));

    await addMcpServer(makeServer({ name: "dup" }));

    expect(mcp().servers).toHaveLength(1);
    expect(mcp().error).toContain("already exists");
    expect(settings.setMcpServers).not.toHaveBeenCalled();
  });

  it("removeMcpServer removes from state and persists the new list", async () => {
    appStore.dispatch(setServers([makeServer({ name: "keep" }), makeServer({ name: "drop" })]));

    await removeMcpServer("drop");

    expect(mcp().servers.map((s) => s.name)).toEqual(["keep"]);
    expect(settings.setMcpServers).toHaveBeenCalledTimes(1);
    const persisted = settings.setMcpServers.mock.calls[0][0] as McpServerConfig[];
    expect(persisted.map((s) => s.name)).toEqual(["keep"]);
  });

  it("toggleMcpServer flips disabled and persists the disabled flag", async () => {
    appStore.dispatch(setServers([makeServer({ name: "tog" })]));

    await toggleMcpServer("tog");

    expect(mcp().disabledServers.tog).toBe(true);
    expect(mcp().statusMap.tog).toBe("disabled");
    const persisted = settings.setMcpServers.mock.calls[0][0] as McpServerConfig[];
    expect(persisted[0].disabled).toBe(true);
  });

  it("importMcpServersFromJson adds new servers and reports the count", async () => {
    const json = JSON.stringify({ mcpServers: { a: { command: "x" }, b: { url: "https://y" } } });

    await importMcpServersFromJson(json);

    expect(mcp().servers.map((s) => s.name).sort()).toEqual(["a", "b"]);
    expect(mcp().lastImportedCount).toBe(2);
    expect(settings.setMcpServers).toHaveBeenCalledTimes(1);
  });

  it("restartMcpServer clears the error and re-marks status without a seam call", async () => {
    appStore.dispatch(setServers([makeServer({ name: "r" })]));
    appStore.dispatch(setServerErrorMessage("r", "old failure"));

    restartMcpServer("r");

    expect(mcp().errorMessages.r).toBeUndefined();
    expect(mcp().statusMap.r).toBe("configured");
    expect(settings.setMcpServers).not.toHaveBeenCalled();
  });

  it("testMcpServerConnection is a no-op (BE gap — no seam method)", () => {
    testMcpServerConnection("anything");
    expect(settings.setMcpServers).not.toHaveBeenCalled();
  });

  it("dispatching loadServers triggers a refresh (middleware wiring)", async () => {
    settings.getMcpServers.mockResolvedValueOnce([makeServer({ name: "viaAction" })] as never);

    appStore.dispatch(loadServers());
    await flush();

    expect(settings.getMcpServers).toHaveBeenCalledTimes(1);
    expect(mcp().servers.map((s) => s.name)).toEqual(["viaAction"]);
  });

  it("dispatching addServer triggers an add (middleware wiring)", async () => {
    appStore.dispatch(addServer(makeServer({ name: "viaAdd" })));
    await flush();

    expect(mcp().servers.map((s) => s.name)).toEqual(["viaAdd"]);
    expect(settings.setMcpServers).toHaveBeenCalledTimes(1);
  });

  it("saveAdvancedMcpJson replaces the whole set (removals included) and persists", async () => {
    appStore.dispatch(setServers([makeServer({ name: "stale" })]));

    await saveAdvancedMcpJson(
      JSON.stringify({
        mcpServers: {
          fresh: { command: "npx", args: ["serve"] },
          paused: { command: "npx", disabled: true },
        },
      }),
    );

    expect(mcp().servers.map((s) => s.name)).toEqual(["fresh", "paused"]);
    expect(mcp().disabledServers).toEqual({ paused: true });
    expect(mcp().statusMap.paused).toBe("disabled");
    expect(settings.setMcpServers).toHaveBeenCalledTimes(1);
    const persisted = settings.setMcpServers.mock.calls[0][0] as McpServerConfig[];
    expect(persisted.map((s) => s.name)).toEqual(["fresh", "paused"]);
    expect(mcp().advancedSaveStatus).toBe("saved");
  });

  it("saveAdvancedMcpJson surfaces invalid JSON without touching state or seam", async () => {
    appStore.dispatch(setServers([makeServer({ name: "keep" })]));

    await saveAdvancedMcpJson("{not json");

    expect(mcp().servers.map((s) => s.name)).toEqual(["keep"]);
    expect(settings.setMcpServers).not.toHaveBeenCalled();
    expect(mcp().advancedSaveStatus).toBe("error");
    expect(mcp().advancedSaveError).toBe("Invalid JSON format");
  });

  it("saveAdvancedMcpJson surfaces a seam persistence failure as an error status", async () => {
    settings.setMcpServers.mockResolvedValueOnce({ success: false, error: "boom" } as never);

    await saveAdvancedMcpJson(JSON.stringify({ mcpServers: { x: { command: "x" } } }));

    expect(mcp().advancedSaveStatus).toBe("error");
    expect(mcp().advancedSaveError).toBe("boom");
  });

  it("dispatching saveAdvancedJson triggers the replace-all save (middleware wiring)", async () => {
    appStore.dispatch(saveAdvancedJson(JSON.stringify({ mcpServers: { via: { command: "c" } } })));
    await flush();

    expect(mcp().servers.map((s) => s.name)).toEqual(["via"]);
    expect(settings.setMcpServers).toHaveBeenCalledTimes(1);
  });
});
