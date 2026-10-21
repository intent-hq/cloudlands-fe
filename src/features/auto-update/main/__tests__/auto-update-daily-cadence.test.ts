/**
 * Automatic update-check cadence.
 *
 * On the stable channel automatic checks make at most one successful check
 * per UTC day: the startup check runs only when no check succeeded today,
 * and the hourly tick and focus/resume check only once the UTC day has
 * rolled over (`k=daily` for the tick). A failed check is not recorded, so
 * a later tick or focus retries; until a check succeeds, stable makes at most
 * one automatic attempt per hour across startup, tick, focus and resume.
 * Manual and channel-switch checks always run and do not count as attempts. Alpha and beta keep the startup check, hourly checks (`k=periodic`)
 * and focus/resume checks after 4 h. The recorded day is the
 * `lastUpdateCheckDay` local pref, the same value the telemetry `d` flag uses.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import type { Mock } from 'vitest';

// Match the service's private timings.
const STARTUP_CHECK_DELAY_MS = 10_000;
const HOUR_MS = 60 * 60 * 1000;

let testUserDataPath: string;
const liveWindows: unknown[] = [];

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

const savedEnv = { ...process.env };

async function writePrefs(prefs: Record<string, unknown>): Promise<void> {
  await fs.writeFile(path.join(testUserDataPath, 'local-prefs.json'), JSON.stringify(prefs));
}

async function readPrefs(): Promise<Record<string, unknown>> {
  const { __drainLocalPrefsWriteChainForTesting } = await import('../../../../main/local-prefs');
  await __drainLocalPrefsWriteChainForTesting();
  try {
    return JSON.parse(await fs.readFile(path.join(testUserDataPath, 'local-prefs.json'), 'utf8'));
  } catch {
    return {};
  }
}

/**
 * Initialize a fresh service at `now` with `prefs` on disk. The startup and
 * hourly timers stay armed on the fake clock. Every check answers "no
 * update" unless a test overrides the mock; `triggers` records the `k`
 * value of each check's feed (null when the check ran against GitHub).
 */
async function setup(now: string, prefs: Record<string, unknown> = {}) {
  vi.setSystemTime(new Date(now));
  await writePrefs(prefs);
  const svc = await import('../auto-update.service');
  const { default: electronUpdater } = await import('electron-updater');
  const { app, powerMonitor } = await import('electron');
  const updater = electronUpdater.autoUpdater;
  const checkMock = updater.checkForUpdates as unknown as Mock;
  const feedMock = updater.setFeedURL as unknown as Mock;
  const triggers: (string | null)[] = [];
  const recordTrigger = () => {
    const url = (feedMock.mock.calls.at(-1)?.[0] as { url: string }).url;
    triggers.push(new URL(url).searchParams.get('k'));
  };
  const answerNotAvailable = async () => {
    recordTrigger();
    updaterHandlers['checking-for-update']();
    updaterHandlers['update-not-available']({ version: '2.0.0' });
    return { updateInfo: { version: '2.0.0' } };
  };
  checkMock.mockImplementation(answerNotAvailable);
  const answerFailure = async () => {
    recordTrigger();
    updaterHandlers['checking-for-update']();
    const error = new Error('net::ERR_INTERNET_DISCONNECTED');
    updaterHandlers['error'](error);
    throw error;
  };

  liveWindows.push({
    isDestroyed: () => false,
    webContents: {
      isDestroyed: () => false,
      getURL: () => 'app://workspaces/workspace/x',
      send: vi.fn(),
    },
  });
  await svc.autoUpdateService.initialize();

  const handlerFor = (mock: unknown, event: string) =>
    (mock as Mock).mock.calls.find(([e]) => e === event)?.[1] as () => void;

  return {
    service: svc.autoUpdateService,
    checkMock,
    triggers,
    answerNotAvailable,
    answerFailure,
    focus: handlerFor(app.on, 'browser-window-focus'),
    resume: handlerFor(powerMonitor.on, 'resume'),
  };
}

/** Let async check work settle without advancing the clock. */
async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

beforeEach(async () => {
  testUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'auto-update-cadence-'));
  liveWindows.length = 0;
  delete process.env.AUTO_UPDATE_URL;
  delete process.env.DO_NOT_TRACK;
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
  process.env = { ...savedEnv };
});

