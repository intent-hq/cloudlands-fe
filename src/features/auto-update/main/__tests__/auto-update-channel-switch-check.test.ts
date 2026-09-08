/**
 * Channel-switch immediate update check tests.
 *
 * A user-initiated channel switch (SET_CHANNEL IPC) must fire exactly one
 * immediate update check with manual-check feedback, while initialize()'s
 * internal setChannel call must not trigger an early duplicate check. A
 * switch while an update is available/downloaded/downloading must not keep
 * the old feed's artifact (intent-hq/monorepo#2270): the pending quit-install
 * is neutralized, an in-flight download is cancelled (settled via
 * electron-updater's 'update-cancelled' event, never 'error'), and a fresh
 * check runs against the new feed — including when the old-feed outcome only
 * lands after a switch made during the 'checking' state.
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

interface MockToken {
  cancelled: boolean;
  cancel: Mock;
}

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

/**
 * Deterministically drain async work that is already scheduled — promise
 * continuations, queueMicrotask callbacks (the queued channel-switch recheck
 * release), and fire-and-forget chains kicked off by an awaited IPC handler —
 * without a wall-clock wait. Each setImmediate turn runs after the microtasks
 * and IO callbacks queued before it, so a handful of turns exhausts every
 * pending continuation regardless of machine load (intent-hq/monorepo#2509).
 */
