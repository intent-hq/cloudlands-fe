// Request-boundary tests: controlled responses, no Store or daemon startup.
import { describe, expect, it, vi } from 'vitest';
import type { ScriptArchiveFilter, ScriptWithState } from '../../../features/scripts/types';
import type { BackendRuntime } from './backend-transport-runtime';
import { createBackendScriptsClient } from './backend-scripts-client';

const supported = { server: { capabilities: { scriptLifecycle: 1 } } };
const unsupported = { server: { capabilities: {} } };

function fixture() {
  const request =
    vi.fn<(...args: Parameters<BackendRuntime['backendRequest']>) => Promise<unknown>>();
  const backendRequest: BackendRuntime['backendRequest'] = <T>(
    ...args: Parameters<BackendRuntime['backendRequest']>
  ) => request(...args) as Promise<T>;
  return { request, client: createBackendScriptsClient({ backendRequest }) };
}

function rows(): ScriptWithState[] {
  return [
    {
      id: 'saved-command',
      workspaceId: 'workspace-a',
      name: 'Check',
      command: 'pnpm check',
      mode: 'command',
      source: 'user',
      purpose: 'saved',
      createdAt: '2026-09-01T00:00:00Z',
      runtime: { status: 'idle', restartCount: 0 },
    },
    {
      id: 'service',
      workspaceId: 'workspace-a',
      name: 'Preview',
      command: 'pnpm dev',
      mode: 'service',
      source: 'user',
      purpose: 'saved',
      createdAt: '2026-09-02T00:00:00Z',
      runtime: { status: 'idle', restartCount: 0, previouslyRunning: true },
    },
  ];
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe('canonical script lifecycle reads', () => {
  it('constructs without negotiating and sends the exact hello request when asked', async () => {
    const f = fixture();
    expect(f.request).not.toHaveBeenCalled();
    f.request.mockResolvedValueOnce(supported);
    expect(await f.client.supportsLifecycle()).toBe(true);
    expect(f.request.mock.calls).toEqual([['client.hello', {}]]);
  });

  // Invalid capability types characterize the inherited JS client, not daemon acceptance.
  it.each([undefined, null, 0, 2, true, '1'])(
    'refuses capability value %s without guessing support',
    async (capability) => {
      const f = fixture();
      f.request.mockResolvedValueOnce({
        server: { capabilities: { scriptLifecycle: capability } },
      });
      expect(await f.client.supportsLifecycle()).toBe(false);
      expect(f.request.mock.calls).toEqual([['client.hello', {}]]);
    },
  );

  it.each([undefined, null, {}, { server: null }, { server: {} }])(
    'treats a missing capability envelope as unsupported: %j',
    async (response) => {
      const f = fixture();
      f.request.mockResolvedValueOnce(response);
      expect(await f.client.supportsLifecycle()).toBe(false);
    },
  );

  const supportedOptions: Array<{
    label: string;
    options: { archive?: ScriptArchiveFilter } | undefined;
    archive: ScriptArchiveFilter;
  }> = [
    { label: 'omitted options', options: undefined, archive: 'active' },
    { label: 'empty options', options: {}, archive: 'active' },
    { label: 'explicit active', options: { archive: 'active' }, archive: 'active' },
    { label: 'history', options: { archive: 'archived' }, archive: 'archived' },
    { label: 'all', options: { archive: 'all' }, archive: 'all' },
  ];
  it.each(supportedOptions)(
    'negotiates and forwards $label without changing rows',
    async ({ options, archive }) => {
      const f = fixture();
      const scripts = rows();
      if (archive === 'archived') {
        // History contains inactive commands; retain the complete runtime snapshot.
        scripts.splice(1);
        scripts[0].archivedAt = '2026-09-03T00:00:00Z';
      }
      f.request.mockResolvedValueOnce(supported).mockResolvedValueOnce({ scripts });
      const result = await f.client.list('workspace-a', options);
      expect(f.request.mock.calls).toEqual([
        ['client.hello', {}],
        ['script.list', { workspaceId: 'workspace-a', archive }],
      ]);
      expect(result).toBe(scripts);
      expect(result[0]).toBe(scripts[0]);
    },
  );

  it.each([undefined, {}, { archive: 'all' as const }])(
    'omits the wire filter for an unsupported legacy read: %j',
    async (options) => {
      const f = fixture();
      const scripts = rows();
      f.request.mockResolvedValueOnce(unsupported).mockResolvedValueOnce({ scripts });
      expect(await f.client.list('workspace-a', options)).toBe(scripts);
      expect(f.request.mock.calls).toEqual([
        ['client.hello', {}],
        ['script.list', { workspaceId: 'workspace-a' }],
      ]);
    },
  );

  it.each(['active', 'archived'] as const)(
    'refuses unsupported %s rather than requesting an unfiltered list',
    async (archive) => {
      const f = fixture();
      f.request.mockResolvedValueOnce(unsupported);
      await expect(f.client.list('workspace-a', { archive })).rejects.toThrow(Error);
      expect(f.request.mock.calls).toEqual([['client.hello', {}]]);
    },
  );

  it('does not cache an earlier negotiation or add a second probe inside a list', async () => {
    const f = fixture();
    const scripts = rows();
    f.request
      .mockResolvedValueOnce(supported)
      .mockResolvedValueOnce(unsupported)
      .mockResolvedValueOnce({ scripts })
      .mockResolvedValueOnce(supported)
      .mockResolvedValueOnce({ scripts });
    expect(await f.client.supportsLifecycle()).toBe(true);
    expect(await f.client.list('workspace-a')).toBe(scripts);
    expect(await f.client.list('workspace-a')).toBe(scripts);
    expect(f.request.mock.calls).toEqual([
      ['client.hello', {}],
      ['client.hello', {}],
      ['script.list', { workspaceId: 'workspace-a' }],
      ['client.hello', {}],
      ['script.list', { workspaceId: 'workspace-a', archive: 'active' }],
    ]);
  });

  it.each([new Error('hello failed'), { code: 'HELLO_UNAVAILABLE' }])(
    'preserves failed negotiation instead of treating it as unsupported: %j',
    async (failure) => {
      const f = fixture();
      f.request.mockRejectedValue(failure);
      await expect(f.client.supportsLifecycle()).rejects.toBe(failure);
      await expect(f.client.list('workspace-a', { archive: 'archived' })).rejects.toBe(failure);
      expect(f.request.mock.calls).toEqual([
        ['client.hello', {}],
        ['client.hello', {}],
      ]);
    },
  );

  it('turns a synchronous request throw into the original async rejection', async () => {
    const f = fixture();
    const failure = new Error('synchronous boundary failure');
    f.request.mockImplementation(() => {
      throw failure;
    });
    const capability = f.client.supportsLifecycle();
    const list = f.client.list('workspace-a');
    await expect(capability).rejects.toBe(failure);
    await expect(list).rejects.toBe(failure);
    expect(f.request.mock.calls).toEqual([
      ['client.hello', {}],
      ['client.hello', {}],
    ]);
  });

  it.each([undefined, null, {}, [], { scripts: null }, { scripts: {} }, { scripts: 'invalid' }])(
    'rejects malformed list envelopes without returning cached history: %j',
    async (response) => {
      const f = fixture();
      f.request.mockResolvedValueOnce(supported).mockResolvedValueOnce(response);
      await expect(f.client.list('workspace-a')).rejects.toThrow(Error);
      expect(f.request.mock.calls).toEqual([
        ['client.hello', {}],
        ['script.list', { workspaceId: 'workspace-a', archive: 'active' }],
      ]);
    },
  );

  it('returns an empty array by identity and preserves list rejection identity', async () => {
    const f = fixture();
    const empty: ScriptWithState[] = [];
    const failure = { code: 'LIST_UNAVAILABLE' };
    f.request
      .mockResolvedValueOnce(supported)
      .mockResolvedValueOnce({ scripts: empty })
      .mockResolvedValueOnce(supported)
      .mockRejectedValueOnce(failure);
    expect(await f.client.list('workspace-a')).toBe(empty);
    await expect(f.client.list('workspace-a')).rejects.toBe(failure);
  });

  it('uses the call receiver override dynamically, as the source facade requires', async () => {
    const f = fixture();
    const scripts = rows();
    f.request.mockResolvedValue({ scripts });
    const receiver = {
      allowed: false,
      async supportsLifecycle() {
        return this.allowed;
      },
    };
    expect(await f.client.list.call(receiver, 'workspace-a', { archive: 'all' })).toBe(scripts);
    receiver.allowed = true;
    expect(await f.client.list.call(receiver, 'workspace-a')).toBe(scripts);
    expect(f.request.mock.calls).toEqual([
      ['script.list', { workspaceId: 'workspace-a' }],
      ['script.list', { workspaceId: 'workspace-a', archive: 'active' }],
    ]);
  });

  it('rejects a throwing receiver override without invoking the backend', async () => {
    const f = fixture();
    const failure = new Error('override failed');
    const receiver = {
      supportsLifecycle() {
        throw failure;
      },
    };
    await expect(f.client.list.call(receiver, 'workspace-a')).rejects.toBe(failure);
    expect(f.request).not.toHaveBeenCalled();
  });

  it('retains the method receiver requirement when list is detached', async () => {
    const f = fixture();
    const detached = f.client.list;
    await expect(detached('workspace-a')).rejects.toThrow(TypeError);
    expect(f.request).not.toHaveBeenCalled();
  });

  it('reads archive options after its original pending hello settles', async () => {
    const f = fixture();
    const hello = deferred<unknown>();
    const scripts = rows();
    const options: { archive: ScriptArchiveFilter } = { archive: 'active' };
    f.request.mockReturnValueOnce(hello.promise).mockResolvedValueOnce({ scripts });
    const pending = f.client.list('workspace-a', options);
    expect(f.request.mock.calls).toEqual([['client.hello', {}]]);
    options.archive = 'all';
    hello.resolve(supported);
    expect(await pending).toBe(scripts);
    expect(f.request.mock.calls).toEqual([
      ['client.hello', {}],
      ['script.list', { workspaceId: 'workspace-a', archive: 'all' }],
    ]);
  });

  it('keeps independent clients and pending negotiations separate', async () => {
    const a = fixture();
    const b = fixture();
    const hello = deferred<unknown>();
    const aRows = rows();
    const bRows: ScriptWithState[] = [];
    a.request.mockReturnValueOnce(hello.promise).mockResolvedValueOnce({ scripts: aRows });
    b.request.mockResolvedValueOnce(unsupported).mockResolvedValueOnce({ scripts: bRows });
    const pendingA = a.client.list('workspace-a', { archive: 'all' });
    expect(await b.client.list('workspace-b')).toBe(bRows);
    expect(a.request.mock.calls).toEqual([['client.hello', {}]]);
    expect(b.request.mock.calls).toEqual([
      ['client.hello', {}],
      ['script.list', { workspaceId: 'workspace-b' }],
    ]);
    hello.resolve(supported);
    expect(await pendingA).toBe(aRows);
    expect(a.request.mock.calls).toEqual([
      ['client.hello', {}],
      ['script.list', { workspaceId: 'workspace-a', archive: 'all' }],
    ]);
    expect(b.request).toHaveBeenCalledTimes(2);
  });
});
