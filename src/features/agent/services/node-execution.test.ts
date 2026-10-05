import { describe, expect, it, vi } from 'vitest';
import { NodeExecutionClient } from './node-execution';
import { AgentPlacementSchema } from '$shared/types/agent-node';

const caps = { agentNodes: 1, localNodeIsolation: 1 };
function fixture(capabilities: unknown = caps) {
  let enabled = false;
  const request = vi.fn(async (method: string, _params?: unknown): Promise<unknown> => {
    if (method === 'client.hello') return { server: { capabilities } };
    if (method === 'hub.merge')
      return { ok: true, status: 'merged', canonicalHead: 'a'.repeat(40) };
    return { ok: true };
  });
  const client = new NodeExecutionClient(request, () => enabled);
  return {
    client,
    request,
    enable: (value: boolean) => {
      enabled = value;
    },
  };
}

describe('canonical node execution contract', () => {
  it.each([
    {},
    { target: 'remote', checkout: 'shared' },
    { target: 'local', checkout: 'isolated', exclusive: true },
    { target: 'local', checkout: 'isolated', typo: true },
  ])('rejects invalid placement %j', (placement) => {
    expect(AgentPlacementSchema.safeParse(placement).success).toBe(false);
  });

  it('keeps local isolated placement available with Labs off', async () => {
    const { client, request } = fixture();
    await client.preparePlacement({ target: 'local', checkout: 'isolated' });
    expect(request).toHaveBeenCalledExactlyOnceWith('client.hello', {});
  });

  it('still requires platform capability when a complete request includes architecture', async () => {
    const placement = { target: 'local', checkout: 'shared', arch: 'aarch64' } as const;
    expect(AgentPlacementSchema.safeParse(placement).success).toBe(false);
    await expect(fixture(caps).client.preparePlacement(placement)).rejects.toThrow();
    await expect(
      fixture({ ...caps, agentPlatformRouting: 1 }).client.preparePlacement(placement),
    ).resolves.toEqual(placement);
  });

  it.each([undefined, {}, { agentNodes: true }, { agentNodes: 2 }, { agentNodes: 1 }])(
    'refuses unsupported local isolation without a shared fallback: %j',
    async (capabilities) => {
      const { client } = fixture(capabilities ?? null);
      await expect(
        client.preparePlacement({ target: 'local', checkout: 'isolated' }),
      ).rejects.toThrow();
    },
  );

  it('checks Labs again after the capability request completes', async () => {
    const { client, request, enable } = fixture();
    enable(true);
    request.mockImplementation(async () => {
      enable(false);
      return { server: { capabilities: caps } };
    });
    await expect(
      client.preparePlacement({ target: 'remote', checkout: 'isolated' }),
    ).rejects.toThrow();
    expect(request.mock.calls.map(([method]) => method)).toEqual(['client.hello']);
  });

  it('never substitutes shared mode for a stale remote selection', async () => {
    const { client, request } = fixture();
    await expect(
      client.preparePlacement({ target: 'remote', checkout: 'isolated' }),
    ).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });

  it.each([
    { ok: true, status: 'merged', commitRange: 'a..b', canonicalHead: 'b'.repeat(40) },
    { ok: true, status: 'conflict', conflictingPaths: ['src/app.ts'] },
    { ok: true, status: 'blocked', reason: 'target-offline' },
    { ok: true, status: 'blocked', reason: 'dirty-parent', overlappingPaths: ['src/app.ts'] },
  ])('returns hub domain results without treating them as RPC failures: %j', async (result) => {
    const { client, request } = fixture();
    request.mockImplementation(async (method) =>
      method === 'client.hello' ? { server: { capabilities: caps } } : result,
    );
    const input = {
      workspaceId: 'ws-owned',
      agentId: 'agent-child',
      checkpointId: 'checkpoint-clean',
      requestId: '00000000-0000-4000-8000-000000000003',
    };
    expect(await client.merge(input)).toEqual(result);
    expect(request.mock.calls).toEqual([
      ['client.hello', {}],
      ['hub.merge', input],
    ]);
  });

  it('discards existing remote work with Labs off using only the hub contract', async () => {
    const { client, request } = fixture();
    const input = {
      workspaceId: 'ws-owned',
      agentId: 'agent-child',
      requestId: '00000000-0000-4000-8000-000000000004',
    };
    expect(await client.discard(input)).toEqual({ ok: true });
    expect(request.mock.calls).toEqual([
      ['client.hello', {}],
      ['hub.discard', input],
    ]);
  });

  it('fails explicitly on an older daemon without attempting retired APIs', async () => {
    const { client, request } = fixture({});
    await expect(
      client.discard({
        workspaceId: 'ws-owned',
        agentId: 'agent-child',
        requestId: '00000000-0000-4000-8000-000000000004',
      }),
    ).rejects.toThrow();
    expect(request.mock.calls).toEqual([['client.hello', {}]]);
  });
});
