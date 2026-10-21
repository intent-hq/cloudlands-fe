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
import { CancellationToken } from 'electron-updater/out/types.js';

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
type BeforeSendHeadersListener = (
  details: { url: string; requestHeaders: Record<string, string> },
  callback: (response: { requestHeaders: Record<string, string> }) => void,
) => void;

const sessionState: {
  listener: BeforeRequestListener | null;
  headersListener: BeforeSendHeadersListener | null;
} = { listener: null, headersListener: null };

vi.mock('electron-updater', async () => {
  // The real token (builder-util-runtime's), so a feed request built by the
  // service's provider is genuinely cancellable in these tests.
  const { CancellationToken } = await import('electron-updater/out/types.js');
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
            onBeforeSendHeaders: vi.fn((listener: BeforeSendHeadersListener) => {
              sessionState.headersListener = listener;
            }),
          },
        },
      },
      CancellationToken,
    },
  };
});

// The renderer's auto-update client, wired below to the main service's
// broadcasts so the real renderer saga (and its watchdog) runs against them.
const rendererClient = vi.hoisted(() => ({
  listeners: {} as Record<string, (value?: unknown) => void>,
}));

vi.mock('$features/auto-update/auto-update.client', () => {
  const on = (channel: string) => (callback: (value?: unknown) => void) => {
    rendererClient.listeners[channel] = callback;
    return () => {
      delete rendererClient.listeners[channel];
    };
  };
  return {
    autoUpdateClient: {
      getState: vi.fn(() => new Promise(() => {})),
      setShareStatistics: vi.fn(),
      downloadUpdate: vi.fn(),
      installUpdate: vi.fn(),
      onShowToast: on('auto-update:show-toast'),
      onUpToDate: on('auto-update:up-to-date'),
      onStatusChanged: on('auto-update:status-changed'),
      onProgress: on('auto-update:progress'),
      onError: on('auto-update:error'),
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
    currentFeed,
    mockWindow,
  };
}

type Ctx = Awaited<ReturnType<typeof setup>>;

type Answer = (() => Promise<unknown>) & { deduplicates?: boolean };

/**
 * Serve checks from `answers` the way electron-updater 6.x does: each fresh
 * check emits 'checking-for-update', and a check requested while the slow
 * telemetry request is in flight is deduplicated onto its pending promise.
 */
function serveChecks(ctx: Ctx, answers: Answer[]) {
  let pending: Promise<unknown> | null = null;
  ctx.checkMock.mockImplementation(() => {
    if (pending) return pending;
    const next = answers.shift();
    if (!next) throw new Error('unexpected update check');
    ctx.checkedFeeds.push(ctx.currentFeed());
    updaterHandlers['checking-for-update']();
    if (!next.deduplicates) return next();
    const promise = next().finally(() => {
      if (pending === promise) pending = null;
    });
    pending = promise;
    return promise;
  });
}

/**
 * A telemetry feed request whose response never arrives. The request is
 * issued through the provider the service configured (electron-updater's
 * `provider: 'custom'` hook) with a fake HTTP executor; the token the
 * provider hands the executor is the only way to abort it, as with
 * electron-updater's real ElectronHttpExecutor.
 */
function slowTelemetry(ctx: Ctx) {
  const abort = vi.fn();
  let respond: ((body: string) => void) | null = null;
  const answer: Answer = async () => {
    const options = ctx.feedMock.mock.calls.at(-1)?.[0] as {
      url: string;
      updateProvider?: new (
        options: unknown,
        updater: unknown,
        runtime: unknown,
      ) => {
        getLatestVersion(): Promise<unknown>;
      };
    };
    if (typeof options.updateProvider !== 'function') {
      // A stalled socket with no way to cancel it.
      return new Promise(() => {});
    }
    const executor = {
      request: (_options: unknown, token: CancellationToken = new CancellationToken()) =>
        token.createPromise<string>((resolve, _reject, onCancel) => {
          respond = resolve;
          onCancel(abort);
        }),
    };
    const provider = new options.updateProvider(
      options,
      { channel: null, isAddNoCacheQuery: false },
      { executor, platform: 'linux', isUseMultipleRangeRequest: true },
    );
    try {
      return await provider.getLatestVersion();
    } catch (error) {
      // electron-updater emits 'error' before the check promise rejects.
      updaterHandlers['error'](error);
      throw error;
    }
  };
  answer.deduplicates = true;
  return { answer, abort, lateResponse: (body: string) => respond?.(body) };
}

/** Next check answers "no update" after `ms`. */
const notAvailableAfter = (ms: number) => () =>
  new Promise((resolve) =>
    setTimeout(() => {
      updaterHandlers['update-not-available']({ version: '2.219.8' });
      resolve({ updateInfo: { version: '2.219.8' } });
    }, ms),
  );

/** Renderer saga watchdog (auto-update-saga.ts CHECK_TIMEOUT_MS). */
const RENDERER_CHECK_TIMEOUT_MS = 35_000;

/**
 * Record every broadcast with its (fake) time, and replay the renderer
 * saga's watchdog over them: armed by each 'checking' status, cancelled by
 * any other status or up-to-date answer.
 */
function recordBroadcasts(ctx: Ctx) {
  const timeline: Array<{ at: number; channel: string; status?: string }> = [];
  ctx.mockWindow.webContents.send.mockImplementation((channel: string, payload?: unknown) => {
    timeline.push({ at: Date.now(), channel, status: (payload as { status?: string })?.status });
  });
  const statuses = () =>
    timeline.filter((e) => e.channel === 'auto-update:status-changed').map((e) => e.status);
  const rendererWatchdogFired = (now = Date.now()) => {
    let armedAt: number | null = null;
    for (const event of timeline) {
      if (armedAt !== null && event.at - armedAt >= RENDERER_CHECK_TIMEOUT_MS) return true;
      if (event.channel === 'auto-update:status-changed') {
        armedAt = event.status === 'checking' ? event.at : null;
      } else if (event.channel === 'auto-update:up-to-date') {
        armedAt = null;
      }
    }
    return armedAt !== null && now - armedAt >= RENDERER_CHECK_TIMEOUT_MS;
  };
  return { timeline, statuses, rendererWatchdogFired };
}

/**
 * Run the real renderer auto-update saga against the main service's
 * broadcasts (the preload bridge forwards each channel to its listener).
 */
async function startRenderer(ctx: Ctx) {
  const { runSaga, stdChannel } = await import('redux-saga');
  const { autoUpdateSaga } =
    await import('../../../../store/renderer/slices/auto-update/sagas/auto-update-saga');
  const slice = await import('../../../../store/renderer/slices/auto-update/auto-update-slice');
  const send = ctx.mockWindow.webContents.send;
  const previous = send.getMockImplementation();
  send.mockImplementation((channel: string, payload?: unknown) => {
    previous?.(channel, payload);
    rendererClient.listeners[channel]?.(payload);
  });
  const channel = stdChannel();
  const dispatched: unknown[] = [];
  const task = runSaga(
    {
      channel,
      dispatch: (action: unknown) => {
        dispatched.push(action);
      },
      getState: () => ({ autoUpdate: { status: 'idle' } }),
    },
    autoUpdateSaga,
  );
  channel.put(slice.initAutoUpdate());
  await Promise.resolve();
  const timedOut = () =>
    dispatched.some(
      (action) => JSON.stringify(action) === JSON.stringify(slice.setCheckTimedOut()),
    );
  const saw = (action: unknown) =>
    dispatched.some((seen) => JSON.stringify(seen) === JSON.stringify(action));
  return { timedOut, saw, slice, stop: () => task.cancel() };
}

async function setupWithFakeTimers() {
  const ctx = await setup();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  return ctx;
}

function query(url: string): Record<string, string> {
  return Object.fromEntries(new URL(url).searchParams.entries());
}

const savedEnv = { ...process.env };

beforeEach(async () => {
  testUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'auto-update-telemetry-'));
  mockWindows = [];
  sessionState.listener = null;
  sessionState.headersListener = null;
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

describe('slow telemetry response', () => {
  it('aborts the pending telemetry request and retries once on GitHub before any watchdog fires', async () => {
    const ctx = await setupWithFakeTimers();
    const slow = slowTelemetry(ctx);
    // GitHub answers just inside the main 30s watchdog, so the whole check
    // spans well past the renderer's 35s window measured from the start.
    serveChecks(ctx, [slow.answer, notAvailableAfter(29_000)]);
    const broadcasts = recordBroadcasts(ctx);

    const pending = ctx.service.checkForUpdatesManual();
    await vi.advanceTimersByTimeAsync(9_999);
    expect(ctx.checkedFeeds).toHaveLength(1);
    expect(slow.abort).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(slow.abort).toHaveBeenCalledTimes(1);
    expect(ctx.checkedFeeds).toHaveLength(2);
    expect(ctx.checkedFeeds[0].startsWith(`${TELEMETRY_PREFIX}stable?`)).toBe(true);
    expect(ctx.checkedFeeds[1]).toBe(`${GITHUB_PREFIX}stable`);

    await vi.advanceTimersByTimeAsync(29_000);
    const state = await pending;
    await drainAsyncWork();

    expect(state.status).toBe('not-available');
    expect(state.error).toBeNull();
    expect(broadcasts.statuses()).not.toContain('error');
    expect(broadcasts.rendererWatchdogFired()).toBe(false);
    expect(ctx.mockWindow.webContents.send).toHaveBeenCalledWith('auto-update:up-to-date', {
      version: '2.219.8',
    });
    // No further watchdog fires after the retry settled.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(ctx.service.getState().status).toBe('not-available');
    expect(broadcasts.statuses()).not.toContain('error');
  });

  it('a manual check during the slow attempt is not left deduplicated onto it', async () => {
    const ctx = await setupWithFakeTimers();
    const slow = slowTelemetry(ctx);
    serveChecks(ctx, [slow.answer, notAvailableAfter(1_000), notAvailableAfter(1_000)]);
    const broadcasts = recordBroadcasts(ctx);

    const first = ctx.service.checkForUpdates('startup');
    await vi.advanceTimersByTimeAsync(5_000);
    const again = await ctx.service.checkForUpdatesManual();
    expect(again.status).toBe('checking');
    await vi.advanceTimersByTimeAsync(6_000);
    await first;
    await drainAsyncWork();

    expect(slow.abort).toHaveBeenCalledTimes(1);
    expect(ctx.checkedFeeds).toEqual([
      expect.stringContaining(TELEMETRY_PREFIX),
      `${GITHUB_PREFIX}stable`,
    ]);
    expect(ctx.service.getState().status).toBe('not-available');
    expect(broadcasts.statuses()).not.toContain('error');
    // The manual request still gets its answer.
    expect(ctx.mockWindow.webContents.send).toHaveBeenCalledWith('auto-update:up-to-date', {
      version: '2.219.8',
    });

    // The next check starts fresh (no pending promise survives the abort)
    // and stays on GitHub for the session.
    const next = ctx.service.checkForUpdatesManual();
    await vi.advanceTimersByTimeAsync(1_000);
    await next;
    expect(ctx.checkedFeeds.at(-1)).toBe(`${GITHUB_PREFIX}stable`);
    expect(ctx.checkedFeeds).toHaveLength(3);
  });

  it('a telemetry response arriving after the abort cannot land', async () => {
    const ctx = await setupWithFakeTimers();
    const slow = slowTelemetry(ctx);
    serveChecks(ctx, [slow.answer, notAvailableAfter(1_000)]);

    const pending = ctx.service.checkForUpdatesManual();
    await vi.advanceTimersByTimeAsync(10_000);
    slow.lateResponse('version: 9.9.9\npath: Intent.AppImage\nsha512: abc\n');
    await vi.advanceTimersByTimeAsync(1_000);
    await pending;
    await drainAsyncWork();

    const state = ctx.service.getState();
    expect(state.status).toBe('not-available');
    expect(state.updateInfo).toBeNull();
  });

  it('switching to disabled during the slow attempt aborts it without a retry or an error', async () => {
    const ctx = await setupWithFakeTimers();
    const slow = slowTelemetry(ctx);
    serveChecks(ctx, [slow.answer]);
    const broadcasts = recordBroadcasts(ctx);

    const pending = ctx.service.checkForUpdatesManual();
    await vi.advanceTimersByTimeAsync(3_000);
    await ctx.service.setChannel('disabled');
    await vi.advanceTimersByTimeAsync(7_000);
    await pending;
    await vi.advanceTimersByTimeAsync(60_000);

    expect(slow.abort).toHaveBeenCalledTimes(1);
    expect(ctx.checkedFeeds).toHaveLength(1);
    expect(broadcasts.statuses()).not.toContain('error');
    expect(ctx.service.getState().status).toBe('idle');
    expect(broadcasts.rendererWatchdogFired()).toBe(false);
  });

  it('a channel switch during the GitHub retry cancels its stale autoDownload and rechecks the new channel', async () => {
    const ctx = await setupWithFakeTimers();
    const slow = slowTelemetry(ctx);
    const staleDownload = { cancelled: false, cancel: vi.fn() };
    serveChecks(ctx, [
      slow.answer,
      () =>
        new Promise((resolve) =>
          setTimeout(() => {
            updaterHandlers['update-available']({ version: '2.220.0' });
            resolve({ updateInfo: { version: '2.220.0' }, cancellationToken: staleDownload });
          }, 5_000),
        ),
      notAvailableAfter(1_000),
    ]);
    const broadcasts = recordBroadcasts(ctx);

    const pending = ctx.service.checkForUpdatesManual();
    await vi.advanceTimersByTimeAsync(12_000);
    expect(ctx.checkedFeeds[1]).toBe(`${GITHUB_PREFIX}stable`);
    await ctx.service.setChannel('beta');
    await ctx.service.checkForUpdatesOnChannelSwitch();
    await vi.advanceTimersByTimeAsync(3_000);
    await pending;
    await drainAsyncWork();
    await vi.advanceTimersByTimeAsync(1_000);
    await drainAsyncWork();

    expect(staleDownload.cancel).toHaveBeenCalledTimes(1);
    expect(ctx.checkedFeeds).toEqual([
      expect.stringContaining(`${TELEMETRY_PREFIX}stable?`),
      `${GITHUB_PREFIX}stable`,
      `${GITHUB_PREFIX}beta`,
    ]);
    expect(ctx.service.getState().status).toBe('not-available');
    expect(ctx.service.getState().updateInfo).toBeNull();
    expect(broadcasts.statuses()).not.toContain('error');
  });

  it('a channel switch during the slow attempt retries on the new channel and then rechecks it', async () => {
    const ctx = await setupWithFakeTimers();
    const slow = slowTelemetry(ctx);
    serveChecks(ctx, [slow.answer, notAvailableAfter(1_000), notAvailableAfter(1_000)]);
    const broadcasts = recordBroadcasts(ctx);

    const pending = ctx.service.checkForUpdatesManual();
    await vi.advanceTimersByTimeAsync(3_000);
    await ctx.service.setChannel('beta');
    await ctx.service.checkForUpdatesOnChannelSwitch();
    await vi.advanceTimersByTimeAsync(8_000);
    await pending;
    await drainAsyncWork();
    await vi.advanceTimersByTimeAsync(1_000);
    await drainAsyncWork();

    expect(slow.abort).toHaveBeenCalledTimes(1);
    expect(ctx.checkedFeeds).toEqual([
      expect.stringContaining(`${TELEMETRY_PREFIX}stable?`),
      `${GITHUB_PREFIX}beta`,
      `${GITHUB_PREFIX}beta`,
    ]);
    expect(ctx.service.getState().status).toBe('not-available');
    expect(broadcasts.statuses()).not.toContain('error');
    expect(broadcasts.rendererWatchdogFired()).toBe(false);
  });
});

describe('slow telemetry response while an update is downloaded', () => {
  it('a menu check keeps the renderer watchdog quiet across the GitHub retry and keeps the artifact', async () => {
    const ctx = await setupWithFakeTimers();
    const { default: electronUpdater } = await import('electron-updater');
    updaterHandlers['update-available']({ version: '2.220.0' });
    updaterHandlers['update-downloaded']({ version: '2.220.0' });
    expect(ctx.service.getState().status).toBe('downloaded');
    expect(electronUpdater.autoUpdater.autoInstallOnAppQuit).toBe(true);

    const broadcasts = recordBroadcasts(ctx);
    const renderer = await startRenderer(ctx);
    const slow = slowTelemetry(ctx);
    // GitHub re-offers the downloaded version 29s into the retry; the
    // re-resolved download lands 'downloaded' again.
    serveChecks(ctx, [
      slow.answer,
      () =>
        new Promise((resolve) =>
          setTimeout(() => {
            updaterHandlers['update-available']({ version: '2.220.0' });
            resolve({
              updateInfo: { version: '2.220.0' },
              cancellationToken: { cancelled: false, cancel: vi.fn() },
              downloadPromise: Promise.resolve([]),
            });
            queueMicrotask(() => updaterHandlers['update-downloaded']({ version: '2.220.0' }));
          }, 29_000),
        ),
    ]);

    // Help → Check for Updates (src/main/index.ts): toast first, then the check.
    const { broadcastToRenderers } = await import('../auto-update-broadcast');
    broadcastToRenderers('auto-update:show-toast');
    expect(renderer.saw(renderer.slice.showToastChecking())).toBe(true);
    const pending = ctx.service.checkForUpdatesManual();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(slow.abort).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(29_000);
    await pending;
    await drainAsyncWork();
    await vi.advanceTimersByTimeAsync(60_000);
    renderer.stop();

    expect(renderer.timedOut()).toBe(false);
    expect(broadcasts.statuses()).not.toContain('error');
    expect(broadcasts.statuses()).not.toContain('checking');
    expect(broadcasts.statuses().at(-1)).toBe('downloaded');
    const state = ctx.service.getState();
    expect(state.status).toBe('downloaded');
    expect(state.updateInfo?.version).toBe('2.220.0');
    expect(electronUpdater.autoUpdater.autoInstallOnAppQuit).toBe(true);
    expect(ctx.checkedFeeds).toEqual([
      expect.stringContaining(`${TELEMETRY_PREFIX}stable?`),
      `${GITHUB_PREFIX}stable`,
    ]);
  });

  it('an automatic check while downloaded does not pop the toast on the GitHub retry', async () => {
    const ctx = await setupWithFakeTimers();
    updaterHandlers['update-available']({ version: '2.220.0' });
    updaterHandlers['update-downloaded']({ version: '2.220.0' });
    const broadcasts = recordBroadcasts(ctx);
    const slow = slowTelemetry(ctx);
    serveChecks(ctx, [slow.answer, notAvailableAfter(1_000)]);

    const pending = ctx.service.checkForUpdates('periodic');
    await vi.advanceTimersByTimeAsync(11_000);
    await pending;

    expect(slow.abort).toHaveBeenCalledTimes(1);
    expect(broadcasts.timeline.map((e) => e.channel)).not.toContain('auto-update:show-toast');
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

describe('updater session telemetry header filter', () => {
  it('is installed on the updater session and drops the installation id only for the telemetry host', async () => {
    await setup();
    const listener = sessionState.headersListener;
    expect(listener).not.toBeNull();

    const send = (url: string) => {
      let sent: Record<string, string> | undefined;
      listener!(
        { url, requestHeaders: { 'x-user-staging-id': 'install-id', Accept: '*/*' } },
        (response) => {
          sent = response.requestHeaders;
        },
      );
      return sent;
    };
    expect(send(`${TELEMETRY_PREFIX}stable/latest-linux.yml?p=linux-x64`)).toEqual({
      Accept: '*/*',
    });
    expect(send(`${GITHUB_PREFIX}stable/latest-linux.yml`)).toEqual({
      'x-user-staging-id': 'install-id',
      Accept: '*/*',
    });
  });
});
