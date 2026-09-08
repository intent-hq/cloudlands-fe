import { BrowserWindow } from 'electron';
import { isFocusedWindowBrowserActive } from '../features/system/main/system.ipc';

type ZoomCommand = 'menu:zoom-in' | 'menu:zoom-out' | 'menu:reset-zoom';

/** Keep browser-panel zoom on its workspace route; app zoom belongs to the window. */
export function handleMenuZoom(
  command: ZoomCommand,
  sendWorkspaceCommand: (channel: ZoomCommand) => void,
): void {
  const focusedWindow = BrowserWindow.getFocusedWindow();
  if (!focusedWindow || focusedWindow.isDestroyed() || focusedWindow.webContents.isDestroyed()) {
    return;
  }
  if (isFocusedWindowBrowserActive()) {
    sendWorkspaceCommand(command);
    return;
  }

  const contents = focusedWindow.webContents;
  contents.setZoomLevel(
    command === 'menu:reset-zoom'
      ? 0
      : contents.getZoomLevel() + (command === 'menu:zoom-in' ? 0.5 : -0.5),
  );

  // Electron's zoom-changed event describes mouse-wheel requests, not programmatic
  // setZoomLevel calls. Chromium can also share zoom across same-origin windows:
  // publish each window's actual factor, never copy the focused window's factor.
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed() || window.webContents.isDestroyed()) continue;
    window.webContents.send('window:zoom-changed', {
      zoomFactor: window.webContents.getZoomFactor(),
    });
  }
}
