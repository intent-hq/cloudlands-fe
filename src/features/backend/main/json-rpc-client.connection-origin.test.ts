import { EventEmitter } from 'node:events';
import { Duplex as LifecycleDuplex } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  JsonRpcClient,
  type JsonRpcClientOptions,
  type ClientConnectionOrigin,
} from './json-rpc-client';

// Original controlled Duplex helper from the actual-client write-fence suite.
class LifecycleSocket extends LifecycleDuplex {
  readonly frames: Array<{
    id: number | string;
    method?: string;
    params?: unknown;
    result?: unknown;
  }> = [];
  readonly written = new EventEmitter();
  closeOriginal: (() => void) | undefined;
  holdClose = false;
  destroyError: Error | null = null;
  constructor(emitClose = true) {
    super({ emitClose });
  }
  override _read(): void {}
  override _write(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    const frame = JSON.parse(chunk.toString());
    this.frames.push(frame);
    this.written.emit('frame', frame);
    callback();
  }
  override _destroy(error: Error | null, callback: (error?: Error | null) => void): void {
    if (this.holdClose) this.closeOriginal = () => callback(this.destroyError ?? error);
    else callback(this.destroyError ?? error);
  }
  reply(id: number | string, result: unknown): void {
    this.emit('data', Buffer.from(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n'));
  }
  next(method: string): Promise<{ id: number | string; method: string }> {
    return new Promise((resolve) => {
      const receive = (frame: { id: number | string; method: string }) => {
        if (frame.method !== method) return;
        this.written.off('frame', receive);
        resolve(frame);
      };
      this.written.on('frame', receive);
    });
  }
}

const clients: JsonRpcClient[] = [];
const ack = { clientId: 'same-original-client', server: { capabilities: {} } };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function create(options: JsonRpcClientOptions = {}) {
  const socket = new LifecycleSocket();
  const client = new JsonRpcClient({
    captureConnectionOrigins: true,
    socketFactory: () => socket,
    heartbeatIntervalMs: 0,
    requestTimeoutMs: 100,
    reconnectDelayMs: 1,
    helloParams: () => ({ clientId: ack.clientId }),
    ...options,
  });
  clients.push(client);
  return { socket, client };
}
function status(client: JsonRpcClient, expected: string) {
  return new Promise<void>((resolve) => {
    const listener = (value: string) => {
      if (value !== expected) return;
      client.off('status', listener);
      resolve();
    };
    client.on('status', listener);
  });
}
async function open(client: JsonRpcClient, socket: LifecycleSocket, response = ack) {
  const connected = status(client, 'connected');
  const frame = socket.next('client.hello');
  socket.emit('connect');
  socket.reply((await frame).id, response);
  await connected;
}
async function connected(options: JsonRpcClientOptions = {}) {
  const result = create(options);
  result.client.start();
  await open(result.client, result.socket);
  return result;
}
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  for (const client of clients.splice(0)) client.dispose();
  vi.useRealTimers();
});

