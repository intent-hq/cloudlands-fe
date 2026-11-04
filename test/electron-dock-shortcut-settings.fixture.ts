/** Actual Settings + root preference saga + native registrar, using only a disposable Electron profile. */
import { _electron as electron, expect, test } from '@playwright/test';
import { mkdtemp, rm, writeFile, readFile, symlink, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build, createServer, type ViteDevServer } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/postcss';
import autoprefixer from 'autoprefixer';
import { settleDepsOptimizer } from './vite-harness-cache.mjs';

test('editable global dock keys use the confirmed registrar, persist, reset and retain old keys on failure', async ({}, info) => {
  test.setTimeout(180000);
  const root = await mkdtemp(join(tmpdir(), 'intent-editable-dock-keys-'));
  let server: ViteDevServer | undefined,
    application: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    await symlink(
      resolve('node_modules'),
      join(root, 'node_modules'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    const entry = join(root, 'entry.ts');
    await writeFile(
      entry,
      [
        `export {createDockShortcutRegistration} from ${JSON.stringify(resolve('src/main/dock-shortcut-registration.ts'))};`,
        `export {createDockShortcutPreferences} from ${JSON.stringify(resolve('src/main/dock-shortcut-preferences.ts'))};`,
        `export {registerDockShortcutSettingsHandlers} from ${JSON.stringify(resolve('src/main/dock-shortcut-settings-ipc.ts'))};`,
        `export {getDockShortcutOverridesLocalPref,setDockShortcutOverridesLocalPref} from ${JSON.stringify(resolve('src/main/local-prefs.ts'))};`,
        `export {stampWindowWithBackend} from ${JSON.stringify(resolve('src/main/window-backend.ts'))};`,
      ].join('\n'),
    );
    await build({
      configFile: false,
      logLevel: 'error',
      resolve: { alias: { $shared: resolve('src/shared') } },
      ssr: { noExternal: true },
      plugins: [
        {
          name: 'fixture-logger',
          enforce: 'pre',
          resolveId(id) {
            if (id.endsWith('/ipc-debug-tracker')) return '\0quiet-ipc-debug';
            if (id.endsWith('shared/logger') || id === '$shared/logger') return '\0quiet-logger';
          },
          load(id) {
            // Diagnostics are outside this contract; validation and the native IPC handlers stay real.
            if (id === '\0quiet-ipc-debug')
              return 'export const ipcDebugTracker = new Proxy({}, {get:()=>()=>{}});';
            if (id === '\0quiet-logger')
              return 'export class Logger { info(){} debug(){} warn(){} error(){} }';
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
          output: { format: 'cjs', entryFileNames: 'settings.cjs' },
        },
      },
    });
    server = await createServer({
      configFile: false,
      root: process.cwd(),
      cacheDir: join(root, 'vite-cache'),
      optimizeDeps: {
        entries: ['test/fixtures/dock-shortcut-settings/index.html'],
        include: ['bits-ui', 'svelte', 'flatstr', 'redux-saga', 'typed-redux-saga'],
      },
      plugins: [svelte({ configFile: resolve('svelte.config.js') })],
      css: { postcss: { plugins: [tailwindcss, autoprefixer] } },
      resolve: {
        alias: [
          ...['lib', 'store', 'features', 'shared'].map((name) => ({
            find: `$${name}`,
            replacement: resolve(`src/${name}`),
          })),
          { find: '$app', replacement: resolve('playwright/app-stubs') },
          {
            find: /^@fortawesome\/(?:fontawesome-common-types|fontawesome-svg-core|free-brands-svg-icons|free-regular-svg-icons|free-solid-svg-icons)$/,
            replacement: resolve('src/lib/icons/phosphor-icons.ts'),
          },
          {
            find: /^svelte-fa$/,
            replacement: resolve('src/lib/components/shared/icons/fa-proxy.ts'),
          },
        ],
      },
      server: {
        host: '127.0.0.1',
        port: 0,
        watch: { ignored: ['**/*'] },
        fs: { allow: [await realpath(process.cwd()), await realpath(root)] },
      },
    });
    await server.listen();
    await settleDepsOptimizer(server);
    const url = server.resolvedUrls!.local[0] + 'test/fixtures/dock-shortcut-settings/index.html';
    const profile = join(root, 'profile');
    await writeFile(
      join(root, 'main.cjs'),
      `
      const {app,BrowserWindow,globalShortcut}=require('electron');
      app.setPath('userData',${JSON.stringify(profile)});app.setPath('sessionData',${JSON.stringify(profile)});
      const api=require('./settings.cjs');const callbacks=new Map();const calls=[];const refused=[];
      let failSave=false;
      const registrar=api.createDockShortcutRegistration({register(key,callback){const ok=globalShortcut.register(key,callback);if(ok)callbacks.set(key,callback);return ok;},unregister(key){callbacks.delete(key);globalShortcut.unregister(key);}},action=>calls.push(action),key=>refused.push(key));
      const prefs=api.createDockShortcutPreferences({registrar,read:api.getDockShortcutOverridesLocalPref,write:async value=>{if(failSave)throw new Error('Synthetic disk refusal');await api.setDockShortcutOverridesLocalPref(value);},platform:process.platform,changed(snapshot){for(const window of BrowserWindow.getAllWindows())window.webContents.send('dock-shortcuts:changed',snapshot);}});
      globalThis.editableDock={prefs,registrar,callbacks,calls,refused,failNextSave(value){failSave=value;}};
      app.whenReady().then(async()=>{await prefs.load();api.registerDockShortcutSettingsHandlers(prefs);prefs.enable(true);const window=new BrowserWindow({width:1100,height:850,show:false,webPreferences:{preload:${JSON.stringify(resolve('test/fixtures/dock-shortcut-settings/preload.cjs'))},sandbox:false,contextIsolation:true,nodeIntegration:false}});api.stampWindowWithBackend(window,'fixture-backend');await window.loadURL(${JSON.stringify(url)});});
      app.on('will-quit',()=>prefs.enable(false));
    `,
    );
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) =>
          !key.startsWith('DD_') && !['NODE_OPTIONS', 'ELECTRON_RUN_AS_NODE'].includes(key),
      ),
    );
    const launch = async () => {
      application = await electron.launch({
        args: [join(root, 'main.cjs')],
        env: { ...env, DD_TRACE_ENABLED: 'false' },
      });
      const page = await application.firstWindow();
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              (window as any).shortcutFixture?.store.state.userPreferences.dockShortcuts?.enabled,
          ),
        )
        .toBe(true);
      return page;
    };
    let page = await launch();
    const field = () => page.locator('[id="shortcut-dock.focus"]');
    const raw = () => page.evaluate(() => (window as any).shortcutFixture.effective('dock.focus'));
    const edit = async (chord: string) => {
      await field().click();
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              (window as any).shortcutFixture.store.state.userPreferences.dockShortcutCaptureToken,
          ),
        )
        .toBeTruthy();
      await page.keyboard.press(chord);
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              (window as any).shortcutFixture.store.state.userPreferences.dockShortcutPending ??
              false,
          ),
        )
        .toBe(false);
    };
    const initial = await application!.evaluate(() =>
      (globalThis as any).editableDock.prefs.snapshot(),
    );
    expect(await raw()).toBe('ctrl+shift+d');
    await field().click();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as any).shortcutFixture.store.state.userPreferences.dockShortcutCaptureToken,
        ),
      )
      .toBeTruthy();
    expect(
      await application!.evaluate(({ globalShortcut }) =>
        globalShortcut.isRegistered('Control+Shift+D'),
      ),
    ).toBe(false);
    await page.keyboard.press('Control+Alt+Shift+Y');
    await expect.poll(raw).toBe('ctrl+alt+shift+y');
    expect(
      await application!.evaluate(({ globalShortcut }) => ({
        newKey: globalShortcut.isRegistered('Control+Alt+Shift+Y'),
        oldKey: globalShortcut.isRegistered('Control+Shift+D'),
      })),
    ).toEqual({ newKey: true, oldKey: false });
    await application!.evaluate(() =>
      (globalThis as any).editableDock.callbacks.get('Control+Alt+Shift+Y')(),
    );
    expect(await application!.evaluate(() => (globalThis as any).editableDock.calls)).toEqual([
      'focus',
    ]);
    const snapshots: any[] = [
      { phase: 'initial', snapshot: initial },
      {
        phase: 'edited',
        snapshot: await application!.evaluate(() =>
          (globalThis as any).editableDock.prefs.snapshot(),
        ),
      },
    ];
    // Hold a genuine old GET reply while another native update is broadcast first.
    await page.evaluate(() => {
      (window as any).shortcutTest.holdGet();
      (window as any).shortcutFixture.refresh();
    });
    await expect
      .poll(() => page.evaluate(() => (window as any).shortcutTest.hasHeldGet()))
      .toBe(true);
    const newer = await application!.evaluate(async () => {
      const prefs = (globalThis as any).editableDock.prefs;
      return prefs.update({
        expectedRevision: prefs.snapshot().revision,
        id: 'dock.focus',
        key: 'ctrl+alt+shift+u',
        appOverrides: {},
      });
    });
    await expect.poll(raw).toBe('ctrl+alt+shift+u');
    await page.evaluate(() => (window as any).shortcutTest.releaseGet());
    await field().click();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as any).shortcutFixture.store.state.userPreferences.dockShortcutCaptureToken,
        ),
      )
      .toBeTruthy();
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as any).shortcutFixture.store.state.userPreferences.dockShortcuts.revision,
        ),
      )
      .toBe(newer.revision);
    await application!.evaluate(() => (globalThis as any).editableDock.prefs.enable(false));
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as any).shortcutFixture.store.state.userPreferences.dockShortcuts.enabled,
        ),
      )
      .toBe(false);
    await application!.evaluate(() => (globalThis as any).editableDock.prefs.enable(true));
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as any).shortcutFixture.store.state.userPreferences.dockShortcuts.enabled,
        ),
      )
      .toBe(true);
    await expect.poll(raw).toBe('ctrl+alt+shift+u');
    snapshots.push({ phase: 'held-old-get-after-new-change', snapshot: newer });
    await edit('Control+Alt+Shift+Y');
    await expect.poll(raw).toBe('ctrl+alt+shift+y');
    await edit('Control+Shift+R');
    await expect.poll(raw).toBe('ctrl+alt+shift+y');
    await expect(page.getByRole('alert').filter({ hasText: 'already used' }).first()).toBeVisible();
    await edit('Meta+Shift+S');
    await expect(page.getByRole('alert').filter({ hasText: 'already used' }).first()).toBeVisible();
    await edit('Y');
    await expect(page.getByRole('alert').filter({ hasText: 'Use Control' }).first()).toBeVisible();
    await application!.evaluate(({ globalShortcut }) => {
      if (!globalShortcut.register('Control+Alt+Shift+F10', () => {}))
        throw new Error('Fixture sentinel key unavailable');
    });
    await edit('Control+Alt+Shift+F10');
    await expect(page.getByRole('alert').filter({ hasText: 'unavailable' }).first()).toBeVisible();
    expect(
      await application!.evaluate(({ globalShortcut }) =>
        globalShortcut.isRegistered('Control+Alt+Shift+Y'),
      ),
    ).toBe(true);
    await application!.evaluate(() => (globalThis as any).editableDock.failNextSave(true));
    await edit('Control+Alt+Shift+F11');
    await expect(
      page.getByRole('alert').filter({ hasText: 'could not be saved' }).first(),
    ).toBeVisible();
    expect(
      await application!.evaluate(({ globalShortcut }) => ({
        old: globalShortcut.isRegistered('Control+Alt+Shift+Y'),
        attempt: globalShortcut.isRegistered('Control+Alt+Shift+F11'),
      })),
    ).toEqual({ old: true, attempt: false });
    await application!.evaluate(({ globalShortcut }) => {
      (globalThis as any).editableDock.failNextSave(false);
      globalShortcut.unregister('Control+Alt+Shift+F10');
    });
    const persisted = JSON.parse(await readFile(join(profile, 'local-prefs.json'), 'utf8'));
    expect(persisted.dockShortcutOverrides['dock.focus']).toBe('ctrl+alt+shift+y');
    snapshots.push({
      phase: 'after-refusals',
      snapshot: await application!.evaluate(() =>
        (globalThis as any).editableDock.prefs.snapshot(),
      ),
    });
    await page.getByRole('button', { name: 'Workspace row', exact: true }).focus();
    await page.keyboard.press('Meta+Shift+S');
    expect(await page.evaluate(() => (window as any).shortcutFixture.workspaceActions)).toEqual([
      'fixture-space',
    ]);
    await page.getByRole('button', { name: 'Open shortcut sheet', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('dialog').getByText('⌃⌥⇧Y', { exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await application!.close();
    application = undefined;
    page = await launch();
    await expect.poll(raw).toBe('ctrl+alt+shift+y');
    expect(
      await application!.evaluate(({ globalShortcut }) =>
        globalShortcut.isRegistered('Control+Alt+Shift+Y'),
      ),
    ).toBe(true);
    const reset = page.locator('[data-shortcut-category="dock"]').getByRole('button').first();
    await reset.click();
    await expect.poll(raw).toBe('ctrl+shift+d');
    await edit('Control+Alt+Shift+Y');
    await expect.poll(raw).toBe('ctrl+alt+shift+y');
    await page.getByRole('button', { name: 'Reset all', exact: true }).click();
    await expect.poll(raw).toBe('ctrl+shift+d');
    await page
      .locator('[data-shortcut-category="dock"]')
      .screenshot({ path: info.outputPath('editable-dock-shortcuts.png') });
    await application!.evaluate(() => (globalThis as any).editableDock.prefs.enable(false));
    expect(
      await application!.evaluate(({ globalShortcut }) =>
        ['D', 'S', 'R', 'A', 'M'].some((key) =>
          globalShortcut.isRegistered('Control+Shift+' + key),
        ),
      ),
    ).toBe(false);
    snapshots.push({
      phase: 'reset-disabled',
      snapshot: await application!.evaluate(() =>
        (globalThis as any).editableDock.prefs.snapshot(),
      ),
    });
    await writeFile(
      info.outputPath('editable-dock-shortcuts.json'),
      JSON.stringify(
        {
          boundary:
            'Real Settings, production Redux/saga, IPC, local prefs and Electron globalShortcut. Callback invoked through captured registration callback; physical OS delivery is unverified. Persistence uses disposable userData only.',
          snapshots,
          persisted,
        },
        null,
        2,
      ),
    );
  } finally {
    if (application) await application.close();
    await server?.close();
    await rm(root, { recursive: true, force: true });
  }
});
