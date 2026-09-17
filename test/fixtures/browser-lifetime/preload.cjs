const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  invoke: (channel, payload) => ipcRenderer.invoke('fixture:invoke', channel, payload),
});
