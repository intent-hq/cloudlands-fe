const { app, BrowserWindow } = require('electron');
const { setupCustomViewsIPC, disposeCustomViews } = require(process.argv[4]);

app.setPath('userData', process.argv[2]);
let quitting = false;
app.on('before-quit', (event) => {
  if (quitting) return;
  event.preventDefault();
  quitting = true;
  void disposeCustomViews().finally(() => app.quit());
});

void app.whenReady().then(async () => {
  setupCustomViewsIPC();
  const window = new BrowserWindow({
    width: 1000,
    height: 700,
    webPreferences: {
      preload: process.argv[5],
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      sandbox: true,
    },
  });
  await window.loadURL(process.argv[3]);
});
