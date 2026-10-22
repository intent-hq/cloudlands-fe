/**
 * Regression tests for the deep-link invoke bridge seeder: the generated
 * `invoke()` routes renderer invokes through the mock router, so without this
 * bridge `deep-link:consume-pending` rejected and no `intent://` link (the
 * `intent` CLI included) ever reached the deep-links saga.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEEP_LINK_CHANNELS } from '$shared/ipc/channels';
import { mockInvoke, resetMockIpcRouter } from '$shared/ipc-mock-router';
import { registerDeepLinkBridge } from './deep-link-bridge-seeder';

const originalElectronAPI = (window as any).electronAPI;

describe('deep-link-bridge-seeder', () => {
  beforeEach(() => resetMockIpcRouter());
  afterEach(() => {
    (window as any).electronAPI = originalElectronAPI;
    resetMockIpcRouter();
  });

  it('forwards consume-pending to the Electron main process and returns its queue', async () => {
    const queued = { actions: [{ type: 'open', params: { path: '/Users/me' } }] };
    const invokeSpy = vi.fn(async () => queued);
    (window as any).electronAPI = { ...(originalElectronAPI || {}), invoke: invokeSpy };
    registerDeepLinkBridge();

    await expect(mockInvoke(DEEP_LINK_CHANNELS.CONSUME_PENDING, {})).resolves.toEqual(queued);
    expect(invokeSpy).toHaveBeenCalledWith('deep-link:consume-pending', {});
  });

  it('reports an empty queue when there is no main process', async () => {
    (window as any).electronAPI = undefined;
    registerDeepLinkBridge();

    await expect(mockInvoke(DEEP_LINK_CHANNELS.CONSUME_PENDING, {})).resolves.toEqual({
      actions: [],
    });
  });
});
