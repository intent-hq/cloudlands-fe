/**
 * Weekly/monthly actives, new installs and install age on the telemetry feed.
 *
 * Each telemetry check carries `w` (first successful check of the UTC ISO
 * week), `m` (first of the UTC month), `i` (first successful check ever on a
 * genuinely fresh install) and `a` (install-age bucket). Like `d`, the w/m/i
 * state only advances after a successful check, on any feed. The first-seen
 * day is recorded once: today for a fresh userData with no prior update
 * prefs, otherwise an estimate from userData's age (never `i=1`), or unknown.
 *
 * Fake clock: `vi.useFakeTimers()` runs once per test in beforeEach and
 * `setup()` pins the time right after; nothing here resets timers, so the
 * pinned time cannot be lost (see the #3574 merge-queue ejection).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import type { Mock } from 'vitest';

let testUserDataPath: string;
const liveWindows: unknown[] = [];
const userDataAge = vi.hoisted(() => ({ createdAtMs: null as number | null, calls: 0 }));

vi.mock('electron', () => ({
  app: {
    getPath: () => testUserDataPath,
    getVersion: () => '2.230.0',
    on: vi.fn(),
    off: vi.fn(),
  },
  BrowserWindow: { getAllWindows: () => liveWindows },
  powerMonitor: { on: vi.fn(), off: vi.fn() },
}));

vi.mock('../user-data-age', () => ({
  estimateDirCreatedAtMs: vi.fn(async () => {
    userDataAge.calls += 1;
    return userDataAge.createdAtMs;
  }),
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

const TELEMETRY_PREFIX = 'https://updates.intentapp.dev/desktop/';
const savedEnv = { ...process.env };

async function writePrefs(prefs: Record<string, unknown>): Promise<void> {
  await fs.writeFile(path.join(testUserDataPath, 'local-prefs.json'), JSON.stringify(prefs));
}

async function readPrefs(): Promise<Record<string, unknown>> {
  await vi.advanceTimersByTimeAsync(0);
  const { __drainLocalPrefsWriteChainForTesting } = await import('../../../../main/local-prefs');
  await __drainLocalPrefsWriteChainForTesting();
  try {
    return JSON.parse(await fs.readFile(path.join(testUserDataPath, 'local-prefs.json'), 'utf8'));
  } catch {
    return {};
  }
}

type Query = Record<string, string>;

/**
 * Start a service at `now` with `prefs` on disk. `feeds` records the query
 * of each check's telemetry feed (null when it ran on GitHub). Checks answer
 * "no update" unless `fail()` is called first. `inFlight(fn)` runs `fn` once
 * while the next request is pending (after its feed was built, before it
 * answers), e.g. to move the clock across a period boundary; whether that
 * request fails is fixed before `fn` runs.
 */
async function setup(now: string, prefs: Record<string, unknown> | null = {}) {
  vi.setSystemTime(new Date(now));
  if (prefs) await writePrefs(prefs);
  const svc = await import('../auto-update.service');
  const { default: electronUpdater } = await import('electron-updater');
  const updater = electronUpdater.autoUpdater;
  const checkMock = updater.checkForUpdates as unknown as Mock;
  const feedMock = updater.setFeedURL as unknown as Mock;
  const feeds: (Query | null)[] = [];
  let failing = false;
  let duringRequest: (() => void) | null = null;
  checkMock.mockImplementation(async () => {
    const url = (feedMock.mock.calls.at(-1)?.[0] as { url: string }).url;
    feeds.push(
      url.startsWith(TELEMETRY_PREFIX) ? Object.fromEntries(new URL(url).searchParams) : null,
    );
    updaterHandlers['checking-for-update']();
    const failsNow = failing;
    const pending = duringRequest;
    duringRequest = null;
    pending?.();
    if (failsNow) {
      const error = new Error('net::ERR_INTERNET_DISCONNECTED');
      updaterHandlers['error'](error);
      throw error;
    }
    updaterHandlers['update-not-available']({ version: '2.230.0' });
    return { updateInfo: { version: '2.230.0' } };
  });
  liveWindows.push({
    isDestroyed: () => false,
    webContents: {
      isDestroyed: () => false,
      getURL: () => 'app://workspaces/workspace/x',
      send: vi.fn(),
    },
  });
  await svc.autoUpdateService.initialize();
  return {
    service: svc.autoUpdateService,
    feeds,
    check: async () => {
      await svc.autoUpdateService.checkForUpdatesManual();
      await vi.advanceTimersByTimeAsync(0);
    },
    fail: (value = true) => {
      failing = value;
    },
    inFlight: (fn: () => void) => {
      duringRequest = fn;
    },
  };
}

