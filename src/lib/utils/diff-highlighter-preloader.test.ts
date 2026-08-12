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

  it('terminates a pool created without a lease, so preload cannot pin workers for the session', async () => {
    const { preloader, worker } = await loadModules();

    // The idle-preload path creates the pool directly; no viewer ever takes a
    // lease, so nothing would release it.
    preloader.getDiffWorkerPool();
    expect(preloader.inspectDiffWorkerPoolLifecycle()).toMatchObject({
      created: 1,
      terminated: 0,
      live: 1,
      activeLeases: 0,
    });

    await vi.advanceTimersByTimeAsync(preloader.DIFF_WORKER_POOL_IDLE_TERMINATION_MS);

    expect(worker.terminateWorkerPoolSingleton).toHaveBeenCalledTimes(1);
    expect(preloader.inspectDiffWorkerPoolLifecycle()).toMatchObject({
      created: 1,
      terminated: 1,
      live: 0,
      activeLeases: 0,
      alive: false,
    });
  });

  it('keeps a preload-created pool alive when a viewer leases it inside the idle window', async () => {
    const { preloader, worker } = await loadModules();

    preloader.getDiffWorkerPool();
    await vi.advanceTimersByTimeAsync(preloader.DIFF_WORKER_POOL_IDLE_TERMINATION_MS / 2);

    preloader.acquireDiffWorkerPool();
    await vi.advanceTimersByTimeAsync(preloader.DIFF_WORKER_POOL_IDLE_TERMINATION_MS * 2);

    expect(worker.terminateWorkerPoolSingleton).not.toHaveBeenCalled();
    expect(preloader.inspectDiffWorkerPoolLifecycle()).toMatchObject({ live: 1, activeLeases: 1 });
  });

  it('pairs every create with a terminate across repeated open/close cycles', async () => {
    const { preloader, worker } = await loadModules();

    for (let cycle = 0; cycle < 5; cycle += 1) {
      preloader.acquireDiffWorkerPool();
      preloader.acquireDiffWorkerPool();
      preloader.releaseDiffWorkerPool();
      preloader.releaseDiffWorkerPool();
      await vi.advanceTimersByTimeAsync(preloader.DIFF_WORKER_POOL_IDLE_TERMINATION_MS);

      const stats = preloader.inspectDiffWorkerPoolLifecycle();
      expect(stats.created).toBe(cycle + 1);
      expect(stats.terminated).toBe(cycle + 1);
      expect(stats.live).toBe(0);
      expect(stats.activeLeases).toBe(0);
    }

    expect(worker.getOrCreateWorkerPoolSingleton).toHaveBeenCalledTimes(5);
    expect(worker.terminateWorkerPoolSingleton).toHaveBeenCalledTimes(5);
  });

  it('terminates the pool when the renderer goes away', async () => {
    const { preloader, worker } = await loadModules();

    preloader.acquireDiffWorkerPool();
    window.dispatchEvent(Object.assign(new Event('pagehide'), { persisted: false }));

    expect(worker.terminateWorkerPoolSingleton).toHaveBeenCalledTimes(1);
    expect(preloader.inspectDiffWorkerPoolLifecycle()).toMatchObject({
      live: 0,
      activeLeases: 0,
      alive: false,
    });
  });

  it('ignores a persisted pagehide so a bfcache restore keeps its pool', async () => {
    const { preloader, worker } = await loadModules();

    preloader.acquireDiffWorkerPool();
    window.dispatchEvent(Object.assign(new Event('pagehide'), { persisted: true }));

    expect(worker.terminateWorkerPoolSingleton).not.toHaveBeenCalled();
    expect(preloader.inspectDiffWorkerPoolLifecycle()).toMatchObject({ live: 1, activeLeases: 1 });
  });
});
