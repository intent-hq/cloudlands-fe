/**
 * Update checks while an artifact is downloaded (auto-supersede).
 *
 * A 'downloaded' state must not stop update checks: automatic checks
 * (startup / periodic / focus-resume) and manual checks keep querying the
 * feed so a newer version can supersede the pending artifact through the
 * normal flow (update-available → autoDownload → update-downloaded). When
 * the feed re-offers the SAME version as the downloaded artifact, the
 * user-visible state must not regress to 'checking'/'available' (a new
 * Download click) — electron-updater re-resolves from its downloaded-file
 * cache and the state lands back at 'downloaded'. Only 'downloading' still
 * skips checks, and the watchdog applies to these checks like any other.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import type { Mock } from 'vitest';

// Match the service's private timings.
const STARTUP_CHECK_DELAY_MS = 10_000;
const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;
const UPDATE_CHECK_TIMEOUT_MS = 30_000;

// Live windows returned by the mocked BrowserWindow.getAllWindows() — the
// service broadcasts renderer notifications to every live window.
const liveWindows: unknown[] = [];

// Mock Electron before importing the service
vi.mock('electron', () => ({
  app: {
    getPath: () => testUserDataPath,
    getVersion: () => '2.0.0',
    on: vi.fn(),
    off: vi.fn(),
  },
  BrowserWindow: { getAllWindows: () => liveWindows },
  powerMonitor: {
    on: vi.fn(),
    off: vi.fn(),
  },
}));

const updaterHandlers: Record<string, (arg?: unknown) => void> = {};

vi.mock('electron-updater', () => {
  class MockCancellationToken {
    cancelled = false;
    cancel = vi.fn(() => {
      this.cancelled = true;
    });
  }
  return {
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
      CancellationToken: MockCancellationToken,
    },
  };
});

let testUserDataPath: string;

type RendererWindow = {
  isDestroyed: () => boolean;
  webContents: { isDestroyed: () => boolean; getURL: () => string; send: Mock };
};

function makeRendererWindow(): RendererWindow {
  return {
    isDestroyed: () => false,
    webContents: {
      isDestroyed: () => false,
      getURL: () => 'app://workspaces/workspace/x',
      send: vi.fn(),
    },
  };
}

/**
 * Import a fresh service instance and initialize it. The startup (10s) and
 * periodic (hourly) timers stay armed on the fake clock so tests can drive
 * the AUTOMATIC check paths deterministically.
 */
async function setupService() {
  const svc = await import('../auto-update.service');
  const { default: electronUpdater } = await import('electron-updater');

  const mockWindow = makeRendererWindow();
  liveWindows.push(mockWindow);
  await svc.autoUpdateService.initialize();

  return {
    service: svc.autoUpdateService,
    mockWindow,
    checkMock: electronUpdater.autoUpdater.checkForUpdates as Mock,
    updater: electronUpdater.autoUpdater,
  };
}

/** Drive the service into 'downloaded' via updater events. */
function landDownloaded(version: string) {
  updaterHandlers['update-available']({ version, releaseDate: '2026-01-01' });
  updaterHandlers['update-downloaded']({ version });
}

/**
 * Record the status carried by every 'auto-update:status-changed' broadcast
 * AT SEND TIME. The service broadcasts its mutable state object, so
 * asserting on the recorded call args after the fact would only ever see
 * the final status on every call.
 */
function trackBroadcastStatuses(mockWindow: RendererWindow): string[] {
  const statuses: string[] = [];
  mockWindow.webContents.send.mockImplementation((channel: string, data?: unknown) => {
    if (channel === 'auto-update:status-changed') {
      statuses.push((data as { status: string }).status);
    }
  });
  return statuses;
}

/** checkForUpdates mock: the feed answers `version`, autoDownload lands it. */
function feedResolvesTo(checkMock: Mock, version: string, { withProgress = false } = {}) {
  checkMock.mockImplementation(async () => {
    updaterHandlers['checking-for-update']();
    updaterHandlers['update-available']({ version, releaseDate: '2026-01-01' });
    if (withProgress) {
      updaterHandlers['download-progress']({
        percent: 50,
        bytesPerSecond: 1000,
        transferred: 50,
        total: 100,
      });
    }
    updaterHandlers['update-downloaded']({ version });
    return { updateInfo: { version } } as never;
  });
}

