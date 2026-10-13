import { describe, expect, it } from 'vitest';
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
