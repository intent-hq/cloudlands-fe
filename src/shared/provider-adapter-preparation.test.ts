import { describe, expect, it, vi } from 'vitest';
import {
  createProviderAdapterPreparer,
  type AdapterPreparationClient,
} from './provider-adapter-preparation';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const row = (id: string, installed = true, gatedOff: string | null = null) => ({
  id,
  installed,
  gatedOff,
});
function backend(providers = [row('claude-code'), row('codex'), row('pi')]) {
  const request = vi.fn(async (method: string) =>
    method === 'host.providerDiscovery' ? { providers } : { accepted: true },
  );
  return { request, client: { request } as AdapterPreparationClient };
}

describe('onboarding adapter preparation wire operation', () => {
  it('prepares every detected eligible provider without any auth, session or shell request', async () => {
    const { client, request } = backend([
      row('claude-code'),
      row('codex'),
      row('pi'),
      row('pi'),
      row('auggie'),
      row('mock'),
    ]);
    await createProviderAdapterPreparer()(client, 'host-a:1');
    expect(request.mock.calls).toEqual([
      ['host.providerDiscovery', {}],
      ['host.prepareProviderAdapters', { providerIds: ['claude-code', 'codex', 'pi'] }],
    ]);
  });

  it('skips missing and gated providers; the daemon revalidates the remaining candidates', async () => {
    const { client, request } = backend([
      row('claude-code', false),
      row('codex', true, 'feature'),
      row('pi'),
    ]);
    await createProviderAdapterPreparer()(client, 'a');
    expect(request).toHaveBeenLastCalledWith('host.prepareProviderAdapters', {
      providerIds: ['pi'],
    });
  });

  it('deduplicates rerenders/refreshes and detects new providers while the optional reply is pending', async () => {
    const prepare = createProviderAdapterPreparer();
    const providers = [row('claude-code')];
    const { client, request } = backend(providers);
    const pending = deferred<{ accepted: true }>();
    request.mockImplementation(async (method) =>
      method === 'host.providerDiscovery' ? { providers } : pending.promise,
    );
    await prepare(client, 'a');
    await prepare(client, 'a');
    providers.push(row('codex'));
    await prepare(client, 'a');
    expect(
      request.mock.calls.filter(([method]) => method === 'host.prepareProviderAdapters'),
    ).toEqual([
      ['host.prepareProviderAdapters', { providerIds: ['claude-code'] }],
      ['host.prepareProviderAdapters', { providerIds: ['codex'] }],
    ]);
    pending.resolve({ accepted: true });
  });

  it('single-flights overlapping discovery calls and permits an explicit refresh afterwards', async () => {
    const prepare = createProviderAdapterPreparer();
    const { client, request } = backend();
    const discovery = deferred<{ providers: ReturnType<typeof row>[] }>();
    request.mockImplementationOnce(() => discovery.promise);
    const first = prepare(client, 'a');
    const second = prepare(client, 'a');
    expect(request).toHaveBeenCalledTimes(1);
    discovery.resolve({ providers: [row('pi')] });
    await Promise.all([first, second]);
    await prepare(client, 'a');
    expect(
      request.mock.calls.filter(([method]) => method === 'host.providerDiscovery'),
    ).toHaveLength(2);
  });

  it.each([{ code: -32601 }, { rpcCode: -32601 }])(
    'skips an older daemon for this connection only: %j',
    async (error) => {
      const prepare = createProviderAdapterPreparer();
      const { client, request } = backend();
      request.mockImplementation(async (method) => {
        if (method === 'host.providerDiscovery') return { providers: [row('pi')] };
        throw error;
      });
      await prepare(client, 'a:1');
      await prepare(client, 'a:1');
      expect(request).toHaveBeenCalledTimes(2);
      await prepare(client, 'a:2');
      expect(request).toHaveBeenCalledTimes(4);
      const other = backend();
      await prepare(other.client, 'b:1');
      expect(other.request).toHaveBeenCalledWith('host.prepareProviderAdapters', {
        providerIds: ['claude-code', 'codex', 'pi'],
      });
    },
  );

  it('contains offline discovery and preparation failures without tight retries', async () => {
    const prepare = createProviderAdapterPreparer();
    const { client, request } = backend();
    request.mockRejectedValueOnce(new Error('offline'));
    await expect(prepare(client, 'a')).resolves.toBeUndefined();
    request.mockImplementation(async (method) => {
      if (method === 'host.providerDiscovery') return { providers: [row('pi')] };
      throw new Error('timeout');
    });
    await expect(prepare(client, 'a')).resolves.toBeUndefined();
    await prepare(client, 'a');
    expect(
      request.mock.calls.filter(([method]) => method === 'host.prepareProviderAdapters'),
    ).toHaveLength(1);
  });

  it('never sends an old discovery result through a replacement client', async () => {
    const prepare = createProviderAdapterPreparer();
    const a = backend();
    const b = backend([row('codex')]);
    const discovery = deferred<{ providers: ReturnType<typeof row>[] }>();
    a.request.mockImplementationOnce(() => discovery.promise);
    const old = prepare(a.client, 'a');
    await prepare(b.client, 'b');
    discovery.resolve({ providers: [row('pi')] });
    await old;
    expect(a.request).toHaveBeenLastCalledWith('host.prepareProviderAdapters', {
      providerIds: ['pi'],
    });
    expect(b.request).toHaveBeenLastCalledWith('host.prepareProviderAdapters', {
      providerIds: ['codex'],
    });
  });

  it('discards old discovery after reconnect and lets the new generation prepare again', async () => {
    const prepare = createProviderAdapterPreparer();
    const { client, request } = backend([row('codex')]);
    const discovery = deferred<{ providers: ReturnType<typeof row>[] }>();
    request.mockImplementationOnce(() => discovery.promise);
    const old = prepare(client, 'a:1');
    await prepare(client, 'a:2');
    discovery.resolve({ providers: [row('pi')] });
    await old;
    expect(
      request.mock.calls.filter(([method]) => method === 'host.prepareProviderAdapters'),
    ).toEqual([['host.prepareProviderAdapters', { providerIds: ['codex'] }]]);
  });
});
