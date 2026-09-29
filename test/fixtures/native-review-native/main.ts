/** Disposable Electron shell. All authority and native dispatch use production handlers. */
import { app, BrowserWindow, ipcMain } from 'electron';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { PassThrough, type Duplex } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';
import { stampWindowWithBackend } from '../../../src/main/window-backend';
import type { BackendConnectionConfig } from '../../../src/features/backend/main/backend-connection';
import type { NativeReviewInput } from '../../../src/shared/types/native-review-operation';

type Envelope = Record<string, any>;
export interface WireRecord {
  socketId: string;
  host: number;
  direction: 'request' | 'response' | 'notification';
  envelope: Envelope;
}
export interface Ready {
  runId: string;
  identity: Record<string, string>;
  credentialDirectory: string;
  control: string;
  hosts: {
    uds: string;
    wss: string;
    fingerprint: string;
    workspaceId: string;
    registeredRootId: string;
    instance: string;
  }[];
}
const [profile, preload, readyPath, rendererPath] = process.argv.slice(2);
if (!profile || !preload || !readyPath || !rendererPath) throw new Error('Owned inputs required');
app.setPath('userData', profile);
app.setPath('sessionData', profile);
app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('password-store', 'basic');

async function run() {
  const ready: Ready = JSON.parse(await readFile(readyPath, 'utf8'));
  process.env.INTENTD_SOCKET = ready.hosts[1].uds;
  const records: WireRecord[] = [];
  const faults: string[] = [];
  const allocations = new Map<string, { socket: Duplex; host: number; config: object }>();
  let observedBytes = 0;
  function observe(socket: Duplex, config: BackendConnectionConfig, probe = false) {
    const host = config.transport === 'uds' ? 1 : 0;
    if (
      !probe &&
      ((config.transport === 'uds' && config.socketPath !== ready.hosts[1].uds) ||
        (config.transport !== 'uds' && config.port !== Number(new URL(ready.hosts[0].wss).port)))
    ) {
      faults.push('Unexpected original socket target');
    }
    const socketId = randomUUID();
    const nativeIds = new Set<string>();
    const buffers = { request: '', response: '' };
    const decoders = { request: new StringDecoder('utf8'), response: new StringDecoder('utf8') };
    let invalid = false;
    if (!probe) allocations.set(socketId, { socket, host, config });
    function record(direction: 'request' | 'response', chunk: unknown) {
      if (invalid || probe) return;
      try {
        buffers[direction] +=
          typeof chunk === 'string'
            ? chunk
            : decoders[direction].write(Buffer.from(chunk as Uint8Array));
        if (Buffer.byteLength(buffers[direction]) > 1_048_576) throw new Error('Wire frame bound');
        let end: number;
        while ((end = buffers[direction].indexOf('\n')) >= 0) {
          const raw = buffers[direction].slice(0, end);
          buffers[direction] = buffers[direction].slice(end + 1);
          if (!raw.trim()) continue;
          const envelope = JSON.parse(raw) as Envelope;
          const request =
            direction === 'request' &&
            typeof envelope.method === 'string' &&
            [
              'accept-changes.prepare',
              'accept-changes.execute',
              'accept-changes.reconcile',
              'accept-changes.release',
            ].includes(envelope.method);
          if (request) nativeIds.add(String(envelope.id));
          const response = direction === 'response' && nativeIds.has(String(envelope.id));
          const notice = direction === 'response' && envelope.method === 'accept-changes.retired';
          if (!request && !response && !notice) continue;
          observedBytes += Buffer.byteLength(raw);
          if (records.length >= 1024 || observedBytes > 16_777_216)
            throw new Error('Native observation bound');
          if (/"(?:token|authorization|password|secret)"\s*:/i.test(raw))
            throw new Error('Unsafe native frame');
          records.push({
            socketId,
            host,
            direction: notice ? 'notification' : direction,
            envelope,
          });
        }
      } catch (error) {
        invalid = true;
        faults.push(String(error));
      }
    }
    const write = socket.write;
    socket.write = function (this: Duplex, ...args: Parameters<Duplex['write']>) {
      record('request', args[0]);
      return Reflect.apply(write, this, args);
    } as Duplex['write'];
    const emit = socket.emit;
    socket.emit = function (event: string | symbol, ...args: any[]) {
      if (event === 'data') record('response', args[0]);
      return Reflect.apply(emit, this, [event, ...args]);
    };
    return socket;
  }
  // The virtual factory module calls this only after the real factory returns.
  Object.assign(globalThis, { nativeReviewSocketObserver: observe });
  const probe = new PassThrough({ highWaterMark: 1 });
  const before = probe.listenerCount('data');
  const same = observe(probe, { transport: 'uds', socketPath: 'probe' }, true);
  const forwarding: Record<string, unknown> = {
    same: same === probe,
    noEarlyListener: probe.listenerCount('data') === before,
    notFlowing: probe.readableFlowing === null,
  };
  const chunks: string[] = [];
  probe.on('data', (chunk) => chunks.push(chunk.toString()));
  let callbacks = 0;
  await new Promise<void>((resolve, reject) => {
    probe.write('one\n', (error) => {
      callbacks++;
      if (error) reject(error);
      else resolve();
    });
  });
  forwarding.chunks = chunks;
  forwarding.callbacks = callbacks;
  const receiver = { count: 0 };
  const methodProbe = new PassThrough();
  const expectedError = new Error('original forwarding error');
  let seenArguments: unknown[] = [];
  methodProbe.write = function (this: unknown, ...args: unknown[]) {
    seenArguments = args;
    if (args[0] === 'throw') throw expectedError;
    (this as unknown as typeof receiver).count++;
    return false;
  } as Duplex['write'];
  observe(methodProbe, { transport: 'uds', socketPath: 'probe' }, true);
  const callback = () => {};
  forwarding.returnValue = Reflect.apply(methodProbe.write, receiver, [
    'payload',
    'utf8',
    callback,
  ]);
  forwarding.receiver = receiver.count;
  forwarding.exactArguments =
    seenArguments[0] === 'payload' && seenArguments[1] === 'utf8' && seenArguments[2] === callback;
  try {
    methodProbe.write('throw');
  } catch (error) {
    forwarding.sameError = error === expectedError;
  }
  probe.destroy();
  methodProbe.destroy();
  if (
    !forwarding.same ||
    !forwarding.noEarlyListener ||
    !forwarding.notFlowing ||
    callbacks !== 1 ||
    chunks.join('') !== 'one\n' ||
    forwarding.returnValue !== false ||
    receiver.count !== 1 ||
    !forwarding.exactArguments ||
    !forwarding.sameError
  )
    throw new Error('Observer forwarding invariants failed');

  const windows = new Map<string, BrowserWindow>();
  const pending = new Set<Promise<unknown>>();
  const ipcRecords: unknown[] = [];
  const handles = new Map<string, { id: string; input: NativeReviewInput }>();
  const originalHandle = ipcMain.handle;
  ipcMain.handle = function (channel, listener) {
    return Reflect.apply(originalHandle, this, [
      channel,
      function (this: unknown, event, ...args) {
        const result = Reflect.apply(listener, this, [event, ...args]);
        if (channel.startsWith('backend:native-review:')) {
          const record: Record<string, unknown> = {
            channel,
            sender: event.sender.id,
            main: event.senderFrame === event.sender.mainFrame,
            frame: event.senderFrame?.routingId,
            args,
          };
          ipcRecords.push(record);
          const promise = Promise.resolve(result);
          pending.add(promise);
          void promise
            .then(
              (value) => {
                record.result = value;
                if (channel.endsWith(':prepare') && value?.ok) {
                  const key = [...windows].find(
                    ([, window]) => !window.isDestroyed() && window.webContents === event.sender,
                  )?.[0];
                  if (key) handles.set(key, { id: value.result.id, input: args[0].input });
                }
              },
              (error) => {
                record.rejected = String(error);
              },
            )
            .finally(() => pending.delete(promise));
        }
        return result;
      },
    ]);
  };
  const http = createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    if (request.url === '/renderer.js') {
      response.setHeader('Content-Type', 'text/javascript');
      response.end(await readFile(rendererPath));
      return;
    }
    response.setHeader('Content-Type', 'text/html');
    response.end(
      '<!doctype html><title>Native review fixture</title><script type="module" src="/renderer.js"></script>' +
        (request.url === '/frame' ? '' : '<iframe src="/frame"></iframe>'),
    );
  });
  await app.whenReady();
  const backend = await import('../../../src/features/backend/main/backend.ipc');
  const connections = await import('../../../src/features/backend/main/connections-store');
  backend.registerBackendHandlers();
  const clients = new Map<string, ReturnType<typeof backend.getLocalBackendClient>>();
  const backendIds = new Map<string, string>();
  async function confirmed(client: ReturnType<typeof backend.getLocalBackendClient>) {
    if (client.getRepositoryConnection()?.nativeReview) return;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('Confirmed native hello deadline'));
      }, 10000);
      const check = () => {
        if (client.getRepositoryConnection()?.nativeReview) {
          cleanup();
          resolve();
        }
      };
      const cleanup = () => {
        clearTimeout(timer);
        client.off('status', check);
      };
      client.on('status', check);
      check();
    });
  }
  async function remote(role: 'owner' | 'member' | 'guest') {
    const token = JSON.parse(await readFile(`${ready.credentialDirectory}/${role}`, 'utf8'))
      .token as string;
    const value = await connections.add({
      label: `Owned ${role}`,
      host: '127.0.0.1',
      port: Number(new URL(ready.hosts[0].wss).port),
      fingerprint: ready.hosts[0].fingerprint,
      token,
      detectHosts: false,
      syncExcluded: true,
    });
    const client = await backend.connectBackendClient(value.id);
    await confirmed(client);
    return { client, id: value.id };
  }
  const owner = await remote('owner');
  clients.set('host-A', owner.client);
  backendIds.set('host-A', owner.id);
  const local = backend.getLocalBackendClient();
  await confirmed(local);
  clients.set('local-B', local);
  backendIds.set('local-B', 'local');
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
  const address = http.address();
  if (!address || typeof address === 'string') throw new Error('Owned renderer listener missing');
  const origin = `http://127.0.0.1:${address.port}`;
  async function open(key: string, backendId: string) {
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
    stampWindowWithBackend(window, backendId);
    windows.set(key, window);
    await window.loadURL(`${origin}/${key}`);
    return window.webContents.id;
  }
  if (allocations.size !== 2 || faults.length)
    throw new Error('Original socket observation missing or invalid');
  await open('host-A', owner.id);
  await open('local-B', 'local');
  const fixture = {
    ready: true,
    forwarding,
    evidence() {
      return {
        records,
        faults,
        ipcRecords,
        pending: pending.size,
        allocations: [...allocations].map(([socketId, a]) => ({
          socketId,
          host: a.host,
          destroyed: a.socket.destroyed,
        })),
      };
    },
    handle(key: string) {
      return handles.get(key);
    },
    async join() {
      await Promise.allSettled([...pending]);
    },
    async role(role: 'owner' | 'member' | 'guest') {
      backend.disconnectBackendClient(backendIds.get('host-A')!);
      const next = await remote(role);
      clients.set('host-A', next.client);
      backendIds.set('host-A', next.id);
      const window = windows.get('host-A')!;
      stampWindowWithBackend(window, next.id);
    },
    async duplicateWindow() {
      return open('other-A', backendIds.get('host-A')!);
    },
    async navigate(key = 'host-A') {
      await windows.get(key)!.loadURL(`${origin}/${key}-next`);
    },
    destroy(key = 'host-A') {
      windows.get(key)?.destroy();
    },
    async reconnect() {
      const client = clients.get('host-A')!,
        config = client.getConfig();
      const original = [...allocations.values()].findLast(
        (value) => value.config === config && !value.socket.destroyed,
      );
      if (!original) throw new Error('Original allocation missing');
      const closed = new Promise<void>((resolve) => original.socket.once('close', resolve));
      original.socket.destroy();
      await closed;
      await confirmed(client);
    },
    async pendingDelete(cancel: boolean) {
      const client = clients.get('host-A')!,
        connection = client.getRepositoryConnection();
      if (!connection || !allocations.size)
        throw new Error('Original owned connection unavailable');
      return client.requestOnCapturedConnection(
        connection,
        cancel ? 'workspace.cancelDelete' : 'workspace.delete',
        { workspaceId: ready.hosts[0].workspaceId, ...(cancel ? {} : { undoDelayMs: 30000 }) },
      );
    },
    async shutdown() {
      await Promise.allSettled([...pending]);
      backend.disposeAllBackendClients();
      for (const window of windows.values()) if (!window.isDestroyed()) window.destroy();
      await new Promise<void>((resolve, reject) =>
        http.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
  Object.assign(globalThis, { nativeReviewFixture: fixture });
  return fixture;
}
void run().catch((error) => {
  console.error(error);
  app.exit(1);
});
export type Fixture = Awaited<ReturnType<typeof run>>;
