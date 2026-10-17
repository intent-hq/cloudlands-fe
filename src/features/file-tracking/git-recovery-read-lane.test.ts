import { afterEach, expect, it, vi } from 'vitest';
import { rendererEventRecovery } from '$features/events/renderer-event-recovery';
import { BackendError } from '$lib/client/live/backend-transport-types';
import { type RecoveryRequestCompletion } from '$shared/event-recovery/session';
import {
  bindGitReadTransport,
  captureGitRead,
  gitReadDrained,
  observeGitReadFailure,
  serializeGitRead,
  waitForGitReads,
} from './git-recovery-read-lane';

const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const off of cleanup.splice(0)) off();
  vi.restoreAllMocks();
});
const settle = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
};
function deadline() {
  let finish!: (value: RecoveryRequestCompletion) => void;
  const completion = new Promise<RecoveryRequestCompletion>((resolve) => {
    finish = resolve;
  });
  return {
    error: new BackendError({ code: 'TIMEOUT', message: 'ordinary deadline' }, completion),
    finish,
  };
}
it('keeps a Git lane occupied after an ordinary deadline while returning its error promptly', async () => {
  const held = deadline();
  const first = serializeGitRead(
    'ordinary-deadline',
    () => true,
    () => Promise.reject(held.error),
  );
  await expect(first).rejects.toBe(held.error);
  const request = vi.fn(async () => 'fresh');
  const next = serializeGitRead('ordinary-deadline', () => true, request);
  await settle();
  expect(request).not.toHaveBeenCalled();
  held.finish({ errors: [], retired: false });
  await expect(next).resolves.toBe('fresh');
});
it('keeps swallowed ordinary deadline work in the original captured lane and root accounting', async () => {
  const held = deadline(),
    sibling = deadline();
  const request = vi
    .fn()
    .mockRejectedValueOnce(held.error)
    .mockRejectedValueOnce(sibling.error)
    .mockResolvedValue('fresh');
  const transport = { key: {}, request };
  cleanup.push(bindGitReadTransport('swallowed-deadline', transport));
  const lane = captureGitRead('swallowed-deadline');
  await expect(
    lane.run(() =>
      Promise.all([
        lane.transport!.request('git.showFile').catch(() => 'fallback'),
        lane.transport!.request('git.diffs').catch(() => 'fallback'),
      ]).then(() => 'fallback'),
    ),
  ).resolves.toBe('fallback');
  const physical = vi.fn();
  void waitForGitReads(transport).then(physical);
  const next = lane.run(() => lane.transport!.request('git.showFile'));
  await settle();
  expect(request).toHaveBeenCalledTimes(2);
  expect(physical).not.toHaveBeenCalled();
  held.finish({ errors: [], retired: false });
  await settle();
  expect(request).toHaveBeenCalledTimes(2);
  expect(physical).not.toHaveBeenCalled();
  sibling.finish({ errors: [], retired: false });
  await expect(next).resolves.toBe('fresh');
  await settle();
  expect(physical).toHaveBeenCalledOnce();
  expect(request).toHaveBeenCalledTimes(3);
});
it.each([false, true])(
  'observes eventual ordinary canonical errors only before physical retirement (retired=%s)',
  async (retired) => {
    const held = deadline(),
      nested = deadline();
    const denied = { rpcCode: -32003 };
    const observed = vi.fn(),
      released = vi.fn();
    const result = observeGitReadFailure(Promise.reject(held.error), observed);
    void gitReadDrained(result, released);
    await expect(result).rejects.toBe(held.error);
    held.finish({ errors: [nested.error], retired });
    await settle();
    if (!retired) expect(released).not.toHaveBeenCalled();
    nested.finish({ errors: [denied], retired: false });
    await settle();
    expect(released).toHaveBeenCalledOnce();
    if (retired) expect(observed).toHaveBeenCalledExactlyOnceWith(held.error);
    else expect(observed).toHaveBeenLastCalledWith(denied);
  },
);

it('separates replacement physical sessions and rejects old queued work', async () => {
  const identity = vi
    .spyOn(rendererEventRecovery, 'capturePhysicalSessionIdentity')
    .mockReturnValue({});
  const held = deadline();
  await expect(
    serializeGitRead(
      'replacement-session',
      () => true,
      () => Promise.reject(held.error),
    ),
  ).rejects.toBe(held.error);
  const obsoleteRead = vi.fn(async () => 'obsolete');
  const obsolete = serializeGitRead('replacement-session', () => true, obsoleteRead).catch(
    (error) => error,
  );
  identity.mockReturnValue({});
  const freshRead = vi.fn(async () => 'fresh');
  const fresh = serializeGitRead('replacement-session', () => true, freshRead);
  try {
    await settle();
    expect(freshRead).toHaveBeenCalledOnce();
    await expect(fresh).resolves.toBe('fresh');
  } finally {
    held.finish({ retired: false, errors: [] });
  }
  await expect(obsolete).resolves.toBeInstanceOf(Error);
  expect(obsoleteRead).not.toHaveBeenCalled();
});
