/**
 * Wire-contract tests for the live scripts domain (PROTOCOL §5.8).
 *
 * Regression: the scripts panel was fed by the mock client, so daemon-managed
 * scripts never reached the store and every mutation hit an unbridged Electron
 * IPC channel. Asserts (a) the exact JSON-RPC requests the client emits for
 * `script.list/create/remove/start/stop/restart/output/status/run` and (b)
 * PROTOCOL-shaped responses pass through verbatim.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

// FAKE transport only: the backend bridge is mocked so no request ever
// reaches the user's real daemon.
vi.mock("./backend-transport", () => ({
  backendRequest: vi.fn(),
  backendSubscribe: vi.fn(() => Promise.resolve({ subscriptionId: "sub-1" })),
  backendUnsubscribe: vi.fn(() => Promise.resolve()),
  onBackendNotification: vi.fn(() => () => {}),
}));

import { backendRequest } from "./backend-transport";
import { LiveScriptsClient } from "./live-scripts-client";
import type { ScriptWithState } from "$store/renderer/slices/scripts/scripts-types";

const mockedRequest = vi.mocked(backendRequest);

/** §5.8 `script.list` entry: camelCase definition + merged `runtime` block. */
const DEV_SCRIPT: ScriptWithState = {
  id: "s-1",
  workspaceId: "ws-1",
  name: "dev",
  command: "pnpm dev",
  cwd: "app",
  env: { PORT: "3000" },
  mode: "service",
  category: "dev",
  source: "user",
  autoStart: true,
  createdAt: "2026-07-01T00:00:00.000Z",
  runtime: { status: "running", pid: 4242, restartCount: 0, detectedUrl: "http://localhost:3000" },
};

describe("LiveScriptsClient (fake transport)", () => {
  afterEach(() => vi.clearAllMocks());

  it("list forwards script.list with workspaceId and returns scripts verbatim", async () => {
    mockedRequest.mockResolvedValueOnce({ scripts: [DEV_SCRIPT] });
    const client = new LiveScriptsClient();

    const scripts = await client.list("ws-1");

    expect(mockedRequest).toHaveBeenCalledWith("script.list", { workspaceId: "ws-1" });
    expect(scripts).toEqual([DEV_SCRIPT]);
  });

  it("list folds malformed results and transport failures to an empty list", async () => {
    const client = new LiveScriptsClient();
    mockedRequest.mockResolvedValueOnce({});
    expect(await client.list("ws-1")).toEqual([]);
    mockedRequest.mockRejectedValueOnce(new Error("uds boom"));
    expect(await client.list("ws-1")).toEqual([]);
  });

  it("create sends the exact §5.8 request and surfaces the created definition", async () => {
    const { runtime: _runtime, ...definition } = DEV_SCRIPT;
    mockedRequest.mockResolvedValueOnce(definition);
    const client = new LiveScriptsClient();

    const result = await client.create("ws-1", {
      name: "dev",
      command: "pnpm dev",
      mode: "service",
      cwd: "app",
      env: { PORT: "3000" },
      category: "dev",
      autoStart: true,
      scriptId: "s-1",
    });

    expect(mockedRequest).toHaveBeenCalledWith("script.create", {
      workspaceId: "ws-1",
      name: "dev",
      command: "pnpm dev",
      mode: "service",
      cwd: "app",
      env: { PORT: "3000" },
      category: "dev",
      autoStart: true,
      scriptId: "s-1",
    });
    expect(result).toEqual({ success: true, id: "s-1", script: definition });
  });

  it("create omits optional params and folds a daemon error to a failed result", async () => {
    const client = new LiveScriptsClient();
    mockedRequest.mockResolvedValueOnce({ id: "s-2" });
    await client.create("ws-1", { name: "x", command: "y", mode: "command" });
    expect(mockedRequest).toHaveBeenCalledWith("script.create", {
      workspaceId: "ws-1",
      name: "x",
      command: "y",
      mode: "command",
    });

    mockedRequest.mockRejectedValueOnce(new Error("mode is required"));
    const failed = await client.create("ws-1", { name: "x", command: "y", mode: "command" });
    expect(failed).toEqual({ success: false, error: "mode is required" });
  });

  it.each([
    ["remove", "script.remove"],
    ["start", "script.start"],
    ["stop", "script.stop"],
    ["restart", "script.restart"],
  ] as const)(
    "%s forwards %s with workspaceId + scriptId (router requires workspaceId, §5.8)",
    async (method, wireMethod) => {
      mockedRequest.mockResolvedValueOnce({ ok: true, scriptId: "s-1" });
      const client = new LiveScriptsClient();

      const result = await client[method]("ws-1", "s-1");

      expect(mockedRequest).toHaveBeenCalledWith(wireMethod, {
        workspaceId: "ws-1",
        scriptId: "s-1",
      });
      expect(result).toEqual({ success: true });
    },
  );

  it("output forwards workspaceId + maxLines and returns the bare output-buffer string", async () => {
    mockedRequest.mockResolvedValueOnce("[2 lines]\nready\nlistening");
    const client = new LiveScriptsClient();

    const output = await client.output("ws-1", "s-1", 10);

    expect(mockedRequest).toHaveBeenCalledWith("script.output", {
      workspaceId: "ws-1",
      scriptId: "s-1",
      maxLines: 10,
    });
    expect(output).toBe("[2 lines]\nready\nlistening");
  });

  it("status forwards workspaceId, returns the runtime state verbatim and folds errors to null", async () => {
    const client = new LiveScriptsClient();
    mockedRequest.mockResolvedValueOnce(DEV_SCRIPT.runtime);
    expect(await client.status("ws-1", "s-1")).toEqual(DEV_SCRIPT.runtime);
    expect(mockedRequest).toHaveBeenCalledWith("script.status", {
      workspaceId: "ws-1",
      scriptId: "s-1",
    });

    mockedRequest.mockRejectedValueOnce(new Error("script s-1 not found"));
    expect(await client.status("ws-1", "s-1")).toBeNull();
  });

  it("run forwards the §5.8 run envelope with workspaceId and returns it verbatim", async () => {
    mockedRequest.mockResolvedValueOnce({ exitCode: 0, output: "ok", timedOut: false });
    const client = new LiveScriptsClient();

    const result = await client.run("ws-1", "s-1", { maxLines: 50, timeoutSeconds: 30 });

    expect(mockedRequest).toHaveBeenCalledWith("script.run", {
      workspaceId: "ws-1",
      scriptId: "s-1",
      maxLines: 50,
      timeoutSeconds: 30,
    });
    expect(result).toEqual({ exitCode: 0, output: "ok", timedOut: false });
  });
});
