/**
 * Unit tests for LiveSystemClient.
 *
 * Asserts that the client invokes `system.status` with the correct wire request
 * and maps the PROTOCOL-shaped mock response to `SystemStatusState` faithfully.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LiveSystemClient } from "./live-system-client";
import { IPC_CHANNELS } from "$shared/ipc-registry";
import type { SystemStatusState } from "$store/renderer/slices/system-status/system-status-slice";

// Mock autoUpdateClient
vi.mock("$features/auto-update/auto-update.client", () => ({
  autoUpdateClient: {
    getState: vi.fn(),
  },
}));

import { autoUpdateClient } from "$features/auto-update/auto-update.client";

describe("LiveSystemClient", () => {
  let client: LiveSystemClient;
  let mockInvoke: ReturnType<typeof vi.fn>;
  let originalWindow: typeof globalThis.window;

  beforeEach(() => {
    originalWindow = globalThis.window;
    client = new LiveSystemClient();
    mockInvoke = vi.fn();

    // Mock window.electronAPI.invoke using vi.stubGlobal
    vi.stubGlobal("window", {
      electronAPI: {
        invoke: mockInvoke,
        on: vi.fn(),
        offById: vi.fn(),
      },
    });
  });

  afterEach(() => {
    // Restore original window to prevent leakage
    vi.stubGlobal("window", originalWindow);
  });

  describe("status", () => {
    it("invokes system.status via backend:request", async () => {
      const mockResponse: SystemStatusState = {
        nodeVersionOk: true,
        nodeVersion: "v20.0.0",
        auggieInstalled: true,
        binaryInstallAvailable: false,
      };

      mockInvoke.mockResolvedValue({
        ok: true,
        result: mockResponse,
      });

      await client.status();

      expect(mockInvoke).toHaveBeenCalledWith(IPC_CHANNELS.BACKEND.REQUEST, {
        method: "system.status",
        params: undefined,
      });
    });

    it("maps PROTOCOL-shaped response to SystemStatusState faithfully", async () => {
      const wireResponse = {
        nodeVersionOk: false,
        nodeVersion: "v18.0.0",
        auggieInstalled: true,
        binaryInstallAvailable: true,
      };

      mockInvoke.mockResolvedValue({
        ok: true,
        result: wireResponse,
      });

      const result = await client.status();

      expect(result).toEqual({
        nodeVersionOk: false,
        nodeVersion: "v18.0.0",
        auggieInstalled: true,
        binaryInstallAvailable: true,
      });
    });

    it("returns default state on wire error", async () => {
      mockInvoke.mockResolvedValue({
        ok: false,
        error: { code: "TRANSPORT_ERROR", message: "Connection failed" },
      });

      const result = await client.status();

      expect(result).toEqual({
        nodeVersionOk: null,
        nodeVersion: undefined,
        auggieInstalled: false,
        binaryInstallAvailable: false,
      });
    });

    it("returns default state when result is not an object", async () => {
      mockInvoke.mockResolvedValue({
        ok: true,
        result: null,
      });

      const result = await client.status();

      expect(result).toEqual({
        nodeVersionOk: null,
        nodeVersion: undefined,
        auggieInstalled: false,
        binaryInstallAvailable: false,
      });
    });

    it("coerces missing or invalid fields to defaults", async () => {
      mockInvoke.mockResolvedValue({
        ok: true,
        result: {
          nodeVersionOk: "invalid",
          auggieInstalled: null,
        },
      });

      const result = await client.status();

      expect(result).toEqual({
        nodeVersionOk: null,
        nodeVersion: undefined,
        auggieInstalled: false,
        binaryInstallAvailable: false,
      });
    });
  });

  describe("releaseNotes", () => {
    it("returns null (daemon does not manage release notes)", async () => {
      const result = await client.releaseNotes();
      expect(result).toBeNull();
    });
  });

  describe("autoUpdate", () => {
    it("delegates to autoUpdateClient.getState and adds toast fields", async () => {
      const mockUpdateState = {
        status: "idle" as const,
        currentVersion: "0.5.0",
        updateInfo: null,
        progress: null,
        error: null,
        channel: "stable" as const,
      };
      vi.mocked(autoUpdateClient.getState).mockResolvedValue(mockUpdateState);

      const result = await client.autoUpdate();

      expect(autoUpdateClient.getState).toHaveBeenCalledOnce();
      expect(result).toEqual({
        ...mockUpdateState,
        toastVisible: false,
        downloadedToastDismissedAt: null,
      });
    });
  });

  describe("subscribe", () => {
    it("emits the initial status fetch result", async () => {
      const mockResponse: SystemStatusState = {
        nodeVersionOk: true,
        nodeVersion: "v20.0.0",
        auggieInstalled: true,
        binaryInstallAvailable: false,
      };

      mockInvoke.mockResolvedValue({
        ok: true,
        result: mockResponse,
      });

      const handler = vi.fn();
      const unsubscribe = client.subscribe(handler);

      // Wait for the async status() call
      await vi.waitFor(() => {
        expect(handler).toHaveBeenCalledWith(mockResponse);
      });

      unsubscribe();
    });

    it("emits default state on fetch error", async () => {
      mockInvoke.mockResolvedValue({
        ok: false,
        error: { code: "ERROR", message: "Failed" },
      });

      const handler = vi.fn();
      client.subscribe(handler);

      await vi.waitFor(() => {
        expect(handler).toHaveBeenCalledWith({
          nodeVersionOk: null,
          nodeVersion: undefined,
          auggieInstalled: false,
          binaryInstallAvailable: false,
        });
      });
    });
  });
});
