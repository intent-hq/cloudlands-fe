import { EventEmitter } from 'node:events';
import { Duplex as LifecycleDuplex } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JsonRpcClient } from './json-rpc-client';
import type { RpcTrafficEvent } from './rpc-traffic';

// Reused verbatim from json-rpc-client.test.ts: real controlled Duplex, no live socket.
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
    if (this.holdClose) this.closeOriginal = () => callback(error);
    else callback(error);
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
const method = 'file.exists';
const params = Object.freeze({ workspaceId: 'ws-fence', path: '/repo/a.ts' });
const result = { exists: true, isFile: true, isDirectory: false };

function connected(client: JsonRpcClient): Promise<void> {
  return new Promise((resolve) => {
    const onStatus = (status: string) => {
      if (status !== 'connected') return;
      client.off('status', onStatus);
      resolve();
    };
    client.on('status', onStatus);
  });
}
async function acknowledge(socket: LifecycleSocket, client: JsonRpcClient) {
  const ready = connected(client);
  const nextHello = socket.next('client.hello');
  socket.emit('connect');
  const hello = await nextHello;
  socket.reply(hello.id, {
    clientId: 'controlled',
    server: { capabilities: { gitlabCheckout: 1 } },
  });
  await ready;
}
async function setup() {
  const socket = new LifecycleSocket();
  const replacement = new LifecycleSocket();
  const socketFactory = vi.fn().mockReturnValueOnce(socket).mockReturnValueOnce(replacement);
  const client = new JsonRpcClient({
    socketFactory,
    lifecycle: { scope: Symbol('captured-write'), generation: 1 },
    helloParams: () => ({ clientId: 'controlled' }),
    heartbeatIntervalMs: 0,
    requestTimeoutMs: 100,
    reconnectDelayMs: 1,
  });
  clients.push(client);
  client.start();
  await acknowledge(socket, client);
  const captured = client.getRepositoryConnection()!;
  expect(captured).not.toBeNull();
  expect(vi.getTimerCount()).toBe(0);
  return { socket, replacement, socketFactory, client, captured };
}
function onRequest(client: JsonRpcClient, callback: (event: RpcTrafficEvent) => void) {
  return client.observeTraffic((event) => {
    if (event.type === 'request' && event.direction === 'outbound' && event.method === method)
      callback(event);
  });
}
function track<T>(promise: Promise<T>) {
  const outcomes: Array<{ value: T } | { error: unknown }> = [];
  const done = promise.then(
    (value) => {
      outcomes.push({ value });
    },
    (error: unknown) => {
      outcomes.push({ error });
    },
  );
  return { outcomes, done };
}
function noReadBytes(...sockets: LifecycleSocket[]) {
  for (const socket of sockets)
    expect(socket.frames.filter((f) => f.method === method)).toEqual([]);
}
async function assertClean(client: JsonRpcClient) {
  const ticket = client.beginRetirement();
  expect(ticket.isDrained()).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
  const retired = await ticket.seal().finish();
  expect(retired.ownersJoined).toBe(true);
  expect(retired.admissionSealed).toBe(true);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
});
afterEach(() => {
  for (const client of clients.splice(0)) client.dispose();
  vi.useRealTimers();
});

