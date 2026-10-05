/**
 * Regression tests for the invite-progress invoke bridge seeder.
 *
 * The generated `invoke()` routes ALL legacy renderer invokes through the
 * mock router in every build, so without a bridge the `invite-progress:ack`
 * and `invite-progress:response` invokes from invite-progress-service.ts
 * REJECT (`UnbridgedMockIpcChannelError`) — the main-process handlers in
 * src/main/invite-progress.ts would never see the ack (dismiss-on-timeout
 * fires every time) or the user's Cancel.
 *
 * The bridge forwards these channels to `window.electronAPI.invoke` when the
 * preload bridge is present, and resolves undefined when it is absent
 * (browser dev build, where no invite join is driven by main).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { INVITE_PROGRESS_CHANNELS } from '$shared/ipc/channels';
import { mockInvoke, resetMockIpcRouter } from '$shared/ipc-mock-router';
import { registerInviteProgressBridge } from './invite-progress-bridge-seeder';

const INVOKE_CHANNELS = [INVITE_PROGRESS_CHANNELS.ACK, INVITE_PROGRESS_CHANNELS.RESPONSE];

const originalElectronAPI = (window as any).electronAPI;

describe('invite-progress-bridge-seeder', () => {
  beforeEach(() => {
    resetMockIpcRouter();
  });

  afterEach(() => {
    (window as any).electronAPI = originalElectronAPI;
    resetMockIpcRouter();
  });

  it('forwards ack/response invokes to window.electronAPI.invoke when bridged', async () => {
    const invokeSpy = vi.fn(async (channel: string) => ({ success: true, forwarded: channel }));
    (window as any).electronAPI = { ...(originalElectronAPI || {}), invoke: invokeSpy };
    registerInviteProgressBridge();

    for (const channel of INVOKE_CHANNELS) {
      const result = await mockInvoke<{ success: boolean; forwarded: string }>(channel, {
        probe: channel,
      });
      expect(result.forwarded).toBe(channel);
      expect(invokeSpy).toHaveBeenCalledWith(channel, { probe: channel });
    }
    expect(invokeSpy).toHaveBeenCalledTimes(INVOKE_CHANNELS.length);
  });

  it('forwards the exact service payload shapes', async () => {
    const invokeSpy = vi.fn(async () => undefined);
    (window as any).electronAPI = { ...(originalElectronAPI || {}), invoke: invokeSpy };
    registerInviteProgressBridge();

    await mockInvoke(INVITE_PROGRESS_CHANNELS.ACK, { requestId: 'req-1' });
    await mockInvoke(INVITE_PROGRESS_CHANNELS.RESPONSE, { requestId: 'req-1', action: 'cancel' });

    expect(invokeSpy).toHaveBeenNthCalledWith(1, INVITE_PROGRESS_CHANNELS.ACK, {
      requestId: 'req-1',
    });
    expect(invokeSpy).toHaveBeenNthCalledWith(2, INVITE_PROGRESS_CHANNELS.RESPONSE, {
      requestId: 'req-1',
      action: 'cancel',
    });
  });

  it('resolves undefined without a preload bridge (browser dev build)', async () => {
    (window as any).electronAPI = undefined;
    registerInviteProgressBridge();

    for (const channel of INVOKE_CHANNELS) {
      await expect(mockInvoke(channel, { requestId: 'req-1' })).resolves.toBeUndefined();
    }
  });
});
