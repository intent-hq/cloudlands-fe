import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { localMachineClient } from './local-machine-client';

describe('local machine client', () => {
  const invoke = vi.fn();

  beforeEach(() => {
    invoke.mockReset();
    vi.stubGlobal('window', { electronAPI: { invoke, on: vi.fn(), offById: vi.fn() } });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('reads settings and applies changes on the host daemon', async () => {
    const settings = [{ path: 'server.wsApi.port', value: 5181, type: 'number' }];
    invoke.mockResolvedValueOnce({ ok: true, result: { settings, revision: 1 } });
    expect(await localMachineClient.settings.list()).toEqual(settings);
    expect(invoke).toHaveBeenLastCalledWith('backend:request', {
      method: 'settings.list',
      params: undefined,
      localMachine: true,
    });
    const changes = [{ path: 'server.wsApi.port', value: 5182 }];
    invoke.mockResolvedValueOnce({ ok: true, result: { applied: changes, revision: 2 } });
    expect(await localMachineClient.settings.update(changes)).toEqual(changes);
    expect(invoke).toHaveBeenLastCalledWith('backend:request', {
      method: 'settings.update',
      params: { changes },
      localMachine: true,
    });
  });

  it('reads pairing credentials and rotates tokens on the host daemon', async () => {
    const info = {
      token: 'host-token',
      certFingerprint: 'AA:BB',
      port: 5181,
      path: '/ws',
      localIps: ['192.0.2.1'],
      hostname: 'host',
      tcAddress: 'tc-fixture',
    };
    invoke.mockResolvedValueOnce({ ok: true, result: info });
    expect(await localMachineClient.server.pairingInfo()).toEqual(info);
    expect(invoke).toHaveBeenLastCalledWith('backend:request', {
      method: 'server.pairingInfo',
      params: undefined,
      localMachine: true,
    });
    invoke.mockResolvedValueOnce({ ok: true, result: { token: 'rotated-host-token' } });
    expect(await localMachineClient.server.rotateToken()).toEqual({ token: 'rotated-host-token' });
    expect(invoke).toHaveBeenLastCalledWith('backend:request', {
      method: 'server.rotateToken',
      params: undefined,
      localMachine: true,
    });
  });

  it('propagates host failures without falling back to the window daemon', async () => {
    invoke.mockResolvedValue({
      ok: false,
      error: { code: 'UNAVAILABLE', message: 'Host unavailable' },
    });
    await expect(localMachineClient.settings.list()).rejects.toThrow('Host unavailable');
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});
