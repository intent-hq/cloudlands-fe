import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CURRENT_PROTOCOL_VERSION } from '../../../test/current-protocol-version';

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
      return {
        server: {
          protocolVersion: CURRENT_PROTOCOL_VERSION,
          capabilities: supported ? { scriptLifecycle: 1, scriptActiveLists: 1 } : {},
        },
      } as never;
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
  it('explicit bulk discovery requests only unarchived definitions', async () => {
    const client = new LiveScriptsClient();
    expect(await client.list('synthetic-history')).toHaveLength(1000);
    expect(request).toHaveBeenCalledWith('script.list', {
      workspaceId: 'synthetic-history',
      archive: 'active',
    });
  });
  it.each([undefined, 0, 2, true, '1'])(
    'does not infer support from capability %s',
    async (capability) => {
      request.mockResolvedValue({ server: { capabilities: { scriptLifecycle: capability } } });
      expect(await new LiveScriptsClient().supportsLifecycle()).toBe(false);
    },
  );

  it('refuses discovery and mutations on older daemons, including after reconnect', async () => {
    const client = new LiveScriptsClient();
    expect(await client.supportsLifecycle()).toBe(true);
    supported = false;
    await expect(client.list('legacy')).rejects.toThrow();
    expect(request).not.toHaveBeenCalledWith('script.list', expect.anything());
    await expect(client.archive('legacy', ['synthetic-0'])).rejects.toThrow();
    await expect(client.restore('legacy', ['synthetic-0'])).rejects.toThrow();
    expect(
      request.mock.calls.some(([method]) =>
        ['script.archive', 'script.restore', 'script.remove'].includes(method),
      ),
    ).toBe(false);
  });
  it.each(['active'] as const)(
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
    await expect(new LiveScriptsClient().list('ws', { archive: 'active' })).rejects.toThrow(
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
        return {
          server: {
            protocolVersion: CURRENT_PROTOCOL_VERSION,
            capabilities: { scriptLifecycle: 1, scriptActiveLists: 1 },
          },
        } as never;
      throw new Error('storage failed after first commit');
    });
    await expect(client.archive('ws', ['a', 'b'])).rejects.toThrow('storage failed');
    await expect(client.list('ws')).rejects.toThrow('storage failed');
  });
});
