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
import { JsonRpcClient } from '../../../src/features/backend/main/json-rpc-client';

/** Passive original-call ledger. Its observers never replace the returned value or Promise. */
export function completionLedger() {
  const rows: Array<Record<string, any>> = [];
  const faults: string[] = [];
  const pending = new Set<Promise<unknown>>();
  const listeners = new Set<() => void>();
  let sequence = 0;
  let sealed = false;
  const changed = () => {
    for (const listener of [...listeners]) listener();
  };
  function invoke<T>(
    fn: (...args: any[]) => T,
    receiver: unknown,
    args: unknown[],
    metadata: Record<string, unknown>,
    project: (value: unknown) => unknown = (value) => value,
  ): T {
    if (sealed) faults.push('Original work issued after quiescence');
    if (rows.length >= 1024) faults.push('Original completion ledger overflow');
    const row: Record<string, any> = { sequence: sequence++, ...metadata, state: 'pending' };
    if (rows.length < 1024) rows.push(row);
    const settle = (state: string, value: unknown) => {
      row.state = state;
      try {
        row.value = state === 'fulfilled' ? project(value) : String(value);
        if (JSON.stringify(rows).length > 16_777_216) faults.push('Completion evidence byte bound');
      } catch (error) {
        faults.push('Unobserved original completion: ' + String(error));
      }
      changed();
    };
    let result: T;
    try {
      result = Reflect.apply(fn, receiver, args);
    } catch (error) {
      settle('thrown', error);
      throw error;
    }
    if (result && typeof (result as any).then === 'function' && !(result instanceof Promise))
      faults.push('Unobserved non-native Promise completion');
    if (result instanceof Promise) {
      pending.add(result);
      void result.then(
        (value) => {
          pending.delete(result);
          settle('fulfilled', value);
        },
        (error) => {
          pending.delete(result);
          settle('rejected', error);
        },
      );
    } else settle('fulfilled', result);
    changed();
    return result;
  }
  async function join(producersClosed: () => boolean, released: () => boolean, seal = true) {
    while (true) {
      if (faults.length) throw new Error(faults.join('; '));
      if (producersClosed() && pending.size === 0 && released()) {
        sealed = seal;
        return { producersClosed: true, pending: 0, sealed, rows: rows.length };
      }
      await new Promise<void>((resolve) => {
        const next = () => {
          listeners.delete(next);
          resolve();
        };
        listeners.add(next);
      });
    }
  }
  return { rows, faults, pending, invoke, join, changed };
}

/** Native/context payloads stay complete; bootstrap data is explicitly metadata-only. */
export function observationValue(method: string, value: any): unknown {
  if (/^(accept-changes\.|workspace\.repositoryContext)/.test(method)) {
    if (/"(?:token|authorization|password|secret)"\s*:/i.test(JSON.stringify(value) ?? ''))
      throw new Error('Unsafe qualified envelope');
    return value;
  }
  return {
    metadataOnly: true,
    method,
    type: typeof value,
    subscriptionId: value?.subscriptionId,
    ok: value?.ok,
    success: value?.success,
    removed: value?.removed,
    unsubscribed: value?.unsubscribed,
    redacted: 'bootstrap/auth/config payload intentionally not retained',
  };
}

