import { describe, expect, it, vi } from 'vitest';
import type { ConnectionRecord } from '$shared/types/connections';
import type { RelayDeps } from './assistant-backend-relay';
import {
  openBackendWorkspace,
  readBackendWorkspaceCards,
  type WorkspaceCardsDeps,
} from './assistant-workspace-cards';
import type { JsonRpcClient } from './json-rpc-client';
import { JsonRpcError } from './json-rpc-errors';

const studio = {
  id: 'studio',
  label: 'Mac Studio',
  host: 'studio.local',
  port: 8843,
  fingerprint: 'aa:bb',
} as ConnectionRecord;

const local = { name: 'MacBook', host: 'macbook', port: 7777, fingerprint: 'ff:ee' };

function deps(
  request: JsonRpcClient['request'],
  clientFor?: RelayDeps['clientFor'],
  liveClients: string[] = [],
): WorkspaceCardsDeps {
  return {
    list: async () => [studio],
    localFacts: () => local,
    clientFor: clientFor ?? vi.fn(async () => ({ request }) as unknown as JsonRpcClient),
    hasClient: (id) => liveClients.includes(id),
    release: vi.fn(),
  };
}

const notFound = () => new JsonRpcError({ code: -32602, message: 'workspace not found' });

describe('readBackendWorkspaceCards', () => {
  it('reads each workspace over the saved connection the backend id names', async () => {
    const request = vi.fn(async (_method: string, params: unknown) => ({
      workspace: { id: (params as { workspaceId: string }).workspaceId, title: 'Safari Fix' },
    })) as unknown as JsonRpcClient['request'];
    const d = deps(request);

    const result = await readBackendWorkspaceCards(
      { backendId: 'fp:AA:BB', workspaceIds: ['ws-1', 'ws-1'] },
      d,
    );

    expect(d.clientFor).toHaveBeenCalledWith('studio');
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith(
      'workspace.get',
      { workspaceId: 'ws-1' },
      expect.anything(),
    );
    expect(result).toEqual({
      status: 'ok',
      machineName: 'Mac Studio',
      workspaces: [{ id: 'ws-1', title: 'Safari Fix' }],
    });
  });

  it('names the local daemon by this machine when the id is its own', async () => {
    const request = vi.fn(async () => ({ id: 'ws-1' })) as unknown as JsonRpcClient['request'];
    const d = deps(request);

    const result = await readBackendWorkspaceCards(
      { backendId: 'fp:FF:EE', workspaceIds: ['ws-1'] },
      d,
    );

    expect(d.clientFor).toHaveBeenCalledWith('local');
    expect(result).toEqual({ status: 'ok', machineName: 'MacBook', workspaces: [{ id: 'ws-1' }] });
  });

  it('leaves out a workspace the machine reports missing', async () => {
    const request = vi.fn(async (_method: string, params: unknown) => {
      const { workspaceId } = params as { workspaceId: string };
      if (workspaceId === 'gone') throw notFound();
      return { workspace: { id: workspaceId } };
    }) as unknown as JsonRpcClient['request'];

    const result = await readBackendWorkspaceCards(
      { backendId: 'fp:AA:BB', workspaceIds: ['gone', 'kept'] },
      deps(request),
    );

    expect(result).toEqual({
      status: 'ok',
      machineName: 'Mac Studio',
      workspaces: [{ id: 'kept' }],
    });
  });

  it('reports a backend this app has not saved without connecting anywhere', async () => {
    const d = deps(vi.fn() as unknown as JsonRpcClient['request']);

    const result = await readBackendWorkspaceCards(
      { backendId: 'fp:00:11', workspaceIds: ['ws-1'] },
      d,
    );

    expect(result).toEqual({ status: 'unknown-backend' });
    expect(d.clientFor).not.toHaveBeenCalled();
  });

  it('reports the machine unreachable when it cannot connect or a read gets no reply', async () => {
    const refused = deps(
      vi.fn() as unknown as JsonRpcClient['request'],
      vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      }),
    );
    const timedOut = deps(
      vi.fn(async () => {
        throw new Error('Request timed out');
      }) as unknown as JsonRpcClient['request'],
    );
    const params = { backendId: 'fp:AA:BB', workspaceIds: ['ws-1'] };

    expect(await readBackendWorkspaceCards(params, refused)).toEqual({
      status: 'unreachable',
      machineName: 'Mac Studio',
    });
    expect(await readBackendWorkspaceCards(params, timedOut)).toEqual({
      status: 'unreachable',
      machineName: 'Mac Studio',
    });
  });
});

describe('readBackendWorkspaceCards connection lifetime', () => {
  const timedOut = vi.fn(async () => {
    throw new Error('Request timed out');
  }) as unknown as JsonRpcClient['request'];
  const params = { backendId: 'fp:AA:BB', workspaceIds: ['ws-1'] };

  it('closes the connection it opened for an unreachable machine', async () => {
    const d = deps(timedOut);

    await readBackendWorkspaceCards(params, d);

    expect(d.release).toHaveBeenCalledWith('studio');
  });

  it('keeps a connection that was already open', async () => {
    const d = deps(timedOut, undefined, ['studio']);

    await readBackendWorkspaceCards(params, d);

    expect(d.release).not.toHaveBeenCalled();
  });

  it('never closes the local daemon connection', async () => {
    const d = deps(timedOut);

    await readBackendWorkspaceCards({ backendId: 'fp:FF:EE', workspaceIds: ['ws-1'] }, d);

    expect(d.release).not.toHaveBeenCalled();
  });
});

describe('openBackendWorkspace', () => {
  it('opens the workspace on the saved connection the backend id names', async () => {
    const open = vi.fn(async (id: string) => ({ status: 'opened' as const, id }));

    const result = await openBackendWorkspace(
      { backendId: 'fp:AA:BB', workspaceId: 'ws-1' },
      { relay: deps(vi.fn() as unknown as JsonRpcClient['request']), open },
    );

    expect(open).toHaveBeenCalledWith('studio', 'ws-1');
    expect(result).toEqual({ status: 'opened', id: 'studio' });
  });

  it('opens nothing for a backend this app has not saved', async () => {
    const open = vi.fn();

    const result = await openBackendWorkspace(
      { backendId: 'addr:elsewhere:1', workspaceId: 'ws-1' },
      { relay: deps(vi.fn() as unknown as JsonRpcClient['request']), open },
    );

    expect(result).toEqual({ status: 'unknown-backend' });
    expect(open).not.toHaveBeenCalled();
  });
});
