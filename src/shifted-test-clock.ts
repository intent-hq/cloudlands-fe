/**
 * Opt-in shifted wall clock for the unit suite (`VITEST_SHIFTED_NOW`).
 *
 * A test that pins a fake clock and then falls back to the real one passes or fails
 * depending on when CI runs: intent-hq/cloudlands-fe#3574 passed its PR checks in the
 * morning and failed 20/20 in the merge queue after 08:00 UTC. The nightly
 * shifted-clock workflow runs the suite with the real clock moved to an odd time of
 * day so such tests fail on schedule instead of in the queue.
 *
 * The shifted clock keeps ticking: `Date.now()` and `new Date()` return the real time
 * plus a fixed offset, so elapsed-time code still works. Dates built from explicit
 * arguments, `Date.UTC` and `Date.parse` are unchanged. It is installed before vitest's
 * fake timers first read `Date.now()`, so `vi.useFakeTimers()` and `vi.clearAllTimers()`
 * fall back to the shifted time, exactly the fallback that broke #3574.
 */

export const SHIFTED_NOW_ENV = 'VITEST_SHIFTED_NOW';

const STATE = Symbol.for('intent.vitest.shiftedTestClock');

const TIME_OF_DAY = /^(\d{2}):(\d{2})(?::(\d{2}))?$/;

interface ShiftedClockState {
  realDate: DateConstructor;
  shiftedDate: DateConstructor;
  offsetMs: number;
}

type ClockGlobal = { Date: DateConstructor; [STATE]?: ShiftedClockState };

/**
 * The epoch milliseconds `value` names: `HH:MM[:SS]` is that UTC time of day on the
 * real UTC date of `realNowMs`; anything else must be a parseable timestamp.
 */
export function shiftedNowTarget(value: string, realNowMs: number): number {
  const timeOfDay = TIME_OF_DAY.exec(value.trim());
  if (timeOfDay) {
    const [hours, minutes, seconds] = timeOfDay.slice(1).map((part) => Number(part ?? 0));
    if (hours > 23 || minutes > 59 || seconds > 59) {
      throw new Error(`${SHIFTED_NOW_ENV}: ${value} is not a valid UTC time of day`);
    }
    const day = new Date(realNowMs);
    return Date.UTC(
      day.getUTCFullYear(),
      day.getUTCMonth(),
      day.getUTCDate(),
      hours,
      minutes,
      seconds,
    );
  }
  const target = Date.parse(value);
  if (Number.isNaN(target)) {
    throw new Error(`${SHIFTED_NOW_ENV}: expected HH:MM[:SS] (UTC) or a timestamp, got ${value}`);
  }
  return target;
}

/**
 * A `Date` whose clock reads run `offsetMs` ahead of `RealDate`'s. `now` is an ordinary
 * own property, so a test that assigns or spies on `Date.now` overrides this one only;
 * the shifted clock keeps reading the `RealDate.now` captured here.
 */
export function createShiftedDate(RealDate: DateConstructor, offsetMs: number): DateConstructor {
  const realNow = RealDate.now;
  const now = () => realNow.call(RealDate) + offsetMs;
  function ShiftedDate(this: unknown, ...args: unknown[]) {
    // `Date()` without `new` returns the current time as a string.
    if (!new.target) return new RealDate(now()).toString();
    return Reflect.construct(RealDate, args.length ? args : [now()], new.target);
  }
  // Statics (`UTC`, `parse`) come from `RealDate`; instances share its prototype, so
  // `instanceof Date` and subclasses behave as with the real constructor.
  Object.setPrototypeOf(ShiftedDate, RealDate);
  ShiftedDate.prototype = RealDate.prototype;
  Object.defineProperty(ShiftedDate, 'now', {
    value: now,
    writable: true,
    configurable: true,
    enumerable: false,
  });
  return ShiftedDate as unknown as DateConstructor;
}

/**
 * Install the shifted clock on `global` when `env` sets {@link SHIFTED_NOW_ENV}, once
 * per process. `global.Date` becomes an accessor: assigning the real `Date` back (vitest
 * does after a date-only `vi.setSystemTime`, from its own copy captured before this
 * runs) yields the shifted `Date` again, even mid-test, while any other assignment
 * (fake timers, vitest's date mock) is kept as is. Returns the offset, or `null` when
 * the variable is unset.
 *
 * Only the global `Date` binding moves: child processes, file timestamps, and
 * `vi.getRealSystemTime()` keep the real clock.
 */
export function installShiftedTestClock(
  env: Record<string, string | undefined> = process.env,
  global: ClockGlobal = globalThis as unknown as ClockGlobal,
): number | null {
  const value = env[SHIFTED_NOW_ENV];
  if (!value) return null;
  const existing = global[STATE];
  if (existing) return existing.offsetMs;

  const realDate = global.Date;
  const realNowMs = realDate.now();
  const offsetMs = shiftedNowTarget(value, realNowMs) - realNowMs;
  const shiftedDate = createShiftedDate(realDate, offsetMs);
  let current = shiftedDate;
  Object.defineProperty(global, 'Date', {
    configurable: true,
    enumerable: false,
    get: () => current,
    set: (next: DateConstructor) => {
      current = next === realDate ? shiftedDate : next;
    },
  });
  global[STATE] = { realDate, shiftedDate, offsetMs };
  return offsetMs;
}

/** Undo {@link installShiftedTestClock} on `global` (tests of the shim only). */
export function uninstallShiftedTestClock(
  global: ClockGlobal = globalThis as unknown as ClockGlobal,
): void {
  const state = global[STATE];
  if (!state) return;
  Object.defineProperty(global, 'Date', {
    configurable: true,
    enumerable: false,
    writable: true,
    value: state.realDate,
  });
  delete global[STATE];
}