async function drainAsyncWork(turns = 5): Promise<void> {
  for (let i = 0; i < turns; i++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

/** Register IPC handlers, initialize the service, and return test seams. */
async function setup({ initialize = true }: { initialize?: boolean } = {}) {
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
  if (initialize) {
    // initialize() arms real-clock timers — the untracked 10s delayed startup
    // check and the hourly periodic interval — that outlive the test:
    // cleanup() cannot clear the startup timeout, afterEach's
    // vi.clearAllTimers() is a no-op on real timers, and vi.resetModules()
    // does not reset the mock registry, so ALL tests in this file share one
    // checkForUpdates mock. Under CI load the file outlives 10s and a leaked
    // startup timer from an earlier test fires mid-later-test, recording a
    // stray call on the shared mock (intent-hq/monorepo#2509). Arm them on a
    // scoped fake clock and discard them deterministically instead — no test
    // exercises those timers.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    try {
      await autoUpdateService.initialize();
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  }

  const checkMock = electronUpdater.autoUpdater.checkForUpdates as unknown as Mock;
  const feedMock = electronUpdater.autoUpdater.setFeedURL as unknown as Mock;
  const downloadMock = electronUpdater.autoUpdater.downloadUpdate as unknown as Mock;
  const updater = electronUpdater.autoUpdater;
  return {
    setChannelHandler,
    checkMock,
    feedMock,
    downloadMock,
    updater,
    service: autoUpdateService,
    mockWindow,
  };
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
  // Disarm the finished test's surviving real-clock timers — same leak class
  // as the startup timer discarded in setup(): most tests end with their
  // check pending forever, leaving the 30s watchdog (startCheckTimeout)
  // armed; past 30s of file runtime it would fire on its stale instance and
  // broadcast a stray error status to the CURRENT test's window via the
  // shared electron mock. resetModules() runs in beforeEach, so this import
  // still resolves the instance this test used.
  const { autoUpdateService } = await import('../auto-update.service');
  autoUpdateService.cleanup();
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

    // The toast surface is made visible up front (mirrors the menu sites) so
    // the "Checking…" feedback appears immediately and a failed check has a
    // visible surface — a 'checking' status broadcast alone never shows it.
    await vi.waitFor(() =>
      expect(mockWindow.webContents.send).toHaveBeenCalledWith('auto-update:show-toast'),
    );
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
    // only startup check is the intentionally delayed one (10s timer, armed
    // on setup()'s scoped fake clock and discarded there).
    await drainAsyncWork();
    expect(checkMock).not.toHaveBeenCalled();
  });

  it('SET_CHANNEL during a download with no held token still resets and rechecks the new feed', async () => {
    const { setChannelHandler, checkMock, service, updater } = await setup();

    updaterHandlers['download-progress']({
      percent: 42,
      bytesPerSecond: 1000,
      transferred: 42,
      total: 100,
    });
    expect(service.getState().status).toBe('downloading');

    checkMock.mockReturnValue(new Promise(() => {}));
    const result = await setChannelHandler({}, { channel: 'alpha' });
    expect(result.success).toBe(true);

    // No token to cancel, but the stale-feed download state is still reset
    // and the new feed is checked; quit-install stays neutralized until a
    // download for the new channel completes.
    expect(updater.autoInstallOnAppQuit).toBe(false);
    await vi.waitFor(() => expect(checkMock).toHaveBeenCalledTimes(1));
  });

  it('SET_CHANNEL with an update downloaded neutralizes quit-install, resets, and rechecks the new feed', async () => {
    const { setChannelHandler, checkMock, feedMock, service, updater } = await setup();
    expect(updater.autoInstallOnAppQuit).toBe(true); // initialize() enables it

    updaterHandlers['update-available']({ version: '2.1.0', releaseDate: '2026-01-01' });
    updaterHandlers['update-downloaded']({ version: '2.1.0' });
    expect(service.getState().status).toBe('downloaded');

    checkMock.mockReturnValue(new Promise(() => {}));
    const result = await setChannelHandler({}, { channel: 'beta' });
    expect(result.success).toBe(true);

    // The stale artifact cannot install on quit while the revalidation runs...
    expect(updater.autoInstallOnAppQuit).toBe(false);
    // ...state was reset so the fresh check actually ran against the new feed.
    expect(service.getState().updateInfo).toBeNull();
    await vi.waitFor(() => expect(checkMock).toHaveBeenCalledTimes(1));
    expect(feedMock).toHaveBeenLastCalledWith({
      provider: 'generic',
      url: expect.stringMatching(/\/beta$/),
    });

    // The new feed resolves to the same version (electron-updater re-resolves
    // from its downloaded-file cache): quit-install is re-enabled.
    updaterHandlers['update-available']({ version: '2.1.0', releaseDate: '2026-01-01' });
    updaterHandlers['update-downloaded']({ version: '2.1.0' });
    expect(service.getState().status).toBe('downloaded');
    expect(updater.autoInstallOnAppQuit).toBe(true);
  });

  it('SET_CHANNEL during a manual download cancels the token, suppresses the cancellation error, and rechecks', async () => {
    const { setChannelHandler, checkMock, downloadMock, service, updater, mockWindow } =
      await setup();

    updaterHandlers['update-available']({ version: '2.1.0', releaseDate: '2026-01-01' });
    let rejectDownload!: (e: Error) => void;
    downloadMock.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectDownload = reject;
        }),
    );
    const downloadPromise = service.downloadUpdate();
    expect(service.getState().status).toBe('downloading');
    const token = downloadMock.mock.calls[0][0] as MockToken;
    expect(token).toBeDefined();

    checkMock.mockReturnValue(new Promise(() => {}));
    const result = await setChannelHandler({}, { channel: 'beta' });
    expect(result.success).toBe(true);

    // In-flight download cancelled and quit-install neutralized; the fresh
    // check runs against the new feed.
    expect(token.cancel).toHaveBeenCalledTimes(1);
    expect(updater.autoInstallOnAppQuit).toBe(false);
    await vi.waitFor(() => expect(checkMock).toHaveBeenCalledTimes(1));

    // The cancellation rejects the download promise with CancellationError
    // and electron-updater emits 'update-cancelled' (never 'error'): the
    // DOWNLOAD caller resolves and no error status/toast appears.
    const cancellation = new Error('cancelled');
    rejectDownload(cancellation);
    await expect(downloadPromise).resolves.toBeUndefined();
    updaterHandlers['update-cancelled']({ version: '2.1.0' });
    expect(service.getState().status).not.toBe('error');
    expect(service.getState().error).toBeNull();
    expect(mockWindow.webContents.send).not.toHaveBeenCalledWith(
      'auto-update:status-changed',
      expect.objectContaining({ status: 'error' }),
    );
  });

  it("a genuine error after the cancellation settled via 'update-cancelled' still surfaces", async () => {
    const { setChannelHandler, checkMock, downloadMock, service } = await setup();

    updaterHandlers['update-available']({ version: '2.1.0', releaseDate: '2026-01-01' });
    let rejectDownload!: (e: Error) => void;
    downloadMock.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectDownload = reject;
        }),
    );
    const downloadPromise = service.downloadUpdate();

    checkMock.mockReturnValue(new Promise(() => {}));
    await setChannelHandler({}, { channel: 'beta' });

    // electron-updater 6.x settles the cancellation via the promise
    // rejection + 'update-cancelled'; the 'error' event is never dispatched
    // for a CancellationError.
    rejectDownload(new Error('cancelled'));
    await expect(downloadPromise).resolves.toBeUndefined();
    updaterHandlers['update-cancelled']({ version: '2.1.0' });

    // Regression (PR #1162 review): the expecting-cancel flag used to be
    // cleared only by the 'error' event, so it stayed latched and swallowed
    // the fresh check's first genuine error.
    updaterHandlers['error'](new Error('network down'));
    expect(service.getState().status).toBe('error');
    expect(service.getState().error).toBe('network down');
  });

  it("an unexpected 'update-cancelled' during a download resets to idle instead of sticking in downloading", async () => {
    const { service } = await setup();

    updaterHandlers['update-available']({ version: '2.1.0', releaseDate: '2026-01-01' });
    updaterHandlers['download-progress']({
      percent: 10,
      bytesPerSecond: 1000,
      transferred: 10,
      total: 100,
    });
    expect(service.getState().status).toBe('downloading');

    updaterHandlers['update-cancelled']({ version: '2.1.0' });
    expect(service.getState().status).toBe('idle');
  });

  it('SET_CHANNEL during an autoDownload cancels the token captured from the check result', async () => {
    const { setChannelHandler, checkMock, service } = await setup();
    const { default: electronUpdater } = await import('electron-updater');
    const TokenCtor = (electronUpdater as unknown as { CancellationToken: new () => MockToken })
      .CancellationToken;

    // autoDownload path: the check result carries the token for the download
    // electron-updater started on its own. 'update-available' fires inside
    // doCheckForUpdates() before the checkForUpdates() promise settles, so
    // the check session is closed by the time the result lands.
    const token = new TokenCtor();
    checkMock.mockImplementation(async () => {
      updaterHandlers['update-available']({ version: '2.1.0', releaseDate: '2026-01-01' });
      return { updateInfo: { version: '2.1.0' }, cancellationToken: token };
    });
    await service.checkForUpdatesManual();
    updaterHandlers['download-progress']({
      percent: 10,
      bytesPerSecond: 1000,
      transferred: 10,
      total: 100,
    });
    expect(service.getState().status).toBe('downloading');

    checkMock.mockReturnValue(new Promise(() => {}));
    await setChannelHandler({}, { channel: 'alpha' });

    expect(token.cancel).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(checkMock).toHaveBeenCalledTimes(2));
  });

  it("SET_CHANNEL in the 'available' window (autoDownload started, no progress yet) cancels the old-feed download", async () => {
    const { setChannelHandler, checkMock, service, updater } = await setup();
    const { default: electronUpdater } = await import('electron-updater');
    const TokenCtor = (electronUpdater as unknown as { CancellationToken: new () => MockToken })
      .CancellationToken;

    // autoDownload starts inside checkForUpdates() the moment
    // 'update-available' fires, but the service only enters 'downloading' on
    // the first 'download-progress' event — the switch lands in between.
    const token = new TokenCtor();
    let rejectDownloadPromise!: (e: Error) => void;
    const downloadPromise = new Promise((_resolve, reject) => {
      rejectDownloadPromise = reject;
    });
    checkMock.mockImplementation(async () => {
      updaterHandlers['update-available']({ version: '2.1.0', releaseDate: '2026-01-01' });
      return { updateInfo: { version: '2.1.0' }, cancellationToken: token, downloadPromise };
    });
    await service.checkForUpdatesManual();
    expect(service.getState().status).toBe('available');

    checkMock.mockReturnValue(new Promise(() => {}));
    await setChannelHandler({}, { channel: 'beta' });

    // Regression (PR #1162 review): the old-feed download used to survive
    // this window — nothing was cancelled, quit-install stayed armed, and
    // electron-updater's downloadPromise dedup would hand the fresh check
    // the OLD download.
    expect(token.cancel).toHaveBeenCalledTimes(1);
    expect(updater.autoInstallOnAppQuit).toBe(false);
    await vi.waitFor(() => expect(checkMock).toHaveBeenCalledTimes(2));

    // The cancel rejects the result's downloadPromise; the service attached
    // a handler, so no unhandled rejection reaches the process (vitest
    // fails the test on one).
    rejectDownloadPromise(new Error('cancelled'));
    await drainAsyncWork();
  });

  it("a token from a check that settled as 'downloaded' before its result landed is not re-stored", async () => {
    const { setChannelHandler, checkMock, service } = await setup();
    const { default: electronUpdater } = await import('electron-updater');
    const TokenCtor = (electronUpdater as unknown as { CancellationToken: new () => MockToken })
      .CancellationToken;

    // Fast cache re-resolve: 'update-downloaded' fires before the
    // checkForUpdates() promise settles, so the terminal event has already
    // consumed (cleared) the token by the time the result carries it back.
    const token = new TokenCtor();
    let resolveCheck!: (result: unknown) => void;
    checkMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCheck = resolve;
        }),
    );
    const check = service.checkForUpdatesManual();
    updaterHandlers['update-available']({ version: '2.1.0', releaseDate: '2026-01-01' });
    updaterHandlers['update-downloaded']({ version: '2.1.0' });
    resolveCheck({ updateInfo: { version: '2.1.0' }, cancellationToken: token });
    await check;
    expect(service.getState().status).toBe('downloaded');

    // A later channel switch must not cancel the consumed token.
    checkMock.mockReturnValue(new Promise(() => {}));
    await setChannelHandler({}, { channel: 'beta' });
    expect(token.cancel).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(checkMock).toHaveBeenCalledTimes(2));
  });

  it('setChannel() disarms quit-install synchronously before its first await', async () => {
    const { service, updater } = await setup();

    updaterHandlers['update-available']({ version: '2.1.0', releaseDate: '2026-01-01' });
    updaterHandlers['update-downloaded']({ version: '2.1.0' });
    expect(updater.autoInstallOnAppQuit).toBe(true);

    // A quit landing while SET_CHANNEL awaits the prefs write must not
    // install the stale artifact: the disarm happens before the first await.
    const pending = service.setChannel('beta');
    expect(updater.autoInstallOnAppQuit).toBe(false);
    await pending;
  });

  it('a terminal event clears the stored token so a stale token is never cancelled later', async () => {
    const { setChannelHandler, checkMock, downloadMock, service } = await setup();

    updaterHandlers['update-available']({ version: '2.1.0', releaseDate: '2026-01-01' });
    downloadMock.mockReturnValue(new Promise(() => {}));
    void service.downloadUpdate();
    const token = downloadMock.mock.calls[0][0] as MockToken;
    updaterHandlers['update-downloaded']({ version: '2.1.0' });

    // A later download (no fresh token held) must not cancel the consumed one.
    updaterHandlers['download-progress']({
      percent: 1,
      bytesPerSecond: 1,
      transferred: 1,
      total: 100,
    });
    checkMock.mockReturnValue(new Promise(() => {}));
    await setChannelHandler({}, { channel: 'beta' });

    expect(token.cancel).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(checkMock).toHaveBeenCalledTimes(1));
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
    await drainAsyncWork();
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
    await drainAsyncWork();
    expect(checkMock).toHaveBeenCalledTimes(1);
  });

  it('switch during checking: an old-feed update outcome is neutralized and the new feed is still checked', async () => {
    const { setChannelHandler, checkMock, feedMock, service, updater } = await setup();
    const { default: electronUpdater } = await import('electron-updater');
    const TokenCtor = (electronUpdater as unknown as { CancellationToken: new () => MockToken })
      .CancellationToken;

    // A check is in flight against the previous feed at the service level.
    const oldToken = new TokenCtor();
    let resolveOldCheck!: (result: unknown) => void;
    checkMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveOldCheck = resolve;
        }),
    );
    const oldCheck = service.checkForUpdatesManual();
    updaterHandlers['checking-for-update']();

    await setChannelHandler({}, { channel: 'beta' });
    expect(checkMock).toHaveBeenCalledTimes(1); // recheck queued, not started

    // The OLD feed's check finds an update: autoDownload starts the old
    // channel's download and progress lands before the queued recheck runs;
    // the check result (carrying the download's token) resolves last, as in
    // electron-updater, where 'update-available' fires inside
    // doCheckForUpdates() before the checkForUpdates() promise settles.
    updaterHandlers['update-available']({ version: '9.9.9', releaseDate: '2026-01-01' });
    updaterHandlers['download-progress']({
      percent: 5,
      bytesPerSecond: 1,
      transferred: 5,
      total: 100,
    });
    expect(service.getState().status).toBe('downloading');
    resolveOldCheck({ updateInfo: { version: '9.9.9' }, cancellationToken: oldToken });
    await oldCheck;

    // Regression (PR #1162 review): the queued recheck used to hit
    // checkForUpdatesManual()'s downloading early-return, adopting the old
    // feed's artifact and never querying the new feed — and the late-captured
    // token was stored, never cancelled. Both the cancel + disarm +
    // reset-then-fresh-check treatment must apply.
    await vi.waitFor(() => expect(checkMock).toHaveBeenCalledTimes(2));
    expect(oldToken.cancel).toHaveBeenCalledTimes(1);
    expect(updater.autoInstallOnAppQuit).toBe(false);
    expect(service.getState().updateInfo).toBeNull();
    expect(feedMock).toHaveBeenLastCalledWith({
      provider: 'generic',
      url: expect.stringMatching(/\/beta$/),
    });
  });

  it("switch during a check running while 'downloaded' queues the recheck instead of racing a deduped check", async () => {
    const { setChannelHandler, checkMock, feedMock, service, updater } = await setup();
    const { default: electronUpdater } = await import('electron-updater');
    const TokenCtor = (electronUpdater as unknown as { CancellationToken: new () => MockToken })
      .CancellationToken;

    // An artifact is downloaded and armed.
    updaterHandlers['update-available']({ version: '2.1.0', releaseDate: '2026-01-01' });
    updaterHandlers['update-downloaded']({ version: '2.1.0' });
    expect(service.getState().status).toBe('downloaded');
    expect(updater.autoInstallOnAppQuit).toBe(true);

    // A check is in flight against the previous feed. The 'checking' status
    // broadcast is suppressed while 'downloaded', so status never flips.
    const oldToken = new TokenCtor();
    let resolveOldCheck!: (result: unknown) => void;
    checkMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveOldCheck = resolve;
        }),
    );
    const oldCheck = service.checkForUpdatesManual();
    updaterHandlers['checking-for-update']();
    expect(service.getState().status).toBe('downloaded');

    await setChannelHandler({}, { channel: 'beta' });

    // Regression (PR #1482 review): the queue gate tested
    // `status === 'checking'`, which a downloaded-state check never sets, so
    // the switch ran an immediate "fresh" check that electron-updater would
    // dedup onto the still-in-flight old-feed request — the new feed was
    // never actually queried.
    await drainAsyncWork();
    expect(checkMock).toHaveBeenCalledTimes(1); // recheck queued, not started

    // The old feed re-offers the already-downloaded version — the terminal
    // outcome that keeps 'downloaded' without any status change — then the
    // check result lands, carrying the autoDownload token.
    updaterHandlers['update-available']({ version: '2.1.0', releaseDate: '2026-01-01' });
    resolveOldCheck({ updateInfo: { version: '2.1.0' }, cancellationToken: oldToken });
    await oldCheck;

    // The queued recheck is still released (the same-version early return
    // skips updateStatus()), neutralizes the old-feed artifact, and queries
    // the NEW feed; the late-captured old-feed token is cancelled, not stored.
    await vi.waitFor(() => expect(checkMock).toHaveBeenCalledTimes(2));
    expect(oldToken.cancel).toHaveBeenCalledTimes(1);
    expect(updater.autoInstallOnAppQuit).toBe(false);
    expect(service.getState().updateInfo).toBeNull();
    expect(feedMock).toHaveBeenLastCalledWith({
      provider: 'generic',
      url: expect.stringMatching(/\/beta$/),
    });
  });

  it("switch during a downloaded-state check: an old-feed supersede outcome is neutralized without stranding 'downloading'", async () => {
    const { setChannelHandler, checkMock, service, updater } = await setup();
    const { default: electronUpdater } = await import('electron-updater');
    const TokenCtor = (electronUpdater as unknown as { CancellationToken: new () => MockToken })
      .CancellationToken;

    updaterHandlers['update-available']({ version: '2.1.0', releaseDate: '2026-01-01' });
    updaterHandlers['update-downloaded']({ version: '2.1.0' });
    expect(service.getState().status).toBe('downloaded');

    const oldToken = new TokenCtor();
    let resolveOldCheck!: (result: unknown) => void;
    checkMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveOldCheck = resolve;
        }),
    );
    const oldCheck = service.checkForUpdatesManual();
    updaterHandlers['checking-for-update']();

    await setChannelHandler({}, { channel: 'beta' });
    await drainAsyncWork();
    expect(checkMock).toHaveBeenCalledTimes(1); // recheck queued, not started

    // The OLD feed offers a NEWER version: the handler falls through to
    // 'available', autoDownload starts against the old feed, and a straggling
    // progress event lands before the check result resolves.
    updaterHandlers['update-available']({ version: '9.9.9', releaseDate: '2026-01-01' });
    updaterHandlers['download-progress']({
      percent: 5,
      bytesPerSecond: 1,
      transferred: 5,
      total: 100,
    });
    expect(service.getState().status).toBe('downloading');
    resolveOldCheck({ updateInfo: { version: '9.9.9' }, cancellationToken: oldToken });
    await oldCheck;

    // The queued recheck neutralizes the old-feed outcome (no old-feed
    // updateInfo survives, quit-install stays disarmed) and queries the new
    // feed; the old-feed autoDownload token is cancelled.
    await vi.waitFor(() => expect(checkMock).toHaveBeenCalledTimes(2));
    expect(oldToken.cancel).toHaveBeenCalledTimes(1);
    expect(updater.autoInstallOnAppQuit).toBe(false);
    expect(service.getState().updateInfo).toBeNull();

    // The expected cancellation settles via 'update-cancelled'; its
    // early return must not strand the status at 'downloading' (which would
    // also block all future checks via the 'downloading' skip guard).
    updaterHandlers['update-cancelled']({ version: '9.9.9' });
    expect(service.getState().status).not.toBe('downloading');
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

  it('SET_CHANNEL on an uninitialized service (dev mode) skips both the check and the toast', async () => {
    const { setChannelHandler, checkMock, mockWindow } = await setup({ initialize: false });
    const { autoUpdateService } = await import('../auto-update.service');

    const result = await setChannelHandler({}, { channel: 'beta' });
    expect(result.success).toBe(true);

    await drainAsyncWork();
    // No check → no not-initialized fail-fast error polluting GET_STATE...
    expect(checkMock).not.toHaveBeenCalled();
    expect(autoUpdateService.getState().error).toBeNull();
    // ...and no "Checking…" toast that nothing would ever resolve.
    expect(mockWindow.webContents.send).not.toHaveBeenCalledWith('auto-update:show-toast');
  });
});

