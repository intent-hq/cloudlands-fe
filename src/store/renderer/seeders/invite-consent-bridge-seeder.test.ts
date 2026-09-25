/**
 * Regression tests for the invite-consent invoke bridge seeder.
 *
 * The generated `invoke()` routes ALL legacy renderer invokes through the
 * mock router in every build, so without a bridge the `invite-consent:ack`
 * and `invite-consent:response` invokes from invite-consent-service.ts
 * REJECT (`UnbridgedMockIpcChannelError`) — the main-process handlers in
 * src/main/invite-consent.ts would never see the ack (native-dialog fallback
 * fires every time) or the user's decision.
 *
 * The bridge forwards these channels to `window.electronAPI.invoke` when the
 * preload bridge is present, and resolves undefined when it is absent
 * (browser dev build, where no invite join is driven by main).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { INVITE_CONSENT_CHANNELS } from '$shared/ipc/channels';
import { mockInvoke, resetMockIpcRouter } from '$shared/ipc-mock-router';
import { registerInviteConsentBridge } from './invite-consent-bridge-seeder';

const INVOKE_CHANNELS = [INVITE_CONSENT_CHANNELS.ACK, INVITE_CONSENT_CHANNELS.RESPONSE];

const originalElectronAPI = (window as any).electronAPI;

describe('invite-consent-bridge-seeder', () => {
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
    registerInviteConsentBridge();

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
    registerInviteConsentBridge();

    await mockInvoke(INVITE_CONSENT_CHANNELS.ACK, { requestId: 'req-1' });
    await mockInvoke(INVITE_CONSENT_CHANNELS.RESPONSE, { requestId: 'req-1', action: 'open' });

    expect(invokeSpy).toHaveBeenNthCalledWith(1, INVITE_CONSENT_CHANNELS.ACK, {
      requestId: 'req-1',
    });
    expect(invokeSpy).toHaveBeenNthCalledWith(2, INVITE_CONSENT_CHANNELS.RESPONSE, {
      requestId: 'req-1',
      action: 'open',
    });
  });

  it('resolves undefined without a preload bridge (browser dev build)', async () => {
    (window as any).electronAPI = undefined;
    registerInviteConsentBridge();

    for (const channel of INVOKE_CHANNELS) {
      await expect(mockInvoke(channel, { requestId: 'req-1' })).resolves.toBeUndefined();
    }
  });
});
