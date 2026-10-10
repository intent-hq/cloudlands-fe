import { Socket } from 'node:net';
import type { Duplex } from 'node:stream';
import { once } from 'node:events';
import { setTimeout as nativeSetTimeout, clearTimeout as nativeClearTimeout } from 'node:timers';
import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import type { JsonRpcClient } from '../json-rpc-client';

// Capture these before fake timers: a stalled fixture must name its stage on the real clock.
const stageSetTimeout = nativeSetTimeout;
const stageClearTimeout = nativeClearTimeout;
const abandonStages = new Set<() => void>();
function stage<T>(name: string, pending: Promise<T>, timeout = 2000): Promise<T> {
  return new Promise((resolve, reject) => {
    let active = true;
    const abandon = () => {
      active = false;
      stageClearTimeout(timer);
      abandonStages.delete(abandon);
    };
    const timer = stageSetTimeout(() => {
      abandon();
      reject(new Error(`Native-close fixture stalled: ${name}`));
    }, timeout);
    abandonStages.add(abandon);
    pending.then(
      (value) => {
        if (!active) return;
        abandon();
        resolve(value);
      },
      (error) => {
        if (!active) return;
        abandon();
        reject(new Error(`Native-close fixture failed: ${name}`, { cause: error }));
      },
    );
  });
}
function stageAssert(name: string, assertion: () => void): Promise<void> {
  return stage(name, vi.waitFor(assertion, { timeout: 500, interval: 1 }));
}

