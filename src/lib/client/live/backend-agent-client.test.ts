import { describe, expect, it, vi } from 'vitest';
import type { AgentListOptions } from '../lifecycle-read-client-types';
import type { BackendRuntime } from './backend-transport-runtime';
import { createBackendAgentClient } from './backend-agent-client';
import { getKnownAgentWorkspace } from './agent-normalization';

// Inject only the declared request boundary; use the real factory and normalizer.
// The unchanged LiveAgentsClient suite retains the full source facade/subscription matrix.
function fixture() {
  const backendRequest = vi.fn<BackendRuntime['backendRequest']>();
  const backend = {
    backendRequest: <T>(...args: Parameters<BackendRuntime['backendRequest']>): Promise<T> =>
      backendRequest(...args) as Promise<T>,
    onBackendNotification: vi.fn<BackendRuntime['onBackendNotification']>(),
    onBackendReconnected: vi.fn<BackendRuntime['onBackendReconnected']>(),
  };
  return { client: createBackendAgentClient(backend), backendRequest };
}

const wireCases: {
  name: string;
  options?: AgentListOptions;
  params: Record<string, unknown>;
}[] = [
  { name: 'default', params: { workspaceId: 'ws-list' } },
  {
    name: 'explicit default flags and empty parent',
    options: { scope: 'all', retiredOnly: false, orphanedOnly: false, parentAgentId: '' },
    params: { workspaceId: 'ws-list' },
  },
  {
    name: 'top-level bin',
    options: { scope: 'topLevel' },
    params: { workspaceId: 'ws-list', scope: 'topLevel' },
  },
  {
    name: 'delegated bin',
    options: { scope: 'delegated' },
    params: { workspaceId: 'ws-list', scope: 'delegated' },
  },
  {
    name: 'background bin',
    options: { scope: 'background' },
    params: { workspaceId: 'ws-list', scope: 'background' },
  },
  {
    name: 'delegated parent',
    options: { scope: 'delegated', parentAgentId: 'parent' },
    params: { workspaceId: 'ws-list', scope: 'delegated', parentAgentId: 'parent' },
  },
  {
    name: 'orphaned delegated rows',
    options: { scope: 'delegated', orphanedOnly: true },
    params: { workspaceId: 'ws-list', scope: 'delegated', orphanedOnly: true },
  },
  {
    name: 'retired rows',
    options: { retiredOnly: true },
    params: { workspaceId: 'ws-list', retiredOnly: true },
  },
];

