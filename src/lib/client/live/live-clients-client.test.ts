import { afterEach, describe, expect, it, vi } from 'vitest';

// FAKE transport only: `client.list` / `client.hello` never reach a daemon.
vi.mock('./backend-transport', () => ({
  backendRequest: vi.fn(),
}));

import { backendRequest } from './backend-transport';
import { __resetOwnClientIdForTesting, LiveClientsClient } from './live-clients-client';

const mockedRequest = vi.mocked(backendRequest);

/** PROTOCOL §5.17 `client.list` row as the daemon returns it. */
const DESKTOP_ROW = {
  clientId: 'cli-desk',
  name: 'Intent Desktop',
  capabilities: { browserExec: true },
  hostname: 'dev-box',
  prettyHostname: 'Dev Box',
  deviceKind: 'macStudio',
  connections: 1,
  transports: ['uds'],
  connectedAt: '2026-09-07T00:00:00.000Z',
};

afterEach(() => {
  __resetOwnClientIdForTesting();
  vi.clearAllMocks();
});

describe('LiveClientsClient (REV-2 PROTOCOL §5.17, fake transport)', () => {
  it('list forwards client.list with no params and surfaces the clients[] rows', async () => {
    const bare = {
      clientId: 'cli-cli',
      capabilities: {},
      connections: 2,
      transports: ['ws'],
      connectedAt: '2026-09-07T00:00:05.000Z',
    };
    mockedRequest.mockResolvedValueOnce({ clients: [DESKTOP_ROW, bare] });
    const client = new LiveClientsClient();

    expect(await client.list()).toEqual([DESKTOP_ROW, bare]);
    expect(mockedRequest).toHaveBeenCalledWith('client.list');
  });

  it('list rejects a malformed clients[] row instead of healing it', async () => {
    mockedRequest.mockResolvedValueOnce({ clients: [{ clientId: 'x' }] });
    const client = new LiveClientsClient();

    await expect(client.list()).rejects.toThrow('Invalid client.list response shape');
  });

  it('ownClientId probes client.hello once and shares the echoed clientId across callers', async () => {
    mockedRequest.mockResolvedValueOnce({
      clientId: 'cli-desk',
      capabilities: { browserExec: true },
      subscriptions: [],
    });
    const client = new LiveClientsClient();

    const [a, b] = await Promise.all([client.ownClientId(), client.ownClientId()]);
    expect(a).toBe('cli-desk');
    expect(b).toBe('cli-desk');
    expect(await new LiveClientsClient().ownClientId()).toBe('cli-desk');
    expect(mockedRequest).toHaveBeenCalledTimes(1);
    expect(mockedRequest).toHaveBeenCalledWith('client.hello', {});
  });

  it('ownClientId does not cache a failed probe, so the next caller retries', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('transport down'));
    mockedRequest.mockResolvedValueOnce({ clientId: 'cli-desk', subscriptions: [] });
    const client = new LiveClientsClient();

    await expect(client.ownClientId()).rejects.toThrow('transport down');
    expect(await client.ownClientId()).toBe('cli-desk');
    expect(mockedRequest).toHaveBeenCalledTimes(2);
  });

  it('ownClientId rejects a hello result without a clientId', async () => {
    mockedRequest.mockResolvedValueOnce({ subscriptions: [] });
    const client = new LiveClientsClient();

    await expect(client.ownClientId()).rejects.toThrow('clientId missing');
  });
});
