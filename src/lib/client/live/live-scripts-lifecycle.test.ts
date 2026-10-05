import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('./backend-transport', () => ({ backendRequest: vi.fn() }));
import { backendRequest } from './backend-transport';
import { LiveScriptsClient } from './live-scripts-client';
import { makeScriptsFixture } from '../../../test/fixtures/scripts';
const request = vi.mocked(backendRequest);
let supported = true;
const rows = makeScriptsFixture().map((s, index) =>
  index < 3 ? { ...s, archivedAt: '2026-09-30T12:00:00Z' } : s,
);
beforeEach(() => {
  supported = true;
  request.mockReset();
  request.mockImplementation(async (method, params) => {
    if (method === 'client.hello')
      return { server: { capabilities: supported ? { scriptLifecycle: 1 } : {} } } as never;
    if (method === 'script.list')
      return {
        scripts: rows.filter((row) => {
          const filter = (params as { archive?: string })?.archive;
          return filter === 'archived'
            ? !!row.archivedAt
            : filter === 'active'
              ? !row.archivedAt
              : true;
        }),
      } as never;
    return { archived: ['synthetic-0'], restored: ['synthetic-0'], skipped: [] } as never;
  });
});
describe('lifecycle wire negotiation', () => {
  it('explicitly requests active; preserves the envelope and all/history options', async () => {
    const client = new LiveScriptsClient();
    expect(await client.list('synthetic-history')).toHaveLength(1000);
    expect(request).toHaveBeenCalledWith('script.list', {
      workspaceId: 'synthetic-history',
      archive: 'active',
    });
    await client.list('synthetic-history', { archive: 'all' });
    expect(request).toHaveBeenCalledWith('script.list', {
      workspaceId: 'synthetic-history',
      archive: 'all',
    });
    expect(await client.list('synthetic-history', { archive: 'archived' })).toHaveLength(3);
    // Legacy callers still receive the same envelope and full definitions when
    // omitting the filter, including rows retained for their selected output.
    expect(await backendRequest('script.list', { workspaceId: 'synthetic-history' })).toEqual({
      scripts: rows,
    });
  });
  it.each([undefined, 0, 2, true, '1'])(
    'does not infer support from capability %s',
    async (capability) => {
      request.mockResolvedValue({ server: { capabilities: { scriptLifecycle: capability } } });
      expect(await new LiveScriptsClient().supportsLifecycle()).toBe(false);
    },
  );

  it('omits filters and refuses mutations on older daemons, including after reconnect', async () => {
    const client = new LiveScriptsClient();
    expect(await client.supportsLifecycle()).toBe(true);
    supported = false;
    expect(await client.list('legacy', { archive: 'all' })).toEqual(rows);
    expect(request).toHaveBeenCalledWith('script.list', { workspaceId: 'legacy' });
    await expect(client.archive('legacy', ['synthetic-0'])).rejects.toThrow();
    await expect(client.restore('legacy', ['synthetic-0'])).rejects.toThrow();
    expect(
      request.mock.calls.some(([method]) =>
        ['script.archive', 'script.restore', 'script.remove'].includes(method),
      ),
    ).toBe(false);
  });
  it.each(['active', 'archived'] as const)(
    'never downgrades an explicit %s partition after capability loss',
    async (archive) => {
      supported = false;
      await expect(new LiveScriptsClient().list('legacy', { archive })).rejects.toThrow();
      expect(request.mock.calls.filter(([method]) => method === 'script.list')).toEqual([]);
    },
  );
  it('surfaces a failed capability probe instead of claiming legacy support', async () => {
    request.mockRejectedValue(new Error('hello unavailable'));
    await expect(new LiveScriptsClient().supportsLifecycle()).rejects.toThrow('hello unavailable');
    await expect(new LiveScriptsClient().list('ws', { archive: 'archived' })).rejects.toThrow(
      'hello unavailable',
    );
    expect(request.mock.calls.filter(([method]) => method === 'script.list')).toEqual([]);
  });
  it('forwards reviewed IDs without deleting and surfaces partial-write failures', async () => {
    const client = new LiveScriptsClient();
    await client.archive('ws', ['a', 'b']);
    expect(request).toHaveBeenCalledWith('script.archive', {
      workspaceId: 'ws',
      scriptIds: ['a', 'b'],
    });
    await client.restore('ws', ['a']);
    expect(request).toHaveBeenCalledWith('script.restore', { workspaceId: 'ws', scriptIds: ['a'] });
    request.mockImplementation(async (method) => {
      if (method === 'client.hello')
        return { server: { capabilities: { scriptLifecycle: 1 } } } as never;
      throw new Error('storage failed after first commit');
    });
    await expect(client.archive('ws', ['a', 'b'])).rejects.toThrow('storage failed');
    await expect(client.list('ws')).rejects.toThrow('storage failed');
  });
});
