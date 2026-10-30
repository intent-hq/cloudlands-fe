import { describe, expect, it } from 'vitest';
import { mockInvoke } from '$shared/ipc-mock-router';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import './remote-machines-bridge-seeder';

const { REMOTE_MACHINES } = IPC_CHANNELS;

describe('remote machines mock bridge', () => {
  it('reports an unsupported backend and no local fingerprint without a main process', async () => {
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
