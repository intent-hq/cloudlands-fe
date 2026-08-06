/**
 * Regression tests for the release-notes bridge seeder.
 *
 * The generated `invoke()` routes every legacy renderer invoke through the
 * mock router in all builds, so without this bridge `release-notes:get` would
 * reject in the packaged app even though the ipcMain handler exists. In a
 * bridge-less build it must fold to the shaped not-available failure, which
 * the client reads as "no notes" (modal fallback) rather than throwing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RELEASE_NOTES_CHANNELS } from '$features/release-notes/types';
import { mockInvoke, resetMockIpcRouter } from '$shared/ipc-mock-router';
import { registerReleaseNotesBridge } from './release-notes-bridge-seeder';

const originalElectronAPI = (window as any).electronAPI;

describe('release-notes-bridge-seeder', () => {
  beforeEach(() => {
    resetMockIpcRouter();
  });

  afterEach(() => {
    (window as any).electronAPI = originalElectronAPI;
    resetMockIpcRouter();
  });

  it('forwards release-notes:get to window.electronAPI.invoke when bridged', async () => {
    const data = {
      version: '2.1.0',
      notes: '## What changed',
      url: 'https://github.com/intent-hq/cloudlands-releases/releases/tag/v2.1.0',
    };
    const invokeSpy = vi.fn(async () => ({ success: true, data }));
    (window as any).electronAPI = { ...(originalElectronAPI || {}), invoke: invokeSpy };
    registerReleaseNotesBridge();

    const result = await mockInvoke<{ success: boolean; data: typeof data }>(
      RELEASE_NOTES_CHANNELS.GET,
    );

    expect(invokeSpy).toHaveBeenCalledWith(RELEASE_NOTES_CHANNELS.GET, undefined);
    expect(result.success).toBe(true);
    expect(result.data).toEqual(data);
  });

  it('folds to the shaped not-available failure when no preload bridge exists', async () => {
    (window as any).electronAPI = undefined;
    registerReleaseNotesBridge();

    const result = await mockInvoke<{ success: boolean; error?: { message?: string } }>(
      RELEASE_NOTES_CHANNELS.GET,
    );

    expect(result.success).toBe(false);
    expect(result.error?.message).toBe('Release notes are not available in this build');
  });
});
