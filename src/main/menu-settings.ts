import { BrowserWindow, type MenuItemConstructorOptions } from 'electron';
import { isAnnotationWindow } from '../features/annotation/main/annotation-window';
import { isDockWindow } from './dock-window';

function acceptsSettings(window: BrowserWindow | null): window is BrowserWindow {
  return (
    !!window &&
    !window.isDestroyed() &&
    !window.webContents.isDestroyed() &&
    !isDockWindow(window) &&
    !isAnnotationWindow(window)
  );
}

/** Shared by the macOS app menu and the Windows/Linux File menu. */
export function createSettingsMenuItem(label: string): MenuItemConstructorOptions {
  return {
    label,
    accelerator: 'CmdOrCtrl+,',
    enabled: acceptsSettings(BrowserWindow.getFocusedWindow()),
    click: () => {
      // Focus may have changed since the debounced application menu rebuild.
      const window = BrowserWindow.getFocusedWindow();
      if (acceptsSettings(window)) window.webContents.send('navigate', '/settings');
    },
  };
}
