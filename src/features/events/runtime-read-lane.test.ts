import { describe, expect, it, vi } from 'vitest';
import { BackendError } from '$lib/client/live/backend-transport-types';
import type { RecoveryRequestCompletion } from '$shared/event-recovery/session';
import { runtimeReadDrained } from './runtime-read-lane';

describe('runtime read physical completion', () => {
  it.each([false, true])(
    'retains ordinary timeout occupancy until completion (retired=%s)',
    async (retired) => {
      let complete!: (value: RecoveryRequestCompletion) => void;
      const physical = new Promise<RecoveryRequestCompletion>((resolve) => {
        complete = resolve;
      });
      const failure = new BackendError({ code: 'TIMEOUT', message: 'Caller deadline' }, physical);
      let drained = false;
      const drain = runtimeReadDrained(Promise.reject(failure)).then(() => {
        drained = true;
      });
      for (let i = 0; i < 5; i++) await Promise.resolve();
      expect(drained).toBe(false);
      complete({ errors: [], retired });
      await drain;
      expect(drained).toBe(true);
    },
  );
  it('releases completed success and ordinary failure without a physical receipt', async () => {
    await expect(runtimeReadDrained(Promise.resolve('value'))).resolves.toBeUndefined();
    await expect(runtimeReadDrained(Promise.reject(new Error('failed')))).resolves.toBeUndefined();
  });
});

describe('physical completion observer', () => {
  it('awaits original error handling before releasing capacity without delaying the caller', async () => {
    let complete!: (value: RecoveryRequestCompletion) => void;
    const physical = new Promise<RecoveryRequestCompletion>((resolve) => {
      complete = resolve;
    });
    let handled!: () => void;
    const handling = new Promise<void>((resolve) => {
      handled = resolve;
    });
    const observe = vi.fn(() => handling);
    const failure = new BackendError({ code: 'TIMEOUT', message: 'Caller deadline' }, physical);
    const result = Promise.reject(failure);
    let released = false;
    const drain = runtimeReadDrained(result, observe).then(() => {
      released = true;
    });
    await expect(result).rejects.toBe(failure);
    expect(observe).not.toHaveBeenCalled();
    const outcome = { errors: [{ rpcCode: -32003 }], retired: false };
    complete(outcome);
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(observe).toHaveBeenCalledExactlyOnceWith(outcome);
    expect(released).toBe(false);
    handled();
    await drain;
    expect(released).toBe(true);
  });
  it('preserves retirement in the callback and skips results without a completion receipt', async () => {
    const observe = vi.fn();
    const outcome = { errors: [], retired: true };
    await runtimeReadDrained(
      Promise.reject(
        new BackendError({ code: 'TIMEOUT', message: 'Deadline' }, Promise.resolve(outcome)),
      ),
      observe,
    );
    expect(observe).toHaveBeenCalledExactlyOnceWith(outcome);
    observe.mockClear();
    await runtimeReadDrained(Promise.resolve('success'), observe);
    await runtimeReadDrained(Promise.reject(new Error('ordinary error')), observe);
    expect(observe).not.toHaveBeenCalled();
  });
});
