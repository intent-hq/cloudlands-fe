const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');

const [profile, url, cdpBundle] = process.argv.slice(2);
if (!profile || !url || new URL(url).hostname !== '127.0.0.1') {
  throw new Error('A fresh profile and loopback fixture URL are required');
}
app.setPath('userData', profile);
app.setPath('sessionData', profile);
app.commandLine.appendSwitch('disable-background-timer-throttling');
globalThis.lifetimeEvidence = { registrations: [], guests: [] };
globalThis.lifetimeCdp = require(cdpBundle).embeddedBrowserCdp;
globalThis.lifetimeNavigate = (tabId, url) =>
  require(cdpBundle).executeActions(
    { actions: [{ action: 'navigate', tabId, url }] },
    undefined,
    undefined,
    tabId[0],
  );
if (new URL(url).searchParams.get('owned') === 'true') {
  for (const tab of ['A-1', 'A-2', 'B-1', 'B-2']) {
    globalThis.lifetimeCdp.claimTab(tab, 'fixture-agent', { width: 800, height: 600 });
  }
}
app.on('web-contents-created', (_event, contents) => {
  if (contents.getType() !== 'webview') return;
  const guest = { id: contents.id, navigations: [], destroyed: false };
  globalThis.lifetimeEvidence.guests.push(guest);
  contents.on('did-navigate', (_event, nextUrl) => guest.navigations.push(nextUrl));
  contents.once('destroyed', () => {
    guest.destroyed = true;
  });
});
ipcMain.handle('fixture:invoke', (_event, channel, payload) => {
  if (channel === 'browser:register-tab') {
    globalThis.lifetimeEvidence.registrations.push(payload);
    globalThis.lifetimeCdp.registerTab(payload.tabId, payload.webContentsId);
  }
  return undefined;
});
app.whenReady().then(async () => {
  const window = new BrowserWindow({
    width: 1000,
    height: 800,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      webviewTag: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  await window.loadURL(url);
  window.showInactive();
});
app.on('window-all-closed', () => app.quit());
