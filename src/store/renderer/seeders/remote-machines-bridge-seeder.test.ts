import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockInvoke } from '$shared/ipc-mock-router';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import './remote-machines-bridge-seeder';

const { REMOTE_MACHINES } = IPC_CHANNELS;
type BridgeWindow = { electronAPI?: unknown };

afterEach(() => {
  delete (window as unknown as BridgeWindow).electronAPI;
});

describe('remote machines mock bridge', () => {
  it('forwards each channel verbatim to the main process when the bridge exists', async () => {
    const invoke = vi.fn(async () => 'from-main');
    (window as unknown as BridgeWindow).electronAPI = { invoke };
    const params = { machineConnectionId: 'mac' };
    await expect(mockInvoke(REMOTE_MACHINES.EXPOSE, params)).resolves.toBe('from-main');
    await expect(mockInvoke(REMOTE_MACHINES.UNEXPOSE, { machineId: 'd-mac' })).resolves.toBe(
      'from-main',
    );
    await expect(mockInvoke(REMOTE_MACHINES.MACHINE_FINGERPRINT, 'local')).resolves.toBe(
      'from-main',
    );
    expect(invoke.mock.calls).toEqual([
      [REMOTE_MACHINES.EXPOSE, params],
      [REMOTE_MACHINES.UNEXPOSE, { machineId: 'd-mac' }],
      [REMOTE_MACHINES.MACHINE_FINGERPRINT, 'local'],
    ]);
  });

  it('reports an unsupported backend and no local fingerprint without a main process', async () => {
    delete (window as unknown as BridgeWindow).electronAPI;
    await expect(
      mockInvoke(REMOTE_MACHINES.EXPOSE, { machineConnectionId: 'mac' }),
    ).resolves.toEqual({ success: false, code: 'unsupported-backend' });
    await expect(mockInvoke(REMOTE_MACHINES.UNEXPOSE, { machineId: 'd-mac' })).resolves.toEqual({
      success: false,
      code: 'unsupported-backend',
    });
    await expect(mockInvoke(REMOTE_MACHINES.MACHINE_FINGERPRINT, 'local')).resolves.toBeNull();
  });
});