describe("'disabled' update channel", () => {
  it("SET_CHANNEL('disabled') persists the pref but never points the feed or checks it", async () => {
    const { setChannelHandler, checkMock, feedMock, mockWindow } = await setup();
    // initialize()'s internal setChannel call reaches setFeedURL only after
    // awaiting the prefs write — let it settle before discarding it, or its
    // late stable feed call lands after mockClear() and fails the assertion.
    const { __drainLocalPrefsWriteChainForTesting } = await import('../../../../main/local-prefs');
    await __drainLocalPrefsWriteChainForTesting();
    await drainAsyncWork();
    feedMock.mockClear(); // discard initialize()'s internal stable feed call

    const result = await setChannelHandler({}, { channel: 'disabled' });
    expect(result.success).toBe(true);

    await drainAsyncWork();
    // There is no /disabled feed and no post-switch check to run — and no
    // "Checking…" toast that nothing would ever resolve.
    expect(feedMock).not.toHaveBeenCalled();
    expect(checkMock).not.toHaveBeenCalled();
    expect(mockWindow.webContents.send).not.toHaveBeenCalledWith('auto-update:show-toast');

    // The preference is persisted like any other channel.
    const prefsPath = path.join(testUserDataPath, 'local-prefs.json');
    await expect
      .poll(async () => JSON.parse(await fs.readFile(prefsPath, 'utf8')).updateChannel, {
        timeout: 2000,
        interval: 50,
      })
      .toBe('disabled');
  });

  it("switching to 'disabled' with an update downloaded disarms quit-install and drops the artifact", async () => {
    const { setChannelHandler, checkMock, service, updater } = await setup();

    updaterHandlers['update-available']({ version: '2.1.0', releaseDate: '2026-01-01' });
    updaterHandlers['update-downloaded']({ version: '2.1.0' });
    expect(service.getState().status).toBe('downloaded');
    expect(updater.autoInstallOnAppQuit).toBe(true);

    await setChannelHandler({}, { channel: 'disabled' });

    expect(updater.autoInstallOnAppQuit).toBe(false);
    expect(service.getState().updateInfo).toBeNull();
    expect(service.getState().status).toBe('idle');
    await drainAsyncWork();
    expect(checkMock).not.toHaveBeenCalled();
  });

  it("switching to 'disabled' mid-download cancels the in-flight download", async () => {
    const { setChannelHandler, downloadMock, service, updater } = await setup();

    updaterHandlers['update-available']({ version: '2.1.0', releaseDate: '2026-01-01' });
    let rejectDownload!: (e: Error) => void;
    downloadMock.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectDownload = reject;
        }),
    );
    const downloadPromise = service.downloadUpdate();
    expect(service.getState().status).toBe('downloading');
    const token = downloadMock.mock.calls[0][0] as MockToken;

    await setChannelHandler({}, { channel: 'disabled' });

    expect(token.cancel).toHaveBeenCalledTimes(1);
    expect(updater.autoInstallOnAppQuit).toBe(false);

    // The cancellation settles like a channel switch: promise resolves and
    // 'update-cancelled' never surfaces an error state.
    rejectDownload(new Error('cancelled'));
    await expect(downloadPromise).resolves.toBeUndefined();
    updaterHandlers['update-cancelled']({ version: '2.1.0' });
    expect(service.getState().status).not.toBe('error');
    expect(service.getState().error).toBeNull();
  });

  it('automatic checks (focus/resume staleness path) are suppressed while disabled', async () => {
    const { setChannelHandler, checkMock } = await setup();
    await setChannelHandler({}, { channel: 'disabled' });

    const { app } = await import('electron');
    const focusHandler = (app.on as unknown as Mock).mock.calls.find(
      ([event]) => event === 'browser-window-focus',
    )?.[1] as () => void;
    expect(focusHandler).toBeTypeOf('function');
    focusHandler();

    await drainAsyncWork();
    expect(checkMock).not.toHaveBeenCalled();
  });

  it('a manual check while disabled stays off the network and surfaces an informative error', async () => {
    const { setChannelHandler, checkMock, service, mockWindow } = await setup();
    await setChannelHandler({}, { channel: 'disabled' });

    const state = await service.checkForUpdatesManual();

    expect(checkMock).not.toHaveBeenCalled();
    expect(state.status).toBe('error');
    expect(state.error).toMatch(/disabled/i);
    // The outcome is broadcast so the toast/menu surface shows why nothing
    // happened.
    expect(mockWindow.webContents.send).toHaveBeenCalledWith(
      'auto-update:status-changed',
      expect.objectContaining({ status: 'error', error: expect.stringMatching(/disabled/i) }),
    );
  });

  it("switching away from 'disabled' re-points the feed and checks it immediately", async () => {
    const { setChannelHandler, checkMock, feedMock, mockWindow } = await setup();
    await setChannelHandler({}, { channel: 'disabled' });
    await drainAsyncWork();
    expect(checkMock).not.toHaveBeenCalled();

    checkMock.mockReturnValue(new Promise(() => {}));
    const result = await setChannelHandler({}, { channel: 'beta' });
    expect(result.success).toBe(true);

    expect(feedMock).toHaveBeenLastCalledWith({
      provider: 'generic',
      url: expect.stringMatching(/\/beta$/),
    });
    await vi.waitFor(() =>
      expect(mockWindow.webContents.send).toHaveBeenCalledWith('auto-update:show-toast'),
    );
    await vi.waitFor(() => expect(checkMock).toHaveBeenCalledTimes(1));
  });

  it("a recheck queued before a switch to 'disabled' is dropped when the old check settles", async () => {
    const { setChannelHandler, checkMock, service } = await setup();

    // A check is in flight against the previous feed; a switch to beta
    // queues a recheck for when it settles...
    updaterHandlers['checking-for-update']();
    checkMock.mockReturnValue(new Promise(() => {}));
    await setChannelHandler({}, { channel: 'beta' });

    // ...but the user then switches to 'disabled' before it does.
    await setChannelHandler({}, { channel: 'disabled' });

    updaterHandlers['update-not-available']({ version: '2.0.0' });
    await drainAsyncWork();

    // The queued recheck is dropped silently: no check, no error state.
    expect(checkMock).not.toHaveBeenCalled();
    expect(service.getState().status).not.toBe('error');
    expect(service.getState().error).toBeNull();
  });

  it("late old-feed events after a direct switch to 'disabled' mid-check cannot re-arm update state", async () => {
    // Direct stable → disabled while a startup/hourly/focus check is in
    // flight: neutralizeStaleFeedArtifact() is a no-op at 'checking', and the
    // old-feed check's events land AFTER the switch. Without a disabled gate
    // in the handlers, 'update-available' repopulates updateInfo (renderer
    // offers Download) and 'update-downloaded' re-arms quit-install —
    // defeating "nothing installs on quit" (PR #1713 review).
    const { setChannelHandler, service, updater } = await setup();

    updaterHandlers['checking-for-update']();
    expect(service.getState().status).toBe('checking');

    await setChannelHandler({}, { channel: 'disabled' });
    expect(updater.autoInstallOnAppQuit).toBe(false);

    // The old-feed check settles late: found an update, then (fast cache
    // re-resolve / autoDownload) reports it downloaded.
    updaterHandlers['update-available']({ version: '2.1.0', releaseDate: '2026-01-01' });
    expect(service.getState().status).not.toBe('available');
    expect(service.getState().updateInfo).toBeNull();

    updaterHandlers['update-downloaded']({ version: '2.1.0' });
    expect(updater.autoInstallOnAppQuit).toBe(false);
    expect(service.getState().status).not.toBe('downloaded');
    expect(service.getState().updateInfo).toBeNull();
    expect(service.getState().status).toBe('idle');

    // The DOWNLOAD IPC path is gated too (defense in depth).
    await expect(service.downloadUpdate()).rejects.toThrow();
  });

  it("an expected cancel settling while 'disabled' returns the state to idle, not stuck", async () => {
    // Epoch-cancelled autoDownload after a switch to 'disabled': the
    // expected-cancel early return in 'update-cancelled' must not leave the
    // status stuck at 'available'/'downloading' with no recheck ever coming.
    const { setChannelHandler, service, updater, downloadMock } = await setup();

    updaterHandlers['update-available']({ version: '2.1.0', releaseDate: '2026-01-01' });
    downloadMock.mockReturnValue(new Promise(() => {}));
    void service.downloadUpdate();
    expect(service.getState().status).toBe('downloading');

    await setChannelHandler({}, { channel: 'disabled' });
    // Switch-time neutralization already reset to idle; the late
    // 'update-cancelled' from the token cancel must keep it there.
    updaterHandlers['update-cancelled']({ version: '2.1.0' });
    expect(service.getState().status).toBe('idle');
    expect(service.getState().error).toBeNull();
    expect(updater.autoInstallOnAppQuit).toBe(false);
  });
});
