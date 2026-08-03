/**
 * AutoUpdateService wait-for-idle install tests.
 *
 * Install should arm a waiter that polls listRespondingAgents and only
 * calls quitAndInstall once every agent is idle (or the waiter is cancelled).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as os from "os";
import * as path from "path";
import * as fs from "fs/promises";

const quitAndInstall = vi.fn();
const listRespondingAgents = vi.fn();
const saveWindowSessions = vi.fn(async () => undefined);
const getBackendClient = vi.fn(() => ({ getStatus: () => "connected", request: vi.fn() }));

let testUserDataPath: string;

vi.mock("electron", () => ({
  app: {
    getPath: () => testUserDataPath,
    getVersion: () => "2.0.0",
    on: vi.fn(),
    off: vi.fn(),
  },
  BrowserWindow: vi.fn(),
  powerMonitor: {
    on: vi.fn(),
    off: vi.fn(),
  },
}));

vi.mock("electron-updater", () => ({
  __esModule: true,
  default: {
    autoUpdater: {
      autoDownload: false,
      autoInstallOnAppQuit: false,
      allowDowngrade: false,
      setFeedURL: vi.fn(),
      checkForUpdates: vi.fn(),
      downloadUpdate: vi.fn(),
      quitAndInstall,
      on: vi.fn(),
    },
  },
}));

vi.mock("../../../../main/window", () => ({
  saveWindowSessions,
}));

vi.mock("../../../../main/running-agents", () => ({
  listRespondingAgents,
}));

vi.mock("../../../backend/main/backend.ipc", () => ({
  getBackendClient,
}));

describe("AutoUpdateService wait-for-idle install", () => {
  beforeEach(async () => {
    testUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "auto-update-idle-"));
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.resetModules();
    listRespondingAgents.mockResolvedValue([]);
    saveWindowSessions.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    vi.clearAllTimers();
    vi.useRealTimers();
    const { __drainLocalPrefsWriteChainForTesting } = await import(
      "../../../../main/local-prefs"
    );
    await __drainLocalPrefsWriteChainForTesting();
    await fs.rm(testUserDataPath, { recursive: true, force: true });
  });

  async function readyService() {
    const mod = await import("../auto-update.service");
    const service = mod.autoUpdateService;
    const mockWindow = {
      isDestroyed: () => false,
      webContents: { send: vi.fn() },
    } as any;
    await service.initialize(mockWindow);

    // Force downloaded state via private field (test-only).
    (service as any).state.status = "downloaded";
    (service as any).state.updateInfo = {
      version: "2.1.0",
      releaseDate: new Date().toISOString(),
    };
    return { service, mod, mockWindow };
  }

  it("installs immediately when no agents are responding", async () => {
    listRespondingAgents.mockResolvedValue([]);
    const { service } = await readyService();

    await service.installUpdate();

    expect(saveWindowSessions).toHaveBeenCalled();
    expect(quitAndInstall).toHaveBeenCalledWith(false, true);
    expect(service.getState().status).toBe("waiting-for-idle");
  });

  it("waits while agents respond, then installs when idle", async () => {
    listRespondingAgents
      .mockResolvedValueOnce([{ agentId: "a1", name: "A", workspaceId: "w" }])
      .mockResolvedValueOnce([{ agentId: "a1", name: "A", workspaceId: "w" }])
      .mockResolvedValueOnce([]);

    const { service, mockWindow } = await readyService();

    const installPromise = service.installUpdate();

    // First tick runs inline; still waiting
    await vi.waitFor(() => {
      expect(service.getState().status).toBe("waiting-for-idle");
      expect(service.getState().respondingAgentCount).toBe(1);
    });
    expect(quitAndInstall).not.toHaveBeenCalled();

    // Advance poll interval for next ticks
    await vi.advanceTimersByTimeAsync(1500);
    await vi.advanceTimersByTimeAsync(1500);
    await installPromise;

    expect(quitAndInstall).toHaveBeenCalledWith(false, true);
  });

  it("cancelPendingInstall stops the waiter and returns to downloaded", async () => {
    listRespondingAgents.mockResolvedValue([
      { agentId: "a1", name: "A", workspaceId: "w" },
    ]);
    const { service } = await readyService();

    const installPromise = service.installUpdate();
    await vi.waitFor(() => {
      expect(service.getState().status).toBe("waiting-for-idle");
    });

    service.cancelPendingInstall();
    expect(service.getState().status).toBe("downloaded");
    expect(service.getState().respondingAgentCount).toBeNull();

    await vi.advanceTimersByTimeAsync(5000);
    await installPromise;

    expect(quitAndInstall).not.toHaveBeenCalled();
  });

  it("is a no-op when install is already waiting", async () => {
    listRespondingAgents.mockResolvedValue([
      { agentId: "a1", name: "A", workspaceId: "w" },
    ]);
    const { service } = await readyService();

    const p1 = service.installUpdate();
    await vi.waitFor(() => expect(service.getState().status).toBe("waiting-for-idle"));
    await service.installUpdate(); // second call
    await vi.advanceTimersByTimeAsync(100);
    // Still only one waiter generation - cancel to clean up
    service.cancelPendingInstall();
    await p1;
    expect(quitAndInstall).not.toHaveBeenCalled();
  });
});
