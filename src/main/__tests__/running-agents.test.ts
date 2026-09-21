/**
 * Quit-path "agents still running?" daemon check.
 *
 * Regression guard for the quit crash: the old check read the removed
 * main-process messageAccumulator Redux slice and threw
 * `Cannot read properties of undefined (reading 'accumulators')` on every
 * quit. The replacement consults the daemon's global mid-turn busy set
 * (`agent.listActive`, PROTOCOL §5.5) and resolves each busy agent's name
 * with `agent.get` — never the unbounded `agent.list` fan-out
 * (intent-hq/intent#5531).
 *
 * Per the FE testing contract, these tests assert the exact wire requests
 * (method + params) and feed back PROTOCOL.md-shaped mock responses.
 */

import { describe, expect, it, vi } from 'vitest';
import { listRespondingAgents, type RunningAgentsRpc } from '../running-agents';

/** PROTOCOL §5.5 `agent.listActive` stream entry. */
function stream(agentId: string, workspaceId: string) {
  return { agentId, sessionId: agentId, workspaceId, startTime: 1_783_468_800_000 };
}

/** PROTOCOL §5.5 `agent.get` result (fields relevant to the quit check). */
function agentGet(id: string) {
  return {
    agent: {
      id,
      name: `Agent ${id}`,
      status: 'running',
      isStreaming: true,
      isProcessing: true,
      isResponding: true,
      messageCount: 1,
      lastActivity: '2026-07-04T00:00:00Z',
    },
  };
}

function mockClient(
  status: string,
  handlers: Record<string, (params?: unknown) => unknown>,
): { client: RunningAgentsRpc; requests: { method: string; params?: unknown }[] } {
  const requests: { method: string; params?: unknown }[] = [];
  const client: RunningAgentsRpc = {
    getStatus: () => status,
    request: vi.fn(async <T>(method: string, params?: unknown): Promise<T> => {
      requests.push({ method, params });
      const handler = handlers[method];
      if (!handler) throw new Error(`unexpected method: ${method}`);
      return handler(params) as T;
    }),
  };
  return { client, requests };
}

describe('listRespondingAgents', () => {
  it('sends one agent.listActive then one agent.get per busy agent and returns them all', async () => {
    const { client, requests } = mockClient('connected', {
      'agent.listActive': () => ({
        streams: [stream('agent-a', 'ws-1'), stream('agent-c', 'ws-2')],
      }),
      'agent.get': (params) => agentGet((params as { agentId: string }).agentId),
    });

    const result = await listRespondingAgents(client);

    expect(requests[0]).toEqual({ method: 'agent.listActive', params: {} });
    expect(requests.slice(1)).toEqual(
      expect.arrayContaining([
        { method: 'agent.get', params: { agentId: 'agent-a', workspaceId: 'ws-1' } },
        { method: 'agent.get', params: { agentId: 'agent-c', workspaceId: 'ws-2' } },
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

  it('never requests agent.list or workspace.list', async () => {
    const { client, requests } = mockClient('connected', {
      'agent.listActive': () => ({ streams: [stream('agent-a', 'ws-1')] }),
      'agent.get': (params) => agentGet((params as { agentId: string }).agentId),
    });

    await listRespondingAgents(client);

    const methods = requests.map((request) => request.method);
    expect(methods).not.toContain('agent.list');
    expect(methods).not.toContain('workspace.list');
  });

  it('returns [] with a single wire request when no agent is mid-turn', async () => {
    const { client, requests } = mockClient('connected', {
      'agent.listActive': () => ({ streams: [] }),
    });

    await expect(listRespondingAgents(client)).resolves.toEqual([]);
    expect(requests).toEqual([{ method: 'agent.listActive', params: {} }]);
  });

  it('returns [] without any wire request when the daemon is not connected', async () => {
    const { client, requests } = mockClient('disconnected', {});

    await expect(listRespondingAgents(client)).resolves.toEqual([]);
    expect(requests).toHaveLength(0);
  });

  it('fails open (returns []) when agent.listActive rejects, without any fallback fan-out', async () => {
    const { client, requests } = mockClient('connected', {
      'agent.listActive': () => {
        throw new Error('daemon went away');
      },
    });

    await expect(listRespondingAgents(client)).resolves.toEqual([]);
    expect(requests).toEqual([{ method: 'agent.listActive', params: {} }]);
  });

  it('falls back to the agent id as name when agent.get rejects but still reports the agent', async () => {
    const { client } = mockClient('connected', {
      'agent.listActive': () => ({
        streams: [stream('agent-bad', 'ws-1'), stream('agent-ok', 'ws-2')],
      }),
      'agent.get': (params) => {
        const { agentId } = params as { agentId: string };
        if (agentId === 'agent-bad') throw new Error('boom');
        return agentGet(agentId);
      },
    });

    const result = await listRespondingAgents(client);

    expect(result).toEqual(
      expect.arrayContaining([
        { agentId: 'agent-bad', name: 'agent-bad', workspaceId: 'ws-1' },
        { agentId: 'agent-ok', name: 'Agent agent-ok', workspaceId: 'ws-2' },
      ]),
    );
    expect(result).toHaveLength(2);
  });

  it('tolerates a streams payload with missing agent ids', async () => {
    const { client, requests } = mockClient('connected', {
      'agent.listActive': () => ({ streams: [{ workspaceId: 'ws-1', startTime: 0 }] }),
    });

    await expect(listRespondingAgents(client)).resolves.toEqual([]);
    expect(requests).toEqual([{ method: 'agent.listActive', params: {} }]);
  });
});
