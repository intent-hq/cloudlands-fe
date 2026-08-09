/**
 * AutoUpdateService manual-check watchdog regression tests
 * (intent-hq/monorepo#1698).
 *
 * A manual "Check for Updates" must always reach a terminal state
 * (available / not-available / error) delivered to the renderer, even when:
 *  - `autoUpdater.checkForUpdates()` hangs forever and electron-updater dedups
 *    onto an earlier in-flight request without re-firing 'checking-for-update'
 *    (so `state.status` never becomes 'checking' at all), or
 *  - `autoUpdater.checkForUpdates()` resolves `null`/`undefined` (updater
 *    inactive) with no follow-up event.
 *
 * The watchdog must key off a per-check in-flight session rather than
 * `state.status === 'checking'`, and must never leave `isManualCheck` latched
 * true past a timed-out/errored check.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import type { Mock } from 'vitest';

// Matches the service's private UPDATE_CHECK_TIMEOUT_MS.
const UPDATE_CHECK_TIMEOUT_MS = 30_000;

// Mock Electron before importing the service
vi.mock('electron', () => ({
  app: {
    getPath: () => testUserDataPath,
    getVersion: () => '2.0.0',
    on: vi.fn(),
    off: vi.fn(),
  },
  BrowserWindow: vi.fn(),
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

/** Import a fresh module instance, initialize it, and drop the startup timers. */
async function setupService() {
  const svc = await import('../auto-update.service');
  const { default: electronUpdater } = await import('electron-updater');

  const mockWindow = {
    isDestroyed: () => false,
    webContents: { send: vi.fn() },
  } as never;
  await svc.autoUpdateService.initialize(mockWindow);
  // initialize() schedules a 10s startup check + hourly interval; clear them
  // so only the timers our test drives remain.
  vi.clearAllTimers();

  return {
    svc,
    mockWindow: mockWindow as { webContents: { send: Mock } },
    checkForUpdatesMock: electronUpdater.autoUpdater.checkForUpdates as Mock,
  };
}

describe('AutoUpdateService manual-check watchdog', () => {
  beforeEach(async () => {
    testUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'auto-update-watchdog-'));
    vi.clearAllMocks();
    vi.resetModules();
    vi.useFakeTimers();
  });

  afterEach(async () => {
    vi.clearAllTimers();
    vi.useRealTimers();
    const { __drainLocalPrefsWriteChainForTesting } = await import('../../../../main/local-prefs');
    await __drainLocalPrefsWriteChainForTesting();
    await fs.rm(testUserDataPath, { recursive: true, force: true });
  });

  it('reports terminal error via the watchdog on a hung/deduped check, even though main status never reached "checking"', async () => {
    const { svc, mockWindow, checkForUpdatesMock } = await setupService();
    // Simulate electron-updater dedup: the promise never settles and no new
    // 'checking-for-update' event fires for this call.
    checkForUpdatesMock.mockImplementation(() => new Promise(() => {}));

    // Fire-and-forget: this call's own returned promise never settles because
    // the underlying checkForUpdates() call hangs forever.
    void svc.autoUpdateService.checkForUpdatesManual();

    // The exact condition that let the bug slip past the old
    // `state.status === 'checking'` gate.
    expect(svc.autoUpdateService.getState().status).not.toBe('checking');

    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_TIMEOUT_MS);

    const state = svc.autoUpdateService.getState();
    expect(state.status).toBe('error');
    expect(mockWindow.webContents.send).toHaveBeenCalledWith(
      'auto-update:status-changed',
      expect.objectContaining({ status: 'error' }),
    );

    // isManualCheck must not stay latched true: a later automatic
    // update-not-available must not trigger the manual "up to date" toast.
    mockWindow.webContents.send.mockClear();
    updaterHandlers['update-not-available']?.({ version: '2.0.0' });
    expect(mockWindow.webContents.send).not.toHaveBeenCalledWith(
      'auto-update:up-to-date',
      expect.anything(),
    );
  });

  it('checkForUpdates() resolving null (updater inactive) produces a terminal error state, not silence', async () => {
    const { svc, mockWindow, checkForUpdatesMock } = await setupService();
    checkForUpdatesMock.mockResolvedValue(null);

    await svc.autoUpdateService.checkForUpdatesManual();

    const state = svc.autoUpdateService.getState();
    expect(state.status).toBe('error');
    expect(mockWindow.webContents.send).toHaveBeenCalledWith(
      'auto-update:status-changed',
      expect.objectContaining({ status: 'error' }),
    );

    // The watchdog must have been cleared - advancing past it must not
    // re-fire another status-changed event.
    const callsBefore = mockWindow.webContents.send.mock.calls.length;
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_TIMEOUT_MS);
    expect(mockWindow.webContents.send.mock.calls.length).toBe(callsBefore);
  });

  it('happy path unchanged: a normal not-available check still sends the up-to-date toast for a manual check', async () => {
    const { svc, mockWindow, checkForUpdatesMock } = await setupService();
    checkForUpdatesMock.mockImplementation(async () => {
      updaterHandlers['checking-for-update']?.();
      updaterHandlers['update-not-available']?.({ version: '2.0.0' });
      return { updateInfo: { version: '2.0.0' } } as never;
    });

    await svc.autoUpdateService.checkForUpdatesManual();

    const state = svc.autoUpdateService.getState();
    expect(state.status).toBe('not-available');
    expect(mockWindow.webContents.send).toHaveBeenCalledWith('auto-update:up-to-date', {
      version: '2.0.0',
    });

    // No stray watchdog fire after the terminal event already cleared it.
    const callsBefore = mockWindow.webContents.send.mock.calls.length;
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_TIMEOUT_MS);
    expect(mockWindow.webContents.send.mock.calls.length).toBe(callsBefore);
  });

  it('update-available also resets isManualCheck, so a later automatic not-available does not show a stale manual toast', async () => {
    const { svc, mockWindow, checkForUpdatesMock } = await setupService();
    checkForUpdatesMock.mockImplementation(async () => {
      updaterHandlers['checking-for-update']?.();
      updaterHandlers['update-available']?.({ version: '2.1.0' });
      return { updateInfo: { version: '2.1.0' } } as never;
    });

    await svc.autoUpdateService.checkForUpdatesManual();
    expect(svc.autoUpdateService.getState().status).toBe('available');

    // Simulate a later periodic/automatic check finding no update. If
    // isManualCheck stayed latched from the manual check above, this would
    // incorrectly fire the manual "up to date" toast.
    mockWindow.webContents.send.mockClear();
    updaterHandlers['update-not-available']?.({ version: '2.1.0' });
    expect(mockWindow.webContents.send).not.toHaveBeenCalledWith(
      'auto-update:up-to-date',
      expect.anything(),
    );
  });
});
