import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetMockIpcRouter } from '$shared/ipc-mock-router';
import { registerNativeDialogBridge } from '$store/renderer/seeders/native-dialog-bridge-seeder';

vi.unmock('$lib/electron-bridge');

import { dialog } from './electron-bridge';

const originalElectronAPI = (window as any).electronAPI;

describe('electron-bridge dialog.openDirectory', () => {
  beforeEach(() => {
    resetMockIpcRouter();
  });

  afterEach(() => {
    (window as any).electronAPI = originalElectronAPI;
    resetMockIpcRouter();
  });

  it('returns the selected directory from the native bridge', async () => {
    const invoke = vi.fn(async () => ['/tmp/project']);
    (window as any).electronAPI = { versions: { electron: '35.0.0' }, invoke };
    registerNativeDialogBridge();

    await expect(
      dialog.openDirectory({ title: 'Choose a folder', defaultPath: '/tmp' }),
    ).resolves.toBe('/tmp/project');
    expect(invoke).toHaveBeenCalledExactlyOnceWith('dialog:open', {
      title: 'Choose a folder',
      defaultPath: '/tmp',
    });
  });

  it('returns null when the native dialog is cancelled', async () => {
    const invoke = vi.fn(async () => null);
    (window as any).electronAPI = { versions: { electron: '35.0.0' }, invoke };
    registerNativeDialogBridge();

    await expect(dialog.openDirectory()).resolves.toBeNull();
    expect(invoke).toHaveBeenCalledExactlyOnceWith('dialog:open', {});
  });

  it('returns null without invoking IPC outside real Electron', async () => {
    const invoke = vi.fn();
    (window as any).electronAPI = {
      versions: { electron: '0.0.0-browser' },
      invoke,
    };
    registerNativeDialogBridge();

    await expect(dialog.openDirectory({ title: 'Choose a folder' })).resolves.toBeNull();
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe('electron-bridge dialog.openFile', () => {
  beforeEach(() => {
    resetMockIpcRouter();
  });

  afterEach(() => {
    (window as any).electronAPI = originalElectronAPI;
    resetMockIpcRouter();
  });

  it('requests file mode and returns the selected file from the native bridge', async () => {
    const invoke = vi.fn(async () => ['/home/user/.ssh/id_ed25519']);
    (window as any).electronAPI = { versions: { electron: '35.0.0' }, invoke };
    registerNativeDialogBridge();

    await expect(
      dialog.openFile({ title: 'Choose an SSH key', defaultPath: '/home/user/.ssh' }),
    ).resolves.toBe('/home/user/.ssh/id_ed25519');
    expect(invoke).toHaveBeenCalledExactlyOnceWith('dialog:open', {
      title: 'Choose an SSH key',
      defaultPath: '/home/user/.ssh',
      mode: 'file',
    });
  });

  it('returns null when the native dialog is cancelled', async () => {
    const invoke = vi.fn(async () => null);
    (window as any).electronAPI = { versions: { electron: '35.0.0' }, invoke };
    registerNativeDialogBridge();

    await expect(dialog.openFile()).resolves.toBeNull();
    expect(invoke).toHaveBeenCalledExactlyOnceWith('dialog:open', { mode: 'file' });
  });

  it('returns null without invoking IPC outside real Electron', async () => {
    const invoke = vi.fn();
    (window as any).electronAPI = {
      versions: { electron: '0.0.0-browser' },
      invoke,
    };
    registerNativeDialogBridge();

    await expect(dialog.openFile({ title: 'Choose an SSH key' })).resolves.toBeNull();
    expect(invoke).not.toHaveBeenCalled();
  });
});
