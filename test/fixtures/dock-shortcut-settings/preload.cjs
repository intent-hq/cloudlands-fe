const { contextBridge, ipcRenderer } = require('electron');
let sequence = 0;
const listeners = new Map();
let holdNextGet = false;
let heldGet = null;
contextBridge.exposeInMainWorld('shortcutTest', {
  holdGet: () => {
    holdNextGet = true;
  },
  hasHeldGet: () => !!heldGet,
  releaseGet: () => {
    const release = heldGet;
    heldGet = null;
    release?.();
  },
});
contextBridge.exposeInMainWorld('electronAPI', {
  versions: { electron: process.versions.electron },
  invoke: async (channel, payload) => {
    const hold = channel === 'dock-shortcuts:get' && holdNextGet;
    if (hold) holdNextGet = false;
    const result = await ipcRenderer.invoke(channel, payload);
    if (hold)
      await new Promise((resolve) => {
        heldGet = resolve;
      });
    return result;
  },
  on: (channel, callback) => {
    const id = String(++sequence);
    const handler = (_event, payload) => callback(payload);
    listeners.set(id, { channel, handler });
    ipcRenderer.on(channel, handler);
    return id;
  },
  offById: (_channel, id) => {
    const entry = listeners.get(id);
    if (entry) {
      ipcRenderer.removeListener(entry.channel, entry.handler);
      listeners.delete(id);
    }
  },
});
