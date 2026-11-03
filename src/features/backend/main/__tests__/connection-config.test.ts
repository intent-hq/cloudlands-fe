import { expect, it, vi } from 'vitest';
import { buildConfigForRecord, ConnectionSecretUnavailableError } from '../connection-config';

vi.mock('electron', () => {
  throw new Error('Config conversion must not load Electron');
});

function record() {
  return {
    id: 'remote',
    host: '127.0.0.1',
    hosts: ['192.168.1.10', '192.168.1.11'],
    port: 8443,
    fingerprint: 'AA:BB',
    tcAddress: null,
    getToken: vi.fn(async () => 'saved-token'),
  };
}

it('uses sanitized candidates while preserving the stored host in metadata', async () => {
  expect(await buildConfigForRecord(record())).toEqual({
    config: {
      transport: 'wss',
      host: '192.168.1.10',
      hosts: ['192.168.1.10', '192.168.1.11'],
      port: 8443,
      fingerprint: 'AA:BB',
      token: 'saved-token',
      tcAddress: undefined,
    },
    meta: { id: 'remote', host: '127.0.0.1', port: 8443 },
  });
});

it('uses an override without reading the secret and preserves guest credentials', async () => {
  const r = {
    ...record(),
    tcAddress: 'tunnel',
    invitedIdentity: { principalId: 'person', pairedAt: 42 },
  };
  const result = await buildConfigForRecord(r, 'override');
  expect(r.getToken).not.toHaveBeenCalled();
  expect(result.config).toMatchObject({ token: 'override', tcAddress: 'tunnel' });
  expect(result.invitedCredential).toEqual({
    principalId: 'person',
    pairedAt: 42,
    token: 'override',
  });
});

it('rejects missing or unreadable tokens without exposing their errors', async () => {
  await expect(buildConfigForRecord(record(), '')).rejects.toThrow('No stored token');
  const r = record();
  r.getToken.mockRejectedValue(new Error('sensitive codec error'));
  await expect(buildConfigForRecord(r)).rejects.toBeInstanceOf(ConnectionSecretUnavailableError);
});
