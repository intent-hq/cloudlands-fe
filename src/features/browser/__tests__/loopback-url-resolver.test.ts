/**
 * Tests for the shared loopback URL resolver (`loopback-url-resolver.ts`):
 * the rewrite → probe → tunnel pipeline behind both `browser.exec`
 * navigate/openTab and the `browser:resolve-url` IPC.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveBrowserUrl } from '../main/loopback-url-resolver';

const remoteContext = { daemonIsRemote: true, daemonHost: '10.0.0.5' };
const localContext = { daemonIsRemote: false };

describe('resolveBrowserUrl', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let forwardPort: ReturnType<typeof vi.fn>;
  let tunnelProvider: () => { forwardPort: (port: number) => Promise<number> };

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);
    forwardPort = vi.fn().mockResolvedValue(45678);
    tunnelProvider = () => ({ forwardPort });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('passes non-loopback URLs through without probing', async () => {
    const result = await resolveBrowserUrl('https://example.com/x', remoteContext, tunnelProvider);
    expect(result).toEqual({ url: 'https://example.com/x', rewritten: false });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(forwardPort).not.toHaveBeenCalled();
  });

  it('passes unparseable URLs through with a reason instead of throwing', async () => {
    const result = await resolveBrowserUrl('not a url', remoteContext, tunnelProvider);
    expect(result.url).toBe('not a url');
    expect(result.rewritten).toBe(false);
    expect(result.reason).toContain('not a parseable URL');
  });

  it('rewrites daemon.localhost to 127.0.0.1 in local mode without probing', async () => {
    const result = await resolveBrowserUrl(
      'http://daemon.localhost:3000/a?b=1',
      localContext,
      tunnelProvider,
    );
    expect(result.url).toBe('http://127.0.0.1:3000/a?b=1');
    expect(result.rewritten).toBe(true);
    expect(result.requestedUrl).toBe('http://daemon.localhost:3000/a?b=1');
    expect(result.tunneled).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('leaves bare loopback URLs unchanged in local mode', async () => {
    const result = await resolveBrowserUrl('http://localhost:5173/', localContext, tunnelProvider);
    expect(result).toEqual({ url: 'http://localhost:5173/', rewritten: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rewrites client.localhost to 127.0.0.1 in remote mode without probing', async () => {
    const result = await resolveBrowserUrl(
      'http://client.localhost:5173/',
      remoteContext,
      tunnelProvider,
    );
    expect(result.url).toBe('http://127.0.0.1:5173/');
    expect(result.rewritten).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rewrites daemon.localhost to the daemon host in remote mode when the probe succeeds', async () => {
    const result = await resolveBrowserUrl(
      'http://daemon.localhost:3000/x?q=1',
      remoteContext,
      tunnelProvider,
    );
    expect(result.url).toBe('http://10.0.0.5:3000/x?q=1');
    expect(result.rewritten).toBe(true);
    expect(result.requestedUrl).toBe('http://daemon.localhost:3000/x?q=1');
    expect(result.tunneled).toBeUndefined();
    expect(result.error).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith('http://10.0.0.5:3000', {
      signal: expect.any(AbortSignal),
    });
    expect(forwardPort).not.toHaveBeenCalled();
  });

  it('rewrites bare loopback URLs to the daemon host in remote mode with an ambiguity warning', async () => {
    const result = await resolveBrowserUrl(
      'http://127.0.0.1:3000/x',
      remoteContext,
      tunnelProvider,
    );
    expect(result.url).toBe('http://10.0.0.5:3000/x');
    expect(result.rewritten).toBe(true);
    expect(result.warning).toContain('daemon.localhost');
  });

  it('treats any HTTP response as reachable, including error statuses', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 502 });
    const result = await resolveBrowserUrl(
      'http://daemon.localhost:3000/',
      remoteContext,
      tunnelProvider,
    );
    expect(result.url).toBe('http://10.0.0.5:3000/');
    expect(result.error).toBeUndefined();
    expect(forwardPort).not.toHaveBeenCalled();
  });

  it('falls back to the daemon tunnel when the probe fails and flags tunneled', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    const result = await resolveBrowserUrl(
      'http://daemon.localhost:8080/page',
      remoteContext,
      tunnelProvider,
    );
    expect(forwardPort).toHaveBeenCalledWith(8080);
    expect(result.url).toBe('http://127.0.0.1:45678/page');
    expect(result.rewritten).toBe(true);
    expect(result.tunneled).toBe(true);
    expect(result.requestedUrl).toBe('http://daemon.localhost:8080/page');
    expect(result.reason).toContain('tunnel');
    expect(result.error).toBeUndefined();
  });

  it('keeps the ambiguity warning through the tunnel for bare-loopback rewrites', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    const result = await resolveBrowserUrl(
      'http://127.0.0.1:3000/x?q=1',
      remoteContext,
      tunnelProvider,
    );
    expect(result.url).toBe('http://127.0.0.1:45678/x?q=1');
    expect(result.tunneled).toBe(true);
    expect(result.warning).toContain('daemon.localhost');
  });

  it('returns the rewritten URL plus an error when the probe fails with no tunnel provider', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    const result = await resolveBrowserUrl('http://daemon.localhost:3000/x', remoteContext);
    expect(result.url).toBe('http://10.0.0.5:3000/x');
    expect(result.rewritten).toBe(true);
    expect(result.tunneled).toBeUndefined();
    expect(result.error).toContain('http://10.0.0.5:3000 is not reachable');
    expect(result.error).toContain('bind 0.0.0.0');
  });

  it('returns the rewritten URL plus an error when the probe fails and no provider is resolved', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    const result = await resolveBrowserUrl(
      'http://daemon.localhost:3000/x',
      remoteContext,
      () => null,
    );
    expect(result.error).toContain('not reachable');
    expect(result.tunneled).toBeUndefined();
  });

  it('returns the rewritten URL plus an error when both the probe and the tunnel fail', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    forwardPort.mockRejectedValue(new Error('tunnel closed'));
    const result = await resolveBrowserUrl(
      'http://daemon.localhost:8080/page',
      remoteContext,
      tunnelProvider,
    );
    expect(forwardPort).toHaveBeenCalledWith(8080);
    expect(result.url).toBe('http://10.0.0.5:8080/page');
    expect(result.tunneled).toBeUndefined();
    expect(result.error).toContain('not reachable');
  });

  it('surfaces the probe error cause detail in the error message', async () => {
    fetchMock.mockRejectedValue(
      Object.assign(new TypeError('fetch failed'), { cause: new Error('ECONNREFUSED') }),
    );
    const result = await resolveBrowserUrl('http://daemon.localhost:3000/', remoteContext);
    expect(result.error).toContain('ECONNREFUSED');
  });
});
