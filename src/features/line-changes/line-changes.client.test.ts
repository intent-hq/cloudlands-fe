/**
 * Line-change metrics client wire contract (PROTOCOL §5.20).
 *
 * FAKE transport only: `backendRequest` is mocked, so no request reaches a
 * real daemon. Each test asserts the exact JSON-RPC method + params the client
 * emits and feeds back a §5.20-shaped payload to assert the mapping.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: vi.fn(),
}));

import { backendRequest } from '$lib/client/live/backend-transport';
import { getAgentLineStats } from './line-changes.client';

const mockedRequest = vi.mocked(backendRequest);

describe('line-changes client (§5.20 metrics reads, fake transport)', () => {
  afterEach(() => vi.clearAllMocks());

  it('getAgentLineStats resolves null when the daemon has no stats', async () => {
    mockedRequest.mockResolvedValueOnce(null);

    expect(await getAgentLineStats('agent-123')).toBeNull();
    expect(mockedRequest).toHaveBeenCalledWith('metrics.getAgentStats', { agentId: 'agent-123' });
  });

  it('getAgentLineStats forwards metrics.getAgentStats and maps the byAgent-less Metrics', async () => {
    mockedRequest.mockResolvedValueOnce({ additions: 7, deletions: 1, filesChanged: 2 });

    const stats = await getAgentLineStats('agent-123');

    expect(mockedRequest).toHaveBeenCalledWith('metrics.getAgentStats', { agentId: 'agent-123' });
    expect(stats).toEqual({ additions: 7, deletions: 1, filesChanged: 2 });
  });

  it('getAgentLineStats propagates transport errors (read service folds them)', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('metrics boom'));

    await expect(getAgentLineStats('agent-123')).rejects.toThrow('metrics boom');
  });
});

it('carries the agent owner for scoped metrics reads', async () => {
  mockedRequest.mockResolvedValueOnce({ additions: 1, deletions: 0, filesChanged: 1 });
  await getAgentLineStats('agent-a', 'workspace-a');
  expect(mockedRequest).toHaveBeenLastCalledWith('metrics.getAgentStats', {
    agentId: 'agent-a',
    workspaceId: 'workspace-a',
  });
});
