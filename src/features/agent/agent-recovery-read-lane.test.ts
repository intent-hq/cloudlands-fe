import { expect, it } from 'vitest';
import { trackAgentRecoveryRead } from './agent-recovery-read-lane';
import { RecoveryRequestTimeoutError } from '$shared/event-recovery/session';
import type { RecoveryLifetime } from '$shared/event-recovery/resource';
const lifetime = (): RecoveryLifetime => ({
  key: {},
  isCurrent: () => true,
  commit: (write) => {
    write();
    return true;
  },
});
it('holds physical ownership through timeout drainage but isolates replacement authority', async () => {
  const owner = lifetime();
  let drain!: (value: { errors: unknown[]; retired: boolean }) => void;
  const timeout = new RecoveryRequestTimeoutError(
    new Promise((resolve) => {
      drain = resolve;
    }),
  );
  const first = trackAgentRecoveryRead(
    'read',
    async () => {
      throw timeout;
    },
    owner,
  ).catch((error) => error);
  let starts = 0;
  const next = trackAgentRecoveryRead(
    'read',
    async () => {
      starts++;
      return 'next';
    },
    owner,
  );
  expect(await trackAgentRecoveryRead('read', async () => 'replacement', lifetime())).toBe(
    'replacement',
  );
  expect(starts).toBe(0);
  drain({ errors: [], retired: false });
  expect(await first).toBe(timeout);
  expect(await next).toBe('next');
  expect(starts).toBe(1);
});
