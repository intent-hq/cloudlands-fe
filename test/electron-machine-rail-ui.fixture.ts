/** Real Electron routing proof. Synthetic documents, production ownership and zoom code. */
import { expect, type ElectronApplication } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'vite';
import { RELEASE_NOTES_CHANNELS as NOTES } from '../src/features/release-notes/types';
import { closeElectronApp, electronTest as test } from './electron-app-close';

const rendererNames = ['home', 'remote', 'peer', 'peerRemote'] as const;
type RendererName = (typeof rendererNames)[number];
type RendererState = {
  open: boolean;
  events: Array<{ channel: string; payload: any }>;
  identity: string;
  draft: string;
};

// This page is deliberately a diagnostic display, not a replica of the app UI.
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  body { margin:0; padding:32px; color:#eee; background:#18181b; font:14px system-ui; }
  h1 { font-size:20px; font-weight:500; } input { font:inherit; padding:8px; }
  article { margin-top:24px; padding:24px; border-radius:12px; background:#27272a; }
  [hidden] { display:none; } pre { white-space:pre-wrap; overflow-wrap:anywhere; }
</style></head><body><h1></h1><p>Electron routing fixture · synthetic content</p>
<input aria-label="Preserved draft" value="Unsent device draft"><article hidden><h2>Release notes</h2><p id="notes"></p></article>
<pre id="events"></pre><script>
  const { ipcRenderer } = require('electron');
  window.state = {open:false, events:[], identity:crypto.randomUUID(), draft:''};
  document.querySelector('h1').textContent = location.pathname.slice(1);
  for (const channel of ['release-notes:show','release-notes:close','window:zoom-changed']) {
    ipcRenderer.on(channel, (_event,payload) => {
      window.state.events.push({channel,payload});
      if (channel === 'release-notes:show') {
        window.state.open = true;
        document.querySelector('#notes').textContent = payload.notes?.notes ?? 'Manual opening';
      }
      if (channel === 'release-notes:close') window.state.open = false;
      document.querySelector('article').hidden = !window.state.open;
      document.querySelector('#events').textContent = JSON.stringify(window.state.events,null,2);
    });
  }
  window.invoke = (channel) => ipcRenderer.invoke(channel);
  window.readState = () => ({...window.state, draft:document.querySelector('input').value});
</script></body></html>`;

test('device rail native release notes and menu zoom use the shown renderer', async ({
  launchElectron,
}, info) => {
  test.setTimeout(90_000);
  const root = await mkdtemp(join(tmpdir(), 'intent-rail-routing-'));
  const evidence: Record<string, unknown> = {
    boundary:
      'Real BrowserWindows as frames (backdrop page plus one view per machine), WebContentsViews, IPC transport, production window-backend and frames registry, release-notes IPC/validation and menu-zoom. Synthetic documents/fetch, app-window enumeration and browser-panel-focus seam. Does not exercise product components, rail transitions, system IPC or native focus fanout.',
    phases: [],
  };
  const server = createServer((_req, response) => {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(html);
  });
  let application: ElectronApplication | undefined;
  try {
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Fixture server has no port');
    const url = `http://127.0.0.1:${address.port}`;
    const entry = join(root, 'entry.ts');
    await writeFile(
      entry,
      [
        `export * from ${JSON.stringify(resolve('src/main/window-backend.ts'))};`,
        `export * from ${JSON.stringify(resolve('src/main/menu-zoom.ts'))};`,
        `export * from ${JSON.stringify(resolve('src/features/release-notes/main/release-notes.ipc.ts'))};`,
      ].join('\n'),
    );
    await build({
      configFile: false,
      logLevel: 'error',
      ssr: { noExternal: true },
      plugins: [
        {
          name: 'rail-routing-external-services',
          enforce: 'pre',
          resolveId(id) {
            if (id.endsWith('/shared/logger')) return '\0rail-logger';
            if (id.endsWith('/ipc-debug-tracker')) return '\0rail-debug';
            if (id === './release-notes.service') return '\0rail-notes-service';
            if (id.endsWith('/offscreen-window')) return '\0rail-app-windows';
            if (id === '../features/system/main/system.ipc') return '\0rail-browser-focus';
          },
          load(id) {
            if (id === '\0rail-logger')
              return 'export class Logger { info(){} debug(){} warn(){} error(){} }';
            if (id === '\0rail-debug')
              return 'export const ipcDebugTracker = {trackCall(){},trackSuccess(){},trackValidationError(){}};';
            if (id === '\0rail-notes-service')
              return `
            const notes = {version:'0.0.0-fixture',notes:'Synthetic release notes for routing evidence.',url:'https://example.invalid/fixture'};
            export async function checkForReleaseNotesOnStartup(callback){callback(notes);}
            export async function getCurrentReleaseNotes(){return notes;}`;
            if (id === '\0rail-app-windows')
              return `import {BrowserWindow} from 'electron'; export function getAppWindows(){return BrowserWindow.getAllWindows();}`;
            if (id === '\0rail-browser-focus')
              return 'export function isFocusedWindowBrowserActive(){return globalThis.railBrowserFocused === true;}';
          },
        },
      ],
      build: {
        ssr: entry,
        outDir: root,
        emptyOutDir: false,
        minify: false,
        rollupOptions: {
          external: ['electron'],
          output: { format: 'cjs', entryFileNames: 'routing.cjs' },
        },
      },
    });
    await writeFile(
      join(root, 'main.cjs'),
      `
      const {app,BrowserWindow,WebContentsView}=require('electron');
      app.setPath('userData', ${JSON.stringify(join(root, 'profile'))});
      app.whenReady().then(async()=>{
        const api=require('./routing.cjs');
        api.setupReleaseNotesIPC();
        const preferences={nodeIntegration:true,contextIsolation:false,sandbox:false,backgroundThrottling:false};
        // Each window is a frame: its own page is the backdrop (bound to no
        // machine) and both of its machines are views inside it.
        const windows={},contents={},views={},framePages={};
        for(const [home,child] of [['home','remote'],['peer','peerRemote']]){
          const window=new BrowserWindow({width:760,height:600,show:false,webPreferences:preferences});
          windows[home]=window; framePages[home]=window.webContents;
          api.markFrameWindow(window);
          await window.loadURL(${JSON.stringify(url)}+'/frame-'+home);
          for(const id of [home,child]){
            const view=new WebContentsView({webPreferences:preferences});
            api.bindMachineViewToBackend(window,view.webContents,id);
            window.contentView.addChildView(view); view.setBounds({x:0,y:0,width:760,height:600});
            await view.webContents.loadURL(${JSON.stringify(url)}+'/'+id);
            contents[id]=view.webContents; views[id]=view;
          }
          windows[child]=views[child];
          api.setShownMachineView(window,views[child].webContents);
        }
        globalThis.railFixture={api,windows,contents,views,framePages};
        windows.home.show(); windows.home.focus(); contents.remote.focus();
      }).catch(error=>{globalThis.railStartupError=String(error.stack||error);});
    `,
    );
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) =>
          !key.startsWith('DD_') && !['NODE_OPTIONS', 'ELECTRON_RUN_AS_NODE'].includes(key),
      ),
    );
    application = await launchElectron({
      args: [join(root, 'main.cjs')],
      env: { ...env, DD_TRACE_ENABLED: 'false' },
    });
    await expect
      .poll(() =>
        application!.evaluate(
          () =>
            (globalThis as any).railStartupError ??
            ((globalThis as any).railFixture ? 'ready' : 'starting'),
        ),
      )
      .toBe('ready');
    async function renderer<T>(name: RendererName, code: string): Promise<T> {
      return application!.evaluate(
        (_electron, { name, code }) =>
          (globalThis as any).railFixture.contents[name].executeJavaScript(code),
        { name, code },
      );
    }
    const state = (name: RendererName) => renderer<RendererState>(name, 'window.readState()');
    const invoke = (name: RendererName, channel: string) =>
      renderer<any>(name, `window.invoke(${JSON.stringify(channel)})`);
    async function capture(label: string) {
      const phase: Record<string, unknown> = { label, renderers: {} };
      (evidence.phases as unknown[]).push(phase);
      for (const name of rendererNames) {
        (phase.renderers as Record<string, unknown>)[name] = await state(name);
        const png = await application!.evaluate(async (_electron, name) => {
          const contents = (globalThis as any).railFixture.contents[name];
          const image = await contents.capturePage();
          if (image.isEmpty()) throw new Error('Empty renderer capture: ' + name);
          return image.toPNG().toString('base64');
        }, name);
        const path = info.outputPath(`${label}-${name}.png`);
        await writeFile(path, Buffer.from(png, 'base64'));
        await info.attach(`${label}: ${name}`, { path, contentType: 'image/png' });
      }
    }
    async function opens(expected: RendererName[]) {
      for (const name of rendererNames)
        await expect.poll(async () => (await state(name)).open).toBe(expected.includes(name));
    }
    await expect
      .poll(() =>
        application!.evaluate(
          ({ BrowserWindow }) =>
            BrowserWindow.getFocusedWindow()?.id ===
            (globalThis as any).railFixture.windows.home.id,
        ),
      )
      .toBe(true);
    const original = Object.fromEntries(
      await Promise.all(rendererNames.map(async (name) => [name, await state(name)])),
    );
    await capture('before-startup');
    await application.evaluate(async () => {
      await (globalThis as any).railFixture.api.initializeReleaseNotesOnStartup();
    });
    await opens(['remote']);
    await capture('startup-single-child-owner');
    expect(await invoke('home', NOTES.GET_PENDING)).toEqual({ success: true, data: null });
    expect(await invoke('peerRemote', NOTES.GET_PENDING)).toEqual({ success: true, data: null });
    const pending = await invoke('remote', NOTES.GET_PENDING);
    expect(pending).toMatchObject({ success: true, data: { version: '0.0.0-fixture' } });
    expect(await invoke('remote', NOTES.GET_PENDING)).toEqual({ success: true, data: null });
    evidence.startupClaim = pending;
    // Switch through the production ownership helper. This does not claim rail transition coverage.
    await application.evaluate(() => {
      const { api, windows } = (globalThis as any).railFixture;
      const { views } = (globalThis as any).railFixture;
      windows.remote.setVisible(false);
      api.setShownMachineView(windows.home, views.home.webContents);
      api.sendShowReleaseNotes(windows.home, { notes: null });
    });
    await opens(['home']);
    await capture('help-on-home-closes-child');
    await application.evaluate(() => {
      const { api, windows, contents } = (globalThis as any).railFixture;
      windows.remote.setVisible(true);
      api.setShownMachineView(windows.home, contents.remote);
      api.sendShowReleaseNotes(windows.home, { notes: null });
    });
    await opens(['remote']);
    await capture('help-on-child-closes-home');
    const manual = await invoke('remote', NOTES.GET);
    expect(manual).toMatchObject({ success: true, data: { version: '0.0.0-fixture' } });
    expect(await invoke('remote', NOTES.DISMISS)).toEqual({ success: true });
    await opens([]);
    // Once a user has interacted, a delayed startup result must not reopen notes.
    await application.evaluate(async () => {
      await (globalThis as any).railFixture.api.initializeReleaseNotesOnStartup();
    });
    expect(await invoke('remote', NOTES.GET_PENDING)).toEqual({ success: true, data: null });
    await opens([]);
    const beforeZoom = await application.evaluate(() =>
      (globalThis as any).railFixture.contents.remote.getZoomLevel(),
    );
    await application.evaluate(() => {
      const fixture = (globalThis as any).railFixture;
      fixture.api.handleMenuZoom('menu:zoom-in', () => {
        throw new Error('Unexpected browser zoom routing');
      });
    });
    expect(
      await application.evaluate(() =>
        (globalThis as any).railFixture.contents.remote.getZoomLevel(),
      ),
    ).toBeCloseTo(beforeZoom + 0.5);
    const zoomEvidence: unknown[] = [];
    for (const name of rendererNames) {
      await expect
        .poll(
          async () =>
            (await state(name)).events.filter((event) => event.channel === 'window:zoom-changed')
              .length,
        )
        .toBeGreaterThan(0);
      const actual = await application.evaluate(
        (_electron, name) => (globalThis as any).railFixture.contents[name].getZoomFactor(),
        name,
      );
      const event = (await state(name)).events
        .filter((event) => event.channel === 'window:zoom-changed')
        .at(-1)!;
      expect(event.payload.zoomFactor).toBeCloseTo(actual);
      zoomEvidence.push({ name, actual, published: event.payload.zoomFactor });
    }
    evidence.zoom = zoomEvidence;
    await capture('after-child-menu-zoom');
    await application.evaluate(() => {
      const fixture = (globalThis as any).railFixture;
      fixture.api.handleMenuZoom('menu:reset-zoom', () => {
        throw new Error('Unexpected browser zoom routing');
      });
    });
    expect(
      await application.evaluate(() =>
        (globalThis as any).railFixture.contents.remote.getZoomLevel(),
      ),
    ).toBe(0);
    const delegated = await application.evaluate(() => {
      const fixture = (globalThis as any).railFixture;
      (globalThis as any).railBrowserFocused = true;
      const commands: string[] = [];
      fixture.api.handleMenuZoom('menu:zoom-out', (command: string) => commands.push(command));
      return { commands, level: fixture.contents.remote.getZoomLevel() };
    });
    expect(delegated).toEqual({ commands: ['menu:zoom-out'], level: 0 });
    evidence.browserDelegation = delegated;
    for (const name of rendererNames) {
      const after = await state(name);
      expect(after.identity).toBe(original[name].identity);
      expect(after.draft).toBe(original[name].draft);
    }
    // A frame page paints the backdrop only: no app message ever reaches it.
    for (const frame of ['home', 'peer']) {
      const events = await application.evaluate(
        (_electron, frame) =>
          (globalThis as any).railFixture.framePages[frame].executeJavaScript(
            'window.readState().events',
          ),
        frame,
      );
      expect(events).toEqual([]);
    }
    evidence.result = 'passed';
  } finally {
    try {
      const path = info.outputPath('machine-rail-native-routing.json');
      await writeFile(path, JSON.stringify(evidence, null, 2));
      await info.attach('Native routing evidence', { path, contentType: 'application/json' });
    } finally {
      if (application) await closeElectronApp(application);
      if (server.listening)
        await new Promise<void>((done, reject) =>
          server.close((error) => (error ? reject(error) : done())),
        );
      await rm(root, { recursive: true, force: true });
    }
  }
});
