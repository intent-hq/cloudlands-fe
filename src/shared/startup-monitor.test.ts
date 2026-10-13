import { afterEach, describe, expect, it, vi } from 'vitest';
import { StartupMonitor } from './startup-monitor';
import { isStartupError, parseStartupSnapshot } from './startup-status';

const snapshot = {
  startupStatus: 1,
  attemptId: 'boot-a',
  phase: 'indexing',
  elapsedMs: 2400,
  phaseElapsedMs: 2300,
  progressAgeMs: 0,
  retryAfterMs: 1000,
  progress: {
    completedNotes: 5,
    totalNotes: 12,
    processedSourceBytes: 1000,
    totalSourceBytes: 5000,
  },
};
const error = { rpcCode: -32012, data: { code: 'daemon-not-ready', startup: snapshot } };
afterEach(() => vi.useRealTimers());

describe('startup snapshot admission', () => {
  it.each([
    null,
    { ...snapshot, startupStatus: 2 },
    { ...snapshot, elapsedMs: -1 },
    { ...snapshot, progress: { ...snapshot.progress, completedNotes: 13 } },
    { ...snapshot, phase: 'finalizing' },
    { ...snapshot, estimatedRemainingMs: null },
  ])('rejects invalid snapshots %j', (input) => {
    expect(parseStartupSnapshot(input)).toBeNull();
  });
  it('recognizes not-ready separately from unsupported and unauthenticated failures', () => {
    expect(isStartupError(error)).toBe(true);
    expect(isStartupError({ rpcCode: -32601 })).toBe(false);
    expect(isStartupError({ rpcCode: -32012 })).toBe(true);
  });
});

describe('startup polling', () => {
  it('keeps fresh unchanged progress distinct from missed updates and recovers without inventing ETA', async () => {
    vi.useFakeTimers();
    const request = vi
      .fn()
      .mockResolvedValueOnce({ ...snapshot, progressAgeMs: 31000 })
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce({ ...snapshot, estimatedRemainingMs: 8000 });
    const monitor = new StartupMonitor(vi.fn());
    monitor.start(error, request, vi.fn());
    await vi.advanceTimersByTimeAsync(1000);
    expect(monitor.state).toMatchObject({ available: true, snapshot: { progressAgeMs: 31000 } });
    await vi.advanceTimersByTimeAsync(1000);
    expect(monitor.state?.available).toBe(false);
    await vi.advanceTimersByTimeAsync(1000);
    expect(monitor.state).toMatchObject({
      available: true,
      snapshot: { estimatedRemainingMs: 8000 },
    });
    monitor.stop();
  });
  it('polls single-flight, retires late responses and resets attempts', async () => {
    vi.useFakeTimers();
    let resolve!: (value: unknown) => void;
    const request = vi.fn(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const monitor = new StartupMonitor(vi.fn());
    monitor.start(error, request, vi.fn());
    await vi.advanceTimersByTimeAsync(10000);
    expect(request).toHaveBeenCalledTimes(1);
    monitor.start(
      {
        ...error,
        data: { ...error.data, startup: { ...snapshot, attemptId: 'boot-b', progress: undefined } },
      },
      vi.fn(),
      vi.fn(),
    );
    resolve({ ...snapshot, phase: 'ready', retryAfterMs: undefined });
    await Promise.resolve();
    expect(monitor.state?.snapshot?.attemptId).toBe('boot-b');
    expect(monitor.state?.snapshot?.progress).toBeUndefined();
    monitor.stop();
  });
  it('does not complete at N/N or finalizing and reconnects only at ready', async () => {
    vi.useFakeTimers();
    const request = vi
      .fn()
      .mockResolvedValueOnce({ ...snapshot, phase: 'finalizing', finalizingStep: 'committing' })
      .mockResolvedValueOnce({ ...snapshot, phase: 'ready', retryAfterMs: undefined });
    const reconnect = vi.fn();
    const monitor = new StartupMonitor(vi.fn());
    monitor.start(error, request, reconnect);
    await vi.advanceTimersByTimeAsync(1000);
    expect(reconnect).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(reconnect).toHaveBeenCalledOnce();
    monitor.stop();
  });
  it('gates an unknown schema without fabricated progress and stops after terminal failure', async () => {
    vi.useFakeTimers();
    const request = vi.fn().mockResolvedValue({
      ...snapshot,
      phase: 'failed',
      retryAfterMs: undefined,
      failure: { code: 'startup-failed', message: 'Daemon startup failed. Check daemon logs.' },
    });
    const monitor = new StartupMonitor(vi.fn());
    monitor.start(
      { ...error, data: { ...error.data, startup: { ...snapshot, startupStatus: 9 } } },
      request,
      vi.fn(),
    );
    expect(monitor.state).toEqual({ snapshot: null, available: false });
    await vi.advanceTimersByTimeAsync(20000);
    expect(request).toHaveBeenCalledOnce();
    expect(monitor.state?.snapshot?.phase).toBe('failed');
    monitor.stop();
  });
});
