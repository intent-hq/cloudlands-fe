import { EventEmitter } from 'node:events';
import { Duplex } from 'node:stream';
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  WorkspaceLoadReadOutcomeSchema,
  type WorkspaceLoadRouteRef,
} from '$shared/types/workspace-load-route';
import { stampWindowWithBackend } from '../../../../main/window-backend';
import { JsonRpcClient } from '../../../backend/main/json-rpc-client';
import { JsonRpcError, type JsonRpcErrorShape } from '../../../backend/main/json-rpc-errors';
import { createWorkspaceLoadRoutes } from '../workspace-load-route';

// Controlled Duplex only; no real daemon, IPC bridge, filesystem or native proof.
// Same strict-window harness boundary as repository-route-lifecycle.test.ts.
const windows = vi.hoisted(() => new Map<object, object>());
vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents: (sender: object) => windows.get(sender) ?? null },
}));

type Frame = { jsonrpc: '2.0'; id: number; method: string; params: unknown };
class ControlledSocket extends Duplex {
  readonly frames: Frame[] = [];
  private readonly waiting: Array<{ method: string; resolve: (frame: Frame) => void }> = [];
  private readonly claimed = new Set<Frame>();
  _read() {}
  _write(chunk: Buffer, _encoding: BufferEncoding, done: (error?: Error | null) => void) {
    const frame = JSON.parse(chunk.toString()) as Frame;
    this.frames.push(frame);
    const index = this.waiting.findIndex((waiter) => waiter.method === frame.method);
    if (index !== -1) {
      this.claimed.add(frame);
      this.waiting.splice(index, 1)[0].resolve(frame);
    }
    done();
  }
  next(method: string): Promise<Frame> {
    const frame = this.frames.find((row) => row.method === method && !this.claimed.has(row));
    if (frame) {
      this.claimed.add(frame);
      return Promise.resolve(frame);
    }
    return new Promise((resolve) => this.waiting.push({ method, resolve }));
  }
  reply(frame: Frame, result: unknown) {
    this.push(Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: frame.id, result }) + '\n'));
  }
  fail(frame: Frame, error: JsonRpcErrorShape) {
    this.push(Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: frame.id, error }) + '\n'));
  }
}

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  windows.clear();
});

function makeWindow(backend = 'local') {
  const sender = Object.assign(new EventEmitter(), { mainFrame: {}, isDestroyed: () => false });
  const window = Object.assign(new EventEmitter(), {
    webContents: sender,
    isDestroyed: () => false,
  });
  windows.set(sender, window);
  stampWindowWithBackend(window as unknown as BrowserWindow, backend);
  return {
    window: window as unknown as BrowserWindow,
    sender,
    event: { sender, senderFrame: sender.mainFrame } as unknown as IpcMainInvokeEvent,
  };
}

function makePeer() {
  const sockets: ControlledSocket[] = [];
  const client = new JsonRpcClient({
    config: { transport: 'uds', socketPath: '/controlled/workspace-load.sock' },
    socketFactory: () => {
      const socket = new ControlledSocket();
      sockets.push(socket);
      return socket;
    },
    heartbeatIntervalMs: 0,
    helloParams: () => ({ clientId: 'desktop-load-test' }),
  });
  cleanups.push(() => client.dispose());
  client.start();
  async function acknowledge() {
    const socket = sockets.at(-1)!;
    socket.emit('connect');
    const hello = await socket.next('client.hello');
    const connected = new Promise<void>((resolve) => {
      const listener = (status: string) => {
        if (status !== 'connected') return;
        client.off('status', listener);
        resolve();
      };
      client.on('status', listener);
    });
    socket.reply(hello, { clientId: 'acknowledged-desktop' });
    await connected;
    expect(client.getRepositoryConnection()).not.toBeNull();
  }
  return { client, sockets, acknowledge };
}

