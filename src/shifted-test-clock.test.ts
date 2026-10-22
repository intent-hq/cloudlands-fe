// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SHIFTED_NOW_ENV,
  createShiftedDate,
  installShiftedTestClock,
  shiftedNowTarget,
  uninstallShiftedTestClock,
} from './shifted-test-clock';

const REAL_NOW = Date.UTC(2026, 9, 21, 8, 15, 0);
const HOUR_MS = 60 * 60 * 1000;

/** A stand-in global whose `Date` reads a controllable "real" clock. */
function fakeGlobal(realNowMs = REAL_NOW) {
  let current = realNowMs;
  const RealDate = new Proxy(Date, {
    construct: (target, args, newTarget) =>
      Reflect.construct(target, args.length ? args : [current], newTarget),
    get: (target, property) => (property === 'now' ? () => current : Reflect.get(target, property)),
  });
  return {
    global: { Date: RealDate } as { Date: DateConstructor },
    RealDate,
    tick: (ms: number) => {
      current += ms;
    },
  };
}

describe('shiftedNowTarget', () => {
  it('reads HH:MM and HH:MM:SS as a UTC time of day on the real UTC date', () => {
    expect(new Date(shiftedNowTarget('23:30', REAL_NOW)).toISOString()).toBe(
      '2026-10-21T23:30:00.000Z',
    );
    expect(new Date(shiftedNowTarget(' 00:05:09 ', REAL_NOW)).toISOString()).toBe(
      '2026-10-21T00:05:09.000Z',
    );
  });

  it('accepts an explicit timestamp', () => {
    expect(shiftedNowTarget('2026-12-31T23:59:00Z', REAL_NOW)).toBe(
      Date.UTC(2026, 11, 31, 23, 59, 0),
    );
  });

  it('rejects an out-of-range time of day or an unparseable value, naming the variable', () => {
    expect(() => shiftedNowTarget('24:00', REAL_NOW)).toThrow(SHIFTED_NOW_ENV);
    expect(() => shiftedNowTarget('12:60', REAL_NOW)).toThrow(/not a valid UTC time of day/);
    expect(() => shiftedNowTarget('late evening', REAL_NOW)).toThrow(/expected HH:MM/);
  });
});

describe('createShiftedDate', () => {
  it('shifts clock reads, keeps ticking, and leaves explicit dates alone', () => {
    const { RealDate, tick } = fakeGlobal();
    const ShiftedDate = createShiftedDate(RealDate, 15 * HOUR_MS);

    expect(new Date(ShiftedDate.now()).toISOString()).toBe('2026-10-21T23:15:00.000Z');
    expect(new ShiftedDate().toISOString()).toBe('2026-10-21T23:15:00.000Z');
    tick(1500);
    expect(ShiftedDate.now() - REAL_NOW).toBe(15 * HOUR_MS + 1500);

    expect(new ShiftedDate(0).getTime()).toBe(0);
    expect(new ShiftedDate('2026-01-02T03:04:05Z').toISOString()).toBe('2026-01-02T03:04:05.000Z');
    expect(ShiftedDate.UTC(2026, 0, 1)).toBe(Date.UTC(2026, 0, 1));
    expect(ShiftedDate.parse('2026-01-01T00:00:00Z')).toBe(Date.UTC(2026, 0, 1));
  });

  it('stays a Date: instanceof, subclassing, and the string-returning call form', () => {
    const { RealDate } = fakeGlobal();
    const ShiftedDate = createShiftedDate(RealDate, HOUR_MS);

    expect(new ShiftedDate()).toBeInstanceOf(Date);
    expect(new ShiftedDate() instanceof ShiftedDate).toBe(true);
    class Stamp extends ShiftedDate {}
    const stamp = new Stamp();
    expect(stamp).toBeInstanceOf(Stamp);
    expect(stamp.getTime()).toBe(REAL_NOW + HOUR_MS);
    expect((ShiftedDate as unknown as () => string)()).toBe(
      new Date(REAL_NOW + HOUR_MS).toString(),
    );
  });

  it('lets a test override or spy on Date.now without touching the shifted clock', () => {
    const { RealDate } = fakeGlobal();
    const ShiftedDate = createShiftedDate(RealDate, HOUR_MS);
    const shiftedNow = ShiftedDate.now;

    ShiftedDate.now = () => 0;
    expect(ShiftedDate.now()).toBe(0);
    expect(new ShiftedDate().getTime()).toBe(REAL_NOW + HOUR_MS);
    expect(RealDate.now()).toBe(REAL_NOW);
    // A wrapper around the saved reader (text-rebase-bench's installClock) must not recurse.
    ShiftedDate.now = () => shiftedNow() + 1;
    expect(ShiftedDate.now()).toBe(REAL_NOW + HOUR_MS + 1);
    ShiftedDate.now = shiftedNow;

    const spy = vi.spyOn(ShiftedDate, 'now').mockReturnValue(42);
    expect(ShiftedDate.now()).toBe(42);
    spy.mockRestore();
    expect(ShiftedDate.now()).toBe(REAL_NOW + HOUR_MS);
  });
});

