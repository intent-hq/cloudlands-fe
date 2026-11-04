import { app, ipcMain } from 'electron';
import { randomUUID } from 'node:crypto';
import { IPC_CHANNELS } from '../shared/ipc-registry';
import { getDockWindow } from './dock-window';
import { getStrictBackendBindingForWebContents } from './window-backend';
import { createDockContextFeed } from './dock-context-feed';
import { readDockForegroundObservation } from './dock-foreground-observation';

export function initializeDockContextFeed(): void {
  const scope = () => {
    const window = getDockWindow();
    return window && !window.isDestroyed()
      ? getStrictBackendBindingForWebContents(window.webContents)
      : null;
  };
  const feed = createDockContextFeed({
    scope,
    visible: () => getDockWindow()?.isVisible() ?? false,
    async read() {
      const binding = scope();
      if (!binding) throw new Error('Dock context document unavailable');
      return readDockForegroundObservation(binding.backendId);
    },
    version: randomUUID,
    changed(value) {
      const window = getDockWindow();
      if (window && scope()?.backendId === value.backendId)
        window.webContents.send(IPC_CHANNELS.DOCK_CONTEXT.CHANGED, value);
    },
  });
  ipcMain.handle(IPC_CHANNELS.DOCK_CONTEXT.GET, async (event) => {
    const window = getDockWindow();
    if (
      !window ||
      event.sender !== window.webContents ||
      event.senderFrame !== event.sender.mainFrame ||
      !scope()
    )
      throw new Error('Dock context requires its live main document');
    return feed.read();
  });
  feed.start();
  app.once('will-quit', () => feed.stop());
}
