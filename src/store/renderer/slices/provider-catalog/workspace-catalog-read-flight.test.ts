import { afterEach, expect, it, vi } from 'vitest';
import { rendererEventRecovery } from '$features/events/renderer-event-recovery';
import { createEventRecoverySession } from '$shared/event-recovery/session';
import { trackWorkspaceCatalogRead } from './workspace-catalog-read-flight';

function attach() {
  let sequence = 0;
  return rendererEventRecovery.attach(
    createEventRecoverySession({
      supported: true,
      isCurrent: () => true,
      onNotification: () => () => {},
      onRetired: () => () => {},
      dispose: () => {},
      request: async (_method, _params, observe) => {
        const result = { subscriptionId: `lease-${++sequence}`, lossRecovery: 1 };
        observe?.(result);
        return result;
      },
    }),
  );
}
const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};
afterEach(() => rendererEventRecovery.dispose());

it('serializes a workspace across covering lease changes and keeps other workspaces independent', async () => {
  const scope = attach();
  let release!: (value: string) => void;
  const first = trackWorkspaceCatalogRead(
    'A',
    () =>
      new Promise<string>((resolve) => {
        release = resolve;
      }),
  );
  await flush();
  await scope.subscribe({ eventTypes: ['settings:changed'] }, { recover: true });
  const read = vi.fn(async () => 'second');
  const second = trackWorkspaceCatalogRead('A', read);
  expect(await trackWorkspaceCatalogRead('B', async () => 'other')).toBe('other');
  expect(read).not.toHaveBeenCalled();
  release('first');
  expect(await first).toBe('first');
  expect(await second).toBe('second');
  expect(read).toHaveBeenCalledTimes(1);
});

it('releases the workspace after a failed read', async () => {
  attach();
  const first = trackWorkspaceCatalogRead('A', async () => {
    throw new Error('temporary');
  });
  const second = trackWorkspaceCatalogRead('A', async () => 'current');
  await expect(first).rejects.toThrow('temporary');
  expect(await second).toBe('current');
});

it('rejects retired replies and queued work without blocking a replacement session', async () => {
  attach();
  let release!: (value: string) => void;
  const first = trackWorkspaceCatalogRead(
    'A',
    () =>
      new Promise<string>((resolve) => {
        release = resolve;
      }),
  );
  await flush();
  const read = vi.fn(async () => 'queued old');
  const queued = trackWorkspaceCatalogRead('A', read);
  const failures = Promise.allSettled([first, queued]);
  attach();
  expect(await trackWorkspaceCatalogRead('A', async () => 'new session')).toBe('new session');
  release('old session');
  expect((await failures).map((result) => result.status)).toEqual(['rejected', 'rejected']);
  expect(read).not.toHaveBeenCalled();
});
