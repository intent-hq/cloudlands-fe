const { contextBridge, ipcRenderer } = require('electron');
let sequence = 0;
const listeners = new Map();
contextBridge.exposeInMainWorld('electronAPI', {
  versions: { electron: process.versions.electron },
  invoke: (channel, payload) => ipcRenderer.invoke(channel, payload),
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
