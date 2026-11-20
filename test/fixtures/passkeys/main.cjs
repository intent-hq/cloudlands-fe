const { app, BrowserWindow } = require('electron');
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

app.whenReady().then(async () => {
  require(path.join(bundleDir, 'passkeys-main.cjs')).setupPasskeysIPC(
    path.join(bundleDir, 'passkey-page.js'),
  );
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
  await window.loadURL(url);
  window.showInactive();
});
app.on('window-all-closed', () => app.quit());
