/**
 * Wire-contract tests for the terminal IPC bridges in the terminals/scripts
 * seeder: `terminal:createWithCommand` → `terminal.create` and
 * `terminal:professional:write` → `terminal.write` (PROTOCOL §5.13), routed
 * through the `AppClient` terminals seam (the live client owns the base64
 * framing, asserted in live-terminals-client.test.ts).
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// FAKE AppClient seam: no daemon IPC ever fires. Each test asserts the seam
// call the bridge makes and how it maps the result back to the legacy
// renderer envelope + mock events.
vi.mock("$lib/client", () => ({
  appClient: {
    terminals: {
      create: vi.fn(),
      write: vi.fn(),
      subscribeEvents: vi.fn(),
    },
  },
}));

import { appClient } from "$lib/client";
import { addMockIpcListener, mockInvoke } from "$shared/ipc-mock-router";
import type { TerminalEventHandlers } from "$lib/client/app-client";

const terminals = vi.mocked(appClient.terminals);

describe("terminals-scripts-seeder terminal bridges", () => {
  beforeAll(async () => {
    // Importing the seeder runs its `registerMockIpcHandler` side effects.
    await import("./terminals-scripts-seeder");
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("terminal:createWithCommand → terminal.create (§5.13)", () => {
    it("creates a PTY running the command and returns {ok, terminalId} with the daemon id", async () => {
      terminals.create.mockResolvedValueOnce({ success: true, id: "term-42" });
      terminals.subscribeEvents.mockReturnValueOnce(() => {});

      const createdEvents: unknown[] = [];
      const offCreated = addMockIpcListener("terminal:created", (payload) =>
        createdEvents.push(payload),
      );

      const response = await mockInvoke("terminal:createWithCommand", {
        workspaceId: "ws-1",
        command: "pnpm test",
        cwd: "/repo",
        title: "Command: pnpm test",
      });
      offCreated();

      expect(terminals.create).toHaveBeenCalledWith({
        workspaceId: "ws-1",
        cols: 80,
        rows: 24,
        cwd: "/repo",
        command: "pnpm test",
      });
      expect(response).toEqual({ ok: true, terminalId: "term-42" });
      // PanelLayout listens for `terminal:created` and reloads the workspace's
      // terminal list from the daemon.
      expect(createdEvents).toEqual([
        { terminalId: "term-42", workspaceId: "ws-1", background: true },
      ]);
    });

    it("forwards the daemon terminal:exit to terminal:professional:exit:<id> and unsubscribes", async () => {
      terminals.create.mockResolvedValueOnce({ success: true, id: "term-9" });
      const unsubscribe = vi.fn();
      let handlers: TerminalEventHandlers | undefined;
      terminals.subscribeEvents.mockImplementationOnce((_id, h) => {
        handlers = h;
        return unsubscribe;
      });

      const exitCodes: unknown[] = [];
      const offExit = addMockIpcListener("terminal:professional:exit:term-9", (payload) =>
        exitCodes.push(payload),
      );

      await mockInvoke("terminal:createWithCommand", {
        workspaceId: "ws-1",
        command: "false",
      });

      expect(terminals.subscribeEvents).toHaveBeenCalledWith(
        "term-9",
        expect.objectContaining({ onExit: expect.any(Function) }),
      );
      handlers?.onExit?.({ terminalId: "term-9", exitCode: 1 });
      offExit();

      // CliBlock and the changes/commit panels read the raw exit code payload.
      expect(exitCodes).toEqual([1]);
      expect(unsubscribe).toHaveBeenCalledTimes(1);
    });

    it("maps a daemon create failure to {ok:false, error} without emitting events", async () => {
      terminals.create.mockResolvedValueOnce({ success: false, error: "spawn failed" });

      const createdEvents: unknown[] = [];
      const offCreated = addMockIpcListener("terminal:created", (payload) =>
        createdEvents.push(payload),
      );
      const response = await mockInvoke("terminal:createWithCommand", {
        workspaceId: "ws-1",
        command: "pnpm test",
      });
      offCreated();

      expect(response).toEqual({ ok: false, error: "spawn failed" });
      expect(terminals.subscribeEvents).not.toHaveBeenCalled();
      expect(createdEvents).toEqual([]);
    });

    it("rejects missing workspaceId/command without calling the daemon", async () => {
      const response = await mockInvoke<{ ok: boolean }>("terminal:createWithCommand", {
        workspaceId: "ws-1",
      });
      expect(response.ok).toBe(false);
      expect(terminals.create).not.toHaveBeenCalled();
    });
  });

  describe("terminal:professional:write → terminal.write (§5.13)", () => {
    it("forwards {terminalId, data} through the terminals seam", async () => {
      terminals.write.mockResolvedValueOnce({ success: true });

      const response = await mockInvoke("terminal:professional:write", {
        terminalId: "term-42",
        data: "brew install rtk\n",
      });

      expect(terminals.write).toHaveBeenCalledWith("term-42", "brew install rtk\n");
      expect(response).toEqual({ success: true });
    });

    it("rejects on a daemon write failure so callers' catch blocks run", async () => {
      terminals.write.mockResolvedValueOnce({ success: false, error: "terminal not found" });

      await expect(
        mockInvoke("terminal:professional:write", { terminalId: "gone", data: "x" }),
      ).rejects.toThrow("terminal not found");
    });
  });
});
