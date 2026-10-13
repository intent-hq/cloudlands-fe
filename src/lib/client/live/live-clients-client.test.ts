import { afterEach, describe, expect, it, vi } from 'vitest';

// Fake transport boundary; observing identity must never send a hello.
vi.mock('./backend-transport', () => ({
  backendRequest: vi.fn(),
  observeBackendNodeCapabilities: vi.fn(),
}));

import { backendRequest, observeBackendNodeCapabilities } from './backend-transport';
import { __resetOwnClientIdForTesting, LiveClientsClient } from './live-clients-client';

const mockedRequest = vi.mocked(backendRequest);
const observeIdentity = vi.mocked(observeBackendNodeCapabilities);

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
  vi.resetAllMocks();
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

  it('carries workspace context without filtering the returned registry', async () => {
    mockedRequest.mockResolvedValueOnce({ clients: [DESKTOP_ROW] });
    expect(await new LiveClientsClient().list('workspace-A')).toEqual([DESKTOP_ROW]);
    expect(mockedRequest).toHaveBeenCalledWith('client.list', { workspaceId: 'workspace-A' });
  });

  it('list rejects a malformed clients[] row instead of healing it', async () => {
    mockedRequest.mockResolvedValueOnce({ clients: [{ clientId: 'x' }] });
    const client = new LiveClientsClient();

    await expect(client.list()).rejects.toThrow('Invalid client.list response shape');
  });

  it('observes current confirmed identity without a hello or process-wide value cache', async () => {
    observeIdentity.mockResolvedValue({ clientId: 'cli-desk', server: { capabilities: {} } });
    const client = new LiveClientsClient();
    expect(await client.ownClientId()).toBe('cli-desk');
    observeIdentity.mockResolvedValue({ clientId: 'replacement', server: { capabilities: {} } });
    expect(await new LiveClientsClient().ownClientId()).toBe('replacement');
    expect(observeIdentity).toHaveBeenCalledTimes(2);
    expect(mockedRequest).not.toHaveBeenCalled();
  });

  it('rejects unconfirmed observation without fallback and accepts a later confirmed identity', async () => {
    observeIdentity.mockRejectedValueOnce(new Error('Backend identity is not confirmed'));
    observeIdentity.mockResolvedValueOnce({ clientId: 'cli-desk' });
    const client = new LiveClientsClient();
    await expect(client.ownClientId()).rejects.toThrow('not confirmed');
    expect(await client.ownClientId()).toBe('cli-desk');
    expect(mockedRequest).not.toHaveBeenCalled();
  });

  it.each([{}, { clientId: '' }, { clientId: 3 }])(
    'rejects missing or invalid confirmed identity %j',
    async (value) => {
      observeIdentity.mockResolvedValue(value);
      await expect(new LiveClientsClient().ownClientId()).rejects.toThrow('clientId missing');
      expect(mockedRequest).not.toHaveBeenCalled();
    },
  );

  it('rejects held identity after invalidation while a new observation succeeds', async () => {
    let resolve!: (value: unknown) => void;
    observeIdentity.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const old = new LiveClientsClient().ownClientId();
    const rejected = expect(old).rejects.toThrow('changed');
    __resetOwnClientIdForTesting();
    observeIdentity.mockResolvedValue({ clientId: 'current' });
    expect(await new LiveClientsClient().ownClientId()).toBe('current');
    resolve({ clientId: 'obsolete' });
    await rejected;
    expect(mockedRequest).not.toHaveBeenCalled();
  });
});
