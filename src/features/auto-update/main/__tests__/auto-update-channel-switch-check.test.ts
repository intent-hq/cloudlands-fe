/**
 * Channel-switch immediate update check tests.
 *
 * A user-initiated channel switch (SET_CHANNEL IPC) must fire exactly one
 * immediate update check with manual-check feedback, while initialize()'s
 * internal setChannel call must not trigger an early duplicate check, and a
 * switch during an active download must not start a check at all.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import type { Mock } from 'vitest';

// Live windows returned by the BrowserWindow.getAllWindows mock; renderer
// notifications are broadcast to these (see auto-update-broadcast.ts).
let mockWindows: unknown[] = [];

// Mock Electron before importing the service/IPC modules
vi.mock('electron', () => ({
  app: {
    getPath: () => testUserDataPath,
    getVersion: () => '2.0.0',
    on: vi.fn(),
    off: vi.fn(),
  },
  BrowserWindow: {
    getAllWindows: () => mockWindows,
  },
  ipcMain: {
    handle: vi.fn(),
  },
  powerMonitor: {
    on: vi.fn(),
    off: vi.fn(),
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

let testUserDataPath: string;

/** Register IPC handlers, initialize the service, and return test seams. */
async function setup() {
  const { ipcMain } = await import('electron');
  const { default: electronUpdater } = await import('electron-updater');
  const ipc = await import('../auto-update.ipc');
  const { autoUpdateService } = await import('../auto-update.service');

  ipc.setupAutoUpdateIPC();
  const handleMock = ipcMain.handle as unknown as Mock;
  const setChannelHandler = handleMock.mock.calls.find(
    ([channel]) => channel === 'auto-update:set-channel',
  )?.[1] as (event: unknown, data: unknown) => Promise<{ success: boolean }>;
  expect(setChannelHandler).toBeTypeOf('function');

  const mockWindow = {
    isDestroyed: () => false,
    webContents: {
      send: vi.fn(),
      isDestroyed: () => false,
      getURL: () => 'http://localhost:5173/',
    },
  };
  mockWindows = [mockWindow];
  await autoUpdateService.initialize();

  const checkMock = electronUpdater.autoUpdater.checkForUpdates as unknown as Mock;
  const feedMock = electronUpdater.autoUpdater.setFeedURL as unknown as Mock;
  return { setChannelHandler, checkMock, feedMock, mockWindow };
}

beforeEach(async () => {
  testUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'auto-update-test-'));
  mockWindows = [];
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

describe('channel-switch immediate update check', () => {
  it('user SET_CHANNEL fires exactly one immediate check with manual-check feedback', async () => {
    const { setChannelHandler, checkMock, mockWindow } = await setup();
    expect(checkMock).not.toHaveBeenCalled();

    checkMock.mockReturnValue(new Promise(() => {}));
    const result = await setChannelHandler({}, { channel: 'beta' });
    expect(result.success).toBe(true);

    await vi.waitFor(() => expect(checkMock).toHaveBeenCalledTimes(1));

    // Manual-check semantics: a terminal "no update" answer surfaces the
    // user-facing "up to date" notification.
    updaterHandlers['update-not-available']({ version: '2.0.0' });
    expect(mockWindow.webContents.send).toHaveBeenCalledWith('auto-update:up-to-date', {
      version: '2.0.0',
    });
    expect(checkMock).toHaveBeenCalledTimes(1);
  });

  it('initialize()-time setChannel does not trigger an early check', async () => {
    const { checkMock } = await setup();

    // initialize() re-points the feed via its internal setChannel call; the
    // only startup check is the intentionally delayed one (10s timer).
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(checkMock).not.toHaveBeenCalled();
  });

  it('SET_CHANNEL during an active download does not start a check', async () => {
    const { setChannelHandler, checkMock } = await setup();

    updaterHandlers['download-progress']({
      percent: 42,
      bytesPerSecond: 1000,
      transferred: 42,
      total: 100,
    });

    const result = await setChannelHandler({}, { channel: 'alpha' });
    expect(result.success).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(checkMock).not.toHaveBeenCalled();
  });

  it('SET_CHANNEL during an in-flight check queues one fresh check against the new feed', async () => {
    const { setChannelHandler, checkMock, feedMock, mockWindow } = await setup();

    // A startup/periodic/focus check is in flight against the previous feed.
    updaterHandlers['checking-for-update']();

    checkMock.mockReturnValue(new Promise(() => {}));
    // Two rapid switches while the check is in flight still queue only one recheck.
    await setChannelHandler({}, { channel: 'beta' });
    const result = await setChannelHandler({}, { channel: 'alpha' });
    expect(result.success).toBe(true);

    // No new updater check while the old-feed request is still in flight.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(checkMock).not.toHaveBeenCalled();

    // The in-flight (old feed) check settles: no manual "up to date" toast for
    // the previous feed's answer...
    updaterHandlers['update-not-available']({ version: '2.0.0' });
    expect(mockWindow.webContents.send).not.toHaveBeenCalledWith(
      'auto-update:up-to-date',
      expect.anything(),
    );

    // ...and exactly one fresh check fires, after the feed was re-pointed.
    await vi.waitFor(() => expect(checkMock).toHaveBeenCalledTimes(1));
    expect(feedMock).toHaveBeenLastCalledWith({
      provider: 'generic',
      url: expect.stringMatching(/\/alpha$/),
    });

    // The recheck carries manual feedback for the new feed's answer.
    updaterHandlers['update-not-available']({ version: '2.0.0' });
    expect(mockWindow.webContents.send).toHaveBeenCalledWith('auto-update:up-to-date', {
      version: '2.0.0',
    });
    // Settled recheck does not re-queue itself.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(checkMock).toHaveBeenCalledTimes(1);
  });

  it('a queued channel-switch recheck also fires when the in-flight check settles with an error', async () => {
    const { setChannelHandler, checkMock } = await setup();

    updaterHandlers['checking-for-update']();
    checkMock.mockReturnValue(new Promise(() => {}));
    await setChannelHandler({}, { channel: 'beta' });
    expect(checkMock).not.toHaveBeenCalled();

    updaterHandlers['error'](new Error('network down'));

    await vi.waitFor(() => expect(checkMock).toHaveBeenCalledTimes(1));
  });
});
