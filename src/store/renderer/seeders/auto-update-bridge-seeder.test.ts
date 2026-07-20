/**
 * Regression tests for the auto-update bridge seeder.
 *
 * Root cause of the packaged-build startup errors ("Auto-update is not
 * available in this build" from AutoUpdateMutationService getState and
 * UserPreferencesBetaPersistenceService hydration): the generated `invoke()`
 * routes ALL legacy renderer invokes through the mock router in every build,
 * and no seeder bridged the `auto-update:*` invoke channels to the real
 * preload bridge (`window.electronAPI.invoke`). The invokes therefore fell
 * into UNBRIDGED_INVOKE_ALLOWLIST shaped failures even in the packaged app
 * where the ipcMain handlers exist.
 *
 * The bridge seeder forwards each auto-update invoke channel to
 * `window.electronAPI.invoke` when the preload bridge is present, and folds
 * to the documented shaped failure when it is absent (browser dev build).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AUTO_UPDATE_CHANNELS } from '$features/auto-update/types';
import { mockInvoke, resetMockIpcRouter } from '$shared/ipc-mock-router';
import { registerAutoUpdateBridge } from './auto-update-bridge-seeder';

const INVOKE_CHANNELS = [
  AUTO_UPDATE_CHANNELS.CHECK_MANUAL,
  AUTO_UPDATE_CHANNELS.GET_STATE,
  AUTO_UPDATE_CHANNELS.SET_CHANNEL,
  AUTO_UPDATE_CHANNELS.DOWNLOAD,
  AUTO_UPDATE_CHANNELS.INSTALL,
];

const originalElectronAPI = (window as any).electronAPI;

describe('auto-update-bridge-seeder', () => {
  beforeEach(() => {
    resetMockIpcRouter();
  });

  afterEach(() => {
    (window as any).electronAPI = originalElectronAPI;
    resetMockIpcRouter();
  });

  it('forwards every auto-update invoke channel to window.electronAPI.invoke when bridged', async () => {
    const invokeSpy = vi.fn(async (channel: string) => ({
      success: true,
      data: { forwarded: channel },
    }));
    (window as any).electronAPI = { ...(originalElectronAPI || {}), invoke: invokeSpy };
    registerAutoUpdateBridge();

    for (const channel of INVOKE_CHANNELS) {
      const result = await mockInvoke<{ success: boolean; data: { forwarded: string } }>(
        channel,
        { probe: channel },
      );
      expect(result.success).toBe(true);
      expect(result.data.forwarded).toBe(channel);
      expect(invokeSpy).toHaveBeenCalledWith(channel, { probe: channel });
    }
    expect(invokeSpy).toHaveBeenCalledTimes(INVOKE_CHANNELS.length);
  });

  it('getState succeeds end-to-end through the bridge (startup hydration path)', async () => {
    const state = {
      status: 'idle',
      currentVersion: '2.0.7',
      updateInfo: null,
      progress: null,
      error: null,
      channel: 'beta',
    };
    (window as any).electronAPI = {
      ...(originalElectronAPI || {}),
      invoke: vi.fn(async () => ({ success: true, data: state })),
    };
    registerAutoUpdateBridge();

    const response = await mockInvoke<{ success: boolean; data: typeof state }>(
      AUTO_UPDATE_CHANNELS.GET_STATE,
    );
    expect(response.success).toBe(true);
    expect(response.data.channel).toBe('beta');
  });

  it('folds to the shaped not-available failure when no preload bridge exists', async () => {
    (window as any).electronAPI = undefined;
    registerAutoUpdateBridge();

    for (const channel of INVOKE_CHANNELS) {
      const result = await mockInvoke<{ success: boolean; error?: { message?: string } }>(
        channel,
      );
      expect(result.success).toBe(false);
      expect(result.error?.message).toBe('Auto-update is not available in this build');
    }
  });
});
