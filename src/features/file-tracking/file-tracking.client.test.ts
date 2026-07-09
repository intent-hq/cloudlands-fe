/**
 * File-tracking client wire contract (PROTOCOL §5.19 `file-tracking.getLineStats`).
 *
 * FAKE transport only: `backendRequest` is mocked, so no request reaches a
 * real daemon. Asserts the exact JSON-RPC method + params and the
 * fold-to-zeros error behavior the title-bar badge relies on.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: vi.fn(),
}));

import { backendRequest } from '$lib/client/live/backend-transport';
import { getLineStats } from './file-tracking.client';

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
