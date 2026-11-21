const { app, BrowserWindow, View, WebContentsView, ipcMain } = require('electron');
const path = require('node:path');

const [profile, url, bundleDir] = process.argv.slice(2);
if (!profile || !url || !bundleDir)
  throw new Error('profile, host URL and bundle dir are required');
app.setPath('userData', profile);
app.setPath('sessionData', profile);

// Same guest preferences as src/main/webview-security.ts enforces for the
// browser panel while passkeys are enabled.
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', (_attach, webPreferences) => {
    delete webPreferences.preload;
    webPreferences.nodeIntegration = false;
    webPreferences.nodeIntegrationInSubFrames = true;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
    webPreferences.webSecurity = true;
  });
});

const main = require(path.join(bundleDir, 'main-under-test.cjs'));

// The production ipcMain.handle authorization wrapper (src/main/index.ts).
main.installIpcHandleAuthorization(ipcMain);

const BROWSER_PANEL_PARTITION = 'persist:browser-panel';
/** Same guest preferences as buildBrowserViewWebPreferences (src/main/webview-security.ts). */
const pagePreferences = () => ({
  partition: BROWSER_PANEL_PARTITION,
  nodeIntegration: false,
  nodeIntegrationInWorker: false,
  nodeIntegrationInSubFrames: false,
  contextIsolation: true,
  sandbox: true,
  webSecurity: true,
  allowRunningInsecureContent: false,
  webviewTag: false,
});

const windows = [];
async function openWindow() {
  const window = new BrowserWindow({
    width: 900,
    height: 720,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      webviewTag: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  const index = windows.length;
  windows.push(window);
  // Later windows (tab windows in the app) host no webview guest; `window=N` tells them apart.
  await window.loadURL(
    index === 0 ? url : `${url.replace(/guest=[^&]*/, 'guest=about%3Ablank')}&window=${index}`,
  );
  window.showInactive();
  return index;
}

// Main-owned browser pages: the real BrowserViewService, with each window's
// own renderer standing in for its machine view.
const views = new main.BrowserViewService({
  createView: (webPreferences) => new WebContentsView({ webPreferences }),
  createParkingHolder: () => new View(),
  webPreferences: pagePreferences,
  secureContents: () => {},
  isNavigationAllowed: () => true,
  machineViewFor: (window) => (window.isDestroyed() ? null : window.webContents),
  shownMachine: () => 'local',
  cdp: { registerTab() {}, unregisterTab() {} },
  send() {},
  onPageMoved: main.notifyMainOwnedBrowserPageMoved,
});
main.setMainOwnedBrowserPageOwners(views);

/** A corner box: the page paints there, and the app dialog stays clickable. */
const PAGE_RECT = { x: 0, y: 0, width: 160, height: 120 };

// Driven from the spec with app.evaluate().
globalThis.passkeyFixtureMain = {
  openWindow,
  openPage(tabId, pageUrl, windowIndex = 0) {
    views.create({ backendId: 'local', workspaceId: 'ws', tabId }, windows[windowIndex], pageUrl);
    views.setPlacement(tabId, PAGE_RECT, true);
    return views.stateOf(tabId).webContentsId;
  },
  show(tabId) {
    views.setPlacement(tabId, PAGE_RECT, true);
    return views.placementOf(tabId);
  },
  detach(tabId) {
    views.detach(tabId);
    return views.placementOf(tabId);
  },
  move(tabId, windowIndex) {
    views.moveToWindow(tabId, windows[windowIndex]);
  },
  /** A WebContentsView in the browser-panel session that BrowserViewService did not make. */
  async openRogue(pageUrl) {
    const rogue = new WebContentsView({ webPreferences: pagePreferences() });
    windows[0].contentView.addChildView(rogue);
    rogue.setBounds({ x: 0, y: 200, width: 160, height: 120 });
    await rogue.webContents.loadURL(pageUrl);
    return rogue.webContents.id;
  },
};

app.whenReady().then(async () => {
  main.setupPasskeysIPC(path.join(bundleDir, 'passkey-page.js'));
  await openWindow();
});
app.on('window-all-closed', () => app.quit());