/** Correlate cleanup to the same original client/connection, never matching IDs alone. */
export function disposalComplete(rows: Array<Record<string, any>>): boolean {
  const calls = rows.filter((row) => row.layer === 'client');
  const ids = calls.map((row) => row.callId);
  if (new Set(ids).size !== ids.length) throw new Error('Duplicate original call identity');
  for (const row of calls) {
    if (row.state === 'pending') return false;
    if (row.state !== 'fulfilled') continue; // Terminal errors are preserved, not release acks.
    const kind =
      row.method === 'workspace.repositoryContext.capture'
        ? ['workspace.repositoryContext.release', 'lifetimeId', 'repositoryLifetimeId']
        : row.method === 'accept-changes.prepare'
          ? ['accept-changes.release', 'operationId', 'operationId']
          : row.method === 'events.subscribe'
            ? ['events.unsubscribe', 'subscriptionId', 'subscriptionId']
            : null;
    if (!kind) continue;
    if (
      ![row.callId, row.clientId, row.socketId].every(
        (id) => typeof id === 'string' && id.length > 0,
      ) ||
      (row.method !== 'events.subscribe' && typeof row.connectionId !== 'string')
    )
      throw new Error('Missing original cleanup identity');
    const id = (row.value?.reviewOperation ?? row.value)?.[kind[1]];
    if (typeof id !== 'string' || !id) throw new Error('Unobserved original lease identity');
    const matches = calls.filter(
      (candidate) =>
        candidate.method === kind[0] &&
        candidate.clientId === row.clientId &&
        (row.method === 'events.subscribe'
          ? candidate.socketId === row.socketId
          : candidate.connectionId === row.connectionId) &&
        (row.method === 'events.subscribe' ||
          (candidate.params?.workspaceId === row.params?.workspaceId &&
            (row.method === 'workspace.repositoryContext.capture'
              ? candidate.params?.gitRootId === row.params?.gitRootId
              : JSON.stringify(candidate.params?.root) ===
                JSON.stringify(row.params?.review?.root)))) &&
        candidate.params?.[kind[2]] === id,
    );
    if (!matches.length || matches.some((candidate) => candidate.state === 'pending')) return false;
    if (
      !matches.some(
        (candidate) =>
          candidate.state === 'fulfilled' &&
          (kind[0] === 'events.unsubscribe'
            ? candidate.value?.success === true
            : candidate.value?.released === true),
      )
    )
      throw new Error('Original cleanup has no successful release acknowledgement');
  }
  return true;
}

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
  const uiMode = process.env.NATIVE_REVIEW_UI === '1';
  const completions = completionLedger();
  const identities = new WeakMap<object, string>();
  const connectionSockets = new WeakMap<object, string>();
  const objectId = (object: object | null) => {
    if (!object) return null;
    if (!identities.has(object)) identities.set(object, randomUUID());
    return identities.get(object)!;
  };
  let activeCall: string | null = null;
  // Install before backend registration/client allocation. A captured rejection may have no wire.
  if (uiMode) {
    for (const name of ['request', 'requestOnCapturedConnection'] as const) {
      const original = JsonRpcClient.prototype[name];
      const observed = function (this: JsonRpcClient, ...args: any[]) {
        const captured = name === 'requestOnCapturedConnection';
        const currentConnection = this.getRepositoryConnection();
        const connection = captured ? args[0] : currentConnection;
        const method = args[captured ? 1 : 0];
        const params = args[captured ? 2 : 1];
        const allocation = [...allocations].findLast(
          ([, value]) => value.config === this.getConfig() && !value.socket.destroyed,
        );
        if (connection && connection === currentConnection && allocation) {
          const known = connectionSockets.get(connection);
          if (known && known !== allocation[0])
            completions.faults.push('Original acknowledged connection changed physical socket');
          else connectionSockets.set(connection, allocation[0]);
        }
        const originalSocket = connection
          ? (connectionSockets.get(connection) ?? null)
          : (allocation?.[0] ?? null);
        if (captured && !originalSocket)
          completions.faults.push('Captured request has no observed original socket');
        const callId = randomUUID();
        const prior = activeCall;
        activeCall = callId;
        try {
          return completions.invoke(
            original,
            this,
            args,
            {
              layer: 'client',
              callId,
              method,
              captured,
              clientId: objectId(this),
              connectionId: objectId(connection),
              incarnationId: objectId(connection?.incarnation ?? null),
              socketId: originalSocket,
              params: observationValue(method, params),
            },
            (value) => observationValue(method, value),
          );
        } finally {
          activeCall = prior;
        }
      };
      if (!Reflect.set(JsonRpcClient.prototype, name, observed))
        throw new Error('Original client observer could not be installed');
    }
  }
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
    const nativeIds = new Map<string, string>();
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
          if (uiMode && direction === 'request' && activeCall) {
            const original = completions.rows.find((row) => row.callId === activeCall);
            if (!original) faults.push('Original issuing future missing');
            else {
              original.wireRequests ??= [];
              original.wireRequests.push({
                socketId,
                requestId: envelope.id,
                method: envelope.method,
              });
            }
          }
          const request =
            direction === 'request' &&
            typeof envelope.method === 'string' &&
            [
              'accept-changes.prepare',
              'accept-changes.execute',
              'accept-changes.reconcile',
              'accept-changes.release',
            ].includes(envelope.method);
          const additional =
            uiMode && direction === 'request' && typeof envelope.method === 'string';
          if (request || additional) nativeIds.set(String(envelope.id), envelope.method);
          const response = direction === 'response' && nativeIds.has(String(envelope.id));
          const notice =
            direction === 'response' &&
            (envelope.method === 'accept-changes.retired' ||
              (uiMode && envelope.method === 'workspace.repositoryContext.retired'));
          if (!request && !additional && !response && !notice) continue;
          const method = envelope.method ?? nativeIds.get(String(envelope.id)) ?? '';
          const qualified = /^(accept-changes\.|workspace\.repositoryContext)/.test(method);
          observedBytes += Buffer.byteLength(raw);
          if (records.length >= 1024 || observedBytes > 16_777_216)
            throw new Error('Native observation bound');
          if (qualified && /"(?:token|authorization|password|secret)"\s*:/i.test(raw))
            throw new Error('Unsafe native frame');
          records.push({
            socketId,
            host,
            direction: notice ? 'notification' : direction,
            envelope:
              !uiMode || qualified
                ? envelope
                : {
                    jsonrpc: envelope.jsonrpc,
                    id: envelope.id,
                    method,
                    ...(direction === 'request'
                      ? { params: observationValue(method, envelope.params), callId: activeCall }
                      : envelope.error
                        ? {
                            error: {
                              code: envelope.error.code,
                              message: 'bootstrap diagnostic redacted',
                            },
                          }
                        : { result: observationValue(method, envelope.result) }),
                  },
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
        const result = uiMode
          ? completions.invoke(
              listener,
              this,
              [event, ...args],
              {
                layer: 'ipc',
                channel,
                sender: event.sender.id,
                frame: event.senderFrame?.routingId,
                document: event.senderFrame?.url,
                main: event.senderFrame === event.sender.mainFrame,
                args:
                  channel.startsWith('backend:native-review:') ||
                  channel.startsWith('backend:repository:')
                    ? args
                    : { metadataOnly: true, method: args[0]?.method },
              },
              (value) =>
                channel.startsWith('backend:native-review:') ||
                channel.startsWith('backend:repository:')
                  ? value
                  : observationValue(channel, value),
            )
          : Reflect.apply(listener, this, [event, ...args]);
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
    if (request.url === '/renderer.js' || request.url === '/style.css') {
      response.setHeader(
        'Content-Type',
        request.url.endsWith('.css') ? 'text/css' : 'text/javascript',
      );
      response.end(
        await readFile(request.url.endsWith('.css') ? rendererPath + '.css' : rendererPath),
      );
      return;
    }
    response.setHeader('Content-Type', 'text/html');
    response.end(
      '<!doctype html><title>Native review fixture</title>' +
        (uiMode ? '<link rel="stylesheet" href="/style.css"><main id="ui"></main>' : '') +
        '<script type="module" src="/renderer.js"></script>' +
        (uiMode || request.url === '/frame' ? '' : '<iframe src="/frame"></iframe>'),
    );
  });
  await app.whenReady();
  const backend = await import('../../../src/features/backend/main/backend.ipc');
  const connections = await import('../../../src/features/backend/main/connections-store');
  backend.registerBackendHandlers();
  const clients = new Map<string, ReturnType<typeof backend.getLocalBackendClient>>();
  const backendIds = new Map<string, string>();
  async function confirmed(client: ReturnType<typeof backend.getLocalBackendClient>) {
    const admitted = () => {
      const original = client.getRepositoryConnection();
      return original?.nativeReview && (!uiMode || original.repositoryContext);
    };
    if (admitted()) return;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('Confirmed native hello deadline'));
      }, 10000);
      const check = () => {
        if (admitted()) {
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
  const owner = await remote(
    uiMode && process.env.NATIVE_REVIEW_UI_ROLE === 'member' ? 'member' : 'owner',
  );
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
        ...(uiMode
          ? {
              completions: completions.rows,
              completionFaults: completions.faults,
              outstandingOriginals: completions.pending.size,
            }
          : {}),
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
    async quiesceUi(seal = true) {
      if (!uiMode) throw new Error('UI quiescence requires the actual renderer');
      const producers = [];
      for (const [key, window] of windows) {
        if (window.isDestroyed()) throw new Error('Unobserved renderer disposal');
        const receipt = await window.webContents.executeJavaScript('window.nativeUi.close()');
        if (
          !receipt.producersClosed ||
          receipt.tasks.length !== 5 ||
          receipt.tasks.some((task: any) => !task.iteratorDone || !task.joined) ||
          receipt.faults.length
        )
          throw new Error('Original renderer tasks did not complete');
        producers.push({ key, sender: window.webContents.id, receipt });
      }
      const joined = await completions.join(
        () => producers.length === windows.size,
        () => pending.size === 0 && disposalComplete(completions.rows),
        seal,
      );
      return { producers, joined };
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
