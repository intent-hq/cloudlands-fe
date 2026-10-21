/**
 * Update checks through updates.intentapp.dev.
 *
 * With "Share anonymous update statistics" on (the default) every check
 * points electron-updater at the telemetry feed with fresh trigger and
 * daily-flag parameters. A failed telemetry check is retried once on GitHub
 * without a user-visible error, and the session then stays on GitHub. The
 * toggle, DO_NOT_TRACK and a custom AUTO_UPDATE_URL all bypass the telemetry
 * host. The updater session only reaches approved hosts.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import type { Mock } from 'vitest';

let mockWindows: unknown[] = [];
let testUserDataPath: string;

vi.mock('electron', () => ({
  app: {
    getPath: () => testUserDataPath,
    getVersion: () => '2.219.8',
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

type BeforeRequestListener = (
  details: { url: string },
  callback: (response: { cancel: boolean }) => void,
) => void;

const updaterHandlers: Record<string, (arg?: unknown) => void> = {};
const sessionState: { listener: BeforeRequestListener | null } = { listener: null };

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
        netSession: {
          webRequest: {
            onBeforeRequest: vi.fn((listener: BeforeRequestListener) => {
              sessionState.listener = listener;
            }),
          },
        },
      },
      CancellationToken: MockCancellationToken,
    },
  };
});

const TELEMETRY_PREFIX = 'https://updates.intentapp.dev/desktop/';
const GITHUB_PREFIX = 'https://github.com/intent-hq/cloudlands-releases/releases/download/';

async function drainAsyncWork(turns = 5): Promise<void> {
  for (let i = 0; i < turns; i++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

async function writePrefs(prefs: Record<string, unknown>): Promise<void> {
  await fs.writeFile(path.join(testUserDataPath, 'local-prefs.json'), JSON.stringify(prefs));
}

async function readPrefs(): Promise<Record<string, unknown>> {
  return JSON.parse(await fs.readFile(path.join(testUserDataPath, 'local-prefs.json'), 'utf8'));
}

async function setup() {
  const { ipcMain } = await import('electron');
  const { default: electronUpdater } = await import('electron-updater');
  const ipc = await import('../auto-update.ipc');
  const { autoUpdateService } = await import('../auto-update.service');

  ipc.setupAutoUpdateIPC();
  const handleMock = ipcMain.handle as unknown as Mock;
  const handler = (channel: string) =>
    handleMock.mock.calls.find(([c]) => c === channel)?.[1] as (
      event: unknown,
      data?: unknown,
    ) => Promise<{ success: boolean }>;

  const mockWindow = {
    isDestroyed: () => false,
    webContents: {
      send: vi.fn(),
      isDestroyed: () => false,
      getURL: () => 'http://localhost:5173/',
    },
  };
  mockWindows = [mockWindow];

  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  try {
    await autoUpdateService.initialize();
  } finally {
    vi.clearAllTimers();
    vi.useRealTimers();
  }

  const updater = electronUpdater.autoUpdater;
  const checkMock = updater.checkForUpdates as unknown as Mock;
  const feedMock = updater.setFeedURL as unknown as Mock;
  // The feed each check actually ran against (the last setFeedURL call
  // before that checkForUpdates call).
  const checkedFeeds: string[] = [];
  const currentFeed = () => (feedMock.mock.calls.at(-1)?.[0] as { url: string }).url;

  /** Next check resolves with "no update" (result + terminal event). */
  const answerNotAvailable = () =>
    checkMock.mockImplementationOnce(async () => {
      checkedFeeds.push(currentFeed());
      queueMicrotask(() => updaterHandlers['update-not-available']({ version: '2.219.8' }));
      return { updateInfo: { version: '2.219.8' } };
    });
  /**
   * Next check fails the way electron-updater 6.x fails: the 'error' event is
   * emitted first, then the check promise rejects.
   */
  const answerFailure = (message: string) =>
    checkMock.mockImplementationOnce(async () => {
      checkedFeeds.push(currentFeed());
      const error = new Error(message);
      updaterHandlers['error'](error);
      throw error;
    });

  return {
    service: autoUpdateService,
    setShareStatistics: handler('auto-update:set-share-statistics'),
    checkMock,
    feedMock,
    checkedFeeds,
    answerNotAvailable,
    answerFailure,
    mockWindow,
  };
}

function query(url: string): Record<string, string> {
  return Object.fromEntries(new URL(url).searchParams.entries());
}

const savedEnv = { ...process.env };

