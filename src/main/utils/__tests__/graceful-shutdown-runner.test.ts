/**
 * Runtime guard for the signal shutdown path: the window-session save that
 * SIGTERM/SIGINT perform must run inside the hard-exit watchdog, so a stalled
 * save cannot keep the process alive, and repeated signals must not queue
 * additional saves.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { runGracefulShutdown, type GracefulShutdownSteps } from '../graceful-shutdown-runner';

const HARD_EXIT_MS = 10_000;

function makeSteps(overrides: Partial<GracefulShutdownSteps> = {}) {
  let shuttingDown = false;
  const order: string[] = [];
  const steps: GracefulShutdownSteps = {
    beginTeardown: vi.fn(() => {
      if (shuttingDown) return false;
      shuttingDown = true;
      order.push('begin');
      return true;
    }),
    persistWindowSessions: vi.fn(async () => {
      order.push('persist');
    }),
    onPersistError: vi.fn(),
    cleanup: vi.fn(async () => {
      order.push('cleanup');
    }),
    onHardExit: vi.fn(),
    hardExitMs: HARD_EXIT_MS,
    ...overrides,
  };
  return { steps, order };
}

describe('runGracefulShutdown', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('hard-exits when the window-session save stalls, without reaching cleanup', async () => {
    const { steps } = makeSteps({
      persistWindowSessions: vi.fn(() => new Promise<never>(() => {})),
    });

    void runGracefulShutdown(steps, { persistWindowSessions: true });
    await vi.advanceTimersByTimeAsync(HARD_EXIT_MS - 1);
    expect(steps.onHardExit).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(steps.onHardExit).toHaveBeenCalledTimes(1);
    expect(steps.cleanup).not.toHaveBeenCalled();
  });

  it('repeated signals during a pending save do not start more saves', async () => {
    const { steps } = makeSteps({
      persistWindowSessions: vi.fn(() => new Promise<never>(() => {})),
    });

    void runGracefulShutdown(steps, { persistWindowSessions: true });
    void runGracefulShutdown(steps, { persistWindowSessions: true });
    void runGracefulShutdown(steps, { persistWindowSessions: true });
    await vi.advanceTimersByTimeAsync(0);

    expect(steps.persistWindowSessions).toHaveBeenCalledTimes(1);
    expect(steps.cleanup).not.toHaveBeenCalled();
  });

  it('claims teardown, then saves, then cleans up, then disarms the watchdog', async () => {
    const { steps, order } = makeSteps();

    await runGracefulShutdown(steps, { persistWindowSessions: true });
    await vi.advanceTimersByTimeAsync(HARD_EXIT_MS);

    expect(order).toEqual(['begin', 'persist', 'cleanup']);
    expect(steps.onHardExit).not.toHaveBeenCalled();
  });

  it('still cleans up when the save rejects', async () => {
    const failure = new Error('disk full');
    const { steps } = makeSteps({
      persistWindowSessions: vi.fn(async () => Promise.reject(failure)),
    });

    await runGracefulShutdown(steps, { persistWindowSessions: true });

    expect(steps.onPersistError).toHaveBeenCalledWith(failure);
    expect(steps.cleanup).toHaveBeenCalledTimes(1);
  });

  it('skips the save unless asked', async () => {
    const { steps } = makeSteps();

    await runGracefulShutdown(steps);

    expect(steps.persistWindowSessions).not.toHaveBeenCalled();
    expect(steps.cleanup).toHaveBeenCalledTimes(1);
  });
});
