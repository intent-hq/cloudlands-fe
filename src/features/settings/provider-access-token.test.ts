import { providerTokenCapability } from '$shared/provider-catalog';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: vi.fn(),
  onBackendNotification: vi.fn(() => () => {}),
  onBackendReconnected: vi.fn(() => () => {}),
}));
vi.mock('$lib/client', async () => {
  const { LiveSettingsClient } = await import('$lib/client/live/live-settings-client');
  return { appClient: { settings: new LiveSettingsClient() } };
});
import { backendRequest } from '$lib/client/live/backend-transport';
import { __resetSettingsReadCacheForTests } from '$lib/client/live/live-settings-client';
import { readProviderToken, writeProviderToken } from './provider-access-token';
import { ProviderCatalogResponseSchema } from '$shared/provider-catalog';
const wire = vi.mocked(backendRequest);
const path = 'providers.codex.accessToken';
const definition = {
  path,
  label: 'Codex access token',
  description: '',
  category: 'providers',
  type: 'string',
  sensitive: true,
};
afterEach(() => {
  wire.mockReset();
  __resetSettingsReadCacheForTests();
});
describe('provider token settings wire contract', () => {
  it.each([null, '********'])('reads only the documented configured marker %s', async (value) => {
    wire.mockResolvedValue({ definition, value });
    expect(await readProviderToken(path)).toEqual({ configured: value !== null });
    expect(wire).toHaveBeenCalledWith('settings.get', { path });
  });
  it('saves/replaces using settings.update and removes with settings.reset', async () => {
    for (const token of ['synthetic-first', 'synthetic-replacement']) {
      wire.mockResolvedValueOnce({ applied: [{ path, value: '********' }], revision: 2 });
      expect(await writeProviderToken(path, token)).toEqual({ configured: true });
      expect(wire).toHaveBeenLastCalledWith('settings.update', {
        changes: [{ path, value: token }],
      });
    }
    wire.mockResolvedValueOnce({ path, value: null });
    expect(await writeProviderToken(path)).toEqual({ configured: false });
    expect(wire).toHaveBeenLastCalledWith('settings.reset', { path });
  });
  it('rejects missing or raw-secret receipts without reflecting their value', async () => {
    wire.mockResolvedValueOnce({ definition, value: 'unexpected-secret' });
    await expect(readProviderToken(path)).rejects.toThrow('Invalid token settings response');
    wire.mockResolvedValueOnce({ applied: [{ path, value: 'unexpected-secret' }] });
    await expect(writeProviderToken(path, 'synthetic-input')).rejects.toThrow(
      'Invalid token settings response',
    );
    wire.mockResolvedValueOnce({ applied: [] });
    await expect(writeProviderToken(path, 'synthetic-input')).rejects.toThrow(
      'Missing token settings receipt',
    );
  });
  it('treats an unavailable setting as an error, never as an absent token', async () => {
    wire.mockRejectedValueOnce(new Error('offline'));
    await expect(readProviderToken(path)).rejects.toThrow('Token settings unavailable');
  });
  it('only accepts catalog-advertised known provider and setting pairs', () => {
    const base = {
      id: 'codex',
      displayName: 'Codex',
      shortName: 'Codex',
      command: 'codex',
      canBeDisabled: true,
      visible: true,
    };
    const accessToken = {
      kind: 'codexAccessToken',
      settingPath: path,
      label: 'Access token',
      guidance: 'Business/Enterprise',
    };
    const result = ProviderCatalogResponseSchema.parse({
      providers: [
        { ...base, accessToken },
        base,
        { ...base, id: 'other', accessToken },
        { ...base, accessToken: { ...accessToken, settingPath: 'server.password' } },
      ],
    });
    expect(providerTokenCapability(result.providers[0])).toEqual(accessToken);
    for (const entry of result.providers.slice(1))
      expect(providerTokenCapability(entry)).toBeUndefined();
  });
});
