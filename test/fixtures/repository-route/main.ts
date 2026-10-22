/** Disposable Electron shell. No Intent startup, settings, credentials or installed daemon. */
import { app, BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createSocketServer, type Socket } from 'node:net';
import { join } from 'node:path';
import {
  getBackendIdForWebContents,
  getStrictBackendBindingForWebContents,
  stampWindowWithBackend,
} from '../../../src/main/window-backend';
import { JsonRpcClient } from '../../../src/features/backend/main/json-rpc-client';
import { registerRepositoryRouteHandlers } from '../../../src/features/backend/main/repository-route-lifecycle';
import { IPC_CHANNELS } from '../../../src/shared/ipc-registry';
import type { RepositoryRootIdentity } from '../../../src/shared/types/repository-context';

const [profile, preload, mode] = process.argv.slice(2);
if (!profile || !preload || !['unavailable', 'injected'].includes(mode)) {
  throw new Error('Disposable profile, generated preload and explicit fixture mode required');
}
app.setPath('userData', profile);
app.setPath('sessionData', profile);
const root = {
  kind: 'primary',
  workspaceId: 'same-workspace',
} as const satisfies RepositoryRootIdentity;
const clients = new Map<string, JsonRpcClient>();
const windows = new Map<string, BrowserWindow>();
const sockets = new Set<Socket>();
const servers: ReturnType<typeof createSocketServer>[] = [];
const evidence: {
  wire: Array<{ backendId: string; method: string; params: unknown }>;
  ipc: Array<{
    channel: string;
    sender: number;
    processId: number;
    routingId: number;
    main: boolean;
  }>;
  destruction: Array<{ id: number; retired: boolean }>;
} = { wire: [], ipc: [], destruction: [] };
const stamps = new WeakMap<object, number>();
let nextStamp = 0;
let ready = false;
let heldNavigation: (() => void) | undefined;
const fixtureLifetime = Object.freeze({});

function audit(channel: string, event: IpcMainInvokeEvent) {
  evidence.ipc.push({
    channel,
    sender: event.sender.id,
    processId: event.senderFrame?.processId ?? -1,
    routingId: event.senderFrame?.routingId ?? -1,
    main: event.senderFrame === event.sender.mainFrame,
  });
}
const registry = registerRepositoryRouteHandlers(
  {
    handle(channel, listener) {
      ipcMain.handle(channel, (event, ...args) => {
        audit(channel, event);
        return listener(event, ...args);
      });
    },
  },
  {
    readBackend: (id) => clients.get(id),
    // The production-equivalent case is null. Positive mode is fixture-only:
    // it proves Electron routing, never daemon/account/authority admission.
    resolveLifetime: ({ root: selected }) =>
      mode === 'injected' && selected.workspaceId === root.workspaceId
        ? {
            stamp: fixtureLifetime,
            isCurrent: () => true,
            allowsRequest: (method, params) =>
              method === 'git.status' && params.workspaceId === root.workspaceId,
          }
        : null,
    errorPayload: () => ({ code: 'FIXTURE_TRANSPORT_ERROR', message: 'Fixture transport failed' }),
  },
);

// Only this ordinary IPC adapter is a fixture. Full backend.ipc startup would
// load application services; its null-feed wiring already has source-unit proof.
ipcMain.handle(IPC_CHANNELS.BACKEND.REQUEST, async (event, request) => {
  audit(IPC_CHANNELS.BACKEND.REQUEST, event);
  const client = clients.get(getBackendIdForWebContents(event.sender));
  if (!client || request.method !== 'git.status') throw new Error('Unsupported fixture request');
  return { ok: true, result: await client.request(request.method, request.params) };
});

const http = createHttpServer((request, response) => {
  const respond = () => {
    response.setHeader('Content-Type', 'text/html');
    response.setHeader('Cache-Control', 'no-store');
    response.end(
      `<!doctype html><title>Repository route fixture</title><p>Disposable Electron fixture</p>${
        request.url === '/frame' ? '' : '<iframe src="/frame"></iframe>'
      }`,
    );
  };
  if (request.url === '/held') heldNavigation = respond;
  else respond();
});

async function startBackend(backendId: string) {
  const socketPath = join(profile, `${backendId}.sock`);
  const server = createSocketServer((socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
    let input = '';
    socket.on('data', (data) => {
      input += data.toString();
      for (let newline = input.indexOf('\n'); newline !== -1; newline = input.indexOf('\n')) {
        const message = JSON.parse(input.slice(0, newline));
        input = input.slice(newline + 1);
        evidence.wire.push({ backendId, method: message.method, params: message.params });
        const result =
          message.method === 'client.hello'
            ? { clientId: `fixture-${backendId}` }
            : { branch: `${backendId}-branch` };
        socket.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, result })}\n`);
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, resolve);
  });
  servers.push(server);
  const client = new JsonRpcClient({
    config: { transport: 'uds', socketPath },
    heartbeatIntervalMs: 0,
    helloParams: () => ({ clientId: `fixture-${backendId}` }),
  });
  clients.set(backendId, client);
  await new Promise<void>((resolve, reject) => {
    client.on('error', reject);
    client.on('status', (status) => {
      if (status === 'connected') resolve();
    });
    client.start();
  });
}

const fixture = {
  get ready() {
    return ready;
  },
  root,
  evidence,
  get navigationHeld() {
    return heldNavigation !== undefined;
  },
  releaseNavigation() {
    heldNavigation?.();
    heldNavigation = undefined;
  },
  snapshot(backendId: string) {
    const window = windows.get(backendId);
    if (!window || window.isDestroyed()) return null;
    const sender = window.webContents;
    const binding = getStrictBackendBindingForWebContents(sender);
    if (binding && !stamps.has(binding.stamp)) stamps.set(binding.stamp, ++nextStamp);
    return {
      windowId: window.id,
      senderId: sender.id,
      processId: sender.mainFrame.processId,
      routingId: sender.mainFrame.routingId,
      stamp: binding ? stamps.get(binding.stamp) : null,
      backendId: binding?.backendId,
      confirmed: clients.get(backendId)?.getRepositoryConnection() !== null,
      url: sender.getURL(),
    };
  },
  destroy(backendId: string) {
    const window = windows.get(backendId);
    if (!window || window.isDestroyed()) return;
    const sender = window.webContents;
    const id = sender.id;
    window.destroy();
    evidence.destruction.push({
      id,
      retired: getStrictBackendBindingForWebContents(sender) === null,
    });
  },
};
Object.assign(globalThis, { repositoryFixture: fixture });
export type Fixture = typeof fixture;

app.whenReady().then(async () => {
  await Promise.all(['host-A', 'local'].map(startBackend));
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
  const address = http.address();
  if (!address || typeof address === 'string') throw new Error('Fixture listener unavailable');
  for (const backendId of ['host-A', 'local']) {
    const window = new BrowserWindow({
      show: false,
      webPreferences: {
        preload,
        contextIsolation: true,
        nodeIntegration: false,
        // Adversarial child-frame IPC fixture only; this is not the app setting.
        nodeIntegrationInSubFrames: mode === 'injected',
      },
    });
    windows.set(backendId, window);
    stampWindowWithBackend(window, backendId);
    await window.loadURL(`http://127.0.0.1:${address.port}/${backendId}`);
  }
  ready = true;
});

app.once('before-quit', (event) => {
  event.preventDefault();
  registry.dispose();
  for (const client of clients.values()) client.dispose();
  for (const socket of sockets) socket.destroy();
  http.close();
  for (const server of servers) server.close();
  app.exit();
});
