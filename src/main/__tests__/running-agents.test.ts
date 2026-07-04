/**
 * Quit-path "agents still running?" daemon check.
 *
 * Regression guard for the quit crash: the old check read the removed
 * main-process messageAccumulator Redux slice and threw
 * `Cannot read properties of undefined (reading 'accumulators')` on every
 * quit. The replacement consults the daemon (`workspace.list` +
 * `agent.list`, PROTOCOL §5.1/§5.5) for the per-agent `isResponding` flag.
 *
 * Per the FE testing contract, these tests assert the exact wire requests
 * (method + params) and feed back PROTOCOL.md-shaped mock responses.
 */

import { describe, expect, it, vi } from 'vitest';
import { listRespondingAgents, type RunningAgentsRpc } from '../running-agents';

/** PROTOCOL §5.5 AgentLite projection (fields relevant to the quit check). */
function agentLite(id: string, isResponding: boolean) {
  return {
    id,
    name: `Agent ${id}`,
    status: isResponding ? 'running' : 'idle',
    isStreaming: isResponding,
    isProcessing: isResponding,
    isResponding,
    messageCount: 1,
    lastActivity: '2026-07-04T00:00:00Z',
  };
}

/** PROTOCOL §5.1 Workspace projection (fields relevant to the quit check). */
function workspace(id: string) {
  return { id, title: `Workspace ${id}`, status: 'active' };
}

function mockClient(
  status: string,
  handlers: Record<string, (params?: unknown) => unknown>,
): { client: RunningAgentsRpc; requests: { method: string; params?: unknown }[] } {
  const requests: { method: string; params?: unknown }[] = [];
  const client: RunningAgentsRpc = {
    getStatus: () => status,
    request: vi.fn(async <T,>(method: string, params?: unknown): Promise<T> => {
      requests.push({ method, params });
      const handler = handlers[method];
      if (!handler) throw new Error(`unexpected method: ${method}`);
      return handler(params) as T;
    }),
  };
  return { client, requests };
}

describe('listRespondingAgents', () => {
  it('sends workspace.list then agent.list per workspace and returns only isResponding agents', async () => {
    const { client, requests } = mockClient('connected', {
      'workspace.list': () => ({ workspaces: [workspace('ws-1'), workspace('ws-2')] }),
      'agent.list': (params) => {
        const { workspaceId } = params as { workspaceId: string };
        if (workspaceId === 'ws-1') {
          return { agents: [agentLite('agent-a', true), agentLite('agent-b', false)] };
        }
        return { agents: [agentLite('agent-c', true)] };
      },
    });

    const result = await listRespondingAgents(client);

    expect(requests[0]).toEqual({ method: 'workspace.list', params: undefined });
    expect(requests.slice(1)).toEqual(
      expect.arrayContaining([
        { method: 'agent.list', params: { workspaceId: 'ws-1' } },
        { method: 'agent.list', params: { workspaceId: 'ws-2' } },
      ]),
    );
    expect(requests).toHaveLength(3);

    expect(result).toEqual(
      expect.arrayContaining([
        { agentId: 'agent-a', name: 'Agent agent-a', workspaceId: 'ws-1' },
        { agentId: 'agent-c', name: 'Agent agent-c', workspaceId: 'ws-2' },
      ]),
    );
    expect(result).toHaveLength(2);
  });

  it('returns [] when no agent is responding', async () => {
    const { client } = mockClient('connected', {
      'workspace.list': () => ({ workspaces: [workspace('ws-1')] }),
      'agent.list': () => ({ agents: [agentLite('agent-a', false), agentLite('agent-b', false)] }),
    });

    await expect(listRespondingAgents(client)).resolves.toEqual([]);
  });

  it('returns [] without any wire request when the daemon is not connected', async () => {
    const { client, requests } = mockClient('disconnected', {});

    await expect(listRespondingAgents(client)).resolves.toEqual([]);
    expect(requests).toHaveLength(0);
  });

  it('fails open (returns []) when workspace.list rejects', async () => {
    const { client } = mockClient('connected', {
      'workspace.list': () => {
        throw new Error('daemon went away');
      },
    });

    await expect(listRespondingAgents(client)).resolves.toEqual([]);
  });

  it('skips a workspace whose agent.list rejects but still reports the others', async () => {
    const { client } = mockClient('connected', {
      'workspace.list': () => ({ workspaces: [workspace('ws-bad'), workspace('ws-ok')] }),
      'agent.list': (params) => {
        const { workspaceId } = params as { workspaceId: string };
        if (workspaceId === 'ws-bad') throw new Error('boom');
        return { agents: [agentLite('agent-a', true)] };
      },
    });

    await expect(listRespondingAgents(client)).resolves.toEqual([
      { agentId: 'agent-a', name: 'Agent agent-a', workspaceId: 'ws-ok' },
    ]);
  });

  it('tolerates a workspaces payload with missing ids', async () => {
    const { client, requests } = mockClient('connected', {
      'workspace.list': () => ({ workspaces: [{ title: 'no id' }] }),
    });

    await expect(listRespondingAgents(client)).resolves.toEqual([]);
    expect(requests).toEqual([{ method: 'workspace.list', params: undefined }]);
  });
});