/** Simulate a relaunch: drop the module graph and start again on the same userData. */
async function relaunch(now: string) {
  const { autoUpdateService } = await import('../auto-update.service');
  autoUpdateService.cleanup();
  const { __drainLocalPrefsWriteChainForTesting } = await import('../../../../main/local-prefs');
  await vi.advanceTimersByTimeAsync(0);
  await __drainLocalPrefsWriteChainForTesting();
  vi.resetModules();
  liveWindows.length = 0;
  return setup(now, null);
}

const cohort = (q: Query | null) => q && { w: q.w, m: q.m, i: q.i, a: q.a };

beforeEach(async () => {
  testUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'auto-update-cohorts-'));
  liveWindows.length = 0;
  userDataAge.createdAtMs = null;
  userDataAge.calls = 0;
  delete process.env.AUTO_UPDATE_URL;
  delete process.env.DO_NOT_TRACK;
  vi.clearAllMocks();
  vi.resetModules();
  vi.useFakeTimers();
});

afterEach(async () => {
  vi.clearAllTimers();
  const { autoUpdateService } = await import('../auto-update.service');
  autoUpdateService.cleanup();
  const { __drainLocalPrefsWriteChainForTesting } = await import('../../../../main/local-prefs');
  await __drainLocalPrefsWriteChainForTesting();
  vi.useRealTimers();
  await fs.rm(testUserDataPath, { recursive: true, force: true });
  process.env = { ...savedEnv };
});

describe('fresh install', () => {
  it('sends i=1 and a=0d on its first successful check, then i=0 for later checks', async () => {
    userDataAge.createdAtMs = Date.parse('2026-10-22T08:59:58Z');
    const { feeds, check } = await setup('2026-10-22T09:00:00Z', null);

    await check();
    await check();

    expect(feeds.map(cohort)).toEqual([
      { w: '1', m: '1', i: '1', a: '0d' },
      { w: '0', m: '0', i: '0', a: '0d' },
    ]);
    expect(await readPrefs()).toMatchObject({
      firstSeenDay: '2026-10-22',
      firstSeenEstimated: false,
      lastUpdateCheckDay: '2026-10-22',
      lastUpdateWeek: '2026-W43',
      lastUpdateMonth: '2026-10',
    });
  });

  it('never sends i=1 again after a relaunch, and the age grows from the recorded day', async () => {
    userDataAge.createdAtMs = Date.parse('2026-10-22T08:59:58Z');
    const first = await setup('2026-10-22T09:00:00Z', null);
    await first.check();

    const second = await relaunch('2026-10-30T09:00:00Z');
    await second.check();

    expect(cohort(second.feeds[0])).toEqual({ w: '1', m: '0', i: '0', a: '8-30d' });
    expect(userDataAge.calls).toBe(1);
  });

  it('a failed first check does not advance w/m/i, so the next launch still sends them', async () => {
    userDataAge.createdAtMs = Date.parse('2026-10-22T08:59:58Z');
    const first = await setup('2026-10-22T09:00:00Z', null);
    first.fail();
    await first.check();

    const prefs = await readPrefs();
    expect(prefs).toMatchObject({ firstSeenDay: '2026-10-22', firstSeenEstimated: false });
    expect(prefs).not.toHaveProperty('lastUpdateWeek');
    expect(prefs).not.toHaveProperty('lastUpdateMonth');
    expect(prefs).not.toHaveProperty('lastUpdateCheckDay');

    const second = await relaunch('2026-10-22T10:00:00Z');
    await second.check();
    expect(cohort(second.feeds[0])).toEqual({ w: '1', m: '1', i: '1', a: '0d' });
  });
});

