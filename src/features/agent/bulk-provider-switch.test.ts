import { describe, expect, it, vi } from 'vitest';

import { runBulkProviderSwitch, runBulkRetry, type BulkSwitchDeps } from './bulk-provider-switch';

function deps(overrides: Partial<BulkSwitchDeps> = {}): BulkSwitchDeps & {
  calls: string[];
} {
  const calls: string[] = [];
  return {
    calls,
    setModel: vi.fn(async (agentId, modelId, _ws, providerId) => {
      calls.push(`setModel:${agentId}:${providerId}:${modelId}`);
      return { ok: true as const };
    }),
    retry: vi.fn(async (agentId) => {
      calls.push(`retry:${agentId}`);
      return { ok: true as const, redriven: true };
    }),
    ...overrides,
  };
}

const target = { providerId: 'codex', modelId: 'sol' };

describe('runBulkProviderSwitch', () => {
  it('switches workers before restarting their coordinator, and never retries workers', async () => {
    const d = deps();
    const outcomes = await runBulkProviderSwitch(
      [
        {
          agentId: 'c1',
          workspaceId: 'ws',
          target,
          workers: [
            { agentId: 'w1', workspaceId: 'ws' },
            { agentId: 'w2', workspaceId: 'ws' },
          ],
        },
      ],
      d,
    );
    expect(d.calls).toEqual([
      'setModel:c1:codex:sol',
      'setModel:w1:codex:sol',
      'setModel:w2:codex:sol',
      'retry:c1',
    ]);
    expect(outcomes).toEqual([
      { agentId: 'c1', status: 'switched', workersSwitched: 2, redriven: true },
    ]);
  });

  it('does not retry or touch workers when the coordinator switch fails', async () => {
    const d = deps({
      setModel: vi.fn(async () => ({ ok: false as const, error: 'model rejected' })),
    });
    const outcomes = await runBulkProviderSwitch(
      [
        {
          agentId: 'c1',
          workspaceId: 'ws',
          target,
          workers: [{ agentId: 'w1', workspaceId: 'ws' }],
        },
      ],
      d,
    );
    expect(d.setModel).toHaveBeenCalledTimes(1);
    expect(d.retry).not.toHaveBeenCalled();
    expect(outcomes[0]).toEqual({
      agentId: 'c1',
      status: 'failed',
      reason: 'model rejected',
      workersSwitched: 0,
    });
  });

  it('marks an agent with no available target as unavailable without any call', async () => {
    const d = deps();
    const outcomes = await runBulkProviderSwitch(
      [{ agentId: 'c1', workspaceId: 'ws', target: null, workers: [] }],
      d,
    );
    expect(d.setModel).not.toHaveBeenCalled();
    expect(outcomes[0]).toMatchObject({ agentId: 'c1', status: 'unavailable' });
  });

  it('reports a failed retry and a deleted agent separately', async () => {
    const d = deps({
      retry: vi.fn(async (agentId: string) =>
        agentId === 'gone'
          ? { ok: false as const, notFound: true, error: 'not found' }
          : { ok: false as const, error: 'Agent not in error status' },
      ),
    });
    const outcomes = await runBulkProviderSwitch(
      [
        { agentId: 'gone', workspaceId: 'ws', target, workers: [] },
        { agentId: 'busy', workspaceId: 'ws', target, workers: [] },
      ],
      d,
    );
    expect(outcomes.map((o) => [o.agentId, o.status, o.reason])).toEqual([
      ['gone', 'gone', undefined],
      ['busy', 'failed', 'Agent not in error status'],
    ]);
  });

  it('treats a thrown call as a failure and keeps going', async () => {
    const d = deps({
      setModel: vi.fn(async (agentId: string) => {
        if (agentId === 'a') throw new Error('socket closed');
        return { ok: true as const };
      }),
    });
    const outcomes = await runBulkProviderSwitch(
      [
        { agentId: 'a', workspaceId: 'ws', target, workers: [] },
        { agentId: 'b', workspaceId: 'ws', target, workers: [] },
      ],
      d,
    );
    expect(outcomes.map((o) => o.status)).toEqual(['failed', 'switched']);
    expect(outcomes[0].reason).toBe('socket closed');
  });

  it('runs at most three agents at a time and reports each as it finishes', async () => {
    let active = 0;
    let peak = 0;
    const done: string[] = [];
    const d = deps({
      setModel: vi.fn(async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 1));
        active -= 1;
        return { ok: true as const };
      }),
      onAgentDone: (outcome) => done.push(outcome.agentId),
    });
    const items = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((agentId) => ({
      agentId,
      workspaceId: 'ws',
      target,
      workers: [],
    }));
    await runBulkProviderSwitch(items, d);
    expect(peak).toBe(3);
    expect(done.sort()).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g']);
  });
});

describe('runBulkRetry', () => {
  it('retries every agent without a provider change', async () => {
    const d = deps();
    const outcomes = await runBulkRetry(
      [
        { agentId: 'a', workspaceId: 'ws-1' },
        { agentId: 'b', workspaceId: 'ws-2' },
      ],
      d,
    );
    expect(d.setModel).not.toHaveBeenCalled();
    expect(d.retry).toHaveBeenCalledWith('a', 'ws-1');
    expect(d.retry).toHaveBeenCalledWith('b', 'ws-2');
    expect(outcomes.map((o) => o.status)).toEqual(['retried', 'retried']);
  });
});
