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
import {
  clearAgentLineStats,
  getAgentLineStats,
  getAllWorkspaceLineStats,
  getWorkspaceLineStats,
} from './line-changes.client';

const mockedRequest = vi.mocked(backendRequest);

describe('line-changes client (§5.20 metrics reads, fake transport)', () => {
  afterEach(() => vi.clearAllMocks());

  it('getWorkspaceLineStats forwards metrics.getWorkspaceStats and maps Metrics (incl. byAgent)', async () => {
    mockedRequest.mockResolvedValueOnce({
      additions: 140,
      deletions: 12,
      filesChanged: 3,
      byAgent: { 'agent-123': { additions: 140, deletions: 12, filesChanged: 3 } },
    });

    const stats = await getWorkspaceLineStats('ws-abc');

    expect(mockedRequest).toHaveBeenCalledWith('metrics.getWorkspaceStats', {
      workspaceId: 'ws-abc',
    });
    expect(stats).toEqual({
      additions: 140,
      deletions: 12,
      filesChanged: 3,
      byAgent: { 'agent-123': { additions: 140, deletions: 12, filesChanged: 3 } },
    });
  });

  it('getWorkspaceLineStats resolves null when the daemon has no stats', async () => {
    mockedRequest.mockResolvedValueOnce(null);

    expect(await getWorkspaceLineStats('ws-abc')).toBeNull();
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

  it('getAllWorkspaceLineStats forwards metrics.getAllWorkspaceStats and maps the record', async () => {
    mockedRequest.mockResolvedValueOnce({
      'ws-a': { additions: 1, deletions: 2, filesChanged: 1 },
      'ws-b': { additions: 0, deletions: 0, filesChanged: 0 },
    });

    const stats = await getAllWorkspaceLineStats();

    expect(mockedRequest).toHaveBeenCalledWith('metrics.getAllWorkspaceStats', {});
    expect(stats).toEqual({
      'ws-a': { additions: 1, deletions: 2, filesChanged: 1 },
      'ws-b': { additions: 0, deletions: 0, filesChanged: 0 },
    });
  });

  it('clearAgentLineStats forwards metrics.clearAgentStats and folds { success } to boolean', async () => {
    mockedRequest.mockResolvedValueOnce({ success: true });

    expect(await clearAgentLineStats('agent-123')).toBe(true);
    expect(mockedRequest).toHaveBeenCalledWith('metrics.clearAgentStats', {
      agentId: 'agent-123',
    });

    mockedRequest.mockResolvedValueOnce({ success: false });
    expect(await clearAgentLineStats('agent-123')).toBe(false);
  });
});