beforeEach(async () => {
  testUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'auto-update-telemetry-'));
  mockWindows = [];
  sessionState.listener = null;
  delete process.env.AUTO_UPDATE_URL;
  delete process.env.DO_NOT_TRACK;
  vi.clearAllMocks();
  vi.resetModules();
});

afterEach(async () => {
  vi.useRealTimers();
  process.env = { ...savedEnv };
  const { autoUpdateService } = await import('../auto-update.service');
  autoUpdateService.cleanup();
  const { __drainLocalPrefsWriteChainForTesting } = await import('../../../../main/local-prefs');
  await __drainLocalPrefsWriteChainForTesting();
  await fs.rm(testUserDataPath, { recursive: true, force: true });
});

describe('telemetry feed', () => {
  it('a manual check runs against updates.intentapp.dev with non-identifying parameters', async () => {
    const { service, checkedFeeds, answerNotAvailable } = await setup();
    answerNotAvailable();

    await service.checkForUpdatesManual();

    expect(checkedFeeds).toHaveLength(1);
    const feed = checkedFeeds[0];
    expect(feed.startsWith(`${TELEMETRY_PREFIX}stable?`)).toBe(true);
    const { detectInstallSource } = await import('../update-telemetry');
    expect(query(feed)).toEqual({
      p: `${process.platform}-${process.arch}`,
      v: '2.219.8',
      src: detectInstallSource(process.platform, process.env),
      k: 'manual',
      d: '1',
    });
  });

  it('sends d=1 only on the first counted check of a UTC day and again after the day rolls over', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-21T23:58:00Z'));
    await writePrefs({ lastUpdateCheckDay: '2026-10-20' });
    const { service, checkedFeeds, answerNotAvailable } = await setup();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-21T23:58:00Z'));

    answerNotAvailable();
    await service.checkForUpdatesManual();
    answerNotAvailable();
    await service.checkForUpdatesManual();
    vi.setSystemTime(new Date('2026-10-22T00:00:30Z'));
    answerNotAvailable();
    await service.checkForUpdatesManual();

    expect(checkedFeeds.map((feed) => query(feed).d)).toEqual(['1', '0', '1']);
    const { __drainLocalPrefsWriteChainForTesting } = await import('../../../../main/local-prefs');
    await drainAsyncWork();
    await __drainLocalPrefsWriteChainForTesting();
    expect((await readPrefs()).lastUpdateCheckDay).toBe('2026-10-22');
  });

  it('a channel switch check carries k=channel on the new channel', async () => {
    const { service, checkedFeeds, answerNotAvailable } = await setup();
    await service.setChannel('beta');
    answerNotAvailable();

    await service.checkForUpdatesOnChannelSwitch();

    expect(checkedFeeds[0].startsWith(`${TELEMETRY_PREFIX}beta?`)).toBe(true);
    expect(query(checkedFeeds[0]).k).toBe('channel');
  });
});

describe('opt-outs select the GitHub feed', () => {
  it('turning the Settings toggle off persists it and sends the next check to GitHub', async () => {
    const { service, setShareStatistics, checkedFeeds, answerNotAvailable } = await setup();
    expect(service.getState().shareStatistics).toBe(true);

    const result = await setShareStatistics({}, { enabled: false });
    expect(result.success).toBe(true);
    expect(service.getState().shareStatistics).toBe(false);
    expect((await readPrefs()).shareUpdateStatistics).toBe(false);

    answerNotAvailable();
    await service.checkForUpdatesManual();
    expect(checkedFeeds).toEqual([`${GITHUB_PREFIX}stable`]);
  });

  it('a persisted toggle-off is honoured from startup', async () => {
    await writePrefs({ shareUpdateStatistics: false });
    const { service, checkedFeeds, answerNotAvailable } = await setup();
    expect(service.getState().shareStatistics).toBe(false);

    answerNotAvailable();
    await service.checkForUpdatesManual();
    expect(checkedFeeds).toEqual([`${GITHUB_PREFIX}stable`]);
  });

  it('DO_NOT_TRACK=1 sends checks to GitHub even with the toggle on', async () => {
    process.env.DO_NOT_TRACK = '1';
    const { service, checkedFeeds, answerNotAvailable } = await setup();
    expect(service.getState().shareStatistics).toBe(true);

    answerNotAvailable();
    await service.checkForUpdatesManual();
    expect(checkedFeeds).toEqual([`${GITHUB_PREFIX}stable`]);
  });

  it('a custom AUTO_UPDATE_URL bypasses the telemetry host', async () => {
    process.env.AUTO_UPDATE_URL = 'http://127.0.0.1:8080/feeds';
    const { service, checkedFeeds, answerNotAvailable } = await setup();

    answerNotAvailable();
    await service.checkForUpdatesManual();
    expect(checkedFeeds).toEqual(['http://127.0.0.1:8080/feeds/stable']);
  });

  it('rejects a non-boolean SET_SHARE_STATISTICS payload', async () => {
    const { setShareStatistics, service } = await setup();
    const result = await setShareStatistics({}, { enabled: 'no' });
    expect(result.success).toBe(false);
    expect(service.getState().shareStatistics).toBe(true);
  });
});

