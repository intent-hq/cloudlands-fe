/** Native hit testing proof, using production CSS and synthetic machine titlebars. */
import { expect, type ElectronApplication } from '@playwright/test';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer as httpServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import tailwindcss from '@tailwindcss/postcss';
import autoprefixer from 'autoprefixer';
import { createServer } from 'vite';
import { closeElectronApp, electronTest as test } from './electron-app-close';

const run = promisify(execFile);
const kinds = ['explicit', 'inherited', 'before', 'after'] as const;
const pause = () => new Promise<void>((done) => setTimeout(done, 150));

function documentHtml(home: boolean) {
  return `<!doctype html><html class="dark"><head><link rel="stylesheet" href="/app.css">
  <style>
    body { margin: 0; background: hsl(var(--background)); color: hsl(var(--foreground)); }
    #app { padding: 16px 24px; font: 14px system-ui; }
    .row { position: absolute; left: 24px; display: flex; gap: 20px; }
    .source, button { width: 150px; height: 40px; position: relative; }
    button { background: hsl(var(--muted)); border-radius: 6px; -webkit-app-region: no-drag; }
    .source { background: hsl(var(--muted)); border-radius: 6px; text-align: center; padding-top: 10px; }
    .explicit, .inherit-parent { -webkit-app-region: drag; }
    .inherited { width: 100%; height: 100%; -webkit-app-region: inherit; }
    .before::before, .after::after { content: ''; position: absolute; inset: 0; -webkit-app-region: drag; }
    /* Deliberately restore ONLY the original drag contributions for the negative control.
       This is a forced-drag baseline, not a claim to load an old product revision. */
    :root[data-force-original-drag] .explicit,
    :root[data-force-original-drag] .inherit-parent { -webkit-app-region: drag !important; }
    :root[data-force-original-drag] .inherited { -webkit-app-region: inherit !important; }
    :root[data-force-original-drag] .before::before,
    :root[data-force-original-drag] .after::after { -webkit-app-region: drag !important; }
  </style></head><body><main id="app">
    <p>Native regression fixture · ${home ? 'Home' : 'Remote'} renderer</p>
    <div class="row" style="top:${home ? 60 : 160}px">
      <div class="source explicit">Explicit drag</div>
      <div class="source inherit-parent"><div class="inherited">Inherited drag</div></div>
      <div class="source before">Before drag</div><div class="source after">After drag</div>
    </div>
    <div class="row" style="top:${home ? 160 : 60}px">
      ${kinds.map((kind) => `<button id="${kind}">${kind} tab</button>`).join('')}
    </div>
    <button id="control" style="position:absolute;left:24px;top:260px">Input control</button>
    <p id="phase" style="position:absolute;left:24px;top:320px"></p>
  </main><script>
    window.events = []; window.identity = crypto.randomUUID();
    for (const type of ['pointerdown', 'mousedown', 'click']) {
      document.addEventListener(type, e => window.events.push({type, target:e.target.id, trusted:e.isTrusted}));
    }
  </script></body></html>`;
}

