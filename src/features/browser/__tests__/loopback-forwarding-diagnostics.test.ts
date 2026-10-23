import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '../../../shared/logger';
import { TC_ADDRESS_WITH_PSK } from '../../../test/fixtures/tc-address.fixture';
import { TunnelForbiddenError } from '../../backend/main/tunnel-manager';
import { loopbackContextFromTransport } from '../main/loopback-rewrite';
import { resolveBrowserUrl } from '../main/loopback-url-resolver';

describe.each([
  { name: 'saved-loopback', host: 'localhost', unresolvedHost: 'localhost' },
  { name: 'Tailcat', host: TC_ADDRESS_WITH_PSK, unresolvedHost: 'daemon.localhost' },
])('$name forwarding diagnostics', ({ host, unresolvedHost }) => {
  const requestedUrl = 'http://daemon.localhost:8080/preview?q=1#section';
  const context = loopbackContextFromTransport(false, { transport: 'wss', host }, true);
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each([undefined, () => null])(
    'reports an unavailable provider without probing client loopback',
    async (provider) => {
      const result = await resolveBrowserUrl(requestedUrl, context, provider);
      expect(result.error).toMatch(/provider.*unavailable/i);
      expect(result.error).not.toMatch(/probe failed|bind 0\.0\.0\.0|client loopback/i);
      expect(result.tunneled).toBeUndefined();
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('preserves provider construction failure', async () => {
    const result = await resolveBrowserUrl(requestedUrl, context, () => {
      throw new Error('PROVIDER_SETUP_FAILURE');
    });
    expect(result.error).toContain('PROVIDER_SETUP_FAILURE');
    expect(result.error).toMatch(/provider/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([new Error('FORWARD_CONNECT_FAILURE'), 'FORWARD_CONNECT_FAILURE'])(
    'preserves the forwarding failure (%s)',
    async (failure) => {
      const forwardPort = vi.fn().mockRejectedValue(failure);
      const result = await resolveBrowserUrl(requestedUrl, context, () => ({ forwardPort }));
      expect(result.error).toContain('FORWARD_CONNECT_FAILURE');
      expect(forwardPort).toHaveBeenCalledExactlyOnceWith(8080);
      expect(result.url).toBe(`http://${unresolvedHost}:8080/preview?q=1#section`);
      expect(result.tunneled).toBeUndefined();
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('preserves a forwarding cause while removing credential values', async () => {
    const failure = new Error('FORWARD_CONNECT_FAILURE token=private-marker', {
      cause: new Error(
        'ECONNREFUSED wss://user:private-marker@localhost:9443/tunnel?token=private-marker',
      ),
    });
    const result = await resolveBrowserUrl(requestedUrl, context, () => ({
      forwardPort: vi.fn().mockRejectedValue(failure),
    }));
    expect(result.error).toContain('FORWARD_CONNECT_FAILURE');
    expect(result.error).toContain('ECONNREFUSED');
    expect(result.error).not.toContain('private-marker');
  });

  it.each(['provider', 'forward', 'forbidden'])(
    'redacts Tailcat credentials in %s failures and logs',
    async (stage) => {
      const failure =
        stage === 'forbidden' ? new TunnelForbiddenError() : new Error('TAILCAT_CONNECT_FAILURE');
      failure.message += ` ${TC_ADDRESS_WITH_PSK} token=private-marker`;
      failure.cause = new Error(`TAILCAT_CAUSE_FAILURE ${TC_ADDRESS_WITH_PSK}`);
      const result = await resolveBrowserUrl(requestedUrl, context, () => {
        if (stage === 'provider') throw failure;
        return { forwardPort: vi.fn().mockRejectedValue(failure) };
      });
      expect(result.error).toContain('TAILCAT_CAUSE_FAILURE');
      if (stage === 'forbidden') expect(result.forbidden).toBe(true);
      else expect(result.error).toContain('TAILCAT_CONNECT_FAILURE');
      const diagnostics = JSON.stringify([result, vi.mocked(Logger.prototype.warn).mock.calls]);
      expect(diagnostics.toLowerCase()).not.toContain(TC_ADDRESS_WITH_PSK.toLowerCase());
      expect(diagnostics).not.toContain('private-marker');
      expect(result.tunneled).toBeUndefined();
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('keeps the remote probe error separately from the forwarding failure', async () => {
    fetchMock.mockRejectedValue(new Error('PROBE_FAILURE'));
    const result = await resolveBrowserUrl(
      requestedUrl,
      { daemonIsRemote: true, daemonHost: '192.0.2.5' },
      () => ({ forwardPort: vi.fn().mockRejectedValue(new Error('FORWARD_FAILURE')) }),
    );
    expect(result.error).toContain('PROBE_FAILURE');
    expect(result.error).toContain('FORWARD_FAILURE');
  });

  it('preserves workspace-guest refusal classification', async () => {
    const result = await resolveBrowserUrl(requestedUrl, context, () => ({
      forwardPort: vi.fn().mockRejectedValue(new TunnelForbiddenError()),
    }));
    expect(result.forbidden).toBe(true);
    expect(result.tunneled).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
