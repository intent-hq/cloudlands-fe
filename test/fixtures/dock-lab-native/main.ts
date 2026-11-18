/** Real IPC, registry and disk writes; native dock side effects are counters only. */
import { app, BrowserWindow, WebContentsView, ipcMain, type WebContents } from 'electron';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { WINDOW_CHANNELS } from '../../../src/shared/ipc/channels';
import { bindMachineViewToBackend, stampWindowWithBackend } from '../../../src/main/window-backend';

const profile = process.argv[2];
if (!profile) throw new Error('Disposable profile required');
app.setPath('userData', profile);
app.setPath('sessionData', profile);
app.commandLine.appendSwitch('disable-background-networking');

async function run() {
  await app.whenReady();
  // Import after setting userData: debug tracking also uses this owned profile.
  const dock = await import('../../../src/main/dock-lab');
  const requests: { channel: string; sender: number; payload: unknown }[] = [];
  const effects: string[] = [];
  const handle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (channel, listener) =>
    handle(channel, (event, payload) => {
      requests.push({ channel, sender: event.sender.id, payload });
      return listener(event, payload);
    });
  dock.registerDockLabHandlers({
    show: async () => {
      effects.push('show');
    },
    hide: () => {
      effects.push('hide');
    },
    onChange: () => {
      effects.push('change');
    },
    restore: async () => true,
    isDock: () => false,
  });
  ipcMain.handle = handle;
  ipcMain.on('fixture:barrier', (event) => event.sender.send('fixture:barrier'));
  // Start from an opt-out: the dock is on by default.
  await writeFile(join(profile, 'local-prefs.json'), JSON.stringify({ dockLabEnabled: false }));
  await dock.loadDockLabEnabled();
  const webPreferences = { nodeIntegration: true, contextIsolation: false, sandbox: false };
  const window = new BrowserWindow({ show: false, webPreferences });
  stampWindowWithBackend(window, 'local');
  const renderers = new Map<string, WebContents>([['outer', window.webContents]]);
  for (const name of ['settings', 'second-machine', 'unregistered-browser']) {
    const view = new WebContentsView({ webPreferences });
    window.contentView.addChildView(view);
    if (name !== 'unregistered-browser') bindMachineViewToBackend(window, view.webContents, name);
    renderers.set(name, view.webContents);
  }
  const document =
    'data:text/html,' + encodeURIComponent('<!doctype html><title>Dock lab IPC fixture</title>');
  async function mount(sender: WebContents) {
    await sender.loadURL(document);
    await sender.executeJavaScript(`(async () => {
      const ipc = require('electron').ipcRenderer;
      window.dockFixture = { events: [], current: null };
      ipc.on(${JSON.stringify(WINDOW_CHANNELS.DOCK_LAB_CHANGED)}, (_event, value) => {
        window.dockFixture.events.push(value);
        window.dockFixture.current = value.enabled;
      });
      const initial = await ipc.invoke(${JSON.stringify(WINDOW_CHANNELS.GET_DOCK_LAB)}, {});
      window.dockFixture.current = initial.enabled;
    })()`);
  }
  for (const sender of renderers.values()) await mount(sender);
  const preference = join(profile, 'local-prefs.json');
  const fixture = {
    async set(name: string, enabled: boolean) {
      return renderers.get(name)!.executeJavaScript(`(async () => {
        try { return { ok: true, value: await require('electron').ipcRenderer.invoke(
          ${JSON.stringify(WINDOW_CHANNELS.SET_DOCK_LAB)}, { enabled: ${JSON.stringify(enabled)} }) }; }
        catch (error) { return { ok: false, error: String(error) }; }
      })()`);
    },
    external: dock.changeDockLabEnabled,
    async blockPersistence(blocked: boolean) {
      if (blocked) {
        await rename(preference, preference + '.saved');
        await mkdir(preference); // Rename onto a directory fails even when running as root.
      } else {
        await rm(preference, { recursive: true });
        await rename(preference + '.saved', preference);
      }
    },
    async destroySecond() {
      const sender = renderers.get('second-machine')!;
      await new Promise<void>((resolve) => {
        sender.once('destroyed', resolve);
        sender.close({ waitForBeforeUnload: false });
      });
    },
    remount: () => mount(renderers.get('settings')!),
    async snapshot() {
      const recipients: Record<
        string,
        { id: number; current: boolean; events: { enabled: boolean }[] }
      > = {};
      for (const [name, sender] of renderers) {
        if (sender.isDestroyed()) continue;
        // A round trip on the same IPC stream drains preceding broadcasts, including
        // the excluded browser's stream. Negative delivery checks need no sleeps.
        const state = await sender.executeJavaScript(`(async () => {
          const ipc = require('electron').ipcRenderer;
          await new Promise(resolve => { ipc.once('fixture:barrier', resolve); ipc.send('fixture:barrier'); });
          return window.dockFixture;
        })()`);
        recipients[name] = { id: sender.id, ...state };
      }
      const persisted = await readFile(preference, 'utf8').then(
        (raw) => JSON.parse(raw).dockLabEnabled as boolean,
        () => null,
      );
      return {
        enabled: dock.isDockLabEnabled(),
        persisted,
        recipients,
        requests: [...requests],
        effects: [...effects],
      };
    },
  };
  Object.assign(globalThis, { dockLabFixture: fixture });
  return fixture;
}
void run().catch((error) => {
  console.error(error);
  app.exit(1);
});
export type Fixture = Awaited<ReturnType<typeof run>>;
