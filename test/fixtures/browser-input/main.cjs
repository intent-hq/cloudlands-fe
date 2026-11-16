const { app, BrowserWindow } = require('electron');
const [profile, bundle] = process.argv.slice(2);
if (!profile || !bundle) throw new Error('An isolated profile and input bundle are required');
app.setPath('userData', profile);
app.setPath('sessionData', profile);
app.whenReady().then(async () => {
  // Never shown or focused: input must reach the page without window focus.
  globalThis.inputFixtureWindow = new BrowserWindow({
    show: false,
    width: 800,
    height: 600,
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  await globalThis.inputFixtureWindow.loadURL('about:blank');
  globalThis.inputFixture = require(bundle);
});