describe('existing install upgrading into cohorts', () => {
  it('estimates the first-seen day from userData and never sends i=1', async () => {
    userDataAge.createdAtMs = Date.parse('2025-06-01T12:00:00Z');
    const { feeds, check } = await setup('2026-10-22T09:00:00Z', {
      lastUpdateCheckDay: '2026-10-21',
    });

    await check();

    expect(cohort(feeds[0])).toEqual({ w: '1', m: '1', i: '0', a: '365d+' });
    expect(await readPrefs()).toMatchObject({
      firstSeenDay: '2025-06-01',
      firstSeenEstimated: true,
    });
  });

  it('treats a userData older than this process as an existing install even with no prefs', async () => {
    userDataAge.createdAtMs = Date.parse('2026-10-01T12:00:00Z');
    const { feeds, check } = await setup('2026-10-22T09:00:00Z', null);

    await check();

    expect(cohort(feeds[0])).toEqual({ w: '1', m: '1', i: '0', a: '8-30d' });
  });

  it('sends a=unknown when userData has no usable timestamp, and does not re-estimate', async () => {
    userDataAge.createdAtMs = null;
    const first = await setup('2026-10-22T09:00:00Z', { lastUpdateCheckDay: '2026-10-21' });
    await first.check();
    expect(cohort(first.feeds[0])).toEqual({ w: '1', m: '1', i: '0', a: 'unknown' });
    const prefs = await readPrefs();
    expect(prefs.firstSeenEstimated).toBe(true);
    expect(prefs).not.toHaveProperty('firstSeenDay');

    userDataAge.createdAtMs = Date.parse('2026-01-01T00:00:00Z');
    const second = await relaunch('2026-10-23T09:00:00Z');
    await second.check();
    expect(cohort(second.feeds[0])?.a).toBe('unknown');
    expect(userDataAge.calls).toBe(1);
  });

  it('treats missing or malformed week/month prefs as no previous check', async () => {
    const { feeds, check } = await setup('2026-10-22T09:00:00Z', {
      lastUpdateCheckDay: '2026-10-22',
      lastUpdateWeek: 42,
      firstSeenDay: '2026-10-20',
      firstSeenEstimated: false,
    });

    await check();

    expect(cohort(feeds[0])).toEqual({ w: '1', m: '1', i: '0', a: '1-7d' });
  });
});

describe('rollover', () => {
  const settled = {
    firstSeenDay: '2026-01-10',
    firstSeenEstimated: false,
  };

  it('sends w=1 again after Sunday → Monday UTC, without m=1 inside the month', async () => {
    const { feeds, check } = await setup('2026-10-25T23:59:00Z', {
      ...settled,
      lastUpdateCheckDay: '2026-10-25',
      lastUpdateWeek: '2026-W43',
      lastUpdateMonth: '2026-10',
    });

    await check();
    vi.setSystemTime(new Date('2026-10-26T00:00:30Z'));
    await check();
    await check();

    expect(feeds.map((q) => q && { w: q.w, m: q.m })).toEqual([
      { w: '0', m: '0' },
      { w: '1', m: '0' },
      { w: '0', m: '0' },
    ]);
    expect((await readPrefs()).lastUpdateWeek).toBe('2026-W44');
  });

  it('sends m=1 again after the UTC month rolls over mid-week', async () => {
    const { feeds, check } = await setup('2026-10-31T23:59:00Z', {
      ...settled,
      lastUpdateCheckDay: '2026-10-31',
      lastUpdateWeek: '2026-W44',
      lastUpdateMonth: '2026-10',
    });

    await check();
    vi.setSystemTime(new Date('2026-11-01T00:00:30Z'));
    await check();

    expect(feeds.map((q) => q && { w: q.w, m: q.m })).toEqual([
      { w: '0', m: '0' },
      { w: '0', m: '1' },
    ]);
    expect((await readPrefs()).lastUpdateMonth).toBe('2026-11');
  });

  it('across the year boundary keeps ISO week 2026-W53 and starts a new month', async () => {
    const { feeds, check } = await setup('2026-12-31T23:59:00Z', {
      ...settled,
      lastUpdateCheckDay: '2026-12-31',
      lastUpdateWeek: '2026-W53',
      lastUpdateMonth: '2026-12',
    });

    await check();
    vi.setSystemTime(new Date('2027-01-01T00:00:30Z'));
    await check();
    vi.setSystemTime(new Date('2027-01-04T00:00:30Z'));
    await check();

    expect(feeds.map((q) => q && { d: q.d, w: q.w, m: q.m })).toEqual([
      { d: '0', w: '0', m: '0' },
      { d: '1', w: '0', m: '1' },
      { d: '1', w: '1', m: '0' },
    ]);
  });
});

