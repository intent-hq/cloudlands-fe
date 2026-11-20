const { contextBridge, ipcRenderer } = require('electron');

let next = 0;
const listeners = new Map();
contextBridge.exposeInMainWorld('electronAPI', {
  invoke: (channel, payload) => ipcRenderer.invoke(channel, payload),
  on: (channel, callback) => {
    const id = `listener-${++next}`;
    const listener = (_event, payload) => callback(payload);
    listeners.set(id, { channel, listener });
    ipcRenderer.on(channel, listener);
    return id;
  },
  offById: (_channel, id) => {
    const entry = listeners.get(id);
    if (!entry) return;
    ipcRenderer.removeListener(entry.channel, entry.listener);
    listeners.delete(id);
  },
});
