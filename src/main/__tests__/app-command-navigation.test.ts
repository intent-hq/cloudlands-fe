import { describe, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';

import {
  attachAppCommandHistoryNavigation,
  historyDirectionForAppCommand,
} from '../app-command-navigation';
import { IPC_CHANNELS } from '../../shared/ipc-registry';

/** Minimal BrowserWindow stand-in capturing the app-command listener. */
function createFakeWindow(overrides?: { windowDestroyed?: boolean; contentsDestroyed?: boolean }) {
  const listeners = new Map<string, (...args: unknown[]) => void>();
  const send = vi.fn();
  const window = {
    on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      listeners.set(event, listener);
    }),
    isDestroyed: () => overrides?.windowDestroyed ?? false,
    webContents: {
      isDestroyed: () => overrides?.contentsDestroyed ?? false,
      send,
    },
  };
  const emitAppCommand = (command: string) => {
    listeners.get('app-command')?.({}, command);
  };
  return { window: window as unknown as BrowserWindow, send, emitAppCommand };
}

describe('historyDirectionForAppCommand', () => {
  it('maps browser-backward to back', () => {
    expect(historyDirectionForAppCommand('browser-backward')).toBe('back');
  });

  it('maps browser-forward to forward', () => {
    expect(historyDirectionForAppCommand('browser-forward')).toBe('forward');
  });

  it.each(['browser-refresh', 'media-play-pause', 'browser-home', ''])(
    'returns null for %j',
    (command) => {
      expect(historyDirectionForAppCommand(command)).toBeNull();
    },
  );
});

describe('attachAppCommandHistoryNavigation', () => {
  it('sends app:history-navigate back for browser-backward', () => {
    const { window, send, emitAppCommand } = createFakeWindow();
    attachAppCommandHistoryNavigation(window, 'win32');
    emitAppCommand('browser-backward');
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(IPC_CHANNELS.APP.HISTORY_NAVIGATE, 'back');
  });

  it('sends app:history-navigate forward for browser-forward', () => {
    const { window, send, emitAppCommand } = createFakeWindow();
    attachAppCommandHistoryNavigation(window, 'win32');
    emitAppCommand('browser-forward');
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(IPC_CHANNELS.APP.HISTORY_NAVIGATE, 'forward');
  });

  it('ignores every other app-command', () => {
    const { window, send, emitAppCommand } = createFakeWindow();
    attachAppCommandHistoryNavigation(window, 'win32');
    emitAppCommand('browser-refresh');
    emitAppCommand('media-nexttrack');
    expect(send).not.toHaveBeenCalled();
  });

  it('does not send to a destroyed window', () => {
    const { window, send, emitAppCommand } = createFakeWindow({ windowDestroyed: true });
    attachAppCommandHistoryNavigation(window, 'win32');
    emitAppCommand('browser-backward');
    expect(send).not.toHaveBeenCalled();
  });

  it('does not send to destroyed webContents', () => {
    const { window, send, emitAppCommand } = createFakeWindow({ contentsDestroyed: true });
    attachAppCommandHistoryNavigation(window, 'win32');
    emitAppCommand('browser-forward');
    expect(send).not.toHaveBeenCalled();
  });

  // Electron also emits app-command on Linux (electron#18322), where the X
  // buttons already reach the renderer as mouse events — registering there
  // would double-fire (two history steps per press).
  it.each(['linux', 'darwin'] as NodeJS.Platform[])(
    'does not register the listener on %s',
    (platform) => {
      const { window, send, emitAppCommand } = createFakeWindow();
      attachAppCommandHistoryNavigation(window, platform);
      expect(window.on).not.toHaveBeenCalled();
      emitAppCommand('browser-backward');
      expect(send).not.toHaveBeenCalled();
    },
  );
});