// A native socket with no network I/O; destruction and actual close are separate.
class ControlledSocket extends Socket {
  writes: Array<{ id: number; method: string; params: unknown }> = [];
  finishDestroy?: () => void;
  override _read() {}
  override _write(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ) {
    this.writes.push(JSON.parse(chunk.toString()));
    callback();
  }
  override _destroy(error: Error | null, callback: (error?: Error | null) => void) {
    this.finishDestroy = () => {
      this.finishDestroy = undefined;
      // net.Socket sets emitClose=false: its base _destroy owns the actual close event.
      super._destroy(error, callback);
    };
  }
  receive(id: number, result: unknown) {
    this.emit('data', Buffer.from(JSON.stringify({ id, result }) + '\n'));
  }
  async closePhysically() {
    const closed = once(this, 'close');
    if (!this.destroyed) this.destroy();
    expect(this.finishDestroy, 'native socket destroy callback installed').toBeTypeOf('function');
    this.finishDestroy!();
    await stage('native physical close event', closed);
  }
}
const clients: JsonRpcClient[] = [];
const controlledSockets: ControlledSocket[] = [];
let Client: typeof import('../json-rpc-client').JsonRpcClient;
let registerHandlers: typeof import('../note-delete-subscription').registerNoteDeleteSubscriptionHandlers;
beforeEach(async () => {
  vi.useRealTimers();
  vi.resetModules();
  const [rpcModule, subscriptionModule] = await stage(
    'module imports before clock mocking',
    Promise.all([import('../json-rpc-client'), import('../note-delete-subscription')]),
    5000,
  );
  Client = rpcModule.JsonRpcClient;
  registerHandlers = subscriptionModule.registerNoteDeleteSubscriptionHandlers;
  // Only product timeout/reconnect clocks are fake. Keep import and native stream scheduling real.
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
  });
});
afterEach(() => {
  // A failed stage must not leave real guard timers or deliberately delayed socket closes behind.
  for (const abandon of [...abandonStages]) abandon();
  clients.splice(0).forEach((client) => client.dispose());
  for (const socket of controlledSockets.splice(0)) {
    if (!socket.destroyed) socket.destroy();
    socket.finishDestroy?.();
  }
  vi.useRealTimers();
});
async function fixture() {
  const sockets: ControlledSocket[] = [];
  const client = new Client({
    socketFactory: () => {
      const socket = new ControlledSocket();
      sockets.push(socket);
      controlledSockets.push(socket);
      return socket as Duplex;
    },
    config: { transport: 'uds', socketPath: '/unused-controlled-socket' },
    helloParams: () => ({ clientId: 'persisted' }),
    reconnectDelayMs: 10,
    heartbeatIntervalMs: 0,
    requestTimeoutMs: 1000,
  });
  clients.push(client);
  const handlers = new Map<string, (event: IpcMainInvokeEvent, value: unknown) => Promise<any>>();
  registerHandlers(
    { handle: (name: string, handler: any) => handlers.set(name, handler) } as Pick<
      IpcMain,
      'handle'
    >,
    {
      capture: (event) => {
        const connection = client.getRepositoryConnection()!;
        return {
          // Baseline handler ignores this additive capture field: regression reaches its real cap.
          physicalCloseSource: client,
          incarnation: connection.incarnation,
          principal: event.senderFrame!,
          isLive: () => client.getRepositoryConnection() === connection,
          request: (method, params) =>
            client.requestOnCapturedConnection(connection, method, params),
        };
      },
      errorPayload: (error) => ({ code: 'TRANSPORT_ERROR', message: String(error) }),
    },
  );
  async function confirmConnection() {
    const socket = sockets.at(-1)!;
    socket.emit('connect');
    await stageAssert('hello request emitted', () =>
      expect(socket.writes.at(-1)?.method).toBe('client.hello'),
    );
    socket.receive(socket.writes.at(-1)!.id, { clientId: 'confirmed' });
    await stageAssert('hello ACK confirmed', () =>
      expect(client.getRepositoryConnection()).not.toBeNull(),
    );
    return socket;
  }
  client.start();
  await confirmConnection();
  function subscribe() {
    const event = { sender: { isDestroyed: () => false }, senderFrame: {} } as IpcMainInvokeEvent;
    return stage(
      'native subscribe result',
      handlers.get(IPC_CHANNELS.BACKEND.NOTE_DELETE_SUBSCRIPTION.SUBSCRIBE)!(event, 'ws'),
    );
  }
  async function acknowledgedSubscribe() {
    const socket = sockets.at(-1)!;
    const writes = socket.writes.length;
    const result = subscribe();
    // Wait for either an issued request or a local refusal; never timeout to fake an ACK.
    let settled = false;
    void result.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await stageAssert('subscribe request emitted or locally refused', () =>
      expect(socket.writes.length > writes || settled).toBe(true),
    );
    if (socket.writes.length > writes) {
      expect(socket.writes.at(-1)).toMatchObject({
        method: 'events.subscribe',
        params: { workspaceId: 'ws', eventTypes: ['note:delete-operation'] },
      });
      socket.receive(socket.writes.at(-1)!.id, { subscriptionId: 'same-server-id' });
    }
    return result;
  }
  async function reconnect() {
    const count = sockets.length;
    await stage('reconnect clock advanced', vi.advanceTimersByTimeAsync(10));
    expect(sockets, 'reconnect created exactly one replacement socket').toHaveLength(count + 1);
    return confirmConnection();
  }
  return { client, sockets, subscribe, acknowledgedSubscribe, reconnect };
}
it('reclaims native debt through more than eight actual socket close and reconnect cycles', async () => {
  const f = await fixture();
  for (let i = 0; i < 12; i++) {
    expect(await f.acknowledgedSubscribe()).toMatchObject({ ok: true });
    await f.sockets.at(-1)!.closePhysically();
    await f.reconnect();
  }
  expect(await f.acknowledgedSubscribe()).toMatchObject({ ok: true });
});
it('does not refund logical retirement, destruction request, elapsed time, or old late ACKs', async () => {
  const f = await fixture();
  for (let i = 0; i < 8; i++) {
    expect(await f.acknowledgedSubscribe()).toMatchObject({ ok: true });
    const socket = f.sockets.at(-1)!;
    socket.emit('error', new Error('Transport retired before physical close'));
    expect(socket.destroyed).toBe(true);
    await f.reconnect();
  }
  await stage('elapsed-time control advanced', vi.advanceTimersByTimeAsync(2000));
  const current = f.client.getRepositoryConnection();
  const replacement = f.sockets.at(-1)!;
  const writes = replacement.writes.length;
  expect(await f.subscribe()).toMatchObject({
    ok: false,
    error: { code: 'NOTE_DELETE_REGISTRATION_LIMIT' },
  });
  expect(replacement.writes).toHaveLength(writes);
  const old = f.sockets[0];
  old.receive(old.writes.at(-1)!.id, { subscriptionId: 'late-id' });
  expect(await f.subscribe()).toMatchObject({
    ok: false,
    error: { code: 'NOTE_DELETE_REGISTRATION_LIMIT' },
  });
  await old.closePhysically();
  for (let i = 0; i < 64; i++) expect(await f.acknowledgedSubscribe()).toMatchObject({ ok: true });
  old.emit('close');
  expect(f.client.getRepositoryConnection()).toBe(current);
  expect(await f.subscribe()).toMatchObject({
    ok: false,
    error: { code: 'NOTE_DELETE_REGISTRATION_LIMIT' },
  });
  expect(
    replacement.writes.filter((request) => request.method === 'events.unsubscribe'),
  ).toHaveLength(0);
});
it('reclaims exact native debt even when client disposal precedes the physical close', async () => {
  for (let i = 0; i < 12; i++) {
    const f = await fixture();
    expect(await f.acknowledgedSubscribe()).toMatchObject({ ok: true });
    f.client.dispose();
    await f.sockets[0].closePhysically();
  }
});

it('leaves replacement debt intact when an issued old request gets a late ACK and physical close', async () => {
  const f = await fixture();
  const old = f.sockets[0];
  const pending = f.subscribe();
  await stageAssert('old subscribe issued before retirement', () =>
    expect(old.writes.at(-1)?.method).toBe('events.subscribe'),
  );
  const oldRequest = old.writes.at(-1)!;
  old.emit('error', new Error('Lost subscribe ACK'));
  expect(await pending).toMatchObject({ ok: false });
  const replacement = await f.reconnect();
  const capturedReplacement = f.client.getRepositoryConnection();
  for (let i = 0; i < 64; i++) expect(await f.acknowledgedSubscribe()).toMatchObject({ ok: true });
  old.receive(oldRequest.id, { subscriptionId: 'same-server-id' });
  await old.closePhysically();
  expect(f.client.getRepositoryConnection()).toBe(capturedReplacement);
  expect(await f.subscribe()).toMatchObject({
    ok: false,
    error: { code: 'NOTE_DELETE_REGISTRATION_LIMIT' },
  });
  expect(
    replacement.writes.filter((request) => request.method === 'events.unsubscribe'),
  ).toHaveLength(0);
});
