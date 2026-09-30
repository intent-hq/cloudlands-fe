const { app, BrowserWindow } = require('electron');
const [profile, bundle] = process.argv.slice(2);
if (!profile || !bundle) throw new Error('An isolated profile and capture bundle are required');
app.setPath('userData', profile);
app.setPath('sessionData', profile);
app.whenReady().then(async () => {
  globalThis.captureFixtureWindow = new BrowserWindow({
    show: false,
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  await globalThis.captureFixtureWindow.loadURL('about:blank');
  globalThis.captureFixture = require(bundle).browserCapture;
});