describe('stable channel: at most one successful automatic check per UTC day', () => {
  it('checks on startup when no check has succeeded today, and records the day', async () => {
    const { checkMock, triggers } = await setup('2026-10-21T08:00:00Z', {
      lastUpdateCheckDay: '2026-10-20',
    });

    await vi.advanceTimersByTimeAsync(STARTUP_CHECK_DELAY_MS);

    expect(checkMock).toHaveBeenCalledTimes(1);
    expect(triggers).toEqual(['startup']);
    expect((await readPrefs()).lastUpdateCheckDay).toBe('2026-10-21');
  });

  it('checks on a first-ever startup (no recorded day)', async () => {
    const { triggers } = await setup('2026-10-21T08:00:00Z');

    await vi.advanceTimersByTimeAsync(STARTUP_CHECK_DELAY_MS);

    expect(triggers).toEqual(['startup']);
  });

  it('skips the startup check when a check already succeeded today', async () => {
    const { checkMock } = await setup('2026-10-21T08:00:00Z', {
      lastUpdateCheckDay: '2026-10-21',
    });

    await vi.advanceTimersByTimeAsync(STARTUP_CHECK_DELAY_MS);

    expect(checkMock).not.toHaveBeenCalled();
  });

  it('the hourly tick checks only after the UTC day rolls over, then once', async () => {
    const { checkMock, triggers } = await setup('2026-10-21T21:30:00Z', {
      lastUpdateCheckDay: '2026-10-21',
    });

    // 22:30 and 23:30: same UTC day, nothing due.
    await vi.advanceTimersByTimeAsync(2 * HOUR_MS);
    expect(checkMock).not.toHaveBeenCalled();

    // 00:30: the day rolled over.
    await vi.advanceTimersByTimeAsync(HOUR_MS);
    expect(triggers).toEqual(['daily']);
    expect((await readPrefs()).lastUpdateCheckDay).toBe('2026-10-22');

    // The rest of the day stays quiet.
    await vi.advanceTimersByTimeAsync(20 * HOUR_MS);
    expect(checkMock).toHaveBeenCalledTimes(1);
  });

  it('focus and resume check only when no check has succeeded today', async () => {
    const { checkMock, triggers, focus, resume } = await setup('2026-10-21T08:00:00Z', {
      lastUpdateCheckDay: '2026-10-21',
    });

    // Already checked today: even 5 h later, focus/resume stay quiet.
    vi.setSystemTime(new Date('2026-10-21T13:00:00Z'));
    focus();
    resume();
    await settle();
    expect(checkMock).not.toHaveBeenCalled();

    // Next UTC day (before the hourly tick lands): focus checks once.
    vi.setSystemTime(new Date('2026-10-22T00:10:00Z'));
    focus();
    await settle();
    expect(triggers).toEqual(['focus']);

    focus();
    resume();
    await settle();
    expect(checkMock).toHaveBeenCalledTimes(1);
  });

  it('a failed check is not recorded: a later automatic attempt retries', async () => {
    const { checkMock, focus, answerFailure, answerNotAvailable } = await setup(
      '2026-10-21T08:00:00Z',
      { lastUpdateCheckDay: '2026-10-20' },
    );
    checkMock.mockImplementation(answerFailure);

    await vi.advanceTimersByTimeAsync(STARTUP_CHECK_DELAY_MS);
    const afterStartup = checkMock.mock.calls.length;
    expect(afterStartup).toBeGreaterThan(0);
    expect((await readPrefs()).lastUpdateCheckDay).toBe('2026-10-20');

    // An hour after the failed attempt, focus retries and its success is
    // recorded.
    checkMock.mockImplementation(answerNotAvailable);
    vi.setSystemTime(new Date('2026-10-21T09:00:10Z'));
    focus();
    await settle();
    expect(checkMock.mock.calls.length).toBe(afterStartup + 1);
    expect((await readPrefs()).lastUpdateCheckDay).toBe('2026-10-21');

    // Recorded: the rest of the day stays quiet.
    await vi.advanceTimersByTimeAsync(3 * HOUR_MS);
    expect(checkMock.mock.calls.length).toBe(afterStartup + 1);
  });

  it('a successful check on the GitHub feed (statistics off) also counts', async () => {
    const { checkMock } = await setup('2026-10-21T08:00:00Z', {
      lastUpdateCheckDay: '2026-10-20',
      shareUpdateStatistics: false,
    });

    await vi.advanceTimersByTimeAsync(STARTUP_CHECK_DELAY_MS);
    expect(checkMock).toHaveBeenCalledTimes(1);
    expect((await readPrefs()).lastUpdateCheckDay).toBe('2026-10-21');

    await vi.advanceTimersByTimeAsync(3 * HOUR_MS);
    expect(checkMock).toHaveBeenCalledTimes(1);
  });

  it('a manual check always runs, even after today’s check', async () => {
    const { service, triggers } = await setup('2026-10-21T08:00:00Z', {
      lastUpdateCheckDay: '2026-10-21',
    });

    await service.checkForUpdatesManual();
    await service.checkForUpdatesManual();

    expect(triggers).toEqual(['manual', 'manual']);
  });

  it('a channel switch always checks (k=channel), even after today’s check', async () => {
    const { service, triggers } = await setup('2026-10-21T08:00:00Z', {
      lastUpdateCheckDay: '2026-10-21',
    });

    await service.setChannel('beta');
    await service.checkForUpdatesOnChannelSwitch();
    await settle();
    await service.setChannel('stable');
    await service.checkForUpdatesOnChannelSwitch();
    await settle();

    expect(triggers).toEqual(['channel', 'channel']);
  });
});