describe('captured request opt-in final write fence on the actual JsonRpcClient', () => {
  it('W1 retires the origin in a real traffic observer while the same socket and hello remain live', async () => {
    const { client, socket, replacement, captured, socketFactory } = await setup();
    let current = true;
    const events: RpcTrafficEvent[] = [];
    client.observeTraffic((event) => {
      events.push(event);
    });
    onRequest(client, () => {
      current = false;
    });
    const observed = track(
      client.requestOnCapturedConnection(
        captured,
        method,
        params,
        undefined,
        undefined,
        () => current,
      ),
    );
    await observed.done;
    expect(observed.outcomes).toEqual([
      {
        error: expect.objectContaining({
          message: 'Captured repository connection is unavailable',
        }),
      },
    ]);
    expect(client.getRepositoryConnection()).toBe(captured);
    expect(socket.destroyed).toBe(false);
    noReadBytes(socket, replacement);
    expect(socketFactory).toHaveBeenCalledTimes(1);
    expect(events.map((event) => (event.type === 'response' ? event.status : event.type))).toEqual([
      'request',
      'send-error',
    ]);
    await vi.advanceTimersByTimeAsync(200);
    expect(observed.outcomes).toHaveLength(1);
    expect(events.some((event) => event.type === 'response' && event.status === 'timeout')).toBe(
      false,
    );
    await assertClean(client);
  });

  it.each(['observer', 'guard'] as const)(
    'W2 %s starts a new hello before write; the old request never follows it',
    async (phase) => {
      const { client, socket, replacement, captured } = await setup();
      let hello: Promise<unknown> | undefined;
      const nextHello = socket.next('client.hello');
      if (phase === 'observer')
        onRequest(client, () => {
          hello = client.request('client.hello');
        });
      const observed = track(
        client.requestOnCapturedConnection(captured, method, params, undefined, undefined, () => {
          if (phase === 'guard') hello = client.request('client.hello');
          return true;
        }),
      );
      await observed.done;
      expect(observed.outcomes[0]).toHaveProperty('error');
      noReadBytes(socket, replacement);
      const frame = await nextHello;
      socket.reply(frame.id, { clientId: 'renewed', server: { capabilities: {} } });
      await hello;
      expect(client.getRepositoryConnection()).not.toBe(captured);
      expect(client.getRepositoryConnection()).not.toBeNull();
      noReadBytes(socket, replacement);
      await assertClean(client);
    },
  );

  it('W3 observer closes the socket and starts replacement on the same client; neither receives the old read', async () => {
    const { client, socket, replacement, captured, socketFactory } = await setup();
    onRequest(client, () => {
      socket.emit('error', new Error('controlled old transport loss'));
      vi.advanceTimersByTime(1);
    });
    const observed = track(
      client.requestOnCapturedConnection(
        captured,
        method,
        params,
        undefined,
        undefined,
        () => true,
      ),
    );
    await observed.done;
    expect(observed.outcomes[0]).toHaveProperty('error');
    expect(socketFactory).toHaveBeenCalledTimes(2);
    await acknowledge(replacement, client);
    noReadBytes(socket, replacement);
    expect(client.getRepositoryConnection()).not.toBe(captured);
    await assertClean(client);
  });

  it.each(['observer', 'guard'] as const)(
    'W4 %s disposes the client; no write and no orphan pending entry survive',
    async (phase) => {
      const { client, socket, replacement, captured, socketFactory } = await setup();
      if (phase === 'observer') onRequest(client, () => client.dispose());
      const observed = track(
        client.requestOnCapturedConnection(captured, method, params, undefined, undefined, () => {
          if (phase === 'guard') client.dispose();
          return true;
        }),
      );
      await observed.done;
      noReadBytes(socket, replacement);
      expect(observed.outcomes).toEqual([
        {
          error: expect.objectContaining({
            message:
              phase === 'guard'
                ? 'JSON-RPC client disposed'
                : 'Captured repository connection is unavailable',
          }),
        },
      ]);
      await vi.advanceTimersByTimeAsync(200);
      expect(observed.outcomes).toHaveLength(1);
      expect(socketFactory).toHaveBeenCalledTimes(1);
      expect(client.beginRetirement().isDrained()).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it('W5 params.toJSON retires the origin before observers and the final guard', async () => {
    const { client, socket, replacement, captured } = await setup();
    const order: string[] = [];
    let current = true;
    onRequest(client, () => {
      order.push('observer');
    });
    const observed = track(
      client.requestOnCapturedConnection(
        captured,
        method,
        {
          toJSON() {
            order.push('serialize');
            current = false;
            return params;
          },
        },
        undefined,
        undefined,
        () => {
          order.push('guard');
          return current;
        },
      ),
    );
    await observed.done;
    expect(observed.outcomes[0]).toHaveProperty('error');
    expect(order).toEqual(['serialize', 'observer', 'guard']);
    noReadBytes(socket, replacement);
    await assertClean(client);
  });

  it.each(['false', 'throw'] as const)(
    'W6 a %s guard clears only its own pending timer and retains error identity',
    async (mode) => {
      const { client, socket, replacement, captured } = await setup();
      const error = new Error('controlled predicate failure');
      const observed = track(
        client.requestOnCapturedConnection(
          captured,
          method,
          params,
          { timeoutMs: 250 },
          undefined,
          () => {
            if (mode === 'throw') throw error;
            return false;
          },
        ),
      );
      await observed.done;
      if (mode === 'throw') expect(observed.outcomes).toEqual([{ error }]);
      else expect(observed.outcomes[0]).toHaveProperty('error');
      noReadBytes(socket, replacement);
      await vi.advanceTimersByTimeAsync(500);
      expect(observed.outcomes).toHaveLength(1);
      await assertClean(client);
    },
  );

  it('W7 write-property lookup retires the origin before the predicate is sampled', async () => {
    const { client, socket, replacement, captured } = await setup();
    let current = true;
    const order: string[] = [];
    Object.defineProperty(socket, 'write', {
      configurable: true,
      get() {
        order.push('lookup');
        current = false;
        return LifecycleDuplex.prototype.write;
      },
    });
    const observed = track(
      client.requestOnCapturedConnection(captured, method, params, undefined, undefined, () => {
        order.push('guard');
        return current;
      }),
    );
    await observed.done;
    expect(order).toEqual(['lookup', 'guard']);
    expect(observed.outcomes[0]).toHaveProperty('error');
    noReadBytes(socket, replacement);
    await assertClean(client);
  });

  it('W8 registers correlation before actual stream entry and handles a synchronous response exactly once', async () => {
    const { client, socket, captured } = await setup();
    const order: string[] = [];
    onRequest(client, () => {
      order.push('observer');
    });
    socket.written.on('frame', (frame) => {
      if (frame.method !== method) return;
      order.push('write');
      socket.reply(frame.id, result);
    });
    const observed = track(
      client.requestOnCapturedConnection(captured, method, params, undefined, undefined, () => {
        order.push('guard');
        return true;
      }),
    );
    await observed.done;
    expect(socket.frames[1]).toEqual({
      jsonrpc: '2.0',
      id: 2,
      method: 'file.exists',
      params: { workspaceId: 'ws-fence', path: '/repo/a.ts' },
    });
    expect(observed.outcomes).toEqual([
      { value: { exists: true, isFile: true, isDirectory: false } },
    ]);
    expect(order).toEqual(['observer', 'guard', 'write']);
    socket.reply(2, { exists: false, isFile: false, isDirectory: false });
    await vi.advanceTimersByTimeAsync(200);
    expect(observed.outcomes).toHaveLength(1);
    await assertClean(client);
  });

  it('W9 a denied captured read leaves a different pending request and its timeout untouched', async () => {
    const { client, socket, replacement, captured } = await setup();
    const other = track(
      client.request(
        'file.exists',
        { workspaceId: 'ws-fence', path: '/repo/b.ts' },
        { timeoutMs: 500 },
      ),
    );
    const denied = track(
      client.requestOnCapturedConnection(
        captured,
        method,
        params,
        undefined,
        undefined,
        () => false,
      ),
    );
    await denied.done;
    expect(denied.outcomes[0]).toHaveProperty('error');
    expect(other.outcomes).toEqual([]);
    expect(vi.getTimerCount()).toBe(1);
    expect(socket.frames.filter((frame) => frame.method === method)).toEqual([
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'file.exists',
        params: { workspaceId: 'ws-fence', path: '/repo/b.ts' },
      },
    ]);
    expect(replacement.frames).toEqual([]);
    socket.reply(2, result);
    await other.done;
    expect(other.outcomes).toEqual([{ value: result }]);
    await assertClean(client);
  });

  it('W10 callbacks inside the actual stream entry occur after the fence and do not imply physical-delivery atomicity', async () => {
    const { client, socket, captured } = await setup();
    let current = true;
    socket.written.on('frame', (frame) => {
      if (frame.method !== method) return;
      current = false;
      socket.reply(frame.id, result);
    });
    const observed = track(
      client.requestOnCapturedConnection(
        captured,
        method,
        params,
        undefined,
        undefined,
        () => current,
      ),
    );
    await observed.done;
    expect(current).toBe(false);
    expect(socket.frames.filter((frame) => frame.method === method)).toHaveLength(1);
    expect(observed.outcomes).toEqual([{ value: result }]);
    await assertClean(client);
  });

  it.each(['ordinary', 'captured', 'gitlab'] as const)(
    'W11 unguarded %s preserves serialization, observer, and write order',
    async (kind) => {
      const { client, socket, captured } = await setup();
      const order: string[] = [];
      const target = kind === 'gitlab' ? 'sourceControl.authStatus' : method;
      const value = kind === 'gitlab' ? { isConfigured: false } : result;
      const input =
        kind === 'gitlab'
          ? {
              provider: 'gitlab',
              host: 'git.example',
              instanceBaseUrl: 'https://git.example/Forge',
            }
          : params;
      const serializable = {
        ...input,
        toJSON() {
          order.push('serialize');
          return input;
        },
      };
      client.observeTraffic((event) => {
        if (event.type === 'request' && event.method === target) order.push('observer');
      });
      socket.written.on('frame', (frame) => {
        if (frame.method !== target) return;
        order.push('write');
        socket.reply(frame.id, value);
      });
      const observed = track(
        kind === 'captured'
          ? client.requestOnCapturedConnection(captured, target, serializable)
          : client.request(target, serializable),
      );
      await observed.done;
      expect(order).toEqual(['serialize', 'observer', 'write']);
      expect(observed.outcomes).toEqual([{ value }]);
      expect(socket.frames[1]).toEqual({ jsonrpc: '2.0', id: 2, method: target, params: input });
      await assertClean(client);
    },
  );

  it('W12 parent stays in argument five and the original producer survives independent admission closure', async () => {
    const { client, socket, captured } = await setup();
    const producer = client.beginOriginalProducer();
    const ticket = client.beginMemberRetirement();
    const denied = track(
      client.requestOnCapturedConnection(
        captured,
        method,
        params,
        undefined,
        undefined,
        () => true,
      ),
    );
    await denied.done;
    expect(denied.outcomes[0]).toHaveProperty('error');
    const original = track(
      client.requestOnCapturedConnection(
        captured,
        method,
        params,
        { timeoutMs: 300 },
        producer,
        () => true,
      ),
    );
    expect(socket.frames[1]).toEqual({
      jsonrpc: '2.0',
      id: 2,
      method: 'file.exists',
      params: { workspaceId: 'ws-fence', path: '/repo/a.ts' },
    });
    expect(ticket.isDrained()).toBe(false);
    socket.reply(2, result);
    await original.done;
    expect(original.outcomes).toEqual([{ value: result }]);
    expect(ticket.isDrained()).toBe(false);
    client.finishOriginalProducer(producer);
    await assertClean(client);
  });

  it('W13 predicate settlement before write retains its one response and removes the timer', async () => {
    const { client, socket, replacement, captured } = await setup();
    let requestId: number | string | undefined;
    const events: RpcTrafficEvent[] = [];
    client.observeTraffic((event) => {
      events.push(event);
      if (event.type === 'request' && event.method === method) requestId = event.requestId;
    });
    const observed = track(
      client.requestOnCapturedConnection(captured, method, params, undefined, undefined, () => {
        // Deliberately adversarial transport reentry, not a real daemon claim.
        socket.reply(requestId!, result);
        return true;
      }),
    );
    await observed.done;
    expect(observed.outcomes).toEqual([{ value: result }]);
    noReadBytes(socket, replacement);
    expect(events.map((event) => (event.type === 'response' ? event.status : event.type))).toEqual([
      'request',
      'success',
    ]);
    await vi.advanceTimersByTimeAsync(200);
    expect(observed.outcomes).toHaveLength(1);
    await assertClean(client);
  });

  it('W14 a primitive predicate failure uses the existing send-error normalization', async () => {
    const { client, socket, replacement, captured } = await setup();
    const events: RpcTrafficEvent[] = [];
    client.observeTraffic((event) => {
      events.push(event);
    });
    const observed = track(
      client.requestOnCapturedConnection(captured, method, params, undefined, undefined, () => {
        throw 'controlled primitive failure';
      }),
    );
    await observed.done;
    expect(observed.outcomes).toEqual([
      { error: expect.objectContaining({ message: 'controlled primitive failure' }) },
    ]);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'response',
        status: 'send-error',
        payload: { message: 'controlled primitive failure' },
      }),
    );
    noReadBytes(socket, replacement);
    await assertClean(client);
  });

  it('W15 an actual write-entry throw clears the guarded pending request without a retry', async () => {
    const { client, socket, replacement, captured, socketFactory } = await setup();
    const error = new Error('controlled stream entry failure');
    // Real Duplex.write enters _write, then the transport fixture raises here.
    socket.written.on('frame', (frame) => {
      if (frame.method === method) throw error;
    });
    const observed = track(
      client.requestOnCapturedConnection(
        captured,
        method,
        params,
        undefined,
        undefined,
        () => true,
      ),
    );
    await observed.done;
    expect(observed.outcomes).toEqual([{ error }]);
    expect(socket.frames.filter((frame) => frame.method === method)).toHaveLength(1);
    expect(replacement.frames).toEqual([]);
    expect(socketFactory).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(200);
    expect(observed.outcomes).toHaveLength(1);
    await assertClean(client);
  });
});
