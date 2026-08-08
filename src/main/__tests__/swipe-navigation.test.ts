import { describe, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';

import { attachSwipeHistoryNavigation } from '../swipe-navigation';
import { IPC_CHANNELS } from '../../shared/ipc-registry';

/** Minimal BrowserWindow stand-in capturing the swipe listener. */
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
  const emitSwipe = (direction: string) => {
    listeners.get('swipe')?.({}, direction);
  };
  return { window: window as unknown as BrowserWindow, send, emitSwipe };
}

describe('attachSwipeHistoryNavigation', () => {
  it('sends app:history-navigate back for a left swipe', () => {
    const { window, send, emitSwipe } = createFakeWindow();
    attachSwipeHistoryNavigation(window, 'darwin');
    emitSwipe('left');
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(IPC_CHANNELS.APP.HISTORY_NAVIGATE, 'back');
  });

  it('sends app:history-navigate forward for a right swipe', () => {
    const { window, send, emitSwipe } = createFakeWindow();
    attachSwipeHistoryNavigation(window, 'darwin');
    emitSwipe('right');
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(IPC_CHANNELS.APP.HISTORY_NAVIGATE, 'forward');
  });

  it.each(['up', 'down', 'back', 'forward', ''])(
    'ignores vertical/unexpected swipe direction %j',
    (direction) => {
      const { window, send, emitSwipe } = createFakeWindow();
      attachSwipeHistoryNavigation(window, 'darwin');
      emitSwipe(direction);
      expect(send).not.toHaveBeenCalled();
    },
  );

  it('does not send to a destroyed window', () => {
    const { window, send, emitSwipe } = createFakeWindow({ windowDestroyed: true });
    attachSwipeHistoryNavigation(window, 'darwin');
    emitSwipe('left');
    expect(send).not.toHaveBeenCalled();
  });

  it('does not send to destroyed webContents', () => {
    const { window, send, emitSwipe } = createFakeWindow({ contentsDestroyed: true });
    attachSwipeHistoryNavigation(window, 'darwin');
    emitSwipe('right');
    expect(send).not.toHaveBeenCalled();
  });

  // The swipe event is darwin-only in Electron; other platforms keep their
  // existing paths (Windows app-command, Linux renderer mouse events).
  it.each(['win32', 'linux'] as NodeJS.Platform[])(
    'does not register the listener on %s',
    (platform) => {
      const { window, send, emitSwipe } = createFakeWindow();
      attachSwipeHistoryNavigation(window, platform);
      expect(window.on).not.toHaveBeenCalled();
      emitSwipe('left');
      expect(send).not.toHaveBeenCalled();
    },
  );
});
