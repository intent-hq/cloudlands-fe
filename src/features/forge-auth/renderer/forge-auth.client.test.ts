import { beforeEach, describe, expect, it, vi } from 'vitest';
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('$lib/electron-bridge', () => ({ invoke }));
import { forgeAuthClient } from './forge-auth.client';
import { FORGE_AUTH_CHANNELS } from '../constants';

describe('full GitLab instance authentication', () => {
  beforeEach(() => invoke.mockReset());
  const root = 'https://git.example.com:8443/Forge';
  const target = { provider: 'gitlab', host: 'git.example.com:8443', instanceBaseUrl: root };
  it('forwards the complete logical root on all five existing auth methods', async () => {
    await forgeAuthClient.getStatus('gitlab', root);
    await forgeAuthClient.getUser('gitlab', root);
    await forgeAuthClient.connect({
      provider: 'gitlab',
      host: root,
      method: 'pat',
      token: 'test-token',
    });
    await forgeAuthClient.cancelAuth('gitlab', root);
    await forgeAuthClient.revoke('gitlab', root);
    expect(invoke.mock.calls).toEqual([
      [FORGE_AUTH_CHANNELS.GET_STATUS, target],
      [FORGE_AUTH_CHANNELS.GET_USER, target],
      [FORGE_AUTH_CHANNELS.CONNECT, { ...target, method: 'pat', token: 'test-token' }],
      [FORGE_AUTH_CHANNELS.CANCEL_AUTH, target],
      [FORGE_AUTH_CHANNELS.REVOKE, target],
    ]);
  });
  it('keeps an omitted or bare target available to the daemon configured-instance resolver', async () => {
    await forgeAuthClient.getStatus('gitlab');
    await forgeAuthClient.getStatus('gitlab', 'git.example.com:8443');
    expect(invoke.mock.calls).toEqual([
      [FORGE_AUTH_CHANNELS.GET_STATUS, { provider: 'gitlab' }],
      [FORGE_AUTH_CHANNELS.GET_STATUS, { provider: 'gitlab', host: 'git.example.com:8443' }],
    ]);
  });
  it.each([
    'http://git.example.com/Forge',
    'https://git.example.com/Forge?token=x',
    'https://user@git.example.com/Forge',
    'https://git.example.com/Forge/../other',
  ])('rejects an invalid explicit target before invoking %s', async (host) => {
    await expect(
      forgeAuthClient.connect({ provider: 'gitlab', host, method: 'device' }),
    ).rejects.toThrow();
    expect(invoke).not.toHaveBeenCalled();
  });
});
