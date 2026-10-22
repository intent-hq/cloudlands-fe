/** Disposable shell; actual backend registration and facade, without full App startup. */
import { app, BrowserWindow, ipcMain } from 'electron';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import {
  stampWindowWithBackend,
  getStrictBackendBindingForWebContents,
} from '../../../src/main/window-backend';

const [profile, preload, manifestPath, rendererPath] = process.argv.slice(2);
if (!profile || !preload || !manifestPath || !rendererPath)
  throw new Error('Owned fixture inputs required');
app.setPath('userData', profile);
app.setPath('sessionData', profile);
app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('password-store', 'basic');
async function run() {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
    port: number;
    fingerprint: string;
    guestToken: string;
    localSocket: string;
  };
  process.env.INTENTD_SOCKET = manifest.localSocket;
  const windows = new Map<string, BrowserWindow>();
  const observations: unknown[] = [];
  const originalHandle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (channel, listener) =>
    originalHandle(channel, (event, ...args) => {
      if (channel.startsWith('backend:repository:'))
        observations.push({
          channel,
          sender: event.sender.id,
          main: event.senderFrame === event.sender.mainFrame,
          process: event.senderFrame?.processId,
          frame: event.senderFrame?.routingId,
        });
      return listener(event, ...args);
    });
  const http = createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    if (request.url === '/renderer.js') {
      response.setHeader('Content-Type', 'text/javascript');
      response.end(await readFile(rendererPath));
      return;
    }
    response.setHeader('Content-Type', 'text/html');
    response.end(
      '<!doctype html><title>Native context fixture</title><script type="module" src="/renderer.js"></script>' +
        (request.url === '/frame' ? '' : '<iframe src="/frame"></iframe>'),
    );
  });
  await app.whenReady();
  const backend = await import('../../../src/features/backend/main/backend.ipc');
  const connections = await import('../../../src/features/backend/main/connections-store');
  backend.registerBackendHandlers();
  const remote = await connections.add({
    label: 'Disposable host A',
    host: '127.0.0.1',
    port: manifest.port,
    fingerprint: manifest.fingerprint,
    token: manifest.guestToken,
    detectHosts: false,
    syncExcluded: true,
  });
  const clients = new Map([
    ['host-A', await backend.connectBackendClient(remote.id)],
    ['local-B', backend.getLocalBackendClient()],
  ]);
  await Promise.all(
    [...clients.values()].map(
      (client) =>
        new Promise<void>((resolve, reject) => {
          if (client.getRepositoryConnection()) {
            resolve();
            return;
          }
          client.on('status', () => {
            if (client.getRepositoryConnection()) resolve();
          });
          client.once('error', reject);
        }),
    ),
  );
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
  const address = http.address();
  if (!address || typeof address === 'string') throw new Error('Missing owned HTTP address');
  const origin = `http://127.0.0.1:${address.port}`;
  for (const id of ['host-A', 'local-B']) {
    const window = new BrowserWindow({
      show: false,
      webPreferences: {
        preload,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        nodeIntegrationInSubFrames: true,
      },
    });
    stampWindowWithBackend(window, id === 'host-A' ? remote.id : 'local');
    windows.set(id, window);
    await window.loadURL(`${origin}/${id}`);
  }
  const fixture = {
    ready: true,
    observations,
    snapshot(id: string) {
      const window = windows.get(id);
      if (!window || window.isDestroyed()) return null;
      const binding = getStrictBackendBindingForWebContents(window.webContents);
      return {
        sender: window.webContents.id,
        bound: !!binding,
        backend: binding?.backendId,
        confirmed: !!clients.get(id)?.getRepositoryConnection(),
        capabilities: clients.get(id)?.getRepositoryConnection()?.repositoryContext,
      };
    },
    async navigate() {
      await windows.get('host-A')!.loadURL(`${origin}/host-A-next`);
    },
    destroy() {
      windows.get('host-A')?.destroy();
    },
    async shutdown() {
      backend.disposeAllBackendClients();
      for (const window of windows.values()) if (!window.isDestroyed()) window.destroy();
      await new Promise<void>((resolve, reject) =>
        http.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
  Object.assign(globalThis, { nativeRepositoryFixture: fixture });

  return fixture;
}
void run().catch((error) => {
  console.error(error);
  app.exit(1);
});
export type Fixture = Awaited<ReturnType<typeof run>>;
