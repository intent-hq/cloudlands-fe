import { RecoveryResource } from '$shared/event-recovery/resource';
import { EventEmitter } from 'node:events';
import type { Duplex } from 'node:stream';
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import { createEventRecoveryTransport } from '$lib/client/live/event-recovery-transport';
import { EventRecoveryCoordinator } from '../../events/event-recovery-coordinator';
import { stampWindowWithBackend } from '../../../main/window-backend';
import { JsonRpcClient } from './json-rpc-client';
import { registerEventRecoveryHandlers } from './event-recovery-ipc';

const windows = vi.hoisted(() => new Map<object, object>());
vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents: (sender: object) => windows.get(sender) ?? null },
}));
const cleanup: Array<() => void> = [];
afterEach(() => {
  cleanup.splice(0).forEach((fn) => fn());
  windows.clear();
  vi.useRealTimers();
});
class Socket extends EventEmitter {
  destroyed = false;
  frames: Array<{ id: number; method: string; params: unknown }> = [];
  write(line: string) {
    const frame = JSON.parse(line);
    this.frames.push(frame);
    if (frame.method === 'client.hello')
      queueMicrotask(() =>
        this.reply(frame.id, {
          clientId: 'desktop',
          server: { capabilities: { eventStreamRecovery: 1 } },
        }),
      );
    return true;
  }
  reply(id: number, result: unknown) {
    this.emit('data', Buffer.from(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n'));
  }
  batch(frames: unknown[]) {
    this.emit('data', Buffer.from(frames.map((f) => JSON.stringify(f)).join('\n') + '\n'));
  }
  destroy() {
    this.destroyed = true;
  }
}
async function harness() {
  const socket = new Socket(),
    client = new JsonRpcClient({
      socketFactory: () => socket as unknown as Duplex,
      helloParams: () => ({ clientId: 'desktop' }),
      heartbeatIntervalMs: 0,
    });
  const handlers = new Map<string, (event: IpcMainInvokeEvent, payload: unknown) => unknown>();
  const registry = registerEventRecoveryHandlers(
    {
      handle: (channel, fn) => {
        handlers.set(channel, fn);
      },
    },
    { readBackend: (id) => (id === 'A' ? client : undefined) },
  );
  cleanup.push(() => {
    registry.dispose();
    client.dispose();
  });
  client.start();
  socket.emit('connect');
  for (let i = 0; i < 20; i++) await Promise.resolve();
  function createSender() {
    const listeners = new Map<string, (value: unknown) => void>();
    let counter = 0;
    const delivered: unknown[] = [];
    const frame = {
      send: (channel: string, value: unknown) => {
        delivered.push(value);
        if (channel === IPC_CHANNELS.BACKEND.EVENT_RECOVERY.FRAME)
          for (const fn of [...listeners.values()]) fn(value);
      },
    };
    const sender = Object.assign(new EventEmitter(), {
      mainFrame: frame,
      isDestroyed: () => false,
    });
    const window = Object.assign(new EventEmitter(), {
      webContents: sender,
      isDestroyed: () => false,
    });
    windows.set(sender, window);
    stampWindowWithBackend(window as unknown as BrowserWindow, 'A');
    const event = { sender, senderFrame: frame } as unknown as IpcMainInvokeEvent;
    const bridge = {
      on: (_channel: string, fn: (value: unknown) => void) => {
        const id = String(++counter);
        listeners.set(id, fn);
        return id;
      },
      offById: (_channel: string, id: string) => listeners.delete(id),
      invoke: vi.fn((channel: string, payload: unknown) =>
        Promise.resolve(handlers.get(channel)!(event, payload)),
      ),
    };
    const capture = createEventRecoveryTransport(() => bridge as unknown as Window['electronAPI']);
    return { capture, window, bridge, event, delivered };
  }
  return { socket, client, handlers, createSender, ...createSender() };
}

describe('Electron recovery IPC through real JSON-RPC decode', () => {
  it('observes notification processing before fence even when all frames share one socket chunk', async () => {
    const h = await harness(),
      session = await h.capture();
    cleanup.push(() => session.dispose());
    expect(session.supported).toBe(true);
    const subscribed = session.request('events.subscribe', {
      eventTypes: ['file:*'],
      lossRecovery: 1,
    });
    h.socket.reply(h.socket.frames.at(-1)!.id, { subscriptionId: 'a', lossRecovery: 1 });
    await subscribed;
    for (let i = 0; i < 20; i++) await Promise.resolve();
    let release!: () => void;
    const order: string[] = [];
    session.onNotification((n) =>
      n.method === 'events.lost'
        ? new Promise<void>((resolve) => {
            release = () => {
              order.push('loss');
              resolve();
            };
          })
        : void order.push('later'),
    );
    const fence = session.fence(['a'], () => {
      order.push('fence');
    });
    const request = h.socket.frames.at(-1)!;
    expect(request).toMatchObject({ method: 'events.fence', params: { subscriptionIds: ['a'] } });
    h.socket.batch([
      {
        method: 'events.lost',
        params: { subscriptionId: 'a', generation: '1', scope: { workspaceId: null } },
      },
      { id: request.id, result: { subscriptionIds: ['a'] } },
      { method: 'events.event', params: { subscriptionId: 'a' } },
    ]);
    expect(order).toEqual([]);
    release();
    await fence;
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(order).toEqual(['loss', 'fence', 'later']);
  });
  it('admits the subscription before delivering same-chunk domain notifications', async () => {
    const h = await harness(),
      session = await h.capture();
    cleanup.push(() => session.dispose());
    let admitted = false;
    const observations: boolean[] = [];
    session.onNotification(() => {
      observations.push(admitted);
    });
    const subscribing = (async () => {
      await session.request('events.subscribe', { eventTypes: ['file:*'], lossRecovery: 1 });
      admitted = true;
    })();
    const request = h.socket.frames.at(-1)!;
    h.socket.batch([
      { id: request.id, result: { subscriptionId: 'a', lossRecovery: 1 } },
      { method: 'events.event', params: { subscriptionId: 'a', event: { type: 'file:changed' } } },
    ]);
    await subscribing;
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(observations).toEqual([true]);
  });

  it('keeps partial adoption and mixed writers behind the owner processing barrier', async () => {
    const h = await harness();
    const session = await h.capture();
    const unhandled = vi.fn();
    const coordinator = new EventRecoveryCoordinator(session, unhandled);
    cleanup.push(() => coordinator.dispose());
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const write = vi.fn();
    const read = vi.fn(async () => 'snapshot');
    const resource = coordinator.registerResource({
      key: 'files:ws-a',
      workspaceId: 'ws-a',
      eventTypes: ['file:*'],
      read,
      apply: vi.fn(),
      invalidate: vi.fn(),
      retire: vi.fn(),
      onEvent: async (_event, lifetime) => {
        await held;
        lifetime.commit(write);
      },
    });
    async function subscribe(id: string, type: string, recover: boolean) {
      const pending = coordinator.subscribe(
        { workspaceId: 'ws-a', eventTypes: [type] },
        { recover },
      );
      h.socket.reply(h.socket.frames.at(-1)!.id, {
        subscriptionId: id,
        ...(recover ? { lossRecovery: 1 } : {}),
      });
      await pending;
    }
    await subscribe('a', 'file:*', true);
    await subscribe('unrelated', 'note:*', false);
    await subscribe('mixed', 'file:*', false);
    const event = (subscriptionId: string, type: string) => ({
      method: 'events.event',
      params: { subscriptionId, event: { type, workspaceId: 'ws-a' } },
    });
    h.socket.batch([event('unrelated', 'note:changed'), event('mixed', 'file:changed')]);
    const observed = vi.fn();
    const fence = session.fence(['a'], observed);
    h.socket.batch([
      { id: h.socket.frames.at(-1)!.id, result: { subscriptionIds: ['a'] } },
      event('unrelated', 'note:changed'),
    ]);
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(unhandled).toHaveBeenCalledOnce();
    expect(observed).not.toHaveBeenCalled();
    resource.changeLifetime();
    release();
    await fence;
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(write).not.toHaveBeenCalled();
    expect(unhandled).toHaveBeenCalledTimes(2);
    expect(observed).toHaveBeenCalledOnce();
    h.socket.batch([
      {
        method: 'events.lost',
        params: {
          subscriptionId: 'a',
          generation: '1',
          scope: { workspaceId: 'ws-a' },
        },
      },
    ]);
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(read).not.toHaveBeenCalled();
    expect(h.socket.frames.filter((f) => f.method === 'events.fence')).toHaveLength(1);
  });

  it('retires on backend ABA and rejects old in-flight read replies', async () => {
    const h = await harness(),
      session = await h.capture();
    cleanup.push(() => session.dispose());
    const read = session.request('file.read', { workspaceId: 'ws-a' });
    const rejected = expect(read).rejects.toThrow();
    const request = h.socket.frames.at(-1)!;
    stampWindowWithBackend(h.window as unknown as BrowserWindow, 'B');
    stampWindowWithBackend(h.window as unknown as BrowserWindow, 'A');
    h.socket.reply(request.id, { content: 'old' });
    await rejected;
    expect(session.isCurrent()).toBe(false);
    const count = h.socket.frames.length;
    await expect(session.request('file.read', {})).rejects.toThrow();
    expect(h.socket.frames).toHaveLength(count);
  });
  it('retires on same-socket principal re-handshake', async () => {
    const h = await harness(),
      session = await h.capture();
    cleanup.push(() => session.dispose());
    await h.client.request('client.hello', {});
    expect(session.isCurrent()).toBe(false);
  });
});

describe('recovery renderer authority', () => {
  it('never forwards private repository authority frames to either same-backend sender', async () => {
    const h = await harness();
    const other = h.createSender();
    const a = await h.capture();
    const b = await other.capture();
    cleanup.push(() => {
      a.dispose();
      b.dispose();
    });
    const receivedA = vi.fn(),
      receivedB = vi.fn();
    a.onNotification(receivedA);
    b.onNotification(receivedB);
    for (const method of [
      'workspace.repositoryContext.retired',
      'sourceControl.read.retired',
      'workspace.repositorySelection.retired',
      'accept-changes.retired',
    ]) {
      h.socket.batch([{ method, params: { selectionIds: ['sender-A-private-authority'] } }]);
    }
    expect(receivedA).not.toHaveBeenCalled();
    expect(receivedB).not.toHaveBeenCalled();
    expect(h.delivered).toEqual([]);
    expect(other.delivered).toEqual([]);
  });
  it.each([
    ['sourceControl.read.capture', {}],
    ['sourceControl.read.status', {}],
    ['sourceControl.checkout.capture', {}],
    ['sourceControl.checkout.prepare', {}],
    ['workspace.repositoryContext', {}],
    ['workspace.repositoryContext.capture', {}],
    ['workspace.repositoryContext.release', {}],
    ['workspace.repositorySelection.capture', {}],
    ['workspace.repositorySelection.save', {}],
    ['workspace.repositorySelection.reset', {}],
    ['workspace.repositorySelection.reconcile', {}],
    ['workspace.repositorySelection.release', {}],
    ['accept-changes.reconcile', {}],
    ['accept-changes.release', {}],
    ['accept-changes.prepare', { review: null }],
    ['accept-changes.execute', { review: {} }],
    ['workspace.create', { repositoryCheckout: null }],
  ])('rejects protected %s without dispatching to the daemon', async (method, params) => {
    const h = await harness();
    const session = await h.capture();
    cleanup.push(() => session.dispose());
    const before = h.socket.frames.length;
    const result = session.request(method as string, params).then(
      () => 'allowed',
      () => 'denied',
    );
    const calls = h.socket.frames.slice(before);
    for (const call of calls) h.socket.reply(call.id, {});
    expect(await result).toBe('denied');
    expect(calls).toEqual([]);
  });
  it('rejects foreign frames and same-backend senders using another recovery handle', async () => {
    const h = await harness();
    const channels = IPC_CHANNELS.BACKEND.EVENT_RECOVERY;
    const captured = (await h.handlers.get(channels.CAPTURE)!(h.event, {})) as {
      result: { id: string };
    };
    const other = h.createSender();
    const before = h.socket.frames.length;
    for (const event of [
      other.event,
      { ...h.event, senderFrame: {} },
      { sender: {}, senderFrame: {} },
    ]) {
      const result = await h.handlers.get(channels.REQUEST)!(event as IpcMainInvokeEvent, {
        id: captured.result.id,
        method: 'git.status',
        params: {},
      });
      expect(result).toMatchObject({ ok: false });
    }
    expect(h.socket.frames).toHaveLength(before);
  });
});

it('isolates subscription notifications, replacement groups and controls between same-backend windows', async () => {
  const h = await harness();
  const other = h.createSender();
  const a = await h.capture(),
    b = await other.capture();
  cleanup.push(() => {
    a.dispose();
    b.dispose();
  });
  const receivedA = vi.fn(),
    receivedB = vi.fn();
  a.onNotification(receivedA);
  b.onNotification(receivedB);
  const params = { eventTypes: ['file:*'], replaceGroup: 'files', lossRecovery: 1 };
  const subscribingA = a.request('events.subscribe', params);
  const requestA = h.socket.frames.at(-1)!;
  const subscribingB = b.request('events.subscribe', params);
  const requestB = h.socket.frames.at(-1)!;
  const loss = (subscriptionId: string) => ({
    method: 'events.lost',
    params: {
      subscriptionId,
      generation: '1',
      scope: { workspaceId: null },
    },
  });
  h.socket.batch([
    loss('a'),
    loss('b'),
    { id: requestB.id, result: { subscriptionId: 'b', lossRecovery: 1 } },
    { id: requestA.id, result: { subscriptionId: 'a', lossRecovery: 1 } },
  ]);
  await Promise.all([subscribingA, subscribingB]);
  for (let i = 0; i < 20; i++) await Promise.resolve();
  expect(receivedA).toHaveBeenCalledExactlyOnceWith(loss('a'));
  expect(receivedB).toHaveBeenCalledExactlyOnceWith(loss('b'));
  expect((requestA.params as { replaceGroup: string }).replaceGroup).not.toBe(
    (requestB.params as { replaceGroup: string }).replaceGroup,
  );
  const before = h.socket.frames.length;
  await expect(b.request('events.unsubscribe', { subscriptionId: 'a' })).rejects.toThrow();
  await expect(b.fence(['a'], vi.fn())).rejects.toThrow();
  expect(h.socket.frames).toHaveLength(before);
});

it.each(['git.status', 'file.read'])('preserves captured %s reads', async (method) => {
  const h = await harness();
  const session = await h.capture();
  cleanup.push(() => session.dispose());
  const read = session.request(method, { workspaceId: 'ws-a' });
  const request = h.socket.frames.at(-1)!;
  expect(request.method).toBe(method);
  h.socket.reply(request.id, { value: 'current' });
  await expect(read).resolves.toEqual({ value: 'current' });
});

it('retires a capture when pre-ack staging overflows and cleans up its late subscription', async () => {
  const h = await harness();
  const session = await h.capture();
  cleanup.push(() => session.dispose());
  const subscribing = session.request('events.subscribe', { eventTypes: ['file:*'] });
  const rejected = expect(subscribing).rejects.toThrow();
  const request = h.socket.frames.at(-1)!;
  h.socket.batch(
    Array.from({ length: 65 }, (_, i) => ({
      method: 'events.lost',
      params: { subscriptionId: 'early-' + i },
    })),
  );
  await rejected;
  expect(session.isCurrent()).toBe(false);
  h.socket.reply(request.id, { subscriptionId: 'late' });
  for (let i = 0; i < 20; i++) await Promise.resolve();
  expect(h.socket.frames.at(-1)).toMatchObject({
    method: 'events.unsubscribe',
    params: { subscriptionId: 'late' },
  });
});

it.each([
  [-32602, 'not-found'],
  [-32003, 'forbidden'],
  [-32001, 'unauthorized'],
] as const)('retires a recovery resource on canonical IPC error %s/%s', async (rpcCode, code) => {
  const h = await harness();
  const session = await h.capture();
  cleanup.push(() => session.dispose());
  const subscribe = session.request('events.subscribe', {
    eventTypes: ['file:*'],
    lossRecovery: 1,
  });
  h.socket.reply(h.socket.frames.at(-1)!.id, { subscriptionId: 'a', lossRecovery: 1 });
  await subscribe;
  const retired = vi.fn(),
    apply = vi.fn();
  const resource = new RecoveryResource({
    read: () => session.request('file.read', { workspaceId: 'ws-a' }),
    fence: (ids, observe) => session.fence(ids, observe),
    apply,
    invalidate: vi.fn(),
    retire: retired,
  });
  cleanup.push(() => resource.dispose());
  resource.setLeases([{ id: 'a', lifetime: {} }]);
  resource.invalidate();
  expect(h.socket.frames.at(-1)!.method).toBe('events.fence');
  h.socket.reply(h.socket.frames.at(-1)!.id, { subscriptionIds: ['a'] });
  for (let i = 0; i < 20; i++) await Promise.resolve();
  expect(h.socket.frames.at(-1)!.method).toBe('file.read');
  h.socket.batch([
    {
      id: h.socket.frames.at(-1)!.id,
      error: { code: rpcCode, message: 'Unavailable', data: { code } },
    },
  ]);
  for (let i = 0; i < 20; i++) await Promise.resolve();
  expect(retired).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ rpcCode, code, data: { code } }),
  );
  expect(resource.status).toMatchObject({ stale: false, suspended: true });
  expect(apply).not.toHaveBeenCalled();
  expect(
    h.socket.frames.filter((f) => ['file.read', 'events.fence'].includes(f.method)),
  ).toHaveLength(2);
});