describe('shared agent list reads', () => {
  it.each(wireCases)('emits exact agent.list options for $name', async ({ options, params }) => {
    const { client, backendRequest } = fixture();
    backendRequest.mockResolvedValue({ agents: [], retiredCount: 4 });
    expect(await client.listWithMeta('ws-list', options)).toEqual({ agents: [], retiredCount: 4 });
    expect(backendRequest.mock.calls).toEqual([['agent.list', params]]);
  });

  it('normalizes in wire order and primes the existing workspace cache', async () => {
    const { client, backendRequest } = fixture();
    backendRequest.mockResolvedValue({
      agents: [
        {
          id: 'list-z',
          workspaceId: 'ws-normalized',
          acpSessionId: 'session-z',
          name: 'Zed',
          status: 'idle',
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-02T00:00:00Z',
          lastMessageId: 'reply-z',
          lastMessageRole: 'assistant',
          metadata: { lastSeenMessageId: 'older' },
          isResponding: false,
        },
        {
          id: 'list-a',
          workspaceId: 'ws-normalized',
          name: 'Child',
          status: 'idle',
          parentAgentId: 'parent',
          lastMessageId: 'reply-a',
          lastMessageRole: 'assistant',
          isBackground: false,
          metadata: { isBackground: true },
        },
      ],
      retiredCount: 9,
    });
    const result = await client.listWithMeta('ws-normalized');
    expect(backendRequest.mock.calls).toEqual([['agent.list', { workspaceId: 'ws-normalized' }]]);
    expect(result.agents.map((agent) => agent.id)).toEqual(['list-z', 'list-a']);
    expect(result.agents[0]).toMatchObject({
      id: 'list-z',
      backendSessionId: 'session-z',
      workspaceId: 'ws-normalized',
      name: 'Zed',
      status: 'idle',
      messages: [],
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-02T00:00:00Z',
      hasUnread: true,
      isResponding: false,
    });
    expect(result.agents[1]).toMatchObject({
      parentAgentId: 'parent',
      backendSessionId: null,
      metadata: { isBackground: false },
      hasUnread: false,
    });
    expect(result.retiredCount).toBe(9);
    expect(getKnownAgentWorkspace('list-z')).toBe('ws-normalized');
    expect(getKnownAgentWorkspace('list-a')).toBe('ws-normalized');
  });

  it('keeps daemon counts independent and detects orphan metadata presence', async () => {
    const { client, backendRequest } = fixture();
    backendRequest.mockResolvedValueOnce({
      agents: [],
      retiredCount: 6,
      scopeCounts: { topLevel: 3, delegated: 20, background: 2 },
      delegatedCounts: { running: 8, byParent: { parent: { total: 12, running: 5 } } },
    });
    const legacy = await client.listWithMeta('ws-counts', { scope: 'delegated' });
    expect(legacy).toEqual({
      agents: [],
      retiredCount: 6,
      scopeCounts: { topLevel: 3, delegated: 20, background: 2 },
      delegatedCounts: { running: 8, byParent: { parent: { total: 12, running: 5 } } },
    });
    expect(Object.hasOwn(legacy.delegatedCounts!, 'orphaned')).toBe(false);
    backendRequest.mockResolvedValueOnce({
      agents: [],
      delegatedCounts: { running: 0, byParent: {}, orphaned: { total: 0, running: 0 } },
    });
    const current = await client.listWithMeta('ws-counts', {
      scope: 'delegated',
      orphanedOnly: true,
    });
    expect(current).toEqual({
      agents: [],
      retiredCount: 0,
      delegatedCounts: { running: 0, byParent: {}, orphaned: { total: 0, running: 0 } },
    });
    expect(Object.hasOwn(current, 'scopeCounts')).toBe(false);
  });

  it('omits malformed metadata without inventing zero counts', async () => {
    const { client, backendRequest } = fixture();
    backendRequest.mockResolvedValueOnce({
      agents: [],
      scopeCounts: { topLevel: 1, delegated: '2', background: 0 },
      delegatedCounts: { running: 1, byParent: { parent: { total: 2 } } },
    });
    const malformed = await client.listWithMeta('ws-counts');
    expect(malformed).toEqual({ agents: [], retiredCount: 0 });
    expect(Object.hasOwn(malformed, 'scopeCounts')).toBe(false);
    expect(Object.hasOwn(malformed, 'delegatedCounts')).toBe(false);
    backendRequest.mockResolvedValueOnce({
      agents: [],
      delegatedCounts: { running: 0, byParent: {}, orphaned: null },
    });
    const malformedOrphan = await client.listWithMeta('ws-counts');
    expect(malformedOrphan).toEqual({ agents: [], retiredCount: 0 });
    expect(Object.hasOwn(malformedOrphan, 'delegatedCounts')).toBe(false);
  });

  it('retains inherited numeric acceptance without adding finite-number validation', async () => {
    const { client, backendRequest } = fixture();
    // Boundary characterization, not a claim that nonfinite numbers are valid JSON wire data.
    backendRequest.mockResolvedValue({
      agents: [],
      retiredCount: NaN,
      scopeCounts: { topLevel: Infinity, delegated: -Infinity, background: NaN },
      delegatedCounts: { running: NaN, byParent: { parent: { total: Infinity, running: NaN } } },
    });
    expect(await client.listWithMeta('ws-counts')).toEqual({
      agents: [],
      retiredCount: NaN,
      scopeCounts: { topLevel: Infinity, delegated: -Infinity, background: NaN },
      delegatedCounts: { running: NaN, byParent: { parent: { total: Infinity, running: NaN } } },
    });
  });

  it.each([undefined, null, [], {}, { agents: {}, retiredCount: '4' }])(
    'retains empty envelope fallback for %j',
    async (response) => {
      const { client, backendRequest } = fixture();
      backendRequest.mockResolvedValue(response);
      const result = await client.listWithMeta('ws-fallback');
      expect(result).toEqual({ agents: [], retiredCount: 0 });
      expect(Object.hasOwn(result, 'scopeCounts')).toBe(false);
      expect(Object.hasOwn(result, 'delegatedCounts')).toBe(false);
    },
  );

  it.each(['list', 'listWithMeta'] as const)(
    'propagates the same rejection through %s',
    async (method) => {
      const { client, backendRequest } = fixture();
      const failure = new Error('read refused');
      backendRequest.mockRejectedValue(failure);
      await expect(client[method]('ws-errors', { scope: 'topLevel' })).rejects.toBe(failure);
      expect(backendRequest.mock.calls).toEqual([
        ['agent.list', { workspaceId: 'ws-errors', scope: 'topLevel' }],
      ]);
    },
  );

  it('does not filter invalid rows or undo earlier normalization cache effects', async () => {
    const { client, backendRequest } = fixture();
    backendRequest.mockResolvedValue({
      agents: [{ id: 'before-invalid', workspaceId: 'ws-before-invalid' }, null],
    });
    await expect(client.listWithMeta('ws-before-invalid')).rejects.toBeInstanceOf(TypeError);
    expect(getKnownAgentWorkspace('before-invalid')).toBe('ws-before-invalid');
  });

  it('keeps listWithMeta dispatch dynamic and returns its agents reference', async () => {
    const { client, backendRequest } = fixture();
    const agents: Awaited<ReturnType<typeof client.list>> = [];
    const listWithMeta = vi
      .spyOn(client, 'listWithMeta')
      .mockResolvedValue({ agents, retiredCount: 2 });
    const options = { scope: 'topLevel' } as const;
    expect(await client.list('ws-override', options)).toBe(agents);
    expect(listWithMeta).toHaveBeenCalledWith('ws-override', options);
    expect(listWithMeta.mock.contexts).toEqual([client]);
    expect(backendRequest).not.toHaveBeenCalled();
    const failure = new Error('override failure');
    listWithMeta.mockImplementation(() => {
      throw failure;
    });
    const pending = client.list('ws-override');
    expect(pending).toBeInstanceOf(Promise);
    await expect(pending).rejects.toBe(failure);
  });

  it('routes each instance through its supplied backend', async () => {
    const left = fixture();
    const right = fixture();
    left.backendRequest.mockResolvedValue({
      agents: [{ id: 'left-agent', workspaceId: 'left-ws' }],
    });
    right.backendRequest.mockResolvedValue({
      agents: [{ id: 'right-agent', workspaceId: 'right-ws', isBackground: true }],
    });
    const [leftRows, rightRows] = await Promise.all([
      left.client.list('left-ws', { scope: 'topLevel' }),
      right.client.list('right-ws', { scope: 'background' }),
    ]);
    expect(leftRows.map((agent) => agent.id)).toEqual(['left-agent']);
    expect(rightRows.map((agent) => agent.id)).toEqual(['right-agent']);
    expect(left.backendRequest.mock.calls).toEqual([
      ['agent.list', { workspaceId: 'left-ws', scope: 'topLevel' }],
    ]);
    expect(right.backendRequest.mock.calls).toEqual([
      ['agent.list', { workspaceId: 'right-ws', scope: 'background' }],
    ]);
  });

  it('retains get, model and reasoning requests on the same supplied boundary', async () => {
    const { client, backendRequest } = fixture();
    backendRequest.mockResolvedValueOnce({ agent: { id: 'existing', workspaceId: 'ws-existing' } });
    expect(await client.get('existing', 'ws-existing')).toMatchObject({
      id: 'existing',
      workspaceId: 'ws-existing',
      backendSessionId: null,
      messages: [],
    });
    backendRequest.mockResolvedValueOnce({ success: true, modelId: 'model' });
    expect(await client.setModel('existing', 'model', 'ws-existing', 'provider')).toEqual({
      ok: true,
      data: { success: true, modelId: 'model' },
    });
    backendRequest.mockResolvedValueOnce({ success: true });
    expect(
      await client.setReasoningEffort({
        agentId: 'existing',
        workspaceId: 'ws-existing',
        reasoningEffort: null,
      }),
    ).toEqual({ success: true });
    expect(backendRequest.mock.calls).toEqual([
      ['agent.get', { agentId: 'existing', workspaceId: 'ws-existing' }],
      [
        'agent.setModel',
        {
          agentId: 'existing',
          modelId: 'model',
          workspaceId: 'ws-existing',
          providerId: 'provider',
        },
      ],
      [
        'agent.update',
        { agentId: 'existing', workspaceId: 'ws-existing', changes: { reasoningEffort: null } },
      ],
    ]);
  });
});
