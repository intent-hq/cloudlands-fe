/**
 * Tests for the user-activity bridge seeder: forwards the note read-tracking
 * invoke channels to the real Electron preload bridge when present, and folds
 * to the documented failure envelope when absent (browser dev build), so the
 * note-read-tracking saga degrades to "no badges" instead of throwing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mockInvoke, resetMockIpcRouter } from '$shared/ipc-mock-router';
import { USER_ACTIVITY_CHANNELS } from '$shared/ipc/channels';
import { registerUserActivityBridge } from './user-activity-bridge-seeder';

const INVOKE_CHANNELS = [
  USER_ACTIVITY_CHANNELS.MARK_NOTE_READ,
  USER_ACTIVITY_CHANNELS.GET_UNREAD_NOTE_IDS,
];

const originalElectronAPI = (window as any).electronAPI;

describe('user-activity-bridge-seeder', () => {
  beforeEach(() => {
    resetMockIpcRouter();
  });

  afterEach(() => {
    (window as any).electronAPI = originalElectronAPI;
    resetMockIpcRouter();
  });

  it('forwards each user-activity invoke channel to window.electronAPI.invoke when bridged', async () => {
    const invokeSpy = vi.fn(async (channel: string) => ({
      success: true,
      data: { forwarded: channel },
    }));
    (window as any).electronAPI = { ...(originalElectronAPI || {}), invoke: invokeSpy };
    registerUserActivityBridge();

    for (const channel of INVOKE_CHANNELS) {
      const result = await mockInvoke<{ success: boolean; data: { forwarded: string } }>(channel, {
        probe: channel,
      });
      expect(result.success).toBe(true);
      expect(result.data.forwarded).toBe(channel);
      expect(invokeSpy).toHaveBeenCalledWith(channel, { probe: channel });
    }
    expect(invokeSpy).toHaveBeenCalledTimes(INVOKE_CHANNELS.length);
  });

  it('folds to the shaped not-available failure when no preload bridge exists', async () => {
    (window as any).electronAPI = undefined;
    registerUserActivityBridge();

    for (const channel of INVOKE_CHANNELS) {
      const result = await mockInvoke<{ success: boolean; error?: string }>(channel, {});
      expect(result.success).toBe(false);
      expect(result.error).toContain('not available');
    }
  });
});
