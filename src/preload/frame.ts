import { contextBridge, ipcRenderer } from 'electron';
import type { FrameBridge } from '../shared/frame-route';

// The frame page (an app window's own page under its machine views) only
// paints the backdrop: no general app IPC, backend access or webviews. The
// channels are literal because a sandboxed preload cannot require app modules;
// a test checks them against IPC_CHANNELS.MACHINE_RAIL.
const GET_BACKDROP = 'machine-rail:get-backdrop';
const BACKDROP_CHANGED = 'machine-rail:backdrop-changed';

const bridge: FrameBridge = {
  getBackdrop: () => ipcRenderer.invoke(GET_BACKDROP, {}),
  onBackdrop: (callback) => {
    const listener = (_event: unknown, backdrop: Parameters<typeof callback>[0]) =>
      callback(backdrop);
    ipcRenderer.on(BACKDROP_CHANGED, listener);
    return () => ipcRenderer.removeListener(BACKDROP_CHANGED, listener);
  },
};
contextBridge.exposeInMainWorld('frameBridge', bridge);
