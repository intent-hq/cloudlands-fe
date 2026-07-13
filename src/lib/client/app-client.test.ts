import { beforeEach, describe, expect, it, vi } from "vitest";
import { appClient } from "./index";
import { SKILLS_CHANNELS } from "$shared/ipc/channels";
import { IPC_CHANNELS } from "$shared/ipc-registry";

// `appClient` is a LiveAppClient with all domains now backed by the live daemon.
// Individual live client behavior is covered by their dedicated test files
// (live-skills-client.test.ts, live-system-client.test.ts, etc.). This suite
// exercises the singleton seam to ensure the composition is wired correctly.
describe("appClient seam (all domains live)", () => {
  let mockInvoke: ReturnType<typeof vi.fn>;
  let mockOn: ReturnType<typeof vi.fn>;
  let mockOffById: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockInvoke = vi.fn();
    mockOn = vi.fn();
    mockOffById = vi.fn();

    // Mock window.electronAPI for live clients
    globalThis.window = {
      electronAPI: {
        invoke: mockInvoke,
        on: mockOn,
        offById: mockOffById,
      },
    } as any;
  });

  it("routes skills.list through LiveSkillsClient to skills:list IPC", async () => {
    mockInvoke.mockResolvedValue({ success: true, data: [] });

    await appClient.skills.list("ws-123");

    expect(mockInvoke).toHaveBeenCalledWith(SKILLS_CHANNELS.LIST, {
      workspaceId: "ws-123",
    });
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
