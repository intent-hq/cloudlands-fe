import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock('$lib/electron-bridge', () => ({ invoke: mocks.invoke }));

import { IPC_CHANNELS } from '$shared/ipc-registry';
import { openDockWorkspace } from './dock-navigation';

describe('openDockWorkspace', () => {
  beforeEach(() => mocks.invoke.mockReset());

  it('asks the main process to reuse a normal workspace window', async () => {
    mocks.invoke.mockResolvedValue({ success: true, windowId: 12, reused: true });

    await openDockWorkspace('ws-1');

    expect(mocks.invoke).toHaveBeenCalledWith(IPC_CHANNELS.WINDOW.OPEN_NEW, {
      route: '/workspace/ws-1',
      reuseExistingWorkspace: true,
    });
  });

  it('rejects a failed window request', async () => {
    mocks.invoke.mockResolvedValue({ success: false, error: 'window unavailable' });
    await expect(openDockWorkspace('ws-1')).rejects.toThrow('window unavailable');
  });
});
