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

/** A live renderer window as seen by the broadcast path. */
function makeRendererWindow() {
  return {
    isDestroyed: () => false,
    webContents: {
      isDestroyed: () => false,
      getURL: () => 'app://workspaces/workspace/x',
      send: vi.fn(),
    },
  };
}

/** Import a fresh module instance, initialize it, and drop the startup timers. */
async function setupService() {
  const svc = await import('../auto-update.service');
  const { default: electronUpdater } = await import('electron-updater');

  const mockWindow = makeRendererWindow();
  liveWindows.push(mockWindow);
  await svc.autoUpdateService.initialize();
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
    liveWindows.length = 0;
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

/**
 * Windowless initialization + uninitialized-check regression tests
 * (intent-hq/monorepo#1848).
 *
 * The secondary-startup task can run before any window exists, so
 * initialize() must work with no live windows (notifications broadcast to
 * whatever windows are live at send time), and a manual check against a
 * service that was never initialized (no event handlers attached) must fail
 * fast instead of dying in the misleading 30s watchdog "timed out" error.
 */
describe('windowless initialization and uninitialized checks', () => {
  beforeEach(async () => {
    testUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'auto-update-windowless-'));
    liveWindows.length = 0;
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

  it('initializes without a window: events are handled, and a window created later receives renderer notifications', async () => {
    const svc = await import('../auto-update.service');
    const { default: electronUpdater } = await import('electron-updater');

    await svc.autoUpdateService.initialize();
    // Drop the 10s startup check + hourly interval scheduled by initialize().
    vi.clearAllTimers();

    const checkForUpdatesMock = electronUpdater.autoUpdater.checkForUpdates as Mock;
    checkForUpdatesMock.mockImplementation(async () => {
      updaterHandlers['checking-for-update']?.();
      updaterHandlers['update-not-available']?.({ version: '2.0.0' });
      return { updateInfo: { version: '2.0.0' } } as never;
    });

    // Windowless manual check: the terminal event is handled (handlers were
    // attached despite no window) and the watchdog is cleared.
    await svc.autoUpdateService.checkForUpdatesManual();
    expect(svc.autoUpdateService.getState().status).toBe('not-available');
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_TIMEOUT_MS);
    expect(svc.autoUpdateService.getState().status).toBe('not-available');

    // A window shows up later: the same service instance now notifies it,
    // because notifications broadcast to the windows live at send time.
    const mockWindow = makeRendererWindow();
    liveWindows.push(mockWindow);
    await svc.autoUpdateService.checkForUpdatesManual();
    expect(mockWindow.webContents.send).toHaveBeenCalledWith('auto-update:up-to-date', {
      version: '2.0.0',
    });
  });

  it('a manual check on an uninitialized service fails fast instead of ending in the watchdog timeout', async () => {
    const svc = await import('../auto-update.service');
    const { m } = await import('../../../../shared/paraglide/messages.js');
    const { default: electronUpdater } = await import('electron-updater');
    const checkForUpdatesMock = electronUpdater.autoUpdater.checkForUpdates as Mock;
    // The real-world shape of the bug: the underlying check succeeds quickly,
    // but with no event handlers attached nothing ever closes the watchdog
    // session — the only possible outcome was the false 30s timeout.
    checkForUpdatesMock.mockResolvedValue({ updateInfo: { version: '2.0.0' } } as never);

    const state = await svc.autoUpdateService.checkForUpdatesManual();

    expect(state.status).toBe('error');
    expect(state.error).toBeTruthy();
    expect(state.error).not.toBe(m.autoUpdate_check_timeout_error());
    expect(checkForUpdatesMock).not.toHaveBeenCalled();

    // No watchdog was armed: 30s later the error is still the fail-fast one,
    // not the misleading "timed out / check your network" message.
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_TIMEOUT_MS);
    expect(svc.autoUpdateService.getState().error).toBe(state.error);
    expect(svc.autoUpdateService.getState().error).not.toBe(m.autoUpdate_check_timeout_error());
  });
});