beforeEach(async () => {
  testUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'auto-update-downloaded-'));
  liveWindows.length = 0;
  vi.clearAllMocks();
  vi.resetModules();
  vi.useFakeTimers();
});

afterEach(async () => {
  vi.clearAllTimers();
  vi.useRealTimers();
  const { autoUpdateService } = await import('../auto-update.service');
  autoUpdateService.cleanup();
  const { __drainLocalPrefsWriteChainForTesting } = await import('../../../../main/local-prefs');
  await __drainLocalPrefsWriteChainForTesting();
  await fs.rm(testUserDataPath, { recursive: true, force: true });
});

describe('automatic checks while an update is downloaded', () => {
  it('startup and periodic checks query the feed while status is downloaded (regression)', async () => {
    const { service, checkMock } = await setupService();
    feedResolvesTo(checkMock, '2.1.0');
    landDownloaded('2.1.0');
    expect(service.getState().status).toBe('downloaded');

    // The delayed startup check (10s) must not be skipped by 'downloaded'.
    await vi.advanceTimersByTimeAsync(STARTUP_CHECK_DELAY_MS);
    expect(checkMock).toHaveBeenCalledTimes(1);

    // Neither must the hourly periodic check.
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS);
    expect(checkMock).toHaveBeenCalledTimes(2);
    expect(service.getState().status).toBe('downloaded');
  });

  it('a newer feed version supersedes the pending artifact and lands back at downloaded', async () => {
    const { service, checkMock, updater } = await setupService();
    landDownloaded('2.1.0');
    expect(service.getState().updateInfo?.version).toBe('2.1.0');

    feedResolvesTo(checkMock, '2.2.0', { withProgress: true });
    await vi.advanceTimersByTimeAsync(STARTUP_CHECK_DELAY_MS);

    expect(checkMock).toHaveBeenCalledTimes(1);
    const state = service.getState();
    expect(state.status).toBe('downloaded');
    expect(state.updateInfo?.version).toBe('2.2.0');
    // The fresh artifact re-armed quit-install.
    expect(updater.autoInstallOnAppQuit).toBe(true);
  });

  it('the same feed version does not regress the user-visible state', async () => {
    const { service, checkMock, mockWindow } = await setupService();
    landDownloaded('2.1.0');
    const statuses = trackBroadcastStatuses(mockWindow);

    // Fast cache re-resolve: same version, 'update-downloaded' fires again.
    feedResolvesTo(checkMock, '2.1.0');
    await vi.advanceTimersByTimeAsync(STARTUP_CHECK_DELAY_MS);

    expect(checkMock).toHaveBeenCalledTimes(1);
    expect(service.getState().status).toBe('downloaded');
    expect(service.getState().updateInfo?.version).toBe('2.1.0');
    // No intermediate broadcast regressed the UI away from 'downloaded'.
    expect(statuses).not.toContain('checking');
    expect(statuses).not.toContain('available');
    expect(statuses.every((s) => s === 'downloaded')).toBe(true);
  });

  it("'downloading' still skips automatic checks", async () => {
    const { service, checkMock } = await setupService();
    updaterHandlers['update-available']({ version: '2.1.0', releaseDate: '2026-01-01' });
    updaterHandlers['download-progress']({
      percent: 10,
      bytesPerSecond: 1000,
      transferred: 10,
      total: 100,
    });
    expect(service.getState().status).toBe('downloading');

    await vi.advanceTimersByTimeAsync(STARTUP_CHECK_DELAY_MS + UPDATE_CHECK_INTERVAL_MS);
    expect(checkMock).not.toHaveBeenCalled();
  });

  it('the watchdog still applies: a hung check while downloaded reaches a terminal error', async () => {
    const { service, checkMock } = await setupService();
    // Drop the startup/periodic timers so only the watchdog we arm remains.
    vi.clearAllTimers();
    landDownloaded('2.1.0');
    checkMock.mockImplementation(() => new Promise(() => {}));

    void service.checkForUpdatesManual();
    expect(checkMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_TIMEOUT_MS);
    expect(service.getState().status).toBe('error');
  });
});