describe('stable channel: at most one automatic attempt per hour until a check succeeds', () => {
  it('after a failed attempt, focus, resume and the tick wait an hour', async () => {
    const { checkMock, triggers, focus, resume, answerFailure, answerNotAvailable } = await setup(
      '2026-10-21T08:00:00Z',
      { lastUpdateCheckDay: '2026-10-20' },
    );
    // The first failure is retried on GitHub inside the same attempt, so
    // attempts are counted by their telemetry `k` value.
    checkMock.mockImplementation(answerFailure);
    const attempts = () => triggers.filter((k) => k !== null);

    // 08:00:10: the startup attempt fails (telemetry, then the GitHub retry).
    await vi.advanceTimersByTimeAsync(STARTUP_CHECK_DELAY_MS);
    expect(attempts()).toEqual(['startup']);
    const afterStartup = checkMock.mock.calls.length;

    // 08:20: repeated focus/resume within the hour stay offline.
    await vi.advanceTimersByTimeAsync(20 * 60 * 1000 - STARTUP_CHECK_DELAY_MS);
    focus();
    resume();
    focus();
    await settle();
    expect(checkMock.mock.calls.length).toBe(afterStartup);

    // 09:00:00 tick: 59m50s after the attempt, still throttled.
    await vi.advanceTimersByTimeAsync(40 * 60 * 1000);
    expect(checkMock.mock.calls.length).toBe(afterStartup);

    // 09:00:10: an hour has passed, focus makes exactly one attempt.
    await vi.advanceTimersByTimeAsync(STARTUP_CHECK_DELAY_MS);
    resume();
    focus();
    await settle();
    expect(checkMock.mock.calls.length).toBe(afterStartup + 1);

    // 10:00:00 tick: throttled by the 09:00:10 attempt; the 11:00:00 tick
    // runs and succeeds, then the day stays quiet.
    checkMock.mockImplementation(answerNotAvailable);
    await vi.advanceTimersByTimeAsync(HOUR_MS - STARTUP_CHECK_DELAY_MS);
    expect(checkMock.mock.calls.length).toBe(afterStartup + 1);
    await vi.advanceTimersByTimeAsync(HOUR_MS);
    expect(checkMock.mock.calls.length).toBe(afterStartup + 2);
    expect((await readPrefs()).lastUpdateCheckDay).toBe('2026-10-21');
    await vi.advanceTimersByTimeAsync(5 * HOUR_MS);
    focus();
    resume();
    await settle();
    expect(checkMock.mock.calls.length).toBe(afterStartup + 2);
  });

  it('a failed telemetry attempt retried on GitHub counts as one attempt', async () => {
    const { checkMock, focus, answerFailure } = await setup('2026-10-21T08:00:00Z', {
      lastUpdateCheckDay: '2026-10-20',
    });
    checkMock.mockImplementation(answerFailure);

    await vi.advanceTimersByTimeAsync(STARTUP_CHECK_DELAY_MS);
    // Telemetry feed, then the GitHub retry.
    expect(checkMock).toHaveBeenCalledTimes(2);

    vi.setSystemTime(new Date('2026-10-21T08:30:00Z'));
    focus();
    await settle();
    expect(checkMock).toHaveBeenCalledTimes(2);

    vi.setSystemTime(new Date('2026-10-21T09:00:10Z'));
    focus();
    await settle();
    // The session now goes straight to GitHub: one more request.
    expect(checkMock).toHaveBeenCalledTimes(3);
  });

  it('a new UTC day does not reset the hourly attempt throttle', async () => {
    const { checkMock, focus, answerFailure } = await setup('2026-10-21T23:20:00Z', {
      lastUpdateCheckDay: '2026-10-20',
      shareUpdateStatistics: false,
    });
    checkMock.mockImplementation(answerFailure);

    // 23:20:10 attempt fails.
    await vi.advanceTimersByTimeAsync(STARTUP_CHECK_DELAY_MS);
    expect(checkMock).toHaveBeenCalledTimes(1);

    // 00:05 the next UTC day: still within the hour.
    vi.setSystemTime(new Date('2026-10-22T00:05:00Z'));
    focus();
    await settle();
    expect(checkMock).toHaveBeenCalledTimes(1);

    // 00:20:10: an hour after the attempt.
    vi.setSystemTime(new Date('2026-10-22T00:20:10Z'));
    focus();
    await settle();
    expect(checkMock).toHaveBeenCalledTimes(2);
  });

  it('a successful attempt late in the day throttles the first check of the next day', async () => {
    const { checkMock, focus } = await setup('2026-10-21T23:50:00Z', {
      lastUpdateCheckDay: '2026-10-20',
      shareUpdateStatistics: false,
    });

    await vi.advanceTimersByTimeAsync(STARTUP_CHECK_DELAY_MS);
    expect(checkMock).toHaveBeenCalledTimes(1);
    expect((await readPrefs()).lastUpdateCheckDay).toBe('2026-10-21');

    vi.setSystemTime(new Date('2026-10-22T00:10:00Z'));
    focus();
    await settle();
    expect(checkMock).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date('2026-10-22T00:50:10Z'));
    focus();
    await settle();
    expect(checkMock).toHaveBeenCalledTimes(2);
    expect((await readPrefs()).lastUpdateCheckDay).toBe('2026-10-22');
  });

  it('manual and channel-switch checks bypass the throttle and do not consume it', async () => {
    const { service, checkMock, focus, answerFailure } = await setup('2026-10-21T08:00:00Z', {
      lastUpdateCheckDay: '2026-10-20',
      shareUpdateStatistics: false,
    });
    checkMock.mockImplementation(answerFailure);

    // 08:00:10 automatic attempt fails.
    await vi.advanceTimersByTimeAsync(STARTUP_CHECK_DELAY_MS);

    // Manual checks run immediately, repeatedly.
    vi.setSystemTime(new Date('2026-10-21T08:10:00Z'));
    await service.checkForUpdatesManual();
    await settle();
    await service.checkForUpdatesManual();
    await settle();

    // A channel switch back to stable checks immediately too.
    await service.setChannel('beta');
    await service.setChannel('stable');
    await service.checkForUpdatesOnChannelSwitch();
    await settle();
    expect(checkMock).toHaveBeenCalledTimes(4);

    // Focus is still throttled by the automatic attempt only...
    focus();
    await settle();
    expect(checkMock).toHaveBeenCalledTimes(4);

    // ...and not by the later manual/channel checks.
    vi.setSystemTime(new Date('2026-10-21T09:00:10Z'));
    focus();
    await settle();
    expect(checkMock).toHaveBeenCalledTimes(5);
  });

  it('beta automatic checks do not consume the stable throttle', async () => {
    const { service, checkMock, focus, answerFailure } = await setup('2026-10-21T08:00:00Z', {
      updateChannel: 'beta',
      lastUpdateCheckDay: '2026-10-20',
      shareUpdateStatistics: false,
    });
    checkMock.mockImplementation(answerFailure);

    await vi.advanceTimersByTimeAsync(STARTUP_CHECK_DELAY_MS);
    expect(checkMock).toHaveBeenCalledTimes(1);

    // Switch to stable without the channel-switch check: the first stable
    // automatic attempt runs at once, the next waits an hour.
    await service.setChannel('stable');
    focus();
    await settle();
    focus();
    await settle();
    expect(checkMock).toHaveBeenCalledTimes(2);
  });

  it('the stable throttle survives a round trip through beta, without throttling beta', async () => {
    const { service, checkMock, focus, answerFailure } = await setup('2026-10-21T08:00:00Z', {
      lastUpdateCheckDay: '2026-10-20',
      shareUpdateStatistics: false,
    });
    checkMock.mockImplementation(answerFailure);

    // 08:00:10 stable attempt fails.
    await vi.advanceTimersByTimeAsync(STARTUP_CHECK_DELAY_MS);

    // On beta the 09:00:00 tick runs regardless of the stable throttle.
    await service.setChannel('beta');
    await vi.advanceTimersByTimeAsync(HOUR_MS - STARTUP_CHECK_DELAY_MS);
    expect(checkMock).toHaveBeenCalledTimes(2);

    // Back on stable within the hour after the stable attempt (wall clock set
    // back to 08:30): focus stays throttled.
    await service.setChannel('stable');
    vi.setSystemTime(new Date('2026-10-21T08:30:00Z'));
    focus();
    await settle();
    expect(checkMock).toHaveBeenCalledTimes(2);
  });

  it('a wall clock moved backwards does not block automatic attempts', async () => {
    const { checkMock, focus, answerFailure } = await setup('2026-10-21T08:00:00Z', {
      lastUpdateCheckDay: '2026-10-20',
      shareUpdateStatistics: false,
    });
    checkMock.mockImplementation(answerFailure);

    await vi.advanceTimersByTimeAsync(STARTUP_CHECK_DELAY_MS);
    expect(checkMock).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date('2026-10-21T05:00:00Z'));
    focus();
    await settle();
    expect(checkMock).toHaveBeenCalledTimes(2);
  });
});

