const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  invoke: (channel, payload) =>
    channel === 'browser:list-tabs-response'
      ? ipcRenderer.invoke(channel, payload)
      : ipcRenderer.invoke('fixture:invoke', channel, payload),
  on: (channel, callback) => {
    ipcRenderer.on(channel, (_event, payload) => callback(payload));
  },
});
