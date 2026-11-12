import { BrowserWindow, type MenuItemConstructorOptions } from 'electron';
import { isDockAnnotationWindow } from './dock-annotation-identity';
import { isDockCaptureEditorWindow } from './dock-capture-editor-identity';
import { isDockWindow } from './dock-window';
import { getShownRendererWebContents } from './window-backend';

function acceptsSettings(window: BrowserWindow | null): window is BrowserWindow {
  return (
    !!window &&
    !window.isDestroyed() &&
    !window.webContents.isDestroyed() &&
    !isDockWindow(window) &&
    !isDockAnnotationWindow(window) &&
    !isDockCaptureEditorWindow(window)
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
      if (acceptsSettings(window))
        getShownRendererWebContents(window).send('navigate', '/settings');
    },
  };
}
