import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopOverlayBridge } from '../shared/desktop-overlay';

// No general app IPC, backend access, or session credentials in overlay renderers.
const bridge: DesktopOverlayBridge = {
  ready: () => ipcRenderer.send('desktop-overlay:ready'),
  stop: () => ipcRenderer.send('desktop-overlay:stop'),
  openAgent: () => ipcRenderer.send('desktop-overlay:open-agent'),
  setInteractive: (interactive) => ipcRenderer.send('desktop-overlay:interactive', interactive),
  onPulse: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('desktop-overlay:pulse', listener);
    return () => ipcRenderer.removeListener('desktop-overlay:pulse', listener);
  },
};
contextBridge.exposeInMainWorld('desktopOverlay', bridge);
