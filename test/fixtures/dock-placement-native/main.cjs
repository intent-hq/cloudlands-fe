const {
  app,
  BrowserWindow,
  screen,
  ipcMain,
  desktopCapturer,
  nativeImage,
  systemPreferences,
} = require('electron');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');
const { mkdir, writeFile, rm } = require('node:fs/promises');
const [profile, baseUrl, nativePath, geometry = 'unknown', appLayout = 'root'] =
  process.argv.slice(2);
app.setPath('userData', profile);
app.setAppPath(appLayout === 'dist-main' ? join(profile, 'dist/main') : profile);
app.on('window-all-closed', () => {});
process.env.NODE_ENV = 'development';
process.env.DEV_PORT = new URL(baseUrl).port;

app
  .whenReady()
  .then(async () => {
    if (appLayout === 'dist-main') await mkdir(join(profile, 'dist/main'), { recursive: true });
    // Synthetic helper output traverses the real exec/validation/coordinate path.
    // It is explicitly separate from physical notch and window-level proof.
    const helper = join(profile, 'resources/dock-helper/intent-dock-helper');
    if (geometry === 'unknown') await rm(helper, { force: true });
    else {
      await mkdir(join(profile, 'resources/dock-helper'), { recursive: true });
      const entries = screen.getAllDisplays().map((display) => ({
        id: display.id,
        cutout:
          geometry === 'notch' && display.id === screen.getPrimaryDisplay().id
            ? { x: Math.round((display.bounds.width - 180) / 2), y: 0, width: 180, height: 32 }
            : null,
      }));
      await writeFile(helper, `#!/bin/sh\nprintf '%s' '${JSON.stringify(entries)}'\n`, {
        mode: 0o755,
      });
    }
    const calls = [];
    let pointerRouting = null;
    let ignoredPointerInput = null;
    const actualCursor = screen.getCursorScreenPoint.bind(screen);
    // Tests never depend on the user's real mouse: main's cursor poll (hover presence,
    // pointer routing) sees a point parked off every display until a test sets one.
    // setControlledCursor(null) opts back into the real cursor (native pointer tests).
    let controlledCursor = { x: -100000, y: -100000 };
    screen.getCursorScreenPoint = () => controlledCursor ?? actualCursor();
    let holdDragBegin = false;
    const pendingDragBegins = [];
    const originalHandle = ipcMain.handle.bind(ipcMain);
    ipcMain.handle = (channel, handler) =>
      originalHandle(channel, async (...args) => {
        if (
          holdDragBegin &&
          channel === 'window:update-dock-placement' &&
          args[1]?.action === 'begin-drag'
        ) {
          calls.push({ boundary: 'controlled-begin-delay', command: args[1] });
          await new Promise((resolve) => pendingDragBegins.push(resolve));
        }
        const result = await handler(...args);
        if (channel.startsWith('dock-evidence:'))
          calls.push({ boundary: 'production-dock-evidence-command', channel, ok: result?.ok });
        if (channel === 'window:set-dock-pointer-region')
          pointerRouting = { payload: args[1], result };
        if (channel === 'window:update-dock-placement')
          calls.push({
            boundary: 'production-placement-command',
            command: args[1],
            resultPhase: result?.phase,
            resultRevision: result?.revision,
          });
        return result;
      });
    let captureFailure = false;
    let releaseCapture;
    let holdCapture = false;
    desktopCapturer.getSources = async () => {
      calls.push({ boundary: 'synthetic-screen-capture' });
      if (holdCapture)
        await new Promise((resolve) => {
          releaseCapture = resolve;
        });
      if (captureFailure) throw new Error('Synthetic capture denial');
      return screen.getAllDisplays().map((display) => ({
        id: `screen:${display.id}`,
        name: 'Synthetic QA screen',
        display_id: String(display.id),
        thumbnail: nativeImage.createFromBitmap(Buffer.from([0x54, 0x76, 0x90, 0xff]), {
          width: 1,
          height: 1,
        }),
      }));
    };
    systemPreferences.getMediaAccessStatus = () => 'granted';
    // Fail closed for external writes. This fixture cannot talk to an existing daemon.
    ipcMain.handle('backend:request', (_event, payload) => {
      calls.push({ boundary: 'synthetic-backend', method: payload.method });
      if (payload.method === 'agent.list') return { agents: [] };
      if (payload.method === 'voice.getWorkspaceVocabulary') return { terms: [] };
      throw new Error(`External request unavailable in placement fixture: ${payload.method}`);
    });
    ipcMain.handle('power:get-battery-state', () => ({ onBattery: false }));
    const native = await import(pathToFileURL(nativePath).href);
    native.registerDockPlacementHandlers();
    // The dock composer's capture session, behind the same sender checks as
    // production's dock-evidence IPC (exact dock document main frame only).
    const owner = (event) =>
      event.sender.isDestroyed() ||
      !event.senderFrame ||
      event.senderFrame !== event.sender.mainFrame
        ? null
        : { sender: event.sender, frame: event.senderFrame };
    ipcMain.handle('dock-evidence:begin', (event, request) => {
      const caller = owner(event);
      return caller
        ? native.dockEvidenceSessions.begin(caller, request)
        : { ok: false, error: 'unavailable' };
    });
    ipcMain.handle('dock-evidence:capture', (event, request) => {
      const caller = owner(event);
      return caller
        ? native.dockEvidenceSessions.capture(caller, request)
        : { ok: false, error: 'unavailable' };
    });
    // Exercise the hide-the-dock capture path (production's fallback without
    // ScreenCaptureKit); the window-excluding helper is not part of this fixture.
    native.dockEvidenceSessions.deps.captureVisible = undefined;
    const history = [];
    const tracked = new WeakSet();
    const menu = native.createDockMenuController({
      createWindow() {
        const dock = native.createDockWindow();
        if (!tracked.has(dock)) {
          tracked.add(dock);
          const originalIgnoreMouseEvents = dock.setIgnoreMouseEvents.bind(dock);
          dock.setIgnoreMouseEvents = (ignore, options) => {
            const result = originalIgnoreMouseEvents(ignore, options);
            ignoredPointerInput = { ignore, options };
            return result;
          };
          const originalSend = dock.webContents.send.bind(dock.webContents);
          dock.webContents.send = (channel, ...args) => {
            if (channel.includes('dock')) history.push({ event: channel, args });
            return originalSend(channel, ...args);
          };
        }
        return dock;
      },
      getWindow: native.getDockWindow,
      closeWindow: native.closeDockWindow,
      focusWindow: native.focusDockWindow,
      readEnabledPreference: native.getDockEnabledLocalPref,
      writeEnabledPreference: native.setDockEnabledLocalPref,
      onStateChange: () => history.push({ event: 'menu-state-changed' }),
    });
    // The dock is a Labs feature that is off by default. Persist it on, then start
    // the way the app does (src/main/index.ts): load the setting, register its handlers.
    await native.setDockLabEnabledLocalPref(true);
    await native.loadDockLabEnabled();
    native.registerDockLabHandlers({
      show: () => menu.setEnabled(true),
      hide: () => menu.dismiss(),
      onChange: () => {},
    });
    if (!native.isDockLabEnabled()) throw new Error('Dock Labs setting did not load as on');
    await menu.setEnabled(true);
    globalThis.companionNative = {
      native,
      calls,
      history,
      menu,
      dragBeginGate: {
        hold() {
          holdDragBegin = true;
        },
        pending() {
          return pendingDragBegins.length;
        },
        release() {
          holdDragBegin = false;
          for (const resolve of pendingDragBegins.splice(0)) resolve();
        },
      },
      setControlledCursor(point) {
        controlledCursor = point;
        calls.push({ boundary: 'controlled-os-cursor', point });
      },
      capture: {
        hold(value) {
          holdCapture = value;
        },
        release() {
          holdCapture = false;
          releaseCapture?.();
        },
        fail(value) {
          captureFailure = value;
        },
      },
      snapshot() {
        const current = native.getDockWindow();
        return {
          geometryFixture: geometry,
          appLayout,
          menuEnabled: menu.isEnabled(),
          placement: current ? native.getDockPlacementSnapshot(current) : null,
          id: current?.id,
          webContentsId: current?.webContents.id,
          bounds: current?.getBounds(),
          visible: current?.isVisible(),
          focused: current?.isFocused(),
          alwaysOnTop: current?.isAlwaysOnTop(),
          cursor: screen.getCursorScreenPoint(),
          pointerRouting,
          ignoredPointerInput,
          nativeCursor: current ? native.attachDockCursor(current)?.inspect() : null,
          displays: screen.getAllDisplays().map(({ id, bounds, workArea, scaleFactor }) => ({
            id,
            bounds,
            workArea,
            scaleFactor,
          })),
          calls: [...calls],
          history: [...history],
        };
      },
      async openFocusTarget() {
        const target = new BrowserWindow({
          x: 100,
          y: 160,
          width: 700,
          height: 500,
          title: 'Benign focus target',
          webPreferences: { contextIsolation: true, nodeIntegration: false },
        });
        await target.loadURL(
          'data:text/html,' +
            encodeURIComponent(
              '<!doctype html><title>Benign focus target</title><style>body{margin:0;font:16px system-ui}button{position:fixed;inset:0;width:100%;height:100%;background:#edf0f4}input{position:fixed;top:100px;left:40px;z-index:1}</style><button onclick="this.dataset.clicks=Number(this.dataset.clicks||0)+1" data-clicks="0">Click-through proof</button><input aria-label="Typing proof">',
            ),
        );
        return target.id;
      },
    };
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
