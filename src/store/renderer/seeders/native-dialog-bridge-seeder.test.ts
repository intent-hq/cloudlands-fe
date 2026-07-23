/**
 * Regression tests for the native message-dialog bridge seeder.
 *
 * `dialog:message` used to sit in UNBRIDGED_INVOKE_ALLOWLIST folded to button
 * index 0, so FilesPanel's drop-conflict prompt silently resolved to 'skip'
 * with no user choice — in EVERY build, including packaged Electron (the
 * generated `invoke()` routes all legacy renderer invokes through the mock
 * router). The seeder forwards `dialog:message` to the real preload bridge on
 * the electron platform (same pattern as window-state-bridge-seeder) and
 * rejects everywhere else — web callers must use the in-app MessageDialog.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  mockInvoke,
  resetMockIpcRouter,
  UNBRIDGED_INVOKE_ALLOWLIST,
  UnbridgedMockIpcChannelError,
} from '$shared/ipc-mock-router';
import { registerNativeDialogBridge } from './native-dialog-bridge-seeder';

const PAYLOAD = {
  message: 'A file named "a.txt" already exists at this location. What would you like to do?',
  title: 'File Already Exists',
  type: 'warning',
  buttons: ['Skip', 'Rename', 'Overwrite'],
};

const originalElectronAPI = (window as any).electronAPI;

describe('native-dialog-bridge-seeder', () => {
  beforeEach(() => {
    resetMockIpcRouter();
  });

  afterEach(() => {
    (window as any).electronAPI = originalElectronAPI;
    resetMockIpcRouter();
  });

  it('regression: dialog:message is no longer an allowlist fold to silent skip (index 0)', async () => {
    expect(UNBRIDGED_INVOKE_ALLOWLIST.has('dialog:message')).toBe(false);
    // With no handler registered the router must reject loudly, never resolve 0.
    await expect(mockInvoke('dialog:message', PAYLOAD)).rejects.toBeInstanceOf(
      UnbridgedMockIpcChannelError,
    );
  });

  it('forwards dialog:message verbatim to the real preload bridge and returns the button index', async () => {
    const invokeSpy = vi.fn(async () => 2);
    (window as any).electronAPI = { versions: { electron: '35.0.0' }, invoke: invokeSpy };
    registerNativeDialogBridge();

    const result = await mockInvoke<number>('dialog:message', PAYLOAD);

    expect(result).toBe(2);
    expect(invokeSpy).toHaveBeenCalledExactlyOnceWith('dialog:message', PAYLOAD);
  });

  it('rejects on the web platform (browser mock sentinel) instead of recursing into the mock', async () => {
    const invokeSpy = vi.fn(async () => 0);
    (window as any).electronAPI = { versions: { electron: '0.0.0-browser' }, invoke: invokeSpy };
    registerNativeDialogBridge();

    await expect(mockInvoke('dialog:message', PAYLOAD)).rejects.toThrow(/native Electron bridge/i);
    expect(invokeSpy).not.toHaveBeenCalled();
  });

  it('rejects when no preload bridge exists at all', async () => {
    (window as any).electronAPI = undefined;
    registerNativeDialogBridge();

    await expect(mockInvoke('dialog:message', PAYLOAD)).rejects.toThrow(/native Electron bridge/i);
  });
});
