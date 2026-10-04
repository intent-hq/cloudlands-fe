/** Finite socket producer; real production registration and preload. No GitLab/native claim. */
import { app, BrowserWindow, ipcMain } from 'electron';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createSocketServer, type Socket } from 'node:net';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { stampWindowWithBackend } from '../../../src/main/window-backend';

const [profile, preload, renderer] = process.argv.slice(2);
if (!profile || !preload || !renderer) throw new Error('Owned fixture inputs required');
app.setPath('userData', profile);
app.setPath('sessionData', profile);
app.on('window-all-closed', () => {});
app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('password-store', 'basic');
const socketPath = join(profile, 'producer.sock');
process.env.INTENTD_SOCKET = socketPath;
const instanceBaseUrl = 'https://forge.invalid:8443/Forge';
const projectPath = 'nested/team/target';
const sha = 'c'.repeat(40);
const project = {
  projectPath,
  name: 'target',
  namespace: 'nested/team',
  webUrl: instanceBaseUrl + '/' + projectPath,
  cloneUrl: instanceBaseUrl + '/' + projectPath + '.git',
  defaultBranch: 'trunk',
};
const wire: Array<{ socket: number; method: string; params: any }> = [];
const ipc: Array<{ channel: string; sender: number; main: boolean }> = [];
const sockets = new Set<Socket>();
let socketSequence = 0,
  leaseSequence = 0;
