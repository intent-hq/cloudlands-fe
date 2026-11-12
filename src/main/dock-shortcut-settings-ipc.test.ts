import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '../shared/ipc-registry';
import { createDockShortcutPreferences } from './dock-shortcut-preferences';
import { createDockShortcutRegistration } from './dock-shortcut-registration';

const fixture = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, request: unknown) => Promise<any>>(),
  windows: new Map<object, object>(),
  retired: new Map<object, () => void>(),
}));
vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, handler: any) => fixture.handlers.set(channel, handler) },
  BrowserWindow: { fromWebContents: (sender: object) => fixture.windows.get(sender) },
}));
vi.mock('./ipc-validation-middleware', () => ({
  createValidatedHandler: (_schema: unknown, handler: unknown) => handler,
}));
vi.mock('./window-backend', () => ({
  getStrictBackendBindingForWebContents: () => ({ backendId: 'test-backend' }),
  onStrictBackendBindingRetired: (sender: object, callback: () => void) => {
    fixture.retired.set(sender, callback);
    return () => fixture.retired.delete(sender);
  },
}));

import { registerDockShortcutSettingsHandlers } from './dock-shortcut-settings-ipc';

function owner() {
  const window = new EventEmitter();
  const sender = Object.assign(new EventEmitter(), {
    mainFrame: {},
    isDestroyed: () => false,
    setIgnoreMenuShortcuts: vi.fn(),
  });
  fixture.windows.set(sender, window);
  return { window, sender, event: { sender, senderFrame: sender.mainFrame } };
}

beforeEach(() => {
  fixture.handlers.clear();
  fixture.windows.clear();
  fixture.retired.clear();
});

describe('shortcut capture lease cleanup', () => {
  it('cannot let a released capture continuation unsuspend its replacement', async () => {
    const service = createDockShortcutPreferences({
      registrar: createDockShortcutRegistration(
        { register: () => true, unregister: () => {} },
        () => {},
        () => {},
        'darwin',
      ),
      read: async () => ({}),
      write: async () => {},
      changed: () => {},
      platform: 'darwin',
    });
    await service.load();
    service.enable(true);
    await Promise.resolve();
    registerDockShortcutSettingsHandlers(service);
    const capture = fixture.handlers.get(IPC_CHANNELS.DOCK_SHORTCUTS.CAPTURE)!;
    const first = owner(),
      second = owner();
    const pending = capture(first.event, { active: true });
    const retiredFirst = fixture.retired.get(first.sender)!;
    first.window.emit('blur');
    const replacement = capture(second.event, { active: true });
    const [oldResult, newResult] = await Promise.all([pending, replacement]);
    // Drain the preference queue, including cleanup enqueued by the old continuation.
    await service.refresh({});
    try {
      expect(oldResult.token).toBeNull();
      expect(newResult.token).toEqual(expect.any(String));
      expect(service.snapshot().capturing).toBe(true);
      expect(service.snapshot().registered).toEqual([]);
      expect(first.sender.setIgnoreMenuShortcuts).toHaveBeenLastCalledWith(false);
      expect(second.sender.setIgnoreMenuShortcuts).toHaveBeenLastCalledWith(true);
      retiredFirst();
      await service.refresh({});
      expect(service.snapshot().capturing).toBe(true);
    } finally {
      await capture(second.event, { active: false, token: newResult.token });
    }
    expect(service.snapshot().capturing).toBe(false);
    expect(second.sender.setIgnoreMenuShortcuts).toHaveBeenLastCalledWith(false);
    expect(fixture.retired.size).toBe(0);
  });
});
