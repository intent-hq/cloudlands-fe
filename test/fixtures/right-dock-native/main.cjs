const {
  app,
  BrowserWindow,
  desktopCapturer,
  nativeImage,
  screen,
  systemPreferences,
  globalShortcut,
} = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');
const { createServer } = require('node:http');
const { once } = require('node:events');
const [root, output] = process.argv.slice(2);
app.setPath('userData', join(root, 'profile'));
app.on('window-all-closed', () => {});
const evidence = {
  syntheticCapture: true,
  productionRenderer: false,
  osPermissionsTested: false,
  transitions: [],
};
let server;
let native;
let failCapture = false;
let captureCount = 0;

app.whenReady().then(async () => {
  try {
    server = createServer((_req, res) => {
      res.setHeader('Content-Type', 'text/html');
      res.end(
        '<!doctype html><title>Synthetic native capture fixture</title><style>body{background:#e9f1f4;color:#17344c;font:32px system-ui;padding:48px}</style><h1>Synthetic capture</h1><p>Native lifecycle smoke — no user content</p>',
      );
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    process.env.NODE_ENV = 'development';
    process.env.DEV_PORT = String(server.address().port);
    // Never delegate to OS capture: all screen thumbnails are opaque synthetic pixels.
    desktopCapturer.getSources = async () => {
      if (failCapture) throw new Error('Synthetic capture failure');
      captureCount++;
      return screen.getAllDisplays().map((display) => ({
        id: `screen:${display.id}`,
        name: 'Synthetic screen',
        display_id: String(display.id),
        thumbnail: nativeImage.createFromBitmap(Buffer.from([0x44, 0x88, 0xcc, 0xff]), {
          width: 1,
          height: 1,
        }),
      }));
    };
    systemPreferences.getMediaAccessStatus = () => 'granted';
    native = await import(pathToFileURL(join(root, 'native.mjs')).href);
    const baselineListeners = screen.listenerCount('display-removed');
    const shortcutBefore = globalShortcut.isRegistered('CommandOrControl+Shift+Space');
    const dock = native.createDockWindow();
    await new Promise((resolve, reject) => {
      dock.webContents.once('did-finish-load', resolve);
      dock.webContents.once('did-fail-load', (_event, code, description) =>
        reject(new Error(`${code}: ${description}`)),
      );
    });
    const record = (label) => {
      const state = native.getAnnotationState();
      evidence.transitions.push({
        label,
        state: state && { ...state, screenshotDataUrl: '[synthetic pixels]' },
        windows: BrowserWindow.getAllWindows().map((window) => ({
          id: window.id,
          visible: window.isVisible(),
          opacity: window.getOpacity(),
          route: new URL(window.webContents.getURL() || 'about:blank').pathname,
        })),
      });
    };
    assert.deepEqual(
      await native.startAnnotationMode({
        workspaceId: 'fixture',
        workspaceTitle: 'Synthetic feedback',
      }),
      { success: true },
    );
    assert.equal(BrowserWindow.getAllWindows().length, 3);
    assert.equal(dock.isVisible(), false);
    const startedAt = native.getAnnotationState().startedAt;
    record('capturing');
    assert.equal(await native.setAnnotationTool('draw'), true);
    assert.equal(native.appendAnnotationTranscript('Synthetic narration'), true);
    assert.equal(await native.reviewAnnotation(), true);
    assert.equal(native.getAnnotationState().phase, 'review');
    record('review');
    const overlay = BrowserWindow.getAllWindows().find((window) =>
      window.webContents.getURL().endsWith('/annotation'),
    );
    await fs.writeFile(
      join(output, 'synthetic-review.png'),
      (await overlay.webContents.capturePage()).toPNG(),
    );
    await native.startAnnotationMode({
      workspaceId: 'other',
      workspaceTitle: 'Must preserve draft',
    });
    assert.equal(native.getAnnotationState().startedAt, startedAt);
    assert.equal(native.getAnnotationState().workspaceId, 'fixture');
    assert.equal(await native.setAnnotationTool('mouse'), true);
    const revision = native.getAnnotationState().screenshotRevision;
    failCapture = true;
    assert.equal(await native.setAnnotationTool('draw'), false);
    assert.equal(native.getAnnotationState().screenshotRevision, revision);
    assert.deepEqual(native.getAnnotationState().transcripts, ['Synthetic narration']);
    assert.equal(BrowserWindow.getAllWindows().length, 3);
    record('capture failure retains draft');
    failCapture = false;
    const capturesBeforeReview = captureCount;
    assert.equal(await native.reviewAnnotation(), true);
    assert.equal(captureCount, capturesBeforeReview + 1);
    assert.equal(native.getAnnotationState().screenshotRevision, revision + 1);
    native.closeAnnotationMode();
    assert.equal(native.getAnnotationState(), null);
    assert.equal(BrowserWindow.getAllWindows().length, 1);
    assert.equal(dock.isVisible(), true);
    assert.equal(globalShortcut.isRegistered('CommandOrControl+Shift+Space'), shortcutBefore);
    record('closed and dock restored');
    const dockClosed = once(dock, 'closed');
    native.closeDockWindow();
    await dockClosed;
    assert.equal(BrowserWindow.getAllWindows().length, 0);
    assert.equal(screen.listenerCount('display-removed'), baselineListeners);
    evidence.passed = true;
  } catch (error) {
    evidence.passed = false;
    evidence.error = error.stack || String(error);
    console.error(error);
  } finally {
    native?.closeAnnotationMode();
    native?.closeDockWindow();
    await fs.writeFile(join(output, 'native-lifecycle.json'), JSON.stringify(evidence, null, 2));
    if (server) await new Promise((resolve) => server.close(resolve));
    app.exit(evidence.passed ? 0 : 1);
  }
});
