import { afterEach, describe, expect, it, vi } from 'vitest';

const { backendRequest, state } = vi.hoisted(() => ({
  backendRequest: vi.fn(),
  state: {
    agentSessions: { byAgentId: { 'agent-1': { workspaceId: 'ws-1' } } } as Record<string, unknown>,
  },
}));
vi.mock('$lib/client/live/backend-transport', () => ({ backendRequest }));
vi.mock('$store/renderer/store', () => ({ store: { state } }));

import { loadFullAttentionReason } from '../attention-reason';

const request = {
  kind: 'blocker' as const,
  reason: 'Provider stal',
  timestamp: '2026-10-18T00:00:00Z',
  reasonTruncated: true as const,
};
const agent = (overrides: Record<string, unknown> = {}) => ({
  agent: {
    metadata: {
      attentionRequestKind: 'blocker',
      attentionRequestReason: 'Provider stalled. Retry the turn.',
      attentionRequestTimestamp: request.timestamp,
      ...overrides,
    },
  },
});

afterEach(() => backendRequest.mockReset());

// PROTOCOL §5.5 truncation flags: agent.get is the uncapped detail read.
describe('loadFullAttentionReason', () => {
  it('reads the full reason through agent.get in the agent workspace', async () => {
    backendRequest.mockResolvedValue(agent());
    await expect(loadFullAttentionReason('agent-1', request)).resolves.toBe(
      'Provider stalled. Retry the turn.',
    );
    expect(backendRequest).toHaveBeenCalledWith('agent.get', {
      agentId: 'agent-1',
      workspaceId: 'ws-1',
    });
  });

  it('shares one read between concurrent callers', async () => {
    backendRequest.mockResolvedValue(agent());
    const [a, b] = await Promise.all([
      loadFullAttentionReason('agent-1', request),
      loadFullAttentionReason('agent-1', request),
    ]);
    expect(a).toBe(b);
    expect(backendRequest).toHaveBeenCalledTimes(1);
  });

  it('ignores a different pending request', async () => {
    backendRequest.mockResolvedValue(agent({ attentionRequestTimestamp: '2026-10-18T01:00:00Z' }));
    await expect(loadFullAttentionReason('agent-1', request)).resolves.toBeNull();
    backendRequest.mockResolvedValue(agent({ attentionRequestKind: 'discussion' }));
    await expect(loadFullAttentionReason('agent-1', request)).resolves.toBeNull();
  });

  it('matches the same request across timestamp spellings', async () => {
    backendRequest.mockResolvedValue(
      agent({ attentionRequestTimestamp: '2026-10-18T00:00:00.000+00:00' }),
    );
    await expect(loadFullAttentionReason('agent-1', request)).resolves.toBe(
      'Provider stalled. Retry the turn.',
    );
  });

  it('does not read a request it cannot identify', async () => {
    await expect(
      loadFullAttentionReason('agent-1', { ...request, timestamp: undefined }),
    ).resolves.toBeNull();
    expect(backendRequest).not.toHaveBeenCalled();
  });

  it('resolves null when the read fails', async () => {
    backendRequest.mockRejectedValue(new Error('offline'));
    await expect(loadFullAttentionReason('agent-1', request)).resolves.toBeNull();
  });
});