describe('fallback to GitHub', () => {
  it('a failed telemetry check is retried on GitHub with no user-visible error', async () => {
    const { service, checkedFeeds, answerFailure, answerNotAvailable, mockWindow } = await setup();
    answerFailure('net::ERR_NAME_NOT_RESOLVED');
    answerNotAvailable();

    const state = await service.checkForUpdatesManual();

    expect(checkedFeeds).toHaveLength(2);
    expect(checkedFeeds[0].startsWith(TELEMETRY_PREFIX)).toBe(true);
    expect(checkedFeeds[1]).toBe(`${GITHUB_PREFIX}stable`);
    await drainAsyncWork();
    expect(service.getState().status).toBe('not-available');
    expect(state.error).toBeNull();
    const statuses = mockWindow.webContents.send.mock.calls
      .filter(([channel]) => channel === 'auto-update:status-changed')
      .map(([, s]) => (s as { status: string }).status);
    expect(statuses).not.toContain('error');
    // The manual check still gets its "up to date" answer.
    expect(mockWindow.webContents.send).toHaveBeenCalledWith('auto-update:up-to-date', {
      version: '2.219.8',
    });
  });

  it('stays on GitHub for the rest of the session after a fallback', async () => {
    const { service, checkedFeeds, answerFailure, answerNotAvailable } = await setup();
    answerFailure('HttpError: 503');
    answerNotAvailable();
    await service.checkForUpdatesManual();
    await drainAsyncWork();

    answerNotAvailable();
    await service.checkForUpdatesManual();

    expect(checkedFeeds.slice(1)).toEqual([`${GITHUB_PREFIX}stable`, `${GITHUB_PREFIX}stable`]);
  });

  it('surfaces the error when the GitHub retry fails too', async () => {
    const { service, answerFailure } = await setup();
    answerFailure('net::ERR_BLOCKED_BY_CLIENT');
    answerFailure('net::ERR_INTERNET_DISCONNECTED');

    const state = await service.checkForUpdatesManual();

    expect(state.status).toBe('error');
    expect(state.error).toContain('ERR_INTERNET_DISCONNECTED');
  });

  it('the fallback check gets a fresh watchdog window instead of timing out', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { service, checkMock, answerFailure } = await setup();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    // The telemetry attempt takes 25s to fail; the GitHub retry then takes
    // 20s more — 45s total, past the 30s watchdog for a single window.
    checkMock.mockImplementationOnce(
      () =>
        new Promise((_, reject) =>
          setTimeout(() => {
            const error = new Error('net::ERR_TIMED_OUT');
            updaterHandlers['error'](error);
            reject(error);
          }, 25_000),
        ),
    );
    checkMock.mockImplementationOnce(
      () =>
        new Promise((resolve) =>
          setTimeout(() => {
            updaterHandlers['update-not-available']({ version: '2.219.8' });
            resolve({ updateInfo: { version: '2.219.8' } });
          }, 20_000),
        ),
    );
    void answerFailure;

    const pending = service.checkForUpdatesManual();
    await vi.advanceTimersByTimeAsync(25_000);
    await vi.advanceTimersByTimeAsync(20_000);
    const state = await pending;

    expect(state.status).toBe('not-available');
    expect(state.error).toBeNull();
  });
});

describe('updater session host allowlist', () => {
  it('is installed on the updater session and cancels a foreign redirect target', async () => {
    await setup();
    const listener = sessionState.listener;
    expect(listener).not.toBeNull();

    const decide = (url: string) => {
      let cancel: boolean | undefined;
      listener!({ url }, (response) => {
        cancel = response.cancel;
      });
      return cancel;
    };
    expect(decide('https://evil.example.com/Intent-2.220.0.AppImage')).toBe(true);
    expect(decide(`${TELEMETRY_PREFIX}stable/latest-linux.yml?p=linux-x64`)).toBe(false);
    expect(decide(`${GITHUB_PREFIX}stable/latest-linux.yml`)).toBe(false);
    expect(decide('https://objects.githubusercontent.com/asset')).toBe(false);
  });
});