describe('installShiftedTestClock', () => {
  it('is a no-op when the variable is unset or empty', () => {
    const { global, RealDate } = fakeGlobal();
    expect(installShiftedTestClock({}, global)).toBeNull();
    expect(installShiftedTestClock({ [SHIFTED_NOW_ENV]: '' }, global)).toBeNull();
    expect(global.Date).toBe(RealDate);
  });

  it('moves the clock to the target time of day once per process', () => {
    const { global, RealDate, tick } = fakeGlobal();
    const env = { [SHIFTED_NOW_ENV]: '23:30' };

    expect(installShiftedTestClock(env, global)).toBe(15 * HOUR_MS + 15 * 60 * 1000);
    const ShiftedDate = global.Date;
    expect(ShiftedDate).not.toBe(RealDate);
    expect(new global.Date().toISOString()).toBe('2026-10-21T23:30:00.000Z');

    // A later call (each test file's setup) keeps the first offset and Date.
    tick(HOUR_MS);
    expect(installShiftedTestClock({ [SHIFTED_NOW_ENV]: '07:00' }, global)).toBe(
      15 * HOUR_MS + 15 * 60 * 1000,
    );
    expect(global.Date).toBe(ShiftedDate);
    expect(new global.Date().toISOString()).toBe('2026-10-22T00:30:00.000Z');
  });

  it('maps the real Date back to the shifted one whenever it is reassigned', () => {
    const { global, RealDate } = fakeGlobal();
    installShiftedTestClock({ [SHIFTED_NOW_ENV]: '23:30' }, global);
    const ShiftedDate = global.Date;

    const FakeDate = class extends Date {} as DateConstructor; // fake timers / date mock
    global.Date = FakeDate;
    expect(global.Date).toBe(FakeDate);
    global.Date = RealDate; // vitest's resetDate() / fake-timer uninstall
    expect(global.Date).toBe(ShiftedDate);
  });

  it('uninstalls back to the real Date', () => {
    const { global, RealDate } = fakeGlobal();
    installShiftedTestClock({ [SHIFTED_NOW_ENV]: '23:30' }, global);
    uninstallShiftedTestClock(global);
    expect(global.Date).toBe(RealDate);
    global.Date = RealDate;
    expect(global.Date).toBe(RealDate);
    expect(installShiftedTestClock({ [SHIFTED_NOW_ENV]: '23:30' }, global)).not.toBeNull();
  });
});

describe('vitest fake timers under the shifted clock', () => {
  // Under the nightly run the setup file already installed the clock; keep that one.
  const installedBySetup = Boolean(process.env[SHIFTED_NOW_ENV]);
  let offsetMs = 0;
  beforeEach(() => {
    // Twelve hours from the real clock, so the shifted time is always far from real time.
    // Under the nightly run this returns the setup file's offset instead, and the
    // assertions compare against whichever offset is actually installed.
    const target = new Date(performance.timeOrigin + performance.now() + 12 * HOUR_MS);
    offsetMs = installShiftedTestClock({ [SHIFTED_NOW_ENV]: target.toISOString() }, globalThis)!;
  });
  afterEach(() => {
    vi.useRealTimers();
    if (!installedBySetup) uninstallShiftedTestClock(globalThis);
  });
  // The real wall clock from performance, which neither the shim nor Date mocks touch;
  // read before a test fakes timers (vitest fakes performance too).
  const shiftedNow = () => performance.timeOrigin + performance.now() + offsetMs;

  // The #3574 fallback: fake timers installed at "now", a pin, then clearAllTimers.
  it('falls back to the shifted time, not the real one, after clearAllTimers', () => {
    const expected = shiftedNow();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-21T08:00:00Z'));
    // eslint-disable-next-line intent/no-fake-clock-reset-before-assertion -- replays the fallback on purpose
    vi.clearAllTimers();

    expect(Math.abs(Date.now() - expected)).toBeLessThan(HOUR_MS);
  });

  // vitest restores its own pre-shim copy of Date after a date-only pin.
  it('falls back to the shifted time after a date-only pin and useRealTimers', () => {
    const expected = shiftedNow();
    vi.setSystemTime(new Date('2026-10-21T08:00:00Z'));
    // eslint-disable-next-line intent/no-fake-clock-reset-before-assertion -- replays the fallback on purpose
    vi.useRealTimers();

    expect(Math.abs(Date.now() - expected)).toBeLessThan(HOUR_MS);
    expect(new Date()).toBeInstanceOf(Date);
  });
});
