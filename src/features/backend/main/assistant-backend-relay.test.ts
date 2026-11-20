import { describe, expect, it, vi } from 'vitest';
import type { ConnectionRecord } from '$shared/types/connections';
import {
  backendIdentity,
  buildBackendsReport,
  connectionForBackend,
  handleRelayCall,
  type RelayDeps,
} from './assistant-backend-relay';
import { JsonRpcError } from './json-rpc-errors';
import type { JsonRpcClient } from './json-rpc-client';

function record(overrides: Partial<ConnectionRecord>): ConnectionRecord {
  return {
    id: 'studio',
    label: 'Studio',
    host: 'studio.local',
    port: 8843,
    fingerprint: 'aa:bb',
    ...overrides,
  } as ConnectionRecord;
}

const local = { name: 'MacBook', host: 'macbook', port: 7777, fingerprint: 'ff:ee' };

function deps(
  client: Partial<JsonRpcClient>,
  records: ConnectionRecord[] = [record({})],
): RelayDeps {
  return {
    list: async () => records,
    localFacts: () => local,
    clientFor: vi.fn(async () => client as JsonRpcClient),
  };
}

describe('assistant backend relay', () => {
  it('uses the Keychain machine identity', () => {
    expect(backendIdentity({ host: 'h', port: 1, fingerprint: ' aa:bb ' })).toBe('fp:AA:BB');
    expect(backendIdentity({ host: ' Home.Example ', port: 8843 })).toBe('addr:home.example:8843');
    expect(backendIdentity({ host: '', port: 0, tcAddress: 'route-1' })).toBe('tc:route-1');
  });

  it('reports saved remotes and the local daemon without any token', () => {
    const records = [
      record({ token: 'secret-token' } as Partial<ConnectionRecord>),
      record({ id: 'local', label: 'This machine (local)', host: null, port: null }),
      record({ id: 'shown', displayOnly: true }),
    ];
    const report = buildBackendsReport(records, (id) => id === 'studio', local);
    expect(report).toEqual([
      { name: 'MacBook', host: 'macbook', port: 7777, fingerprint: 'ff:ee', connected: true },
      { name: 'Studio', host: 'studio.local', port: 8843, fingerprint: 'aa:bb', connected: true },
    ]);
    expect(JSON.stringify(report)).not.toContain('secret-token');
  });

  it('maps a relayed backend id to its saved connection, local included', async () => {
    const d = deps({});
    expect(await connectionForBackend('fp:AA:BB', d)).toBe('studio');
    expect(await connectionForBackend('fp:FF:EE', d)).toBe('local');
    expect(await connectionForBackend('fp:00', d)).toBeNull();
  });

  it('relays the call with the requested bound and returns its result', async () => {
    const request = vi.fn(async () => ({ workspaces: [] }));
    const d = deps({ request } as Partial<JsonRpcClient>);
    const reply = await handleRelayCall(
      { backendId: 'fp:AA:BB', method: 'workspace.list', params: { a: 1 }, timeoutMs: 5000 },
      d,
    );
    expect(d.clientFor).toHaveBeenCalledWith('studio');
    expect(request).toHaveBeenCalledWith('workspace.list', { a: 1 }, { timeoutMs: 5000 });
    expect(reply).toEqual({ result: { workspaces: [] } });
  });

  it("passes the remote daemon's JSON-RPC error through and names unknown backends", async () => {
    const request = vi.fn(async () => {
      throw new JsonRpcError({ code: -32602, message: 'bad', data: { code: 'invalid-params' } });
    });
    const reply = (await handleRelayCall(
      { backendId: 'fp:AA:BB', method: 'workspace.get', params: {}, timeoutMs: 1 },
      deps({ request } as Partial<JsonRpcClient>),
    )) as { error: { code: number; message: string } };
    expect(reply.error.code).toBe(-32602);
    expect(reply.error.message).toBe('bad');
    const unknown = (await handleRelayCall(
      { backendId: 'fp:00', method: 'x', params: {}, timeoutMs: 1 },
      deps({}),
    )) as { error: { data: { code: string } } };
    expect(unknown.error.data.code).toBe('unknown-backend');
  });
});
