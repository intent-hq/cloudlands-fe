import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProgressiveRenderQueue } from '../progressive-render-queue';

const request = (source: string, isStreaming = true, revision = '') => ({
  source,
  isStreaming,
  revision,
});
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
afterEach(() => vi.useRealTimers());

describe('progressive render queue', () => {
  it('bounds bursts to one in-flight and one latest trailing snapshot without starving paint', async () => {
    vi.useFakeTimers();
    const first = deferred();
    const painted: string[] = [];
    const render = vi.fn(async (r, current) => {
      if (r.source === 'A') await first.promise;
      if (current()) painted.push(r.source);
    });
    const queue = createProgressiveRenderQueue(render);
    queue.update(request('A'));
    for (let i = 1; i <= 100; i++) queue.update(request('A' + 'B'.repeat(i)));
    expect(render).toHaveBeenCalledTimes(1);
    first.resolve();
    await Promise.resolve();
    expect(painted).toEqual(['A']);
    await vi.advanceTimersByTimeAsync(80);
    expect(render).toHaveBeenCalledTimes(2);
    expect(painted[1]).toBe('A' + 'B'.repeat(100));
    queue.dispose();
  });

  it.each(['final', 'replacement', 'theme'])('invalidates stale %s work', async (kind) => {
    vi.useFakeTimers();
    const first = deferred();
    const painted: string[] = [];
    const render = vi.fn(async (r, current) => {
      if (render.mock.calls.length === 1) await first.promise;
      if (current()) painted.push(r.source + ':' + r.isStreaming + ':' + r.revision);
    });
    const queue = createProgressiveRenderQueue(render);
    queue.update(request('A'));
    const next =
      kind === 'final'
        ? request('A', false)
        : kind === 'theme'
          ? request('A', true, 'dark')
          : request('Z');
    queue.update(next);
    first.resolve();
    await vi.runAllTimersAsync();
    expect(painted).toEqual([next.source + ':' + next.isStreaming + ':' + next.revision]);
    expect(render).toHaveBeenCalledTimes(2);
    queue.dispose();
  });

  it('revalidates unchanged source on stream end but skips identical updates', async () => {
    vi.useFakeTimers();
    const render = vi.fn(async () => {});
    const queue = createProgressiveRenderQueue(render);
    queue.update(request('A'));
    queue.update(request('A'));
    await vi.runAllTimersAsync();
    expect(render).toHaveBeenCalledTimes(1);
    queue.update(request('A', false));
    await vi.runAllTimersAsync();
    expect(render).toHaveBeenCalledTimes(2);
    queue.dispose();
  });

  it('disposal rejects in-flight completion and drops trailing work', async () => {
    vi.useFakeTimers();
    const first = deferred();
    const paint = vi.fn();
    const render = vi.fn(async (_r, current) => {
      await first.promise;
      if (current()) paint();
    });
    const queue = createProgressiveRenderQueue(render);
    queue.update(request('A'));
    queue.update(request('AB'));
    queue.dispose();
    first.resolve();
    await vi.runAllTimersAsync();
    expect(paint).not.toHaveBeenCalled();
    expect(render).toHaveBeenCalledTimes(1);
  });
});
