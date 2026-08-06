/**
 * AutoUpdateService.installUpdate() confirmation gating tests.
 *
 * installUpdate() must run the running-agents confirmation BEFORE any install
 * side effect (saveWindowSessions, isInstallingUpdate, quitAndInstall) — on
 * macOS quitAndInstall closes all windows before before-quit fires, so a
 * prompt there is too late. Cancel must be a clean no-op leaving the update
 * state 'downloaded' so Install can be clicked again.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import type { Mock } from 'vitest';

// Mock Electron before importing the service
vi.mock('electron', () => ({
  app: {
    getPath: () => testUserDataPath,
    getVersion: () => '2.0.0',
    on: vi.fn(),
  },
  BrowserWindow: vi.fn(),
  powerMonitor: {
    on: vi.fn(),
  },
}));

const updaterHandlers: Record<string, (arg?: unknown) => void> = {};

vi.mock('electron-updater', () => ({
  __esModule: true,
  default: {
    autoUpdater: {
      autoDownload: false,
      autoInstallOnAppQuit: false,
      allowDowngrade: false,
      setFeedURL: vi.fn(),
      checkForUpdates: vi.fn(),
      downloadUpdate: vi.fn(),
      quitAndInstall: vi.fn(),
      on: vi.fn((event: string, handler: (arg?: unknown) => void) => {
        updaterHandlers[event] = handler;
      }),
    },
  },
}));

vi.mock('../../../../main/quit-confirmation', () => ({
  confirmQuitWithRunningAgents: vi.fn(),
}));

vi.mock('../../../../main/window', () => ({
  saveWindowSessions: vi.fn(async () => {}),
}));

let testUserDataPath: string;

/** Import fresh module instances and drive the service into 'downloaded'. */
async function setupDownloadedService() {
  const svc = await import('../auto-update.service');
  const { confirmQuitWithRunningAgents } = await import('../../../../main/quit-confirmation');
  const { saveWindowSessions } = await import('../../../../main/window');
  const { default: electronUpdater } = await import('electron-updater');

  const mockWindow = {
    isDestroyed: () => false,
    webContents: { send: vi.fn() },
  } as never;
  await svc.autoUpdateService.initialize(mockWindow);
  updaterHandlers['update-downloaded']({ version: '2.1.0', releaseDate: '2026-01-01' });
  expect(svc.autoUpdateService.getState().status).toBe('downloaded');

  return {
    svc,
    confirmMock: confirmQuitWithRunningAgents as Mock,
    saveMock: saveWindowSessions as Mock,
    quitAndInstallMock: electronUpdater.autoUpdater.quitAndInstall as Mock,
  };
}

describe('AutoUpdateService.installUpdate confirmation gating', () => {
  beforeEach(async () => {
    testUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'auto-update-install-test-'));
    vi.clearAllMocks();
    vi.resetModules();
  });

  afterEach(async () => {
    vi.clearAllTimers();
    vi.useRealTimers();
    const { __drainLocalPrefsWriteChainForTesting } = await import('../../../../main/local-prefs');
    await __drainLocalPrefsWriteChainForTesting();
    await fs.rm(testUserDataPath, { recursive: true, force: true });
  });

  it('cancel is a clean no-op: no session save, no install flag, no quitAndInstall, state stays downloaded', async () => {
    const { svc, confirmMock, saveMock, quitAndInstallMock } = await setupDownloadedService();
    confirmMock.mockResolvedValue(false);

    await svc.autoUpdateService.installUpdate();

    expect(confirmMock).toHaveBeenCalledTimes(1);
    expect(saveMock).not.toHaveBeenCalled();
    expect(quitAndInstallMock).not.toHaveBeenCalled();
    expect(svc.isInstallingUpdate).toBe(false);
    expect(svc.autoUpdateService.getState().status).toBe('downloaded');

    // Install stays clickable: a later confirmed attempt proceeds.
    confirmMock.mockResolvedValue(true);
    await svc.autoUpdateService.installUpdate();
    expect(quitAndInstallMock).toHaveBeenCalledWith(false, true);
  });

  it('confirm proceeds: confirmation runs BEFORE saveWindowSessions, then flag + quitAndInstall(false, true)', async () => {
    const { svc, confirmMock, saveMock, quitAndInstallMock } = await setupDownloadedService();
    confirmMock.mockResolvedValue(true);

    await svc.autoUpdateService.installUpdate();

    expect(confirmMock).toHaveBeenCalledTimes(1);
    expect(saveMock).toHaveBeenCalledTimes(1);
    expect(confirmMock.mock.invocationCallOrder[0]).toBeLessThan(
      saveMock.mock.invocationCallOrder[0],
    );
    expect(svc.isInstallingUpdate).toBe(true);
    expect(quitAndInstallMock).toHaveBeenCalledWith(false, true);
  });

  it('throws without prompting when no update is downloaded', async () => {
    const svc = await import('../auto-update.service');
    const { confirmQuitWithRunningAgents } = await import('../../../../main/quit-confirmation');

    await expect(svc.autoUpdateService.installUpdate()).rejects.toThrow(
      'No update downloaded to install',
    );
    expect(confirmQuitWithRunningAgents).not.toHaveBeenCalled();
  });
});