describe('actual dial and hello origin capture', () => {
  it('C01 disabled capture adds no hello or transport work', async () => {
    const { client, socket } = create({ captureConnectionOrigins: undefined });
    expect(client.captureConnectionOrigin()).toBeNull();
    client.start();
    await open(client, socket);
    expect(client.captureConnectionOrigin()).toBeNull();
    expect(socket.frames).toEqual([
      { jsonrpc: '2.0', id: 1, method: 'client.hello', params: { clientId: ack.clientId } },
    ]);
  });

  it('C02 owns the dial before status and factory callbacks, then binds its first socket', async () => {
    let statusOrigin: ClientConnectionOrigin | null = null;
    let factoryOrigin: ClientConnectionOrigin | null = null;
    const socket = new LifecycleSocket();
    const { client } = create({
      socketFactory: () => {
        factoryOrigin = client.captureConnectionOrigin();
        expect(factoryOrigin?.read()).toMatchObject({
          state: 'pending',
          incarnation: null,
          hello: null,
        });
        return socket;
      },
    });
    client.on('status', (value) => {
      if (value === 'connecting') statusOrigin = client.captureConnectionOrigin();
    });
    expect(client.captureConnectionOrigin()).toBeNull();
    client.start();
    expect(statusOrigin).not.toBeNull();
    expect(factoryOrigin).toBe(statusOrigin);
    const original = client.captureConnectionOrigin()!;
    const pending = original.read();
    expect(pending.state).toBe('pending');
    expect(pending.state !== 'retired' && pending.incarnation).not.toBeNull();
    await open(client, socket);
    const ready = original.read();
    expect(ready.state).toBe('ready');
    expect(ready.state === 'ready' && ready.connection).toBe(client.getRepositoryConnection());
  });

  it('C03 a factory failure retires the pre-incarnation dial before failure callbacks', async () => {
    const replacement = new LifecycleSocket();
    const failure = new Error('controlled dial failure');
    let first: ClientConnectionOrigin | null = null;
    let calls = 0;
    const { client } = create({
      socketFactory: () => {
        if (calls++ === 0) {
          first = client.captureConnectionOrigin();
          throw failure;
        }
        return replacement;
      },
    });
    const retired: string[] = [];
    client.on('error', () => {
      retired.push((first as ClientConnectionOrigin | null)!.read().state);
    });
    client.start();
    expect(retired).toEqual(['retired']);
    await vi.advanceTimersByTimeAsync(1);
    const second = client.captureConnectionOrigin();
    expect(second).not.toBe(first);
    await open(client, replacement);
    expect((first as ClientConnectionOrigin | null)!.read()).toEqual({ state: 'retired' });
    expect(second!.read().state).toBe('ready');
  });

  it.each(['status', 'factory'] as const)(
    'C04 disposal from %s cannot revive an early dial',
    (site) => {
      let original: ClientConnectionOrigin | null = null;
      const socket = new LifecycleSocket();
      let dials = 0;
      const { client } = create({
        socketFactory: () => {
          dials++;
          if (site === 'factory') {
            original = client.captureConnectionOrigin();
            client.dispose();
          }
          return socket;
        },
      });
      client.on('status', (value) => {
        if (value === 'connecting' && site === 'status') {
          original = client.captureConnectionOrigin();
          client.dispose();
        }
      });
      client.start();
      expect((original as ClientConnectionOrigin | null)!.read()).toEqual({ state: 'retired' });
      expect(client.captureConnectionOrigin()).toBeNull();
      expect(socket.frames).toEqual([]);
      expect(dials).toBe(site === 'status' ? 0 : 1);
      if (site === 'factory') expect(socket.destroyed).toBe(true);
      else socket.destroy();
    },
  );

  it('C05 one pending receipt survives only its own delayed startup hello', async () => {
    const identity = deferred<Record<string, unknown>>();
    const { client, socket } = create({ helloParams: () => identity.promise });
    client.start();
    const original = client.captureConnectionOrigin()!;
    const hello = socket.next('client.hello');
    socket.emit('connect');
    expect(socket.frames).toEqual([]);
    expect(original.read().state).toBe('pending');
    const beforeTail: string[] = [];
    client.on('status', (value) => {
      if (value === 'connected') beforeTail.push(original.read().state);
    });
    const done = status(client, 'connected');
    identity.resolve({ clientId: ack.clientId });
    socket.reply((await hello).id, ack);
    await done;
    expect(beforeTail).toEqual(['pending']);
    expect(original.read().state).toBe('ready');
    expect(socket.frames.filter((frame) => frame.method === 'client.hello')).toHaveLength(1);
  });

  it.each([{}, { clientId: '' }, { clientId: 42 }])(
    'C06 invalid acknowledgement %j cannot authorize reads',
    async (response) => {
      const { client, socket } = create();
      client.start();
      const original = client.captureConnectionOrigin()!;
      await open(client, socket, response as typeof ack);
      expect(client.getStatus()).toBe('connected');
      expect(original.read()).toEqual({ state: 'retired' });
      expect(client.captureConnectionOrigin()).toBeNull();
    },
  );

  it('C06 hello timeout retires authority while preserving source degraded transport', async () => {
    const { client, socket } = create();
    client.start();
    const original = client.captureConnectionOrigin()!;
    const frame = socket.next('client.hello');
    socket.emit('connect');
    await frame;
    await vi.advanceTimersByTimeAsync(101);
    expect(client.getStatus()).toBe('connected');
    expect(original.read()).toEqual({ state: 'retired' });
  });

  it('C07 the two source beginHello calls cannot heal null-to-null with the same client ID', async () => {
    let held: ReturnType<typeof deferred<Record<string, unknown>>> | undefined;
    const { client, socket } = await connected({
      helloParams: () => held?.promise ?? { clientId: ack.clientId },
    });
    const prior = client.captureConnectionOrigin()!;
    held = deferred<Record<string, unknown>>();
    const result = client.request('client.hello');
    const first = client.captureConnectionOrigin()!;
    expect(first).not.toBe(prior);
    expect(prior.read().state).toBe('retired');
    const frame = socket.next('client.hello');
    held.resolve({ clientId: ack.clientId });
    const request = await frame;
    const second = client.captureConnectionOrigin()!;
    expect(second).not.toBe(first);
    expect(first.read()).toEqual({ state: 'retired' });
    socket.reply(request.id, ack);
    await result;
    expect(second.read().state).toBe('ready');
    expect(first.read()).toEqual({ state: 'retired' });
  });

  it('C08 late confirmation belongs to the earlier hello only', async () => {
    const { client, socket } = await connected();
    const firstFrame = socket.next('client.hello');
    const firstResult = client.request('client.hello');
    const first = await firstFrame;
    const old = client.captureConnectionOrigin()!;
    const secondFrame = socket.next('client.hello');
    const secondResult = client.request('client.hello');
    const second = await secondFrame;
    const current = client.captureConnectionOrigin()!;
    socket.reply(second.id, ack);
    await secondResult;
    socket.reply(first.id, ack);
    await firstResult;
    expect(old.read().state).toBe('retired');
    expect(current.read().state).toBe('ready');
    expect(client.captureConnectionOrigin()).toBe(current);
  });

  it.each(['hello-result', 'connected-status', 'result-getter'] as const)(
    'C09/C10/C11 rehello in %s cannot publish the outer ready receipt',
    async (site) => {
      let entered = false;
      let next: Promise<unknown> | undefined;
      let client!: JsonRpcClient;
      const reenter = () => {
        if (entered) return;
        entered = true;
        next = client.request('client.hello');
        void next.catch(() => {});
      };
      const setup = create({
        onHelloResult: (value) => {
          if (site === 'hello-result') reenter();
          if (site === 'result-getter' && !entered) {
            Object.defineProperty(value, 'clientId', {
              get: () => {
                reenter();
                return ack.clientId;
              },
            });
          }
        },
      });
      client = setup.client;
      const socket = setup.socket;
      if (site === 'connected-status')
        client.on('status', (s) => {
          if (s === 'connected') reenter();
        });
      client.start();
      const old = client.captureConnectionOrigin()!;
      const hello = socket.next('client.hello');
      socket.emit('connect');
      const first = await hello;
      const followup = socket.next('client.hello');
      socket.reply(first.id, ack);
      const second = await followup;
      expect(old.read()).toEqual({ state: 'retired' });
      const current = client.captureConnectionOrigin()!;
      socket.reply(second.id, ack);
      await next;
      expect(current.read().state).toBe('ready');
      expect(old.read()).toEqual({ state: 'retired' });
    },
  );

  it('C12 a saved ready connection still consults original retirement at the actual write', async () => {
    const { client, socket } = await connected();
    const old = client.captureConnectionOrigin()!;
    const ready = old.read();
    if (ready.state !== 'ready') throw new Error('Expected controlled hello acknowledgement');
    let pendingHello: Promise<unknown> | undefined;
    const stop = client.observeTraffic((event) => {
      if (event.type === 'request' && event.method === 'workspace.get') {
        pendingHello = client.request('client.hello');
        void pendingHello.catch(() => {});
      }
    });
    const rejected = client.requestOnCapturedConnection(
      ready.connection,
      'workspace.get',
      { workspaceId: 'ws-original' },
      undefined,
      undefined,
      () => old.read().state === 'ready',
    );
    await expect(rejected).rejects.toThrow();
    expect(socket.frames.filter((frame) => frame.method === 'workspace.get')).toEqual([]);
    stop();
    client.dispose();
    await pendingHello?.catch(() => {});
  });

  it('C13 retirement is synchronous in source callbacks and settles original pending work', async () => {
    const { client, socket } = await connected();
    const old = client.captureConnectionOrigin()!;
    const snapshots: string[] = [];
    client.observeTraffic((event) => {
      if (event.type === 'disconnected') snapshots.push(old.read().state);
    });
    const request = client.request('workspace.get', { workspaceId: 'ws-original' });
    const rejected = expect(request).rejects.toThrow('disposed');
    client.dispose();
    await rejected;
    expect(snapshots).toEqual(['retired']);
    expect(vi.getTimerCount()).toBe(0);
    socket.reply(2, { workspace: { id: 'late' } });
    expect(old.read()).toEqual({ state: 'retired' });
  });

  it('C14 changed listeners read current latches and late subscribers cannot revive an owner', async () => {
    const { client, socket } = create();
    client.start();
    const old = client.captureConnectionOrigin()!;
    const seen: string[] = [];
    old.subscribeChanged(() => {
      if (old.read().state === 'ready') client.dispose();
    });
    const stop = old.subscribeChanged(() => {
      seen.push(old.read().state);
    });
    old.subscribeChanged(() => {
      throw new Error('passive observer');
    });
    await open(client, socket);
    expect(seen).not.toContain('ready');
    expect(seen.at(-1)).toBe('retired');
    stop();
    stop();
    const late: string[] = [];
    const leave = old.subscribeChanged(() => {
      late.push(old.read().state);
    });
    leave();
    leave();
    expect(late).toEqual(['retired']);
  });

  it('C15 a new owner listener can call start and request without a second physical dial', async () => {
    const socket = new LifecycleSocket();
    let dials = 0;
    const { client } = create({
      socketFactory: () => {
        dials++;
        return socket;
      },
    });
    let request: Promise<unknown> | undefined;
    let original: ClientConnectionOrigin | null = null;
    const stop = client.onConnectionOriginChanged(() => {
      const captured = client.captureConnectionOrigin();
      if (!captured || request) return;
      original = captured;
      client.start();
      request = client.request('workspace.get', { workspaceId: 'one-dial' });
      void request.catch(() => {});
    });
    client.start();
    expect(dials).toBe(1);
    const response = socket.next('workspace.get');
    await open(client, socket);
    const read = await response;
    expect(socket.frames).toEqual([
      { jsonrpc: '2.0', id: 1, method: 'client.hello', params: { clientId: ack.clientId } },
      { jsonrpc: '2.0', id: 2, method: 'workspace.get', params: { workspaceId: 'one-dial' } },
    ]);
    socket.reply(read.id, { id: 'one-dial' });
    await expect(request).resolves.toEqual({ id: 'one-dial' });
    expect(dials).toBe(1);
    expect((original as ClientConnectionOrigin | null)!.read().state).toBe('ready');
    stop();
  });

  it.each([false, true])(
    'C16 late factory socket error is handled and actual close is joined; lifecycle=%s',
    async (tracked) => {
      const late = new LifecycleSocket();
      late.holdClose = true;
      late.destroyError = new Error('late actual destroy failed');
      const closed = new Promise<void>((resolve) => late.once('close', resolve));
      const { client } = create({
        ...(tracked ? { lifecycle: { scope: Symbol('late-factory'), generation: 1 } } : {}),
        socketFactory: () => {
          client.dispose();
          return late;
        },
      });
      client.start();
      expect(late.destroyed).toBe(true);
      expect(late.closed).toBe(false);
      expect(late.frames).toEqual([]);
      expect(client.captureConnectionOrigin()).toBeNull();
      let settled = false;
      const joined = tracked ? client.beginRetirement().seal().finish() : undefined;
      void joined?.then(() => {
        settled = true;
      });
      await Promise.resolve();
      expect(settled).toBe(false);
      // No test error listener: without the production discard handler this is unhandled.
      late.closeOriginal!();
      await closed;
      expect(late.errored).toBe(late.destroyError);
      expect(late.closed).toBe(true);
      if (joined) {
        const result = await joined;
        expect(result.closes).toHaveLength(1);
        expect(result.closes[0]).toMatchObject({ destroyRequested: true, closeObserved: true });
        expect(
          result.failures.some(
            (failure) => failure.kind === 'close' && failure.error === late.destroyError,
          ),
        ).toBe(true);
        expect(result.outcome).toBe('forced');
      }
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it('C17 an original factory cannot finish retirement before its returned socket is accounted for', async () => {
    const late = new LifecycleSocket();
    late.holdClose = true;
    let ticket: ReturnType<JsonRpcClient['beginRetirement']> | undefined;
    let premature: ReturnType<ReturnType<JsonRpcClient['beginRetirement']>['seal']> | undefined;
    let prematureError: unknown;
    let drainedInside: boolean | undefined;
    const { client } = create({
      lifecycle: { scope: Symbol('factory-join'), generation: 1 },
      socketFactory: () => {
        client.dispose();
        ticket = client.beginRetirement();
        drainedInside = ticket.isDrained();
        try {
          premature = ticket.seal();
          void premature.finish();
        } catch (error) {
          prematureError = error;
        }
        return late;
      },
    });
    client.start();
    expect(drainedInside).toBe(false);
    expect(premature).toBeUndefined();
    expect(prematureError).toBeInstanceOf(Error);
    expect(String(prematureError)).toContain('Original client owners have not joined');
    expect(late.destroyed).toBe(true);
    expect(late.closed).toBe(false);
    const joined = ticket!.seal().finish();
    let finished = false;
    void joined.then(() => {
      finished = true;
    });
    await Promise.resolve();
    expect(finished).toBe(false);
    late.closeOriginal!();
    const result = await joined;
    expect(result.ownersJoined).toBe(true);
    expect(result.admissionSealed).toBe(true);
    expect(result.outcome).toBe('forced');
    expect(result.closes).toHaveLength(1);
    expect(result.closes[0]).toMatchObject({ destroyRequested: true, closeObserved: true });
    expect(client.captureConnectionOrigin()).toBeNull();
    expect(late.frames).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