let capability: unknown = 1;
let refusal: string | undefined;
let branchChanged = false;
let holdCreateError = false;
let held: (() => void) | undefined;
const ready = (value: unknown) => ({ status: 'ready', value });
const producer = createSocketServer((socket) => {
  const socketId = ++socketSequence;
  sockets.add(socket);
  socket.once('close', () => sockets.delete(socket));
  let buffer = '';
  socket.on('data', (data) => {
    buffer += data.toString();
    for (let end = buffer.indexOf('\n'); end !== -1; end = buffer.indexOf('\n')) {
      const message = JSON.parse(buffer.slice(0, end));
      buffer = buffer.slice(end + 1);
      const { method, params = {} } = message;
      wire.push({ socket: socketId, method, params });
      const send = (result: unknown) =>
        socket.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }) + '\n');
      if (method === 'client.hello')
        send({
          clientId: 'checkout-electron',
          server: { capabilities: { gitlabCheckout: capability } },
        });
      else if (method === 'sourceControl.checkout.capture')
        send(
          refusal
            ? { status: 'unavailable', reason: refusal }
            : ready({
                checkoutId: 'lease-' + ++leaseSequence,
                revision: 'account-A',
                provider: 'gitlab',
                instanceBaseUrl,
                expiresAfterMs: 600000,
              }),
        );
      else if (method === 'sourceControl.checkout.projects') {
        if (params.query === 'hold') held = () => send(ready({ items: [project] }));
        else
          send(
            ready({
              items: [project],
              ...(params.cursor ? {} : { nextCursor: 'projects/page-2' }),
            }),
          );
      } else if (method === 'sourceControl.checkout.project')
        send(ready({ project, ...(params.url ? { contextUrl: params.url } : {}) }));
      else if (method === 'sourceControl.checkout.branches')
        send(
          refusal
            ? { status: 'unavailable', reason: refusal }
            : ready({
                items: [
                  {
                    name: params.query || (params.cursor ? 'release/next' : 'trunk'),
                    commitSha: sha,
                  },
                ],
                cached: params.cached === true,
                ...(!params.cursor && !params.query ? { nextCursor: 'branches/page-2' } : {}),
              }),
        );
      else if (method === 'sourceControl.checkout.warm')
        send(
          ready({
            projectPath: params.projectPath,
            branch: params.branch,
            commitSha: params.commitSha,
            cached: true,
          }),
        );
      else if (method === 'sourceControl.checkout.release') send({ released: true });
      else if (method === 'workspace.create') {
        if (holdCreateError) {
          held = () =>
            socket.write(
              JSON.stringify({
                jsonrpc: '2.0',
                id: message.id,
                error: {
                  code: -32000,
                  message: 'original private creation error',
                  data: { privatePath: '/A/private' },
                },
              }) + '\n',
            );
        } else if (branchChanged)
          socket.write(
            JSON.stringify({
              jsonrpc: '2.0',
              id: message.id,
              error: {
                code: -32000,
                message: 'CHECKOUT_BRANCH_CHANGED',
                data: { code: 'CHECKOUT_BRANCH_CHANGED' },
              },
            }) + '\n',
          );
        else
          send({
            workspace: {
              id: 'created-' + params.repositoryCheckout.mode,
              title: params.title,
              path: '/finite/checkout',
              branch: params.repositoryCheckout.branch,
              contextLinks: params.contextLinks,
              status: 'active',
            },
          });
      } else send({});
    }
  });
});
const windows = new Map<string, BrowserWindow>();
const http = createHttpServer(async (request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  if (request.url === '/renderer.js') {
    response.setHeader('Content-Type', 'text/javascript');
    response.end(await readFile(renderer));
    return;
  }
  response.setHeader('Content-Type', 'text/html');
  response.end(
    '<!doctype html><title>Checkout consumer fixture</title><script type="module" src="/renderer.js"></script>' +
      (request.url === '/frame' ? '' : '<iframe src="/frame"></iframe>'),
  );
});
async function run() {
  await new Promise<void>((resolve, reject) => {
    producer.once('error', reject);
    producer.listen(socketPath, resolve);
  });
  await app.whenReady();
  const originalHandle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (channel, listener) =>
    originalHandle(channel, (event, ...args) => {
      if (channel.startsWith('backend:repository-checkout:') || channel === 'backend:request')
        ipc.push({
          channel,
          sender: event.sender.id,
          main: event.senderFrame === event.sender.mainFrame,
        });
      return listener(event, ...args);
    });
  const backend = await import('../../../src/features/backend/main/backend.ipc');
  backend.registerBackendHandlers();
  const client = backend.getLocalBackendClient();
  await new Promise<void>((resolve, reject) => {
    if (client.getRepositoryConnection()) return resolve();
    client.on('status', () => {
      if (client.getRepositoryConnection()) resolve();
    });
    client.once('error', reject);
  });
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
  const address = http.address();
  if (!address || typeof address === 'string') throw new Error('Owned HTTP listener missing');
  const origin = 'http://127.0.0.1:' + address.port;
  for (const id of ['original', 'other']) {
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
    stampWindowWithBackend(window, 'local');
    windows.set(id, window);
    await window.loadURL(origin + '/' + id);
  }
  const fixture = {
    ready: true,
    wire,
    ipc,
    instanceBaseUrl,
    projectPath,
    sha,
    get held() {
      return !!held;
    },
    releaseHeld() {
      const action = held;
      held = undefined;
      action?.();
    },
    setRefusal(reason?: string) {
      refusal = reason;
    },
    setBranchChanged(value: boolean) {
      branchChanged = value;
    },
    holdCreateError(value: boolean) {
      holdCreateError = value;
    },
    async hello(value: unknown) {
      capability = value;
      await client.request('client.hello', {});
    },
    changeTarget(id: string, target: string) {
      const window = windows.get(id);
      if (!window) throw new Error('Owned fixture window missing');
      stampWindowWithBackend(window, target);
    },
    async navigate() {
      const window = windows.get('original');
      if (!window) throw new Error('Original fixture window missing');
      await window.loadURL(origin + '/original-next');
    },
    destroy() {
      windows.get('original')?.destroy();
    },
    async shutdown() {
      backend.disposeAllBackendClients();
      for (const window of windows.values()) if (!window.isDestroyed()) window.destroy();
      for (const socket of sockets) socket.destroy();
      await Promise.all([
        new Promise<void>((resolve) => http.close(() => resolve())),
        new Promise<void>((resolve) => producer.close(() => resolve())),
      ]);
    },
  };
  Object.assign(globalThis, { checkoutElectronFixture: fixture });
  return fixture;
}
void run().catch((error) => {
  console.error(error);
  app.exit(1);
});
export type Fixture = Awaited<ReturnType<typeof run>>;
