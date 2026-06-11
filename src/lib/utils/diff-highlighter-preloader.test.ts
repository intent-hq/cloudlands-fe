import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

async function loadModules() {
  vi.resetModules();
  const worker = await import('@pierre/diffs/worker');
  const preloader = await import('./diff-highlighter-preloader');
  return { preloader, worker };
}

describe('diff-highlighter-preloader worker pool leases', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('keeps the worker pool alive until the last active lease is released and idle expires', async () => {
    const { preloader, worker } = await loadModules();

    const firstPool = preloader.acquireDiffWorkerPool();
    const secondPool = preloader.acquireDiffWorkerPool();

    expect(secondPool).toBe(firstPool);
    expect(worker.getOrCreateWorkerPoolSingleton).toHaveBeenCalledTimes(1);

    preloader.releaseDiffWorkerPool();
    await vi.advanceTimersByTimeAsync(preloader.DIFF_WORKER_POOL_IDLE_TERMINATION_MS);
    expect(worker.terminateWorkerPoolSingleton).not.toHaveBeenCalled();

    preloader.releaseDiffWorkerPool();
    await vi.advanceTimersByTimeAsync(preloader.DIFF_WORKER_POOL_IDLE_TERMINATION_MS - 1);
    expect(worker.terminateWorkerPoolSingleton).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(worker.terminateWorkerPoolSingleton).toHaveBeenCalledTimes(1);
    expect(preloader.isDiffHighlighterPreloaded()).toBe(false);
  });

  it('cancels idle termination when a new lease is acquired during the idle window', async () => {
    const { preloader, worker } = await loadModules();

    preloader.acquireDiffWorkerPool();
    preloader.releaseDiffWorkerPool();
    await vi.advanceTimersByTimeAsync(preloader.DIFF_WORKER_POOL_IDLE_TERMINATION_MS / 2);

    preloader.acquireDiffWorkerPool();
    await vi.advanceTimersByTimeAsync(preloader.DIFF_WORKER_POOL_IDLE_TERMINATION_MS);
    expect(worker.terminateWorkerPoolSingleton).not.toHaveBeenCalled();

    preloader.releaseDiffWorkerPool();
    await vi.advanceTimersByTimeAsync(preloader.DIFF_WORKER_POOL_IDLE_TERMINATION_MS);
    expect(worker.terminateWorkerPoolSingleton).toHaveBeenCalledTimes(1);
  });
});
