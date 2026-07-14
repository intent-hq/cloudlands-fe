/**
 * Unit tests for LiveSkillsClient.
 *
 * Asserts that the client invokes `skills:list` with the correct payload and
 * maps the main-process `SkillMetadata` shape to the renderer's `SkillInfo`
 * contract (stripping `allowedTools` and `compatibility`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LiveSkillsClient } from "./live-skills-client";
import { SKILLS_CHANNELS } from "$shared/ipc/channels";

describe("LiveSkillsClient", () => {
  let client: LiveSkillsClient;
  let mockInvoke: ReturnType<typeof vi.fn>;
  let originalWindow: typeof globalThis.window;

  beforeEach(() => {
    originalWindow = globalThis.window;
    client = new LiveSkillsClient();
    mockInvoke = vi.fn();

    // Mock window.electronAPI.invoke using vi.stubGlobal
    vi.stubGlobal("window", {
      electronAPI: {
        invoke: mockInvoke,
      },
    });
  });

  afterEach(() => {
    // Restore original window to prevent leakage
    vi.stubGlobal("window", originalWindow);
  });

  describe("list", () => {
    it("invokes skills:list with workspaceId", async () => {
      mockInvoke.mockResolvedValue({ success: true, data: [] });

      await client.list("ws-123");

      expect(mockInvoke).toHaveBeenCalledWith(SKILLS_CHANNELS.LIST, {
        workspaceId: "ws-123",
      });
    });

    it("maps SkillMetadata to SkillInfo (strips allowedTools/compatibility)", async () => {
      mockInvoke.mockResolvedValue({
        success: true,
        data: [
          {
            name: "example-skill",
            description: "A test skill",
            location: ".agents/skills/example/SKILL.md",
            scope: "project",
            allowedTools: "codebase-retrieval,view",
            compatibility: "augment>=1.0",
          },
        ],
      });

      const result = await client.list("ws-456");

      expect(result).toEqual([
        {
          name: "example-skill",
          description: "A test skill",
          location: ".agents/skills/example/SKILL.md",
          scope: "project",
        },
      ]);
    });

    it("returns empty array on IPC error", async () => {
      mockInvoke.mockRejectedValue(new Error("IPC failure"));

      const result = await client.list("ws-789");

      expect(result).toEqual([]);
    });

    it("returns empty array when success is false", async () => {
      mockInvoke.mockResolvedValue({
        success: false,
        error: "Workspace not found",
      });

      const result = await client.list("ws-xyz");

      expect(result).toEqual([]);
    });

    it("returns empty array when electronAPI is unavailable", async () => {
      vi.stubGlobal("window", undefined);

      const result = await client.list("ws-abc");

      expect(result).toEqual([]);
    });
  });

  describe("subscribe", () => {
    it("emits empty array immediately (no-op subscription)", () => {
      const handler = vi.fn();

      const unsubscribe = client.subscribe(handler);

      expect(handler).toHaveBeenCalledWith([]);
      expect(handler).toHaveBeenCalledTimes(1);

      unsubscribe();
    });
  });
});
