import { afterEach, expect, it, vi } from 'vitest';
import { appClient } from '$lib/client';
import { BackendError } from '$lib/client/live/backend-transport-types';
import {
  getPhysicalRequestCompletion,
  type RecoveryRequestCompletion,
} from '$shared/event-recovery/session';
import { getAgentFileEdits } from '$lib/utils/agent-file-edits';
import { trackWorktreeSnapshotRead } from '$features/file-tracking/worktree-read-lane';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
afterEach(() => vi.restoreAllMocks());

it('keeps ordinary badge siblings occupied after a timeout and observes denial before sibling drain', async () => {
  const done = deferred<RecoveryRequestCompletion>();
  const sibling = deferred<Awaited<ReturnType<typeof appClient.events.query>>>();
  const failed = vi.fn();
  const timeout = new BackendError({ code: 'TIMEOUT', message: 'ordinary deadline' }, done.promise);
  vi.spyOn(appClient.events, 'query')
    .mockRejectedValueOnce(timeout)
    .mockReturnValueOnce(sibling.promise);
  const result = trackWorktreeSnapshotRead('badge-test', () => getAgentFileEdits('ws', 3, failed));
  const outcome = result.catch((e) => e);
  const recovery = vi.fn(async () => []);
  const next = trackWorktreeSnapshotRead('badge-test', recovery, 'recovery');
  try {
    await flush();
    expect(await outcome).toBeInstanceOf(Error);
    expect(recovery).not.toHaveBeenCalled();
    const denied = { rpcCode: -32003 };
    sibling.reject(denied);
    await flush();
    expect(failed).toHaveBeenCalledWith(denied);
    expect(recovery).not.toHaveBeenCalled();
    done.resolve({ errors: [], retired: false });
    await next;
    expect(recovery).toHaveBeenCalledOnce();
    expect(await getPhysicalRequestCompletion(await outcome)).toMatchObject({ retired: false });
  } finally {
    sibling.resolve([]);
    done.resolve({ errors: [], retired: false });
    await next;
  }
});

it('keeps an artifact listing occupied after its shorter caller deadline and observes its late denial', async () => {
  vi.useFakeTimers();
  const { resolveFileBySuffix } = await import('$lib/services/files/resolve-file-by-suffix');
  const listing = deferred<Awaited<ReturnType<typeof appClient.files.listDirectory>>>();
  vi.spyOn(appClient.files, 'listDirectory').mockReturnValue(listing.promise);
  const failed = vi.fn();
  const result = trackWorktreeSnapshotRead('artifact-test', () =>
    resolveFileBySuffix('ws', 'preview.webm', failed),
  ).catch((error) => error);
  await vi.advanceTimersByTimeAsync(751);
  const timeout = await result;
  const recovery = vi.fn(async () => []);
  const next = trackWorktreeSnapshotRead('artifact-test', recovery, 'recovery');
  try {
    expect(timeout).toBeInstanceOf(Error);
    await flush();
    expect(recovery).not.toHaveBeenCalled();
    const denied = { rpcCode: -32003 };
    listing.reject(denied);
    await next;
    expect(failed).toHaveBeenCalledWith(denied);
    expect(await getPhysicalRequestCompletion(timeout)).toEqual({
      errors: [denied],
      retired: false,
    });
    expect(recovery).toHaveBeenCalledOnce();
  } finally {
    listing.resolve([]);
    await next;
    vi.useRealTimers();
  }
});
