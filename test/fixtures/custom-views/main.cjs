const { app, BrowserWindow, net, protocol } = require('electron');
const { setupCustomViewsIPC, disposeCustomViews } = require(process.argv[4]);

// Match the app scheme's production privileges so postMessage uses its real origin.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  },
]);
app.setPath('userData', process.argv[2]);
let quitting = false;
app.on('before-quit', (event) => {
  if (quitting) return;
  event.preventDefault();
  quitting = true;
  void disposeCustomViews().finally(() => app.quit());
});

void app.whenReady().then(async () => {
  protocol.handle('app', (request) => {
    const requested = new URL(request.url);
    if (requested.hostname !== 'workspaces') return new Response(null, { status: 404 });
    const target = new URL(process.argv[3]);
    target.pathname = requested.pathname;
    target.search = requested.search;
    return net.fetch(target.href);
  });
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
  await window.loadURL('app://workspaces/');
});
