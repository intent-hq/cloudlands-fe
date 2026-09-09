import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buffers, channel, runSaga } from 'redux-saga';

import { takeWithBackoff } from './take-with-backoff';

type StatusEvent = { status: 'connected' | 'disconnected'; id: string };

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

const shouldBackoffDisconnected = (value: StatusEvent, previous: StatusEvent | null) =>
  value.status === 'disconnected' && previous?.status === 'disconnected';

function startBackoffSaga(handled: StatusEvent[]) {
  const input = channel<StatusEvent>(buffers.expanding());
  const task = runSaga({ dispatch: vi.fn(), getState: () => ({}) }, function* root() {
    yield* takeWithBackoff(
      input,
      function* handleStatus(value) {
        handled.push(value);
      },
      {
        initialDelayMs: 1_000,
        maxDelayMs: 5_000,
        initialPrevious: { status: 'disconnected', id: 'snapshot' },
        shouldBackoff: shouldBackoffDisconnected,
      },
    );
  });
  return { input, task };
}

describe('takeWithBackoff', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('backs off matching repeated values exponentially and cancels stale delayed work', async () => {
    const handled: StatusEvent[] = [];
    const { input, task } = startBackoffSaga(handled);
    await settle();

    input.put({ status: 'disconnected', id: 'first' });
    await settle();
    await vi.advanceTimersByTimeAsync(999);
    expect(handled).toEqual([]);

    input.put({ status: 'disconnected', id: 'second' });
    await settle();
    await vi.advanceTimersByTimeAsync(1);
    expect(handled).toEqual([]);
    await vi.advanceTimersByTimeAsync(1_998);
    expect(handled).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    await settle();
    expect(handled.map((event) => event.id)).toEqual(['second']);

    input.put({ status: 'disconnected', id: 'third' });
    await settle();
    await vi.advanceTimersByTimeAsync(3_999);
    expect(handled.map((event) => event.id)).toEqual(['second']);
    await vi.advanceTimersByTimeAsync(1);
    await settle();
    expect(handled.map((event) => event.id)).toEqual(['second', 'third']);

    task.cancel();
    await task.toPromise();
  });

  it('processes non-matching values immediately and resets the next backoff delay', async () => {
    const handled: StatusEvent[] = [];
    const { input, task } = startBackoffSaga(handled);
    await settle();

    input.put({ status: 'disconnected', id: 'delayed' });
    await settle();
    await vi.advanceTimersByTimeAsync(500);
    input.put({ status: 'connected', id: 'reset' });
    await settle();
    expect(handled.map((event) => event.id)).toEqual(['reset']);

    await vi.advanceTimersByTimeAsync(1_000);
    await settle();
    expect(handled.map((event) => event.id)).toEqual(['reset']);

    input.put({ status: 'disconnected', id: 'immediate' });
    await settle();
    expect(handled.map((event) => event.id)).toEqual(['reset', 'immediate']);

    input.put({ status: 'disconnected', id: 'delayed-after-reset' });
    await settle();
    await vi.advanceTimersByTimeAsync(999);
    expect(handled.map((event) => event.id)).toEqual(['reset', 'immediate']);
    await vi.advanceTimersByTimeAsync(1);
    await settle();
    expect(handled.map((event) => event.id)).toEqual(['reset', 'immediate', 'delayed-after-reset']);

    task.cancel();
    await task.toPromise();
  });
});
