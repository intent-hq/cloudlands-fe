/**
 * Regression tests for the quit-confirmation invoke bridge seeder.
 *
 * The generated `invoke()` routes ALL legacy renderer invokes through the
 * mock router in every build, so without a bridge the `quit-confirmation:ack`
 * and `quit-confirmation:response` invokes from quit-confirmation-service.ts
 * REJECT (`UnbridgedMockIpcChannelError`) — the main-process handlers in
 * src/main/quit-confirmation.ts would never see the ack (native-dialog
 * fallback fires every time) or the user's decision.
 *
 * The bridge forwards these channels to `window.electronAPI.invoke` when the
 * preload bridge is present, and resolves undefined when it is absent
 * (browser dev build, where no quit round-trip exists).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { QUIT_CONFIRMATION_CHANNELS } from '$shared/ipc/channels';
import { mockInvoke, resetMockIpcRouter } from '$shared/ipc-mock-router';
import { registerQuitConfirmationBridge } from './quit-confirmation-bridge-seeder';

const INVOKE_CHANNELS = [QUIT_CONFIRMATION_CHANNELS.ACK, QUIT_CONFIRMATION_CHANNELS.RESPONSE];

const originalElectronAPI = (window as any).electronAPI;

describe('quit-confirmation-bridge-seeder', () => {
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
    registerQuitConfirmationBridge();

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
    registerQuitConfirmationBridge();

    await mockInvoke(QUIT_CONFIRMATION_CHANNELS.ACK, { requestId: 'req-1' });
    await mockInvoke(QUIT_CONFIRMATION_CHANNELS.RESPONSE, { requestId: 'req-1', proceed: false });

    expect(invokeSpy).toHaveBeenNthCalledWith(1, QUIT_CONFIRMATION_CHANNELS.ACK, {
      requestId: 'req-1',
    });
    expect(invokeSpy).toHaveBeenNthCalledWith(2, QUIT_CONFIRMATION_CHANNELS.RESPONSE, {
      requestId: 'req-1',
      proceed: false,
    });
  });

  it('resolves undefined without a preload bridge (browser dev build)', async () => {
    (window as any).electronAPI = undefined;
    registerQuitConfirmationBridge();

    for (const channel of INVOKE_CHANNELS) {
      await expect(mockInvoke(channel, { requestId: 'req-1' })).resolves.toBeUndefined();
    }
  });
});