test('native machine rail drag regions stop swallowing foreground clicks', async ({
  launchElectron,
}, info) => {
  test.setTimeout(120_000);
  test.skip(
    !['linux', 'darwin'].includes(process.platform),
    'Native input supports Linux X11 and macOS only.',
  );
  test.skip(
    process.platform === 'linux' && !process.env.DISPLAY,
    'Linux native input requires an X11 DISPLAY (Xvfb is supported).',
  );
  const root = await mkdtemp(join(tmpdir(), 'intent-machine-drag-'));
  const evidence: Record<string, unknown> = { platform: process.platform, phases: [], inputs: [] };
  let app: ElectronApplication | undefined;
  let vite: Awaited<ReturnType<typeof createServer>> | undefined;
  const server = httpServer();
  try {
    const swiftPointer = join(root, 'pointer');
    if (process.platform === 'darwin') {
      await run(
        'xcrun',
        [
          'swiftc',
          resolve('test/fixtures/dock-placement-native/pointer.swift'),
          '-o',
          swiftPointer,
        ],
        { timeout: 60_000 },
      );
    }
    async function pointer(command: 'probe' | 'move' | 'down' | 'up', x = 0, y = 0) {
      const args = [command, String(Math.round(x)), String(Math.round(y))];
      if (process.platform === 'darwin') await run(swiftPointer, args, { timeout: 10_000 });
      else
        await run('python3', [resolve('test/fixtures/machine-rail-native-pointer.py'), ...args], {
          timeout: 10_000,
        });
      (evidence.inputs as unknown[]).push({ command, x, y });
    }
    // The Swift helper preflights event permission before parsing commands, with no prompt.
    // Use a harmless move at the current cursor position below on macOS.
    if (process.platform === 'linux') {
      try {
        await pointer('probe');
      } catch (error) {
        if ((error as { code?: number }).code === 77) test.skip(true, String(error));
        throw error;
      }
    }
    vite = await createServer({
      configFile: false,
      logLevel: 'error',
      cacheDir: join(root, 'vite-cache'),
      resolve: { alias: { $lib: resolve('src/lib') } },
      css: { postcss: { plugins: [tailwindcss, autoprefixer] } },
      server: { middlewareMode: true, watch: { ignored: ['**/*'] } },
      optimizeDeps: { noDiscovery: true, include: [] },
    });
    const css = await vite.transformRequest('/src/app.css?direct');
    if (!css) throw new Error('Vite did not compile production app.css');
    evidence.appCssSha256 = createHash('sha256')
      .update(await readFile(resolve('src/app.css')))
      .digest('hex');
    server.on('request', (req, res) => {
      res.setHeader('Content-Type', req.url === '/app.css' ? 'text/css' : 'text/html');
      res.end(req.url === '/app.css' ? css.code : documentHtml(req.url === '/home'));
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing fixture port');
    const url = `http://127.0.0.1:${address.port}`;
    await writeFile(
      join(root, 'main.cjs'),
      `
      const { app, BrowserWindow, WebContentsView } = require('electron');
      app.setPath('userData', ${JSON.stringify(join(root, 'profile'))});
      app.whenReady().then(async () => {
        const window = new BrowserWindow({ x:80, y:80, width:760, height:400, frame:false, useContentSize:true });
        const views = {};
        for (const name of ['home', 'remote']) {
          const view = new WebContentsView({ webPreferences: { sandbox:true, backgroundThrottling:false } });
          window.contentView.addChildView(view); view.setBounds({x:0,y:0,width:760,height:400});
          await view.webContents.loadURL(${JSON.stringify(url)} + '/' + name); views[name] = view;
        }
        globalThis.dragFixture = { window, views };
        window.show(); window.focus();
      });`,
    );
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) =>
          !key.startsWith('DD_') && !['NODE_OPTIONS', 'ELECTRON_RUN_AS_NODE'].includes(key),
      ),
    );
    app = await launchElectron({
      args: [
        join(root, 'main.cjs'),
        ...(process.platform === 'linux' ? ['--ozone-platform=x11'] : []),
      ],
      env: { ...env, DD_TRACE_ENABLED: 'false' },
    });
    await expect.poll(() => app!.evaluate(() => !!(globalThis as any).dragFixture)).toBe(true);
    if (process.platform === 'darwin') {
      const cursor = await app.evaluate(({ screen }) => screen.getCursorScreenPoint());
      try {
        await pointer('move', cursor.x, cursor.y);
      } catch (error) {
        if ((error as { code?: number }).code === 77)
          test.skip(
            true,
            'Native pointer requires existing macOS Accessibility permission; no prompt was opened.',
          );
        throw error;
      }
    }
    async function renderer(name: string, code: string) {
      return app!.evaluate(
        (_electron, { name, code }) =>
          (globalThis as any).dragFixture.views[name].webContents.executeJavaScript(code),
        { name, code },
      );
    }
    async function select(name: 'home' | 'remote', forceBaseline = false) {
      for (const other of ['home', 'remote']) {
        await renderer(
          other,
          `document.documentElement.toggleAttribute('data-machine-hidden', ${other !== name});
          document.documentElement.toggleAttribute('data-machine-page-hidden', ${other !== name});
          document.documentElement.toggleAttribute('data-force-original-drag', ${forceBaseline && other !== name});
          window.events = [];`,
        );
      }
      await app!.evaluate((_electron, name) => {
        const { window, views } = (globalThis as any).dragFixture;
        // Both views remain native-visible: this is the overlap during handoff.
        window.contentView.addChildView(views[name]);
        window.focus();
        views[name].webContents.focus();
      }, name);
      await pause(); // Chromium publishes changed drag rectangles asynchronously.
    }
    async function click(name: string, x: number, y: number) {
      await renderer(name, 'window.events = []');
      const point = await app!.evaluate(
        ({ screen }, { x, y }) => {
          const bounds = (globalThis as any).dragFixture.window.getContentBounds();
          const point = { x: bounds.x + x, y: bounds.y + y };
          return process.platform === 'darwin' ? point : screen.dipToScreenPoint(point);
        },
        { x, y },
      );
      await pointer('move', point.x, point.y);
      await pointer('down', point.x, point.y);
      try {
        await pause();
      } finally {
        await pointer('up', point.x, point.y);
      }
      await pause();
      return renderer(name, 'window.events');
    }
    async function capture(label: string, name: 'home' | 'remote') {
      const path = info.outputPath(`${label}.png`);
      const png = await app!.evaluate(async (_electron, name) => {
        const image = await (globalThis as any).dragFixture.views[name].webContents.capturePage();
        if (image.isEmpty()) throw new Error('Active machine renderer screenshot is empty');
        return image.toPNG().toString('base64');
      }, name);
      await writeFile(path, Buffer.from(png, 'base64'));
      await info.attach(`Native regression fixture: ${label}`, { path, contentType: 'image/png' });
    }
    async function phase(label: string, name: 'home' | 'remote', swallowed: boolean) {
      await renderer(
        name,
        `document.querySelector('#phase').textContent = ${JSON.stringify(label)}`,
      );
      const record: Record<string, unknown> = { label, views: {}, clicks: [] };
      (evidence.phases as unknown[]).push(record);
      for (const view of ['home', 'remote']) {
        (record.views as Record<string, unknown>)[view] = await renderer(
          view,
          `({
          identity:window.identity, hidden:document.documentElement.hasAttribute('data-machine-hidden'),
          regions: ['.explicit', '.inherited', '.before', '.after'].map((selector, i) =>
            getComputedStyle(document.querySelector(selector), i > 1 ? '::' + (i === 2 ? 'before' : 'after') : null).getPropertyValue('-webkit-app-region'))
        })`,
        );
      }
      const control = await click(name, 99, 280);
      expect(control).toContainEqual({ type: 'click', target: 'control', trusted: true });
      for (const [i, kind] of kinds.entries()) {
        const events = await click(name, 99 + i * 170, name === 'home' ? 180 : 80);
        (record.clicks as unknown[]).push({ kind, events });
        if (swallowed)
          expect(events, `${label}: ${kind} must be swallowed by native drag hit testing`).toEqual(
            [],
          );
        else
          for (const type of ['pointerdown', 'mousedown', 'click'])
            expect(events).toContainEqual({ type, target: kind, trusted: true });
      }
      await capture(label, name);
    }
    await select('remote', true);
    await phase('before-forced-original-drag-baseline', 'remote', true);
    await select('remote');
    await phase('after-production-hidden-reset', 'remote', false);
    await select('home');
    await phase('home-restored-outgoing-remote-hidden', 'home', false);
    // The selected home still owns native drag regions; the reset must not disable them.
    const restoredDragEvents: Array<{ kind: (typeof kinds)[number]; events: unknown }> = [];
    evidence.restoredHomeDragEvents = restoredDragEvents;
    for (let i = 0; i < kinds.length; i++) {
      const events = await click('home', 99 + i * 170, 80);
      restoredDragEvents.push({ kind: kinds[i], events });
      expect(events, `restored home ${kinds[i]} still contributes native drag`).toEqual([]);
    }
    await select('remote');
    await phase('remote-selected-again', 'remote', false);
  } finally {
    try {
      const path = info.outputPath('native-machine-drag-evidence.json');
      await writeFile(path, JSON.stringify(evidence, null, 2));
      await info.attach('Native machine drag event evidence', {
        path,
        contentType: 'application/json',
      });
    } finally {
      if (app) await closeElectronApp(app);
      await vite?.close();
      if (server.listening)
        await new Promise<void>((done, reject) =>
          server.close((error) => (error ? reject(error) : done())),
        );
      await rm(root, { recursive: true, force: true });
    }
  }
});