describe('rollover while a check is in flight', () => {
  const settled = {
    firstSeenDay: '2026-01-10',
    firstSeenEstimated: false,
  };

  it('a week rolling over mid-request records the week the request reported, so the new week still sends w=1', async () => {
    const { feeds, check, inFlight } = await setup('2026-10-25T23:59:59Z', {
      ...settled,
      lastUpdateCheckDay: '2026-10-25',
      lastUpdateWeek: '2026-W43',
      lastUpdateMonth: '2026-10',
    });

    inFlight(() => vi.setSystemTime(new Date('2026-10-26T00:00:30Z')));
    await check();
    expect((await readPrefs()).lastUpdateWeek).toBe('2026-W43');
    await check();
    await check();

    expect(feeds.map((q) => q && { w: q.w, m: q.m })).toEqual([
      { w: '0', m: '0' },
      { w: '1', m: '0' },
      { w: '0', m: '0' },
    ]);
    expect((await readPrefs()).lastUpdateWeek).toBe('2026-W44');
  });

  it('a month rolling over mid-request records the month the request reported, so the new month still sends m=1', async () => {
    const { feeds, check, inFlight } = await setup('2026-10-31T23:59:59Z', {
      ...settled,
      lastUpdateCheckDay: '2026-10-31',
      lastUpdateWeek: '2026-W44',
      lastUpdateMonth: '2026-10',
    });

    inFlight(() => vi.setSystemTime(new Date('2026-11-01T00:00:30Z')));
    await check();
    expect((await readPrefs()).lastUpdateMonth).toBe('2026-10');
    await check();

    expect(feeds.map((q) => q && { w: q.w, m: q.m })).toEqual([
      { w: '0', m: '0' },
      { w: '0', m: '1' },
    ]);
    expect((await readPrefs()).lastUpdateMonth).toBe('2026-11');
  });

  it('keeps the once-a-day cadence: the day is still the day the check succeeded', async () => {
    const { check, inFlight } = await setup('2026-10-25T23:59:59Z', {
      ...settled,
      lastUpdateCheckDay: '2026-10-25',
      lastUpdateWeek: '2026-W43',
      lastUpdateMonth: '2026-10',
    });

    inFlight(() => vi.setSystemTime(new Date('2026-10-26T00:00:30Z')));
    await check();

    expect(await readPrefs()).toMatchObject({
      lastUpdateCheckDay: '2026-10-26',
      lastUpdateWeek: '2026-W43',
    });
  });

  it('a failed check spanning the rollover records nothing', async () => {
    const { feeds, check, inFlight, fail } = await setup('2026-10-25T23:59:59Z', {
      ...settled,
      lastUpdateCheckDay: '2026-10-25',
      lastUpdateWeek: '2026-W43',
      lastUpdateMonth: '2026-10',
    });

    fail();
    inFlight(() => vi.setSystemTime(new Date('2026-10-26T00:00:30Z')));
    await check();
    expect(await readPrefs()).toMatchObject({
      lastUpdateCheckDay: '2026-10-25',
      lastUpdateWeek: '2026-W43',
    });
    expect(feeds).toHaveLength(2);
  });

  it('a GitHub fallback built before the rollover and answered after it records the pre-rollover week', async () => {
    const first = await setup('2026-10-25T23:59:59Z', {
      ...settled,
      lastUpdateCheckDay: '2026-10-25',
      lastUpdateWeek: '2026-W43',
      lastUpdateMonth: '2026-10',
    });

    first.fail();
    first.inFlight(() => {
      first.fail(false);
      first.inFlight(() => vi.setSystemTime(new Date('2026-10-26T00:00:30Z')));
    });
    await first.check();

    expect(first.feeds.map((q) => q && { w: q.w })).toEqual([{ w: '0' }, null]);
    expect((await readPrefs()).lastUpdateWeek).toBe('2026-W43');

    const second = await relaunch('2026-10-26T09:00:00Z');
    await second.check();
    expect(cohort(second.feeds[0])?.w).toBe('1');
  });

  it('a GitHub fallback built after the rollover records the new week', async () => {
    const { feeds, check, inFlight, fail } = await setup('2026-10-25T23:59:59Z', {
      ...settled,
      lastUpdateCheckDay: '2026-10-25',
      lastUpdateWeek: '2026-W43',
      lastUpdateMonth: '2026-10',
    });

    fail();
    inFlight(() => {
      fail(false);
      vi.setSystemTime(new Date('2026-10-26T00:00:30Z'));
    });
    await check();

    expect(feeds.map((q) => q && { w: q.w })).toEqual([{ w: '0' }, null]);
    expect((await readPrefs()).lastUpdateWeek).toBe('2026-W44');
  });
});

describe('opt-outs', () => {
  it('a successful GitHub check with the toggle off still advances w/m/i', async () => {
    userDataAge.createdAtMs = Date.parse('2026-10-22T08:59:58Z');
    const first = await setup('2026-10-22T09:00:00Z', { shareUpdateStatistics: false });
    await first.check();
    expect(first.feeds).toEqual([null]);
    expect(await readPrefs()).toMatchObject({
      lastUpdateWeek: '2026-W43',
      lastUpdateMonth: '2026-10',
    });
  });
});
