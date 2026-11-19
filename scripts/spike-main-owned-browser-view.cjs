// Spike probe: main-owned browser views (WebContentsView) for full-screen tab windows.
// Not product code: no app module imports it, and the packaged app does not contain it.
// Linux (needs xvfb-run and ImageMagick `import` for the composited screenshots):
//   SPIKE_OUT=/tmp/spike-out xvfb-run -a -s "-screen 0 1920x1080x24" \
//     "$(node -e "console.log(require('electron'))")" --no-sandbox scripts/spike-main-owned-browser-view.cjs
// It prints one JSON line (SPIKE_REPORT) and writes report.json and PNG evidence to SPIKE_OUT.
// Items: (1) reparent with no reload, (2) CDP stays attached, (3) a detached view runs JS
// and gives screenshots (Electron 44 has no incrementCapturerCount; the probe tests
// capturePage's { stayHidden } option and backgroundThrottling instead), (4) overlay snapshot swap,
// (5) what happens to a child view when its window closes.
'use strict';
const { app, BrowserWindow, WebContentsView, nativeImage, session } = require('electron');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

const OUT = process.env.SPIKE_OUT || path.join(process.cwd(), 'spike-out');
fs.mkdirSync(OUT, { recursive: true });
const PARTITION = 'persist:spike-browser-panel';
const SLOT = { x: 100, y: 80, width: 640, height: 400 };
const MENU = { x: 560, y: 140, width: 260, height: 160 };
const PAGE_COLOR = [0x33, 0x66, 0xcc];
const MENU_COLOR = [0xff, 0x00, 0xff];
const report = {
  electron: process.versions.electron,
  chrome: process.versions.chrome,
  platform: process.platform,
  items: {},
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hex = (rgb) => '#' + rgb.map((n) => n.toString(16).padStart(2, '0')).join('');

let pageHits = 0;
const PAGE_HTML = `<!doctype html><html><head><title>spike page</title><style>
html,body{margin:0;height:100%;background:${hex(PAGE_COLOR)}}#n{font:24px sans-serif;color:#fff;padding:12px}
</style></head><body><div id="n">page</div><input id="draft" value="">
<script>
window.__boot = Math.random().toString(36).slice(2);
window.__ticks = 0; window.__raf = 0;
setInterval(() => { window.__ticks++; }, 50);
(function f(){ window.__raf++; requestAnimationFrame(f); })();
window.setColor = (c) => { document.body.style.background = c; document.documentElement.style.background = c; };
</script></body></html>`;

const MACHINE_HTML = `<!doctype html><html><head><style>
html,body{margin:0;height:100%;background:#202020;overflow:hidden}
#slot{position:absolute;left:${SLOT.x}px;top:${SLOT.y}px;width:${SLOT.width}px;height:${SLOT.height}px;background:#000}
#slot img{width:100%;height:100%;display:block}
#menu{position:absolute;left:${MENU.x}px;top:${MENU.y}px;width:${MENU.width}px;height:${MENU.height}px;background:${hex(MENU_COLOR)};display:none;z-index:10}
</style></head><body><div id="slot"></div><div id="menu"></div><script>
const raf2 = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
window.showSnapshot = async (url) => { const img = new Image(); img.src = url; await img.decode(); const s = document.getElementById('slot'); s.replaceChildren(img); await raf2(); return true; };
window.clearSnapshot = async () => { document.getElementById('slot').replaceChildren(); await raf2(); return true; };
window.setMenu = async (open) => { document.getElementById('menu').style.display = open ? 'block' : 'none'; await raf2(); return true; };
</script></body></html>`;

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.url.startsWith('/page')) {
        pageHits++;
        res.setHeader('content-type', 'text/html');
        res.end(PAGE_HTML);
        return;
      }
      if (req.url.startsWith('/machine')) {
        res.setHeader('content-type', 'text/html');
        res.end(MACHINE_HTML);
        return;
      }
      res.statusCode = 404;
      res.end();
    });
    server.listen(0, '127.0.0.1', () =>
      resolve({ server, base: `http://127.0.0.1:${server.address().port}` }),
    );
  });
}

function withTimeout(p, ms, label) {
  return Promise.race([
    p,
    sleep(ms).then(() => {
      throw new Error(`timeout: ${label} after ${ms}ms`);
    }),
  ]);
}

