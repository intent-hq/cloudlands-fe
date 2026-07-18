import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appClient } from "./index";
import { IPC_CHANNELS } from "$shared/ipc-registry";

// `appClient` is a LiveAppClient with all domains live. Most reach the daemon via
// JSON-RPC; `browser` uses localStorage; `system` uses JSON-RPC + autoUpdateClient.
// Individual client behavior is covered by their dedicated test files
// (live-skills-client.test.ts, etc.). This suite exercises the singleton seam to
// ensure composition is wired correctly.
describe("appClient seam (all domains live)", () => {
  let mockInvoke: ReturnType<typeof vi.fn>;
  let mockOn: ReturnType<typeof vi.fn>;
  let mockOffById: ReturnType<typeof vi.fn>;
  let originalWindow: typeof globalThis.window;

  beforeEach(() => {
    originalWindow = globalThis.window;
    mockInvoke = vi.fn();
    mockOn = vi.fn();
    mockOffById = vi.fn();

    // Mock window.electronAPI for live clients using vi.stubGlobal
    vi.stubGlobal("window", {
      electronAPI: {
        invoke: mockInvoke,
        on: mockOn,
        offById: mockOffById,
      },
    });
  });

  afterEach(() => {
    // Restore original window to prevent leakage
    vi.stubGlobal("window", originalWindow);
  });

  it("routes skills.list through LiveSkillsClient to daemon skill.list RPC", async () => {
    mockInvoke.mockResolvedValue({
      ok: true,
      result: [
        { name: "test-skill", description: "Test", location: "/path/SKILL.md", scope: "user" },
      ],
    });

    const skills = await appClient.skills.list("ws-123");

    expect(mockInvoke).toHaveBeenCalledWith(IPC_CHANNELS.BACKEND.REQUEST, {
      method: "skill.list",
      params: { workspaceId: "ws-123" },
    });
    expect(skills).toHaveLength(1);
    expect(skills[0]).toMatchObject({ name: "test-skill", description: "Test" });
  });

  it("routes system.status through LiveSystemClient to system.status JSON-RPC", async () => {
    mockInvoke.mockResolvedValue({
      ok: true,
      result: {
        nodeVersionOk: true,
        nodeVersion: "v20.0.0",
        auggieInstalled: true,
        binaryInstallAvailable: false,
      },
    });

    await appClient.system.status();

    expect(mockInvoke).toHaveBeenCalledWith(IPC_CHANNELS.BACKEND.REQUEST, {
      method: "system.status",
      params: undefined,
    });
  });

  it("accepts FE-only setUserPreferences as a no-op success on the live settings client", async () => {
    // UserPreferences are FE-only per PROTOCOL §5.12 — the live client accepts
    // the call but does not forward it to the daemon.
    expect(await appClient.settings.setUserPreferences({})).toEqual({ success: true });
  });
});
