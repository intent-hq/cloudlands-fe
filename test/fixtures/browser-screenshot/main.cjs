const { app, BrowserWindow } = require('electron');
const [profile, bundle, deviceScaleFactor] = process.argv.slice(2);
if (!profile || !bundle || !deviceScaleFactor) {
  throw new Error('An isolated profile, CDP bundle and device scale factor are required');
}
app.commandLine.appendSwitch('force-device-scale-factor', deviceScaleFactor);
app.setPath('userData', profile);
app.setPath('sessionData', profile);
app.whenReady().then(async () => {
  globalThis.screenshotFixtureWindow = new BrowserWindow({
    show: false,
    width: 1600,
    height: 1200,
    webPreferences: { contextIsolation: true, webviewTag: true },
  });
  await globalThis.screenshotFixtureWindow.loadURL(
    'data:text/html;charset=utf-8,<!doctype html><body style="margin:0">',
  );
  globalThis.screenshotFixture = require(bundle);
});
