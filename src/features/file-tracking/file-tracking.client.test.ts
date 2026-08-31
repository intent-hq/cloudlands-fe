/**
 * File-tracking client wire contract (PROTOCOL §5.19 `file-tracking.getLineStats`
 * / `file-tracking.getAgentLocks`).
 *
 * FAKE transport only: `backendRequest` is mocked, so no request reaches a
 * real daemon. Asserts the exact JSON-RPC method + params and the
 * fold-to-zeros error behavior the title-bar badge relies on.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: vi.fn(),
}));

const { dispatchSpy } = vi.hoisted(() => ({ dispatchSpy: vi.fn() }));
vi.mock('$store/renderer/store', () => ({
  store: { dispatch: dispatchSpy },
}));

import { backendRequest } from '$lib/client/live/backend-transport';
import { setAgentLockState } from '$store/renderer/slices/agent-lock/agent-lock-slice';
import { getLineStats, hydrateAgentLocks, toLockRecord } from './file-tracking.client';

const mockedRequest = vi.mocked(backendRequest);

describe('file-tracking client (§5.19 getLineStats, fake transport)', () => {
  afterEach(() => vi.clearAllMocks());

  it('forwards file-tracking.getLineStats and maps { additions, deletions }', async () => {
    mockedRequest.mockResolvedValueOnce({ additions: 42, deletions: 7 });

    const stats = await getLineStats('ws-abc');

    expect(mockedRequest).toHaveBeenCalledWith('file-tracking.getLineStats', {
      workspaceId: 'ws-abc',
    });
    expect(stats).toEqual({ additions: 42, deletions: 7 });
  });

  it('folds a malformed payload to zeros', async () => {
    mockedRequest.mockResolvedValueOnce({ additions: 'nope' });

    expect(await getLineStats('ws-abc')).toEqual({ additions: 0, deletions: 0 });
  });

  it('folds transport errors to zeros (badge is informational)', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('daemon down'));

    expect(await getLineStats('ws-abc')).toEqual({ additions: 0, deletions: 0 });
  });
});

describe('file-tracking client (§5.19 getAgentLocks hydration, fake transport)', () => {
  afterEach(() => vi.clearAllMocks());

  it('forwards file-tracking.getAgentLocks and folds arrays into the lock records', async () => {
    mockedRequest.mockResolvedValueOnce({
      autoCommitEnabled: true,
      lockedAgentIds: ['agent-a', 'agent-b'],
      lockedFilePaths: ['src/a.ts'],
    });

    await hydrateAgentLocks('ws-abc');

    expect(mockedRequest).toHaveBeenCalledWith('file-tracking.getAgentLocks', {
      workspaceId: 'ws-abc',
    });
    expect(dispatchSpy).toHaveBeenCalledWith(
      setAgentLockState('ws-abc', { 'agent-a': true, 'agent-b': true }, { 'src/a.ts': true }),
    );
  });

  it('folds a malformed payload to empty (unlocked) records', async () => {
    mockedRequest.mockResolvedValueOnce({ lockedAgentIds: 'nope' });

    await hydrateAgentLocks('ws-abc');

    expect(dispatchSpy).toHaveBeenCalledWith(setAgentLockState('ws-abc', {}, {}));
  });

  it('swallows transport errors without dispatching (state converges via the event)', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('daemon down'));

    await hydrateAgentLocks('ws-abc');

    expect(dispatchSpy).not.toHaveBeenCalled();
  });
});

describe('toLockRecord', () => {
  it('folds a string[] into Record<string, true> and skips non-strings', () => {
    expect(toLockRecord(['a', 42, 'b', null])).toEqual({ a: true, b: true });
    expect(toLockRecord(undefined)).toEqual({});
    expect(toLockRecord('not-an-array')).toEqual({});
  });
});