describe('alpha and beta channels keep the hourly cadence', () => {
  it.each(['alpha', 'beta'] as const)(
    '%s: startup check even after today’s check, then hourly k=periodic checks',
    async (channel) => {
      const { checkMock, triggers } = await setup('2026-10-21T08:00:00Z', {
        updateChannel: channel,
        lastUpdateCheckDay: '2026-10-21',
      });

      await vi.advanceTimersByTimeAsync(STARTUP_CHECK_DELAY_MS);
      expect(triggers).toEqual(['startup']);

      await vi.advanceTimersByTimeAsync(3 * HOUR_MS);
      expect(checkMock).toHaveBeenCalledTimes(4);
      expect(triggers.slice(1)).toEqual(['periodic', 'periodic', 'periodic']);
    },
  );

  it('beta: focus/resume check only 4 h after the last check, regardless of day', async () => {
    const { checkMock, triggers, focus, resume } = await setup('2026-10-21T08:00:00Z', {
      updateChannel: 'beta',
    });
    // Drop the startup/hourly timers so only focus/resume drive checks.
    vi.clearAllTimers();

    focus();
    await settle();
    expect(triggers).toEqual(['focus']);

    // 3 h later: too soon.
    vi.setSystemTime(new Date('2026-10-21T11:00:00Z'));
    focus();
    resume();
    await settle();
    expect(checkMock).toHaveBeenCalledTimes(1);

    // 4 h later on the same UTC day: due again.
    vi.setSystemTime(new Date('2026-10-21T12:00:01Z'));
    resume();
    await settle();
    expect(triggers).toEqual(['focus', 'focus']);
  });
});

