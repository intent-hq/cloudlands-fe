/**
 * Tests for the graceful-shutdown hard-exit watchdog
 * (intent-hq/monorepo#1300): a stalled cleanup chain must trigger the
 * forced-exit callback, while normal completion must not.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { runWithHardExitTimeout } from '../hard-exit-timeout';

const TIMEOUT_MS = 10_000;

describe('runWithHardExitTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('fires onTimeout when the cleanup routine stalls past the deadline', () => {
    const onTimeout = vi.fn();
    void runWithHardExitTimeout(() => new Promise<never>(() => {}), onTimeout, TIMEOUT_MS);

    vi.advanceTimersByTime(TIMEOUT_MS - 1);
    expect(onTimeout).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it('does not fire onTimeout when the routine completes in time', async () => {
    const onTimeout = vi.fn();
    const result = await runWithHardExitTimeout(
      () => Promise.resolve('done'),
      onTimeout,
      TIMEOUT_MS,
    );
    expect(result).toBe('done');

    vi.advanceTimersByTime(TIMEOUT_MS * 2);
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it('clears the timer when the routine rejects', async () => {
    const onTimeout = vi.fn();
    await expect(
      runWithHardExitTimeout(() => Promise.reject(new Error('boom')), onTimeout, TIMEOUT_MS),
    ).rejects.toThrow('boom');

    vi.advanceTimersByTime(TIMEOUT_MS * 2);
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it('clears the timer and rethrows when the routine throws synchronously', () => {
    const onTimeout = vi.fn();
    expect(() =>
      runWithHardExitTimeout(
        () => {
          throw new Error('sync boom');
        },
        onTimeout,
        TIMEOUT_MS,
      ),
    ).toThrow('sync boom');

    vi.advanceTimersByTime(TIMEOUT_MS * 2);
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it('unrefs the watchdog timer so it cannot keep the process alive', () => {
    const unref = vi.fn();
    vi.spyOn(globalThis, 'setTimeout').mockReturnValue({
      unref,
    } as unknown as ReturnType<typeof setTimeout>);

    void runWithHardExitTimeout(() => new Promise<never>(() => {}), vi.fn(), TIMEOUT_MS);
    expect(unref).toHaveBeenCalledTimes(1);
  });
});
