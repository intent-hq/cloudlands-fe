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
it('holds physical ownership through timeout drainage while allowing another resource', async () => {
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
  expect(await trackAgentRecoveryRead('other', async () => 'replacement', lifetime())).toBe(
    'replacement',
  );
  expect(starts).toBe(0);
  drain({ errors: [], retired: false });
  expect(await first).toBe(timeout);
  expect(await next).toBe('next');
  expect(starts).toBe(1);
});

it('keeps one physical lane through authority refresh and separates a new session', async () => {
  const { rendererEventRecovery } = await import('$features/events/renderer-event-recovery');
  const { bindAgentRecoveryReadOwner } = await import('./agent-recovery-read-lane');
  const session = () => ({
    supported: true,
    isCurrent: () => true,
    onRetired: () => () => {},
    dispose: () => {},
    onNotification: () => () => {},
    request: async () => ({}),
    fence: async (_ids: unknown, observe: () => void) => observe(),
  });
  rendererEventRecovery.attach(session() as never);
  const firstBinding = bindAgentRecoveryReadOwner('physical', {});
  const held = Promise.withResolvers<void>();
  const first = trackAgentRecoveryRead('physical', () => held.promise, lifetime());
  rendererEventRecovery.refreshAuthority();
  firstBinding();
  const nextBinding = bindAgentRecoveryReadOwner('physical', {});
  let started = 0;
  const second = trackAgentRecoveryRead(
    'physical',
    async () => {
      started++;
    },
    lifetime(),
  );
  await Promise.resolve();
  expect(started).toBe(0);
  rendererEventRecovery.attach(session() as never);
  const replacementBinding = bindAgentRecoveryReadOwner('physical', {});
  expect(await trackAgentRecoveryRead('physical', async () => 'new session', lifetime())).toBe(
    'new session',
  );
  held.resolve();
  await first;
  await second;
  expect(started).toBe(1);
  firstBinding();
  nextBinding();
  replacementBinding();
  rendererEventRecovery.dispose();
});
