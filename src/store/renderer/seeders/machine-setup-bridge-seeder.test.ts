import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockInvoke } from '$shared/ipc-mock-router';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import './machine-setup-bridge-seeder';

const { MACHINE_SETUP } = IPC_CHANNELS;
type BridgeWindow = { electronAPI?: unknown };

afterEach(() => {
  delete (window as unknown as BridgeWindow).electronAPI;
});

describe('SSH machine setup mock bridge', () => {
  it('forwards each channel verbatim to the main process when the bridge exists', async () => {
    const invoke = vi.fn(async () => 'from-main');
    (window as unknown as BridgeWindow).electronAPI = { invoke };
    const start = {
      host: 'h',
      port: 22,
      username: 'u',
      auth: { method: 'agent' },
      target: 'backend',
    };
    await expect(mockInvoke(MACHINE_SETUP.SSH_START, start)).resolves.toBe('from-main');
    await expect(mockInvoke(MACHINE_SETUP.SSH_CANCEL, { runId: 'r' })).resolves.toBe('from-main');
    expect(invoke.mock.calls).toEqual([
      [MACHINE_SETUP.SSH_START, start],
      [MACHINE_SETUP.SSH_CANCEL, { runId: 'r' }],
    ]);
  });

  it('offers no agent and starts no run without a main process', async () => {
    await expect(mockInvoke(MACHINE_SETUP.SSH_DEFAULTS)).resolves.toEqual({ agent: false });
    await expect(mockInvoke(MACHINE_SETUP.SSH_START, {})).resolves.toEqual({
      ok: false,
      code: 'busy',
    });
  });
});