async function harness(ready = true) {
  const peer = makePeer();
  if (ready) await peer.acknowledge();
  const pool = new Map([['local', peer.client]]);
  const owner = makeWindow();
  const readBackend = vi.fn((id: string) => pool.get(id));
  const open = vi.fn(async () => {
    throw new Error('Unexpected OPEN in get-only lifecycle test');
  });
  const notify = vi.fn();
  const deps = {
    readBackend,
    open,
    notify,
    errorPayload: (error: unknown) =>
      error instanceof JsonRpcError
        ? error.toErrorPayload()
        : {
            code: 'TRANSPORT_ERROR',
            message: error instanceof Error ? error.message : String(error),
          },
  };
  const routes = createWorkspaceLoadRoutes(deps);
  cleanups.push(() => routes.dispose());
  const capture = (requestId = 'request-a', event = owner.event) => {
    const origin = routes.observeOrigin(event);
    return routes.prepare(event, { ...origin, requestId, workspaceId: 'amber-forest' });
  };
  const get = (ref: WorkspaceLoadRouteRef, event = owner.event) =>
    routes.read(event, { ...ref, operation: 'get' });
  return { ...peer, pool, owner, routes, capture, get, deps, readBackend, notify, open };
}

describe('workspace load route using original window and actual JsonRpcClient', () => {
  it('sends exact get to the captured client and rejects other frames and tuples without writes', async () => {
    const h = await harness();
    const ref = h.capture();
    const socket = h.sockets[0];
    const other = makeWindow();
    for (const event of [
      other.event,
      { ...h.owner.event, senderFrame: {} } as IpcMainInvokeEvent,
    ]) {
      expect(await h.get(ref, event)).toEqual({ ref, current: false, reason: 'retired' });
    }
    for (const changed of [
      { routeId: 'forged' },
      { originId: 'forged' },
      { requestId: 'forged' },
      { workspaceId: 'another-workspace' },
    ])
      expect((await h.get({ ...ref, ...changed })).current).toBe(false);
    await expect(
      h.routes.read(h.owner.event, { ...ref, operation: 'get', localMachine: true }),
    ).rejects.toThrow();
    await expect(
      h.routes.read(h.owner.event, { ...ref, operation: 'settings.get' }),
    ).rejects.toThrow();
    expect(socket.frames.map((f) => f.method)).toEqual(['client.hello']);
    const pending = h.get(ref);
    const frame = await socket.next('workspace.get');
    expect(frame).toEqual({
      jsonrpc: '2.0',
      id: 2,
      method: 'workspace.get',
      params: { workspaceId: 'amber-forest' },
    });
    socket.reply(frame, { workspace: { id: 'amber-forest', title: 'Original' } });
    expect(WorkspaceLoadReadOutcomeSchema.parse(await pending)).toEqual({
      ref,
      current: true,
      settlement: {
        status: 'fulfilled',
        value: { workspace: { id: 'amber-forest', title: 'Original' } },
      },
    });
  });

  it('refuses unbound, remote and prehello origins without triggering readiness itself', async () => {
    const h = await harness(false);
    expect(() => h.capture()).toThrow();
    expect(h.sockets[0].frames).toEqual([]);
    const unbound = makeWindow();
    windows.delete(unbound.sender);
    expect(() => h.capture('unbound', unbound.event)).toThrow();
    expect(() => h.capture('remote', makeWindow('saved-remote').event)).toThrow();
    await h.acknowledge();
    const ref = h.capture('new-intent');
    expect(ref.requestId).toBe('new-intent');
    expect(h.sockets[0].frames.map((f) => f.method)).toEqual(['client.hello']);
  });

  it.each(['restamp', 'navigation', 'frame', 'crash', 'close', 'pool'] as const)(
    'permanently rejects held settlement after %s retirement even without delivered notice',
    async (cause) => {
      const h = await harness();
      const ref = h.capture();
      const pending = h.get(ref);
      const frame = await h.sockets[0].next('workspace.get');
      if (cause === 'restamp') stampWindowWithBackend(h.owner.window, 'local');
      if (cause === 'navigation')
        h.owner.sender.emit('did-start-navigation', {}, 'app://next', false, true);
      if (cause === 'frame') h.owner.sender.mainFrame = {};
      if (cause === 'crash') h.owner.sender.emit('render-process-gone');
      if (cause === 'close') h.owner.window.emit('closed');
      if (cause === 'pool') {
        h.routes.retireClient(h.client);
        h.pool.delete('local');
        h.pool.set('local', h.client); // Reinsertion cannot revive the old member.
      }
      h.sockets[0].reply(frame, { workspace: { id: 'amber-forest' } });
      expect(await pending).toEqual({ ref, current: false, reason: 'retired' });
      expect((await h.get(ref)).current).toBe(false);
      expect(h.sockets[0].frames.map((f) => f.method)).toEqual(['client.hello', 'workspace.get']);
      // notify is intentionally retained in main; no renderer event is delivered here.
    },
  );

  it('does not follow another real pool client or a same-ID rehello', async () => {
    const h = await harness();
    const ref = h.capture();
    const replacement = makePeer();
    await replacement.acknowledge();
    h.routes.retireClient(h.client);
    h.pool.set('local', replacement.client);
    expect((await h.get(ref)).current).toBe(false);
    expect(replacement.sockets[0].frames.map((f) => f.method)).toEqual(['client.hello']);
    const next = h.capture('new-member');
    const hello = replacement.client.request('client.hello', {});
    const helloFrame = await replacement.sockets[0].next('client.hello');
    replacement.sockets[0].reply(helloFrame, { clientId: 'acknowledged-desktop' });
    await hello;
    expect((await h.get(next)).current).toBe(false);
  });

  it('preserves ordinary original daemon rejection as current with exact error fields', async () => {
    const h = await harness();
    const ref = h.capture();
    const pending = h.get(ref);
    const frame = await h.sockets[0].next('workspace.get');
    h.sockets[0].fail(frame, {
      code: -32003,
      message: 'Access denied',
      data: { code: 'FORBIDDEN', resource: 'workspace' },
    });
    expect(await pending).toEqual({
      ref,
      current: true,
      settlement: {
        status: 'rejected',
        error: {
          code: 'FORBIDDEN',
          message: 'Access denied',
          data: { code: 'FORBIDDEN', resource: 'workspace' },
          rpcCode: -32003,
        },
      },
    });
    const retry = h.get(ref);
    const retryFrame = await h.sockets[0].next('workspace.get');
    h.sockets[0].reply(retryFrame, { workspace: { id: 'amber-forest' } });
    expect((await retry).current).toBe(true);
  });

  it('checks monotonic retirement after a dependency lookup reenters with same-ID restamping', async () => {
    const h = await harness();
    const ref = h.capture();
    h.readBackend.mockImplementationOnce(() => {
      stampWindowWithBackend(h.owner.window, 'local');
      return h.client;
    });
    expect((await h.get(ref)).current).toBe(false);
    expect(h.sockets[0].frames.map((f) => f.method)).toEqual(['client.hello']);
  });

  it('resolves the real captured-method getter before its final fence', async () => {
    const h = await harness();
    const ref = h.capture();
    const actual = h.client.requestOnCapturedConnection;
    Object.defineProperty(h.client, 'requestOnCapturedConnection', {
      configurable: true,
      get() {
        h.routes.release(h.owner.event, ref);
        return actual;
      },
    });
    expect((await h.get(ref)).current).toBe(false);
    expect(h.sockets[0].frames.map((f) => f.method)).toEqual(['client.hello']);
  });

  it('resolves the injected OPEN getter before its final fence', async () => {
    const h = await harness();
    const ref = h.capture();
    Object.defineProperty(h.deps, 'open', {
      get() {
        stampWindowWithBackend(h.owner.window, 'local');
        return h.open;
      },
    });
    expect((await h.routes.read(h.owner.event, { ...ref, operation: 'open' })).current).toBe(false);
    expect(h.open).not.toHaveBeenCalled();
    expect(h.sockets[0].frames.map((f) => f.method)).toEqual(['client.hello']);
  });

  it('fences traffic-observer retirement at the actual write with the separately reviewed predicate', async () => {
    const h = await harness();
    const ref = h.capture();
    cleanups.push(
      h.client.observeTraffic((event) => {
        if (event.type === 'request' && event.method === 'workspace.get')
          stampWindowWithBackend(h.owner.window, 'local');
      }),
    );
    expect((await h.get(ref)).current).toBe(false);
    expect(h.sockets[0].frames.map((f) => f.method)).toEqual(['client.hello']);
  });

  it('settles retirement in the same response when error conversion reenters', async () => {
    const h = await harness();
    const ref = h.capture();
    const pending = h.get(ref);
    const frame = await h.sockets[0].next('workspace.get');
    const convert = h.deps.errorPayload;
    Object.defineProperty(h.deps, 'errorPayload', {
      get() {
        h.routes.release(h.owner.event, ref);
        return convert;
      },
    });
    h.sockets[0].fail(frame, { code: -32603, message: 'Original daemon failure' });
    expect(await pending).toEqual({ ref, current: false, reason: 'retired' });
  });

  it('does not claim that a settled current response observes a later main retirement', async () => {
    const h = await harness();
    const ref = h.capture();
    const pending = h.get(ref);
    const frame = await h.sockets[0].next('workspace.get');
    h.sockets[0].reply(frame, { workspace: { id: 'amber-forest' } });
    const settled = await pending;
    h.routes.release(h.owner.event, ref);
    expect(settled.current).toBe(true);
    expect((await h.get(ref)).current).toBe(false);
    expect(h.notify).toHaveBeenCalled(); // Main queued a notice; no renderer delivery is claimed.
  });

  it('releases only original scope idempotently and never disposes its shared client', async () => {
    const h = await harness();
    const origin = h.routes.observeOrigin(h.owner.event);
    const a = h.routes.prepare(h.owner.event, {
      ...origin,
      workspaceId: 'amber-forest',
      requestId: 'a',
    });
    const b = h.routes.prepare(h.owner.event, {
      ...origin,
      workspaceId: 'amber-forest',
      requestId: 'b',
    });
    h.readBackend.mockClear();
    h.routes.release(h.owner.event, a);
    h.routes.release(h.owner.event, a);
    expect(h.readBackend).not.toHaveBeenCalled();
    expect(
      h.notify.mock.calls.filter(
        ([, event]) => event.kind === 'route' && event.routeId === a.routeId,
      ),
    ).toHaveLength(1);
    expect(() =>
      h.routes.prepare(h.owner.event, { ...origin, workspaceId: 'amber-forest', requestId: 'a' }),
    ).toThrow();
    expect((await h.get(a)).current).toBe(false);
    const pending = h.get(b);
    const frame = await h.sockets[0].next('workspace.get');
    h.sockets[0].reply(frame, { workspace: { id: 'amber-forest' } });
    expect((await pending).current).toBe(true);
    h.routes.releaseOrigin(h.owner.event, origin);
    h.routes.releaseOrigin(h.owner.event, origin);
    expect(h.client.getRepositoryConnection()).not.toBeNull();
    expect(h.sockets[0].destroyed).toBe(false);
  });

  it('retires a scope when overlapping read capacity is exceeded and settles original reads', async () => {
    const h = await harness();
    const ref = h.capture();
    const a = h.get(ref);
    const aFrame = await h.sockets[0].next('workspace.get');
    const b = h.get(ref);
    const bFrame = await h.sockets[0].next('workspace.get');
    expect((await h.get(ref)).current).toBe(false);
    h.sockets[0].reply(aFrame, { workspace: { id: 'amber-forest' } });
    h.sockets[0].fail(bFrame, { code: -32602, message: 'Workspace not found' });
    expect((await a).current).toBe(false);
    expect((await b).current).toBe(false);
    expect(h.sockets[0].frames.map((f) => f.method)).toEqual([
      'client.hello',
      'workspace.get',
      'workspace.get',
    ]);
  });

  it('bounds origins and consumed request IDs without using a daemon round trip', async () => {
    const h = await harness();
    const origins = Array.from({ length: 8 }, () => h.routes.observeOrigin(h.owner.event));
    expect(() => h.routes.observeOrigin(h.owner.event)).toThrow();
    for (let index = 0; index < 128; index++) {
      const ref = h.routes.prepare(h.owner.event, {
        ...origins[0],
        requestId: `request-${index}`,
        workspaceId: 'amber-forest',
      });
      h.routes.release(h.owner.event, ref);
    }
    expect(() =>
      h.routes.prepare(h.owner.event, {
        ...origins[0],
        requestId: 'overflow',
        workspaceId: 'amber-forest',
      }),
    ).toThrow();
    expect(h.sockets[0].frames.map((f) => f.method)).toEqual(['client.hello']);
  });

  it('expires original origins without renewing them when reads resume', async () => {
    const h = await harness();
    vi.useFakeTimers();
    const ref = h.capture();
    await vi.advanceTimersByTimeAsync(300_001);
    expect((await h.get(ref)).current).toBe(false);
    expect(h.sockets[0].frames.map((f) => f.method)).toEqual(['client.hello']);
  });
});
