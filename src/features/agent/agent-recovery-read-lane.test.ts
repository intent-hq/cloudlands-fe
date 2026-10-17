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

it('preserves the ordinary deadline while retaining physical ownership until completion', async () => {
  const completion = Promise.withResolvers<{ errors: unknown[]; retired: boolean }>();
  const timeout = Object.assign(new Error('Request timed out'), {
    code: 'TIMEOUT',
    completion: completion.promise,
  });
  const first = trackAgentRecoveryRead(
    'ordinary-timeout',
    async () => {
      throw timeout;
    },
    lifetime(),
  );
  await expect(first).rejects.toBe(timeout);
  let starts = 0;
  const next = trackAgentRecoveryRead(
    'ordinary-timeout',
    async () => {
      starts++;
      return 'fresh';
    },
    lifetime(),
  );
  for (let i = 0; i < 10; i++) await Promise.resolve();
  expect(starts).toBe(0);
  completion.resolve({ errors: [], retired: false });
  expect(await next).toBe('fresh');
  expect(starts).toBe(1);
});

it.each(['current', 'replacement', 'retired'] as const)(
  'retains original authority for an ordinary late denial: %s',
  async (transition) => {
    const { rendererEventRecovery } = await import('$features/events/renderer-event-recovery');
    const { agentQueueReducer, replaceAgentQueue, clearAgentQueue } =
      await import('$store/renderer/slices/agent-queue/agent-queue-slice');
    const { BackendError } = await import('$lib/client/live/backend-transport-types');
    const scope = rendererEventRecovery.attach({
      supported: true,
      isCurrent: () => true,
      onRetired: () => () => {},
      dispose: () => {},
      onNotification: () => () => {},
      request: async () => ({}),
      fence: async (_ids: unknown, observe: () => void) => observe(),
    } as never);
    let state = agentQueueReducer(
      undefined,
      replaceAgentQueue('a', [{ id: 'q', content: 'private', queuedAt: '', position: 0 }], 'ws'),
    );
    const key = 'agent-queue:["ws","a"]';
    const register = () =>
      scope.registerResource({
        key,
        workspaceId: 'ws',
        eventTypes: ['agent:*'],
        isCurrent: () => true,
        read: async () => [],
        apply: () => {},
        invalidate: () => {},
        retire: () => {
          state = agentQueueReducer(state, clearAgentQueue('a'));
        },
      });
    const originalOwner = register();
    const completion = Promise.withResolvers<{ errors: unknown[]; retired: boolean }>();
    const timeout = new BackendError({ code: 'TIMEOUT', message: 'deadline' }, completion.promise);
    try {
      const result = trackAgentRecoveryRead(
        key,
        async () => {
          throw timeout;
        },
        rendererEventRecovery.capture(key),
      );
      await expect(result).rejects.toBe(timeout);
      if (transition === 'replacement') {
        originalOwner.dispose();
        register();
      }
      completion.resolve({
        errors: [Object.assign(new Error('denied'), { rpcCode: -32003 })],
        retired: transition === 'retired',
      });
      for (let i = 0; i < 20; i++) await Promise.resolve();
      if (transition === 'current') expect(state.byAgentId.a).toBeUndefined();
      else expect(state.byAgentId.a).toBeDefined();
    } finally {
      completion.resolve({ errors: [], retired: true });
      rendererEventRecovery.dispose();
    }
  },
);