describe('manual checks while an update is downloaded', () => {
  it('queries the feed (no early-return) and supersedes on a newer version', async () => {
    const { service, checkMock } = await setupService();
    landDownloaded('2.1.0');

    feedResolvesTo(checkMock, '2.2.0', { withProgress: true });
    await service.checkForUpdatesManual();

    expect(checkMock).toHaveBeenCalledTimes(1);
    const state = service.getState();
    expect(state.status).toBe('downloaded');
    expect(state.updateInfo?.version).toBe('2.2.0');
  });

  it('same version still latest: ends downloaded, no up-to-date toast, no Download-prompt regression', async () => {
    const { service, checkMock, mockWindow } = await setupService();
    landDownloaded('2.1.0');
    const statuses = trackBroadcastStatuses(mockWindow);

    feedResolvesTo(checkMock, '2.1.0');
    await service.checkForUpdatesManual();

    expect(checkMock).toHaveBeenCalledTimes(1);
    expect(service.getState().status).toBe('downloaded');
    // No misleading "up to date" toast — the artifact is ready to install.
    expect(mockWindow.webContents.send).not.toHaveBeenCalledWith(
      'auto-update:up-to-date',
      expect.anything(),
    );
    // No regression to a state requiring a new Download click.
    expect(statuses).not.toContain('checking');
    expect(statuses).not.toContain('available');
    expect(service.getState().updateInfo?.version).toBe('2.1.0');
  });
});

describe('feed rollback while an update is downloaded', () => {
  /** checkForUpdates mock: the feed no longer offers any update. */
  function feedAnswersNotAvailable(checkMock: Mock) {
    checkMock.mockImplementation(async () => {
      updaterHandlers['checking-for-update']();
      updaterHandlers['update-not-available']({ version: '2.0.0' });
      return { updateInfo: { version: '2.0.0' } } as never;
    });
  }

  it('disarms quit-install, clears updateInfo, and ends not-available (regression)', async () => {
    const { service, checkMock, updater } = await setupService();
    landDownloaded('2.1.0');
    expect(updater.autoInstallOnAppQuit).toBe(true);
    expect(service.getState().updateInfo?.version).toBe('2.1.0');

    // The release was pulled from the feed: the startup check answers
    // 'update-not-available' while the 2.1.0 artifact is still armed.
    feedAnswersNotAvailable(checkMock);
    await vi.advanceTimersByTimeAsync(STARTUP_CHECK_DELAY_MS);

    expect(checkMock).toHaveBeenCalledTimes(1);
    const state = service.getState();
    expect(state.status).toBe('not-available');
    expect(state.updateInfo).toBeNull();
    // The now-unpublished artifact must not install on quit.
    expect(updater.autoInstallOnAppQuit).toBe(false);
  });

  it('a manual check that detects the rollback shows a truthful up-to-date toast', async () => {
    const { service, checkMock, mockWindow, updater } = await setupService();
    landDownloaded('2.1.0');

    feedAnswersNotAvailable(checkMock);
    await service.checkForUpdatesManual();

    // No pending-install UI remains, so "up to date" is correct.
    expect(mockWindow.webContents.send).toHaveBeenCalledWith('auto-update:up-to-date', {
      version: '2.0.0',
    });
    expect(service.getState().status).toBe('not-available');
    expect(service.getState().updateInfo).toBeNull();
    expect(updater.autoInstallOnAppQuit).toBe(false);
  });

  it('a later check that finds an update again re-arms through the normal flow', async () => {
    const { service, checkMock, updater } = await setupService();
    landDownloaded('2.1.0');

    feedAnswersNotAvailable(checkMock);
    await service.checkForUpdatesManual();
    expect(service.getState().status).toBe('not-available');
    expect(updater.autoInstallOnAppQuit).toBe(false);

    // The release is re-published (or a newer one lands): the normal
    // available → download → downloaded flow re-arms quit-install.
    feedResolvesTo(checkMock, '2.1.1', { withProgress: true });
    await service.checkForUpdatesManual();

    const state = service.getState();
    expect(state.status).toBe('downloaded');
    expect(state.updateInfo?.version).toBe('2.1.1');
    expect(updater.autoInstallOnAppQuit).toBe(true);
  });
});