describe('a channel switch changes the cadence immediately', () => {
  it('beta → stable: the hourly tick stops once today’s check succeeded', async () => {
    const { service, checkMock, triggers } = await setup('2026-10-21T08:00:00Z', {
      updateChannel: 'beta',
    });

    await vi.advanceTimersByTimeAsync(HOUR_MS);
    expect(triggers).toEqual(['startup', 'periodic']);

    await service.setChannel('stable');
    await service.checkForUpdatesOnChannelSwitch();
    await settle();
    expect(triggers.at(-1)).toBe('channel');
    const calls = checkMock.mock.calls.length;

    await vi.advanceTimersByTimeAsync(3 * HOUR_MS);
    expect(checkMock.mock.calls.length).toBe(calls);
  });

  it('stable → alpha: hourly checks resume on the next tick', async () => {
    const { service, triggers } = await setup('2026-10-21T08:00:00Z', {
      lastUpdateCheckDay: '2026-10-21',
    });

    await vi.advanceTimersByTimeAsync(HOUR_MS);
    expect(triggers).toEqual([]);

    await service.setChannel('alpha');
    await service.checkForUpdatesOnChannelSwitch();
    await settle();
    await vi.advanceTimersByTimeAsync(2 * HOUR_MS);

    expect(triggers).toEqual(['channel', 'periodic', 'periodic']);
  });
});
