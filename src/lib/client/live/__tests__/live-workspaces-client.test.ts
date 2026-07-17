/**
 * LiveWorkspacesClient tests — includeArchived parameter handling.
 *
 * Ensures `list({ includeArchived: true })` sends the param to the daemon,
 * bare `list()` omits it (default false), and the subscription's `fetchAll`
 * includes archived workspaces.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { LiveWorkspacesClient } from "../live-workspaces-client";
import * as backendTransport from "../backend-transport";
import { createTestWorkspaceId } from "../../../../test/factories/workspace.factory";

describe("LiveWorkspacesClient", () => {
  let client: LiveWorkspacesClient;
  let backendRequestSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    client = new LiveWorkspacesClient();
    backendRequestSpy = vi.spyOn(backendTransport, "backendRequest");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("list()", () => {
    it("sends includeArchived: true when option is provided", async () => {
      backendRequestSpy.mockResolvedValue({ workspaces: [] });

      await client.list({ includeArchived: true });

      expect(backendRequestSpy).toHaveBeenCalledWith("workspace.list", {
        includeArchived: true,
      });
    });

    it("omits params when includeArchived is false", async () => {
      backendRequestSpy.mockResolvedValue({ workspaces: [] });

      await client.list({ includeArchived: false });

      expect(backendRequestSpy).toHaveBeenCalledWith("workspace.list", undefined);
    });

    it("omits params when no options provided (default archived-free)", async () => {
      backendRequestSpy.mockResolvedValue({ workspaces: [] });

      await client.list();

      expect(backendRequestSpy).toHaveBeenCalledWith("workspace.list", undefined);
    });

    it("normalizes returned workspaces", async () => {
      const testId = createTestWorkspaceId();
      const rawWorkspace = {
        id: testId,
        title: "Test Workspace",
        status: "active",
        branch: "main",
        changesets: [],
        timeline: [],
        conversationInfo: [],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      };
      backendRequestSpy.mockResolvedValue({ workspaces: [rawWorkspace] });

      const result = await client.list({ includeArchived: true });

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: testId,
        title: "Test Workspace",
      });
    });
  });

  describe("subscribe()", () => {
    it("fetchAll callback includes archived workspaces", async () => {
      // Spy on the list method before subscribing
      const listSpy = vi.spyOn(client, "list").mockResolvedValue([]);

      const handler = vi.fn();
      const unsubscribe = client.subscribe(handler);

      // Wait a tick for the subscription to initialize
      await new Promise((resolve) => setTimeout(resolve, 0));

      // The subscription's fetchAll should have been called, which calls list
      // Verify list was called with includeArchived: true
      expect(listSpy).toHaveBeenCalledWith({ includeArchived: true });

      unsubscribe();
    });
  });
});
