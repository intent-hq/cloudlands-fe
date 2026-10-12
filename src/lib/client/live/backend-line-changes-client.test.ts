/**
 * Characterize the existing metric-read request boundary with controlled responses.
 * Malformed and inherited values preserve client behavior, not daemon acceptance.
 * The runtime case uses the real backend runtime with only transport selection mocked.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBackendLineChangesClient } from './backend-line-changes-client';
import { createBackendRuntime } from './backend-transport-runtime';
import type { BackendRuntime } from './backend-transport-runtime';
import type { BackendTransport } from './backend-transport-types';

const transportSelection = vi.hoisted(() => ({ resolve: vi.fn() }));
vi.mock('./backend-transport-factory', () => ({
  resolveBackendTransport: transportSelection.resolve,
}));

afterEach(() => vi.clearAllMocks());

function fixture() {
  const backendRequest = vi.fn<BackendRuntime['backendRequest']>();
  const backend = {
    backendRequest: <T>(...args: Parameters<BackendRuntime['backendRequest']>): Promise<T> =>
      backendRequest(...args) as Promise<T>,
  };
  return { backendRequest, client: createBackendLineChangesClient(backend) };
}

describe('canonical agent metric reads', () => {
  it.each([
    { label: 'absent', value: undefined },
    { label: 'null', value: null },
    { label: 'false', value: false },
    { label: 'zero', value: 0 },
    { label: 'number', value: 7 },
    { label: 'string', value: 'metrics' },
  ])('returns null for $label metrics', async ({ value }) => {
    const { client, backendRequest } = fixture();
    backendRequest.mockResolvedValueOnce(value);

    await expect(client.getAgentLineStats('agent-a')).resolves.toBeNull();
    expect(backendRequest.mock.calls).toEqual([['metrics.getAgentStats', { agentId: 'agent-a' }]]);
  });

  it('omits workspace scope when the caller omits it', async () => {
    const { client, backendRequest } = fixture();
    backendRequest.mockResolvedValueOnce({ additions: 7, deletions: 2, filesChanged: 3 });

    await expect(client.getAgentLineStats('agent-a')).resolves.toEqual({
      additions: 7,
      deletions: 2,
      filesChanged: 3,
    });
    expect(backendRequest.mock.calls).toEqual([['metrics.getAgentStats', { agentId: 'agent-a' }]]);
  });

  it.each([
    { label: 'undefined', workspaceId: undefined, params: { agentId: 'agent-a' } },
    { label: 'empty', workspaceId: '', params: { agentId: 'agent-a', workspaceId: '' } },
    {
      label: 'named',
      workspaceId: 'workspace-a',
      params: { agentId: 'agent-a', workspaceId: 'workspace-a' },
    },
  ])('preserves $label workspace scope', async ({ workspaceId, params }) => {
    const { client, backendRequest } = fixture();
    backendRequest.mockResolvedValueOnce({ additions: 4, deletions: 1, filesChanged: 2 });

    await expect(client.getAgentLineStats('agent-a', workspaceId)).resolves.toEqual({
      additions: 4,
      deletions: 1,
      filesChanged: 2,
    });
    expect(backendRequest.mock.calls).toEqual([['metrics.getAgentStats', params]]);
  });

  it.each([
    { label: 'missing fields', raw: {} },
    { label: 'wrong field types', raw: { additions: '9', deletions: false, filesChanged: null } },
    { label: 'array payload', raw: [] },
  ])('retains zero defaults for $label', async ({ raw }) => {
    const { client, backendRequest } = fixture();
    backendRequest.mockResolvedValueOnce(raw);

    await expect(client.getAgentLineStats('agent-a')).resolves.toEqual({
      additions: 0,
      deletions: 0,
      filesChanged: 0,
    });
  });

  it('retains numeric fields independently of invalid siblings', async () => {
    const { client, backendRequest } = fixture();
    backendRequest.mockResolvedValueOnce({ additions: -2.5, deletions: '8', filesChanged: 4 });

    await expect(client.getAgentLineStats('agent-a')).resolves.toEqual({
      additions: -2.5,
      deletions: 0,
      filesChanged: 4,
    });
  });

  it('retains the current non-finite numeric semantics', async () => {
    const { client, backendRequest } = fixture();
    backendRequest.mockResolvedValueOnce({
      additions: Number.NaN,
      deletions: Number.POSITIVE_INFINITY,
      filesChanged: Number.NEGATIVE_INFINITY,
    });

    await expect(client.getAgentLineStats('agent-a')).resolves.toEqual({
      additions: Number.NaN,
      deletions: Number.POSITIVE_INFINITY,
      filesChanged: Number.NEGATIVE_INFINITY,
    });
  });

  it('reads inherited numeric fields and preserves the inherited byAgent reference', async () => {
    const { client, backendRequest } = fixture();
    const byAgent = { 'agent-a': { additions: 6, deletions: 2, filesChanged: 1 } };
    backendRequest.mockResolvedValueOnce(
      Object.create({ additions: 6, deletions: 2, filesChanged: 1, byAgent }),
    );

    const result = await client.getAgentLineStats('agent-a');

    expect(result).toEqual({ additions: 6, deletions: 2, filesChanged: 1, byAgent });
    expect(result?.byAgent).toBe(byAgent);
  });

  it.each([
    { label: 'object', byAgent: { 'agent-a': { additions: 2, deletions: 1, filesChanged: 1 } } },
    { label: 'array', byAgent: [] },
  ])('passes through a $label byAgent value by reference', async ({ byAgent }) => {
    const { client, backendRequest } = fixture();
    backendRequest.mockResolvedValueOnce({ additions: 2, deletions: 1, filesChanged: 1, byAgent });

    const result = await client.getAgentLineStats('agent-a');

    expect(result).toEqual({ additions: 2, deletions: 1, filesChanged: 1, byAgent });
    expect(result?.byAgent).toBe(byAgent);
  });

  it.each([null, false, 4, 'invalid'])('omits a non-object byAgent value: %s', async (byAgent) => {
    const { client, backendRequest } = fixture();
    backendRequest.mockResolvedValueOnce({ additions: 2, deletions: 1, filesChanged: 1, byAgent });

    await expect(client.getAgentLineStats('agent-a')).resolves.toEqual({
      additions: 2,
      deletions: 1,
      filesChanged: 1,
    });
  });

  it.each([new Error('metrics unavailable'), { code: 'metrics-unavailable' }])(
    'preserves rejection identity without retrying',
    async (error) => {
      const { client, backendRequest } = fixture();
      backendRequest.mockRejectedValueOnce(error);

      await expect(client.getAgentLineStats('agent-a', 'workspace-a')).rejects.toBe(error);
      expect(backendRequest.mock.calls).toEqual([
        ['metrics.getAgentStats', { agentId: 'agent-a', workspaceId: 'workspace-a' }],
      ]);
    },
  );

  it('converts a synchronous backend throw into the original rejected error', async () => {
    const { client, backendRequest } = fixture();
    const error = new Error('synchronous backend failure');
    backendRequest.mockImplementationOnce(() => {
      throw error;
    });

    const result = client.getAgentLineStats('agent-a');

    await expect(result).rejects.toBe(error);
    expect(backendRequest.mock.calls).toEqual([['metrics.getAgentStats', { agentId: 'agent-a' }]]);
  });

  it('keeps two backend instances and pending results independent', async () => {
    const first = fixture();
    const second = fixture();
    let resolveFirst!: (value: unknown) => void;
    first.backendRequest.mockReturnValueOnce(new Promise((resolve) => (resolveFirst = resolve)));
    second.backendRequest.mockResolvedValueOnce({ additions: 9, deletions: 0, filesChanged: 2 });

    expect(first.backendRequest).not.toHaveBeenCalled();
    expect(second.backendRequest).not.toHaveBeenCalled();
    const pendingFirst = first.client.getAgentLineStats('agent-a', 'workspace-a');
    const resultSecond = await second.client.getAgentLineStats('agent-b', 'workspace-b');
    resolveFirst({ additions: 3, deletions: 1, filesChanged: 1 });

    expect(resultSecond).toEqual({ additions: 9, deletions: 0, filesChanged: 2 });
    await expect(pendingFirst).resolves.toEqual({ additions: 3, deletions: 1, filesChanged: 1 });
    expect(first.backendRequest.mock.calls).toEqual([
      ['metrics.getAgentStats', { agentId: 'agent-a', workspaceId: 'workspace-a' }],
    ]);
    expect(second.backendRequest.mock.calls).toEqual([
      ['metrics.getAgentStats', { agentId: 'agent-b', workspaceId: 'workspace-b' }],
    ]);
  });

  it('lets the real backend runtime resolve the current transport for each read', async () => {
    const firstRequest = vi.fn<BackendTransport['request']>();
    const secondRequest = vi.fn<BackendTransport['request']>();
    firstRequest.mockResolvedValueOnce({ additions: 1, deletions: 0, filesChanged: 1 });
    secondRequest.mockResolvedValueOnce({ additions: 8, deletions: 2, filesChanged: 3 });
    transportSelection.resolve.mockReturnValue({ request: firstRequest });
    const loadPlacementAccess = vi.fn(() => ({
      remoteEnabled: () => false,
      connectionGeneration: () => 0,
    }));
    const client = createBackendLineChangesClient(createBackendRuntime(loadPlacementAccess));

    expect(transportSelection.resolve).not.toHaveBeenCalled();
    await expect(client.getAgentLineStats('agent-a')).resolves.toEqual({
      additions: 1,
      deletions: 0,
      filesChanged: 1,
    });
    transportSelection.resolve.mockReturnValue({ request: secondRequest });
    await expect(client.getAgentLineStats('agent-b', '')).resolves.toEqual({
      additions: 8,
      deletions: 2,
      filesChanged: 3,
    });
    expect(firstRequest.mock.calls).toEqual([
      ['metrics.getAgentStats', { agentId: 'agent-a' }, undefined],
    ]);
    expect(secondRequest.mock.calls).toEqual([
      ['metrics.getAgentStats', { agentId: 'agent-b', workspaceId: '' }, undefined],
    ]);
    expect(transportSelection.resolve).toHaveBeenCalledTimes(2);
    expect(loadPlacementAccess).not.toHaveBeenCalled();
  });
});