async function makeFrame(base, x, title) {
  const win = new BrowserWindow({
    x,
    y: 0,
    width: 900,
    height: 600,
    useContentSize: true,
    show: true,
    title,
    backgroundColor: '#202020',
  });
  const machine = new WebContentsView({
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  win.contentView.addChildView(machine);
  machine.setBounds({ x: 0, y: 0, width: 900, height: 600 });
  await machine.webContents.loadURL(`${base}/machine`);
  return { win, machine };
}

function makeBrowserView() {
  // Mirrors webview-security.ts for a guest: browser-panel session, no preload,
  // context isolation, sandbox, no node.
  const view = new WebContentsView({
    webPreferences: {
      partition: PARTITION,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });
  view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  return view;
}

const evalPage = (wc, js) => wc.executeJavaScript(js, true);
async function cdp(wc, method, params = {}) {
  return wc.debugger.sendCommand(method, params);
}
function pixelAt(img, x, y) {
  const { width, height } = img.getSize();
  if (x >= width || y >= height) return [-1, -1, -1];
  const bmp = img.toBitmap(); // BGRA
  const i = (y * width + x) * 4;
  return [bmp[i + 2], bmp[i + 1], bmp[i]];
}
const near = (a, b, tol = 8) => a.every((v, i) => Math.abs(v - b[i]) <= tol);

async function screenRoot(name) {
  const file = path.join(OUT, name);
  await new Promise((resolve, reject) =>
    execFile('import', ['-window', 'root', file], (e) => (e ? reject(e) : resolve())),
  );
  return nativeImage.createFromPath(file);
}

async function rates(wc, ms) {
  const a = await evalPage(wc, '({t: window.__ticks, r: window.__raf})');
  await sleep(ms);
  const b = await evalPage(wc, '({t: window.__ticks, r: window.__raf})');
  return {
    intervalTicksPerSec: Math.round(((b.t - a.t) * 1000) / ms),
    rafPerSec: Math.round(((b.r - a.r) * 1000) / ms),
  };
}

async function capture(view, label, opts) {
  const t0 = Date.now();
  try {
    const img = await withTimeout(view.webContents.capturePage(undefined, opts), 3000, label);
    const { width, height } = img.getSize();
    return { ok: !img.isEmpty() && width > 0, width, height, ms: Date.now() - t0, img };
  } catch (e) {
    return { ok: false, error: String(e.message || e), ms: Date.now() - t0 };
  }
}

async function cdpShot(view, label) {
  const t0 = Date.now();
  try {
    const r = await withTimeout(
      cdp(view.webContents, 'Page.captureScreenshot', { format: 'png' }),
      3000,
      label,
    );
    const img = nativeImage.createFromBuffer(Buffer.from(r.data, 'base64'));
    const { width, height } = img.getSize();
    return { ok: width > 0, width, height, ms: Date.now() - t0, img };
  } catch (e) {
    return { ok: false, error: String(e.message || e), ms: Date.now() - t0 };
  }
}
const strip = ({ img: _img, ...rest }) => rest;

async function main() {
  const { server, base } = await startServer();
  const A = await makeFrame(base, 0, 'Main window');
  const B = await makeFrame(base, 920, 'Tab window');
  const view = makeBrowserView();
  const wc = view.webContents;
  let startLoads = 0;
  let gone = 0;
  wc.on('did-start-loading', () => startLoads++);
  wc.on('render-process-gone', () => gone++);
  A.win.contentView.addChildView(view);
  view.setBounds(SLOT);
  await wc.loadURL(`${base}/page`);
  await evalPage(wc, "document.getElementById('draft').value = 'unsaved draft'");
  wc.debugger.attach('1.3');
  await cdp(wc, 'Runtime.enable');
  const consoleSeen = [];
  wc.debugger.on('message', (_e, method, params) => {
    if (method === 'Runtime.consoleAPICalled') consoleSeen.push(params.args?.[0]?.value);
  });
  await sleep(500);

  // (1) Reparent with no reload.
  const before = {
    id: wc.id,
    boot: await evalPage(wc, 'window.__boot'),
    hits: pageHits,
    startLoads,
    pid: wc.getOSProcessId(),
  };
  const t0 = Date.now();
  A.win.contentView.removeChildView(view);
  B.win.contentView.addChildView(view);
  view.setBounds(SLOT);
  const reparentMs = Date.now() - t0;
  await sleep(500);
  const after = {
    id: wc.id,
    boot: await evalPage(wc, 'window.__boot'),
    hits: pageHits,
    startLoads,
    pid: wc.getOSProcessId(),
    draft: await evalPage(wc, "document.getElementById('draft').value"),
  };
  const shotInB = await capture(view, 'capture in B');
  if (shotInB.img) fs.writeFileSync(path.join(OUT, '1-after-reparent.png'), shotInB.img.toPNG());
  const ratesInB = await rates(wc, 1000);
  report.items.reparentNoReload = {
    pass:
      before.id === after.id &&
      before.boot === after.boot &&
      before.hits === after.hits &&
      before.startLoads === after.startLoads &&
      after.draft === 'unsaved draft' &&
      gone === 0 &&
      shotInB.ok &&
      near(pixelAt(shotInB.img, 320, 300), PAGE_COLOR),
    before,
    after,
    reparentMs,
    renderProcessGone: gone,
    captureAfterMove: strip(shotInB),
    ratesInB,
  };

  // (2) CDP stays attached across the move (and a move back).
  await evalPage(wc, "console.log('ping-from-B')");
  B.win.contentView.removeChildView(view);
  A.win.contentView.addChildView(view);
  view.setBounds(SLOT);
  await sleep(200);
  await evalPage(wc, "console.log('ping-from-A')");
  const evalRes = await cdp(wc, 'Runtime.evaluate', { expression: '6*7', returnByValue: true });
  const cdpShotA = await cdpShot(view, 'cdp shot in A');
  await sleep(200);
  report.items.cdpStaysAttached = {
    pass:
      wc.debugger.isAttached() &&
      evalRes.result.value === 42 &&
      consoleSeen.includes('ping-from-B') &&
      consoleSeen.includes('ping-from-A') &&
      cdpShotA.ok,
    isAttached: wc.debugger.isAttached(),
    evaluate: evalRes.result.value,
    consoleEventsAfterMoves: consoleSeen,
    cdpScreenshot: strip(cdpShotA),
  };

  // (3) Detached view: JS, CDP, screenshots; then incrementCapturerCount.
  A.win.contentView.removeChildView(view);
  await sleep(1500);
  const detached = {};
  detached.ratesNoHold = await rates(wc, 2000);
  detached.cdpEvaluateNoHold = (
    await withTimeout(
      cdp(wc, 'Runtime.evaluate', { expression: '1+1', returnByValue: true }),
      3000,
      'eval',
    ).catch((e) => ({ result: { value: String(e.message) } }))
  ).result.value;
  await evalPage(wc, "setColor('#00ff00')");
  detached.capturePageNoHold = strip(await capture(view, 'capture detached no hold'));
  const noHoldCdp = await cdpShot(view, 'cdp detached no hold');
  detached.cdpShotNoHold = strip(noHoldCdp);
  if (noHoldCdp.img)
    detached.cdpShotNoHold.centerIsNewColor = near(pixelAt(noHoldCdp.img, 50, 50), [0, 255, 0]);
  detached.hasIncrementCapturerCount = typeof wc.incrementCapturerCount === 'function';
  const hidden = await capture(view, 'capture detached stayHidden', { stayHidden: true });
  detached.capturePageStayHidden = strip(hidden);
  if (hidden.img)
    detached.capturePageStayHidden.showsNewColor = near(pixelAt(hidden.img, 50, 50), [0, 255, 0]);
  wc.backgroundThrottling = false;
  await sleep(300);
  detached.ratesThrottlingOff = await rates(wc, 2000);
  await evalPage(wc, "setColor('#ff8800')");
  await sleep(100);
  const held = await capture(view, 'capture detached throttling off', { stayHidden: true });
  detached.capturePageThrottlingOff = strip(held);
  if (held.img) {
    detached.capturePageThrottlingOff.showsNewColor = near(
      pixelAt(held.img, 50, 50),
      [0xff, 0x88, 0x00],
    );
    fs.writeFileSync(path.join(OUT, '3-detached-capture.png'), held.img.toPNG());
  }
  const heldCdp = await cdpShot(view, 'cdp detached throttling off');
  detached.cdpShotThrottlingOff = strip(heldCdp);
  if (heldCdp.img)
    detached.cdpShotThrottlingOff.showsNewColor = near(
      pixelAt(heldCdp.img, 50, 50),
      [0xff, 0x88, 0x00],
    );
  wc.backgroundThrottling = true;
  await sleep(300);
  // Fallback the design names: park the view in a window at an off-screen rect.
  A.win.contentView.addChildView(view, 0);
  view.setBounds({ x: -SLOT.width - 10, y: 0, width: SLOT.width, height: SLOT.height });
  await sleep(300);
  detached.parkedOffscreen = { rates: await rates(wc, 2000) };
  await evalPage(wc, "setColor('#8800ff')");
  await sleep(100);
  const parked = await capture(view, 'capture parked');
  detached.parkedOffscreen.capturePage = strip(parked);
  if (parked.img)
    detached.parkedOffscreen.capturePage.showsNewColor = near(
      pixelAt(parked.img, 50, 50),
      [0x88, 0x00, 0xff],
    );
  const parkedCdp = await cdpShot(view, 'cdp parked');
  detached.parkedOffscreen.cdpShot = strip(parkedCdp);
  if (parkedCdp.img)
    detached.parkedOffscreen.cdpShot.showsNewColor = near(
      pixelAt(parkedCdp.img, 50, 50),
      [0x88, 0x00, 0xff],
    );
  A.win.contentView.removeChildView(view);
  report.items.detachedView = {
    pass:
      detached.ratesNoHold.intervalTicksPerSec > 0 &&
      detached.cdpEvaluateNoHold === 2 &&
      !!detached.capturePageThrottlingOff.showsNewColor &&
      !!detached.cdpShotThrottlingOff.showsNewColor,
    ...detached,
  };

  // (3b) Where can a hidden view live and still paint for agents? Each variant uses a fresh
  // view with background throttling off (as the CDP service does for capture holds today).
  const parkingWin = new BrowserWindow({
    x: 0,
    y: 0,
    width: 900,
    height: 600,
    show: false,
    paintWhenInitiallyHidden: true,
    webPreferences: { backgroundThrottling: false },
  });
  const variants = {
    detached: () => {},
    offscreenRectInMainWindow: (v) => {
      A.win.contentView.addChildView(v, 0);
      v.setBounds({ x: -SLOT.width - 10, y: 0, width: SLOT.width, height: SLOT.height });
    },
    underMachineViewInMainWindow: (v) => {
      A.win.contentView.addChildView(v, 0);
      v.setBounds(SLOT);
    },
    onePixelInMainWindow: (v) => {
      A.win.contentView.addChildView(v, 0);
      v.setBounds({ x: 0, y: 0, width: 1, height: 1 });
    },
    hiddenParkingWindow: (v) => {
      parkingWin.contentView.addChildView(v);
      v.setBounds(SLOT);
    },
  };
  const hosting = {};
  for (const [name, park] of Object.entries(variants)) {
    const v = makeBrowserView();
    await v.webContents.loadURL(`${base}/page`);
    v.webContents.backgroundThrottling = false;
    v.webContents.debugger.attach('1.3');
    park(v);
    await sleep(800);
    const r = { rates: await rates(v.webContents, 1500) };
    await evalPage(v.webContents, "setColor('#ff8800')");
    await sleep(150);
    const c = await capture(v, name + ' capture', { stayHidden: true });
    r.capturePage = strip(c);
    if (c.img) r.capturePage.showsNewColor = near(pixelAt(c.img, 50, 50), [0xff, 0x88, 0x00]);
    const d = await cdpShot(v, name + ' cdp');
    r.cdpShot = strip(d);
    if (d.img) r.cdpShot.showsNewColor = near(pixelAt(d.img, 50, 50), [0xff, 0x88, 0x00]);
    if (name === 'underMachineViewInMainWindow') {
      const scr = await screenRoot('3b-under-machine-view.png');
      const cb0 = A.win.getContentBounds();
      r.coveredByMachineView = !near(
        pixelAt(scr, cb0.x + SLOT.x + 40, cb0.y + SLOT.y + 200),
        [0xff, 0x88, 0x00],
      );
    }
    r.pass = !!(r.capturePage.showsNewColor && r.cdpShot.showsNewColor && r.rates.rafPerSec > 0);
    hosting[name] = r;
    if (v.webContents.debugger.isAttached()) v.webContents.debugger.detach();
    for (const w of [A.win, parkingWin]) w.contentView.removeChildView(v);
    v.webContents.close();
  }
  parkingWin.destroy();
  report.items.offscreenHostingVariants = {
    pass: Object.values(hosting).some((h) => h.pass),
    ...hosting,
  };

  // (4) Overlay snapshot swap.
  await evalPage(wc, `setColor('${hex(PAGE_COLOR)}')`);
  A.win.contentView.addChildView(view);
  view.setBounds(SLOT);
  await sleep(400);
  const cb = A.win.getContentBounds();
  const at = (img, x, y) => pixelAt(img, cb.x + x, cb.y + y);
  const inMenuAndSlot = [MENU.x + 20, MENU.y + 20];
  const inSlotOnly = [SLOT.x + 40, SLOT.y + 200];
  const inMenuOnly = [MENU.x + MENU.width - 20, MENU.y + 20];
  await evalPage(A.machine.webContents, 'setMenu(true)');
  await sleep(200);
  const problem = await screenRoot('4a-menu-hidden-behind-page.png');
  const overlay = { windowContentBounds: cb };
  overlay.withoutSwap = {
    menuOverSlotPixel: at(problem, ...inMenuAndSlot),
    menuHiddenByPage: near(at(problem, ...inMenuAndSlot), PAGE_COLOR),
    menuOutsideSlotVisible: near(at(problem, ...inMenuOnly), MENU_COLOR),
  };
  await evalPage(A.machine.webContents, 'setMenu(false)');
  const s0 = Date.now();
  const snap = await wc.capturePage();
  const s1 = Date.now();
  await evalPage(A.machine.webContents, `showSnapshot(${JSON.stringify(snap.toDataURL())})`);
  const s2 = Date.now();
  view.setVisible(false);
  await evalPage(A.machine.webContents, 'setMenu(true)');
  const s3 = Date.now();
  await sleep(150);
  const swapped = await screenRoot('4b-menu-over-snapshot.png');
  overlay.withSwap = {
    menuOverSlotPixel: at(swapped, ...inMenuAndSlot),
    menuVisible: near(at(swapped, ...inMenuAndSlot), MENU_COLOR),
    slotShowsPageImage: near(at(swapped, ...inSlotOnly), PAGE_COLOR),
    timingsMs: {
      capturePage: s1 - s0,
      decodeAndPaint: s2 - s1,
      hideAndOpenMenu: s3 - s2,
      totalToMenuOpen: s3 - s0,
    },
  };
  await evalPage(A.machine.webContents, 'setMenu(false)');
  view.setVisible(true);
  await sleep(50);
  await evalPage(A.machine.webContents, 'clearSnapshot()');
  await evalPage(wc, "setColor('#00ccaa')");
  await sleep(200);
  const restored = await screenRoot('4c-restored-live.png');
  overlay.restore = {
    slotShowsLivePage: near(at(restored, ...inSlotOnly), [0x00, 0xcc, 0xaa]),
    boot: await evalPage(wc, 'window.__boot'),
    sameDocument: (await evalPage(wc, 'window.__boot')) === before.boot,
  };
  report.items.overlaySnapshotSwap = {
    pass:
      overlay.withoutSwap.menuHiddenByPage &&
      overlay.withSwap.menuVisible &&
      overlay.withSwap.slotShowsPageImage &&
      overlay.restore.slotShowsLivePage &&
      overlay.restore.sameDocument,
    ...overlay,
  };

  // (5) Window close: is a child view's webContents destroyed? Can main rescue it in 'close'?
  const C = await makeFrame(base, 0, 'Doomed window');
  const v1 = makeBrowserView();
  await v1.webContents.loadURL(`${base}/page`);
  C.win.contentView.addChildView(v1);
  const D = await makeFrame(base, 0, 'Rescue window');
  const v2 = makeBrowserView();
  await v2.webContents.loadURL(`${base}/page`);
  D.win.contentView.addChildView(v2);
  D.win.on('close', () => {
    D.win.contentView.removeChildView(v2);
    A.win.contentView.addChildView(v2);
  });
  const v2boot = await evalPage(v2.webContents, 'window.__boot');
  C.win.close();
  D.win.close();
  await sleep(800);
  const v2alive = !v2.webContents.isDestroyed();
  report.items.windowClose = {
    pass: v2alive && (await evalPage(v2.webContents, 'window.__boot')) === v2boot,
    unrescuedViewDestroyed: v1.webContents.isDestroyed(),
    rescuedInCloseHandlerAlive: v2alive,
  };
  if (v2alive) {
    A.win.contentView.removeChildView(v2);
    v2.webContents.close();
  }
  if (!v1.webContents.isDestroyed()) v1.webContents.close();

  report.summary = Object.fromEntries(
    Object.entries(report.items).map(([k, v]) => [k, v.pass ? 'GO' : 'NO-GO']),
  );
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log('SPIKE_REPORT ' + JSON.stringify(report));
  wc.debugger.detach();
  server.close();
  app.exit(0);
}

app.commandLine.appendSwitch('force-device-scale-factor', '1');
app
  .whenReady()
  .then(() => {
    session.fromPartition(PARTITION);
    return main();
  })
  .catch((e) => {
    console.error('SPIKE_ERROR', e && e.stack ? e.stack : e);
    app.exit(1);
  });
