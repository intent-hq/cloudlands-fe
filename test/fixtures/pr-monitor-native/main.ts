/** Disposable Electron shell exercising the production monitor IPC registration. */
import { app, BrowserWindow, ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../../src/shared/ipc-registry';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { JsonRpcClient } from '../../../src/features/backend/main/json-rpc-client';
import { registerPrMonitorHandlers } from '../../../src/features/backend/main/pr-monitor-lifecycle';
import { stampWindowWithBackend } from '../../../src/main/window-backend';

const [profile, preload, socketPath, rendererPath] = process.argv.slice(2);
if (!profile || !preload || !socketPath || !rendererPath) throw new Error('Owned inputs required');
app.setPath('userData', profile);
app.setPath('sessionData', profile);
app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('password-store', 'basic');

async function run() {
  await app.whenReady();
  console.log('Native monitor fixture ready', socketPath);
  const client = new JsonRpcClient({
    config: { transport: 'uds', socketPath },
    helloParams: () => ({ clientId: 'native-monitor-fixture' }),
    heartbeatIntervalMs: 0,
  });
  const connected = new Promise<void>((resolve) => {
    client.on('status', () => {
      if (client.getRepositoryConnection()) resolve();
    });
  });
  client.start();
  await connected;
  console.log('Native monitor fixture connected');
  const registry = registerPrMonitorHandlers(ipcMain, {
    recipientVersion: 1,
    readBackend: (id) => (id === 'host-A' ? client : undefined),
    errorPayload: (error) => ({ code: 'RPC_ERROR', message: String(error) }),
  });
  ipcMain.handle(IPC_CHANNELS.BACKEND.REQUEST, async (event, payload) => {
    const history = registry.requestHistory(
      event,
      payload.method,
      payload.params,
      payload.reviewMonitoring,
      payload.timeoutMs,
    );
    if (history !== undefined) return history;
    return { ok: true, result: await client.request(payload.method, payload.params) };
  });
  const server = createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    if (request.url === '/renderer.js') {
      response.setHeader('Content-Type', 'text/javascript');
      response.end(await readFile(rendererPath));
    } else {
      response.setHeader('Content-Type', 'text/html');
      response.end(
        '<!doctype html><title>Monitor native fixture</title><script type="module" src="/renderer.js"></script>',
      );
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing owned server');
  const origin = `http://127.0.0.1:${address.port}`;
  const windows: BrowserWindow[] = [];
  for (let i = 0; i < 2; i++) {
    const window = new BrowserWindow({
      show: false,
      webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: false },
    });
    stampWindowWithBackend(window, 'host-A');
    windows.push(window);
    await window.loadURL(`${origin}/${i}`);
  }
  Object.assign(globalThis, {
    monitorFixture: {
      ready: true,
      async navigate(index: number) {
        await windows[index].loadURL(`${origin}/replacement`);
      },
      stamp(index: number, backend: string) {
        stampWindowWithBackend(windows[index], backend);
      },
      destroy(index: number) {
        windows[index].destroy();
      },
      retire() {
        registry.dispose();
        client.dispose();
      },
    },
  });
  app.on('before-quit', () => {
    registry.dispose();
    client.dispose();
    server.close();
  });
}
void run().catch((error) => {
  console.error(error);
  app.exit(1);
});
