import { registerOrdinaryRequestCompletions } from './ordinary-request-completion';
import { JsonRpcError } from './json-rpc-errors';
import { captureMainEventRecovery, onMainEventRecoveryReady } from './main-event-recovery';
import { RecoveryRequestTimeoutError } from '$shared/event-recovery/session';
import { RecoveryResource } from '$shared/event-recovery/resource';
import { EventEmitter } from 'node:events';
import type { Duplex } from 'node:stream';
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import {
  createEventRecoveryTransport,
  onElectronEventRecoveryReady,
} from '$lib/client/live/event-recovery-transport';
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
    const listeners = new Map<string, { channel: string; fn: (value: unknown) => void }>();
    let counter = 0;
    const delivered: unknown[] = [];
    const frame = {
      send: (channel: string, value: unknown) => {
        delivered.push(value);
        for (const listener of [...listeners.values()])
          if (listener.channel === channel) listener.fn(value);
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
      on: (channel: string, fn: (value: unknown) => void) => {
        const id = String(++counter);
        listeners.set(id, { channel, fn });
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
    ['chat.subscribe', {}],
    ['presence.focus.subscribe', {}],
    ['note.presence.subscribe', {}],
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
    { id: requestB.id, result: { subscriptionId: 'b', lossRecovery: 1 } },
    loss('b'),
    { id: requestA.id, result: { subscriptionId: 'a', lossRecovery: 1 } },
    loss('a'),
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

it('ignores foreign traffic while another sender is awaiting subscription admission', async () => {
  const h = await harness();
  const other = h.createSender();
  const a = await h.capture(),
    b = await other.capture();
  const coordinator = new EventRecoveryCoordinator(b);
  cleanup.push(() => {
    a.dispose();
    coordinator.dispose();
  });
  const subscribedA = a.request('events.subscribe', { eventTypes: ['file:*'], lossRecovery: 1 });
  h.socket.reply(h.socket.frames.at(-1)!.id, { subscriptionId: 'a', lossRecovery: 1 });
  await subscribedA;
  const apply = vi.fn();
  coordinator.registerResource({
    key: 'files:ws-a',
    workspaceId: 'ws-a',
    eventTypes: ['file:*'],
    read: (reader) => reader.request('file.read', { workspaceId: 'ws-a' }),
    apply,
    invalidate: vi.fn(),
    retire: vi.fn(),
  });
  const subscribedB = coordinator
    .subscribe({ workspaceId: 'ws-a', eventTypes: ['file:*'] }, { recover: true })
    .catch((error) => error);
  const requestB = h.socket.frames.at(-1)!;
  h.socket.batch(
    Array.from({ length: 130 }, (_, i) =>
      i % 2
        ? {
            method: 'events.event',
            params: { subscriptionId: 'a', event: { type: 'file:changed', workspaceId: 'ws-a' } },
          }
        : {
            method: 'events.lost',
            params: {
              subscriptionId: 'a',
              generation: String(i + 1),
              scope: { workspaceId: null },
            },
          },
    ),
  );
  expect(b.isCurrent()).toBe(true);
  expect(h.socket.frames.filter((f) => f.method === 'file.read')).toHaveLength(0);
  h.socket.batch([
    { id: requestB.id, result: { subscriptionId: 'b', lossRecovery: 1 } },
    {
      method: 'events.lost',
      params: { subscriptionId: 'b', generation: '1', scope: { workspaceId: 'ws-a' } },
    },
  ]);
  expect(await subscribedB).toMatchObject({ id: 'b' });
  for (let i = 0; i < 20; i++) await Promise.resolve();
  expect(h.socket.frames.at(-1)!.method).toBe('events.fence');
  h.socket.reply(h.socket.frames.at(-1)!.id, { subscriptionIds: ['b'] });
  for (let i = 0; i < 20; i++) await Promise.resolve();
  expect(h.socket.frames.at(-1)!.method).toBe('file.read');
  h.socket.reply(h.socket.frames.at(-1)!.id, { value: 'current' });
  for (let i = 0; i < 20; i++) await Promise.resolve();
  expect(h.socket.frames.at(-1)!.method).toBe('events.fence');
  h.socket.reply(h.socket.frames.at(-1)!.id, { subscriptionIds: ['b'] });
  for (let i = 0; i < 20; i++) await Promise.resolve();
  expect(apply).toHaveBeenCalledExactlyOnceWith({ value: 'current' });
  expect(
    h.socket.frames.filter((f) => ['file.read', 'events.fence'].includes(f.method)),
  ).toHaveLength(3);
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

const typedChannels = [
  ['note.subscribe', 'note.unsubscribe'],
  ['task.subscribe', 'task.unsubscribe'],
  ['comment.subscribe', 'comment.unsubscribe'],
  ['workspace.subscribe', 'workspace.unsubscribe'],
  ['agent.subscribe', 'events.unsubscribe'],
] as const;

describe.each(typedChannels)('captured typed lease %s', (subscribe, unsubscribe) => {
  const params = subscribe === 'workspace.subscribe' ? {} : { workspaceId: 'ws-a' };
  it('cleans an owned lease and excludes it from generic fences', async () => {
    const h = await harness();
    const session = await h.capture();
    const pending = session.request(subscribe, params);
    h.socket.reply(h.socket.frames.at(-1)!.id, { subscriptionId: 'typed' });
    await pending;
    const before = h.socket.frames.length;
    await expect(session.fence(['typed'], vi.fn())).rejects.toThrow();
    expect(h.socket.frames).toHaveLength(before);
    const stopping = session.request(unsubscribe, {
      workspaceId: 'forged',
      subscriptionId: 'typed',
    });
    expect(h.socket.frames.at(-1)).toMatchObject({
      method: unsubscribe,
      params: { ...params, subscriptionId: 'typed' },
    });
    expect(h.socket.frames.at(-1)!.params).not.toHaveProperty('workspaceId', 'forged');
    h.socket.reply(h.socket.frames.at(-1)!.id, {});
    await stopping;
    session.dispose();
    expect(h.socket.frames.filter((f) => f.method === unsubscribe)).toHaveLength(1);
  });
  it('rejects foreign and unknown lease IDs without daemon dispatch', async () => {
    const h = await harness();
    const session = await h.capture();
    const other = await h.createSender().capture();
    cleanup.push(() => {
      session.dispose();
      other.dispose();
    });
    const pending = session.request(subscribe, params);
    h.socket.reply(h.socket.frames.at(-1)!.id, { subscriptionId: 'typed' });
    await pending;
    const before = h.socket.frames.length;
    for (const [owner, id] of [
      [other, 'typed'],
      [session, 'unknown'],
    ] as const) {
      const denied = owner
        .request(unsubscribe, { ...params, subscriptionId: id })
        .catch(() => 'denied');
      // Reply even to an incorrectly admitted call so the regression fails immediately.
      for (const frame of h.socket.frames.slice(before)) h.socket.reply(frame.id, {});
      expect(await denied).toBe('denied');
    }
    expect(h.socket.frames).toHaveLength(before);
  });
  it('releases captured workspace ownership when the renderer retires', async () => {
    const h = await harness();
    const session = await h.capture();
    const pending = session.request(subscribe, params);
    h.socket.reply(h.socket.frames.at(-1)!.id, { subscriptionId: 'typed' });
    await pending;
    session.dispose();
    expect(h.socket.frames.filter((f) => f.method === unsubscribe)).toEqual([
      expect.objectContaining({ params: { ...params, subscriptionId: 'typed' } }),
    ]);
  });
  it('releases a late acknowledgement after renderer replacement without touching its successor', async () => {
    const h = await harness();
    const session = await h.capture();
    const pending = session.request(subscribe, params).catch(() => 'retired');
    const request = h.socket.frames.at(-1)!;
    stampWindowWithBackend(h.window as unknown as BrowserWindow, 'B');
    stampWindowWithBackend(h.window as unknown as BrowserWindow, 'A');
    await expect(h.capture()).rejects.toThrow();
    h.socket.reply(request.id, { subscriptionId: 'old' });
    expect(await pending).toBe('retired');
    for (let i = 0; i < 30; i++) await Promise.resolve();
    await expect(h.capture()).rejects.toThrow();
    const cleanupRequest = h.socket.frames.find((frame) => frame.method === unsubscribe)!;
    h.socket.reply(cleanupRequest.id, {});
    for (let i = 0; i < 30; i++) await Promise.resolve();
    const successor = await h.capture();
    cleanup.push(() => successor.dispose());
    const next = successor.request(subscribe, params);
    h.socket.reply(h.socket.frames.at(-1)!.id, { subscriptionId: 'successor' });
    await next;
    expect(h.socket.frames.filter((f) => f.method === unsubscribe)).toEqual([
      expect.objectContaining({ params: { ...params, subscriptionId: 'old' } }),
    ]);
    expect(successor.isCurrent()).toBe(true);
  });
  it('cleans only once when retirement follows reply decode before promise settlement', async () => {
    const h = await harness();
    const session = await h.capture();
    const pending = session.request(subscribe, params).catch(() => 'retired');
    h.socket.reply(h.socket.frames.at(-1)!.id, { subscriptionId: 'typed' });
    session.dispose();
    await pending;
    expect(h.socket.frames.filter((f) => f.method === unsubscribe)).toHaveLength(1);
  });
  it('does not dispatch a late acknowledgement cleanup after principal replacement', async () => {
    const h = await harness();
    const session = await h.capture();
    const pending = session.request(subscribe, params).catch(() => 'retired');
    const request = h.socket.frames.at(-1)!;
    await h.client.request('client.hello', {});
    const before = h.socket.frames.length;
    h.socket.reply(request.id, { subscriptionId: 'old' });
    expect(await pending).toBe('retired');
    expect(h.socket.frames).toHaveLength(before);
  });
  it('isolates typed replacement groups and denies alternate unsubscribe aliases', async () => {
    const h = await harness();
    const a = await h.capture();
    const b = await h.createSender().capture();
    cleanup.push(() => {
      a.dispose();
      b.dispose();
    });
    const first = a.request(subscribe, { ...params, replaceGroup: 'shared' });
    const requestA = h.socket.frames.at(-1)!;
    h.socket.reply(requestA.id, { subscriptionId: 'a' });
    await first;
    const second = b.request(subscribe, { ...params, replaceGroup: 'shared' });
    const requestB = h.socket.frames.at(-1)!;
    h.socket.reply(requestB.id, { subscriptionId: 'b' });
    await second;
    expect(requestA.params).not.toEqual(requestB.params);
    const before = h.socket.frames.length;
    for (const method of [
      'agent.unsubscribe',
      'chat.unsubscribe',
      'presence.focus.unsubscribe',
      'note.presence.unsubscribe',
    ]) {
      const denied = b.request(method, { subscriptionId: 'a' }).catch(() => 'denied');
      for (const frame of h.socket.frames.slice(before)) h.socket.reply(frame.id, {});
      expect(await denied).toBe('denied');
    }
    expect(h.socket.frames).toHaveLength(before);
  });
  it('dispatches no cleanup on a disconnected captured socket', async () => {
    const h = await harness();
    const session = await h.capture();
    const pending = session.request(subscribe, params);
    h.socket.reply(h.socket.frames.at(-1)!.id, { subscriptionId: 'typed' });
    await pending;
    const before = h.socket.frames.length;
    h.client.dispose();
    session.dispose();
    expect(h.socket.frames).toHaveLength(before);
  });
});

describe('physical recovery timeout ownership', () => {
  for (const adapter of ['ipc', 'main'] as const)
    for (const phase of ['begin', 'read', 'end'] as const)
      it(`keeps the real ${adapter} ${phase} request outstanding until reply and blocks replacement capture`, async () => {
        vi.useFakeTimers();
        const h = await harness();
        const capture = async () => {
          if (adapter === 'ipc') return h.capture();
          const result = captureMainEventRecovery(h.client, () => {});
          if (!result) throw new Error('Unavailable');
          return result.session;
        };
        const shutdown = () => {};
        const frames: Array<{ id: number; method: string; params: unknown }> = [];
        const original = h.socket.write.bind(h.socket);
        const install = (respond: (frame: (typeof frames)[number]) => void) => {
          h.socket.write = (line) => {
            const result = original(line);
            const frame = JSON.parse(line);
            frames.push(frame);
            respond(frame);
            return result;
          };
        };
        const reply = (id: number, result: unknown) => h.socket.reply(id, result);

        let fences = 0;
        let reads = 0;
        let held: (typeof frames)[number] | undefined;
        install((frame) => {
          if (frame.method === 'events.subscribe')
            queueMicrotask(() => reply(frame.id, { subscriptionId: 'a', lossRecovery: 1 }));
          else if (frame.method === 'events.fence') {
            if ((phase === 'begin' && ++fences === 1) || (phase === 'end' && ++fences === 2))
              held = frame;
            else queueMicrotask(() => reply(frame.id, { subscriptionIds: ['a'] }));
          } else if (frame.method === 'data.read') {
            if (phase === 'read' && ++reads === 1) held = frame;
            else queueMicrotask(() => reply(frame.id, 'fresh'));
          } else queueMicrotask(() => reply(frame.id, {}));
        });
        const session = await capture();
        await session.request('events.subscribe', { eventTypes: ['file:*'], lossRecovery: 1 });
        const apply = vi.fn();
        const resource = new RecoveryResource({
          read: () => session.request('data.read'),
          fence: (ids, observe) => session.fence(ids, observe),
          apply,
          invalidate: () => {},
          retire: () => {},
        });
        resource.setLeases([{ id: 'a', lifetime: {} }]);
        resource.invalidate();
        for (let i = 0; i < 30; i++) await Promise.resolve();
        const requests = frames.length;
        expect(held).toBeDefined();
        await vi.advanceTimersByTimeAsync(60_000);
        expect(frames).toHaveLength(requests);
        expect(resource.status).toMatchObject({ running: true, suspended: true, stale: true });
        await expect(capture()).rejects.toThrow();
        expect(vi.getTimerCount()).toBe(0);
        reply(held!.id, phase === 'read' ? 'expired' : { subscriptionIds: ['a'] });
        await vi.advanceTimersByTimeAsync(1000);
        expect(frames).toHaveLength(requests + 3);
        expect(apply).toHaveBeenCalledExactlyOnceWith('fresh');
        resource.dispose();
        session.dispose();
        for (let i = 0; i < 30; i++) await Promise.resolve();
        const next = await capture();
        next.dispose();
        shutdown();
      });

  it('keeps a released capture quarantined until its physical read completes', async () => {
    vi.useFakeTimers();
    const h = await harness();
    const capture = h.capture;
    const shutdown = () => {};
    const frames: Array<{ id: number; method: string; params: unknown }> = [];
    const original = h.socket.write.bind(h.socket);
    const install = (respond: (frame: (typeof frames)[number]) => void) => {
      h.socket.write = (line) => {
        const result = original(line);
        const frame = JSON.parse(line);
        frames.push(frame);
        respond(frame);
        return result;
      };
    };
    const reply = (id: number, result: unknown) => h.socket.reply(id, result);

    let held: (typeof frames)[number] | undefined;
    install((frame) => {
      if (!held) held = frame;
      else queueMicrotask(() => reply(frame.id, 'fresh'));
    });
    const session = await capture();
    const pending = session.request('data.read').catch(() => {});
    session.dispose();
    await pending;
    await expect(capture()).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(frames).toHaveLength(1);
    await expect(capture()).rejects.toThrow();
    reply(held!.id, 'expired');
    for (let i = 0; i < 30; i++) await Promise.resolve();
    const next = await capture();
    expect(await next.request('data.read')).toBe('fresh');
    expect(frames).toHaveLength(2);
    expect(frames[1].id).not.toBe(held!.id);
    next.dispose();
    shutdown();
  });
});

it('bounds outstanding recovery wire requests across captures without deadline churn', async () => {
  vi.useFakeTimers();
  const h = await harness();
  const capture = h.capture;
  const frames = h.socket.frames;
  const reply = (id: number) => h.socket.reply(id, 'expired');
  const shutdown = () => {};
  const a = await capture();
  const b = await capture();
  const before = frames.length;
  const pending = Array.from({ length: 64 }, () => a.request('data.read').catch((error) => error));
  await expect(b.request('data.read')).rejects.toThrow();
  expect(frames.length - before).toBe(64);
  await vi.advanceTimersByTimeAsync(60_000);
  await Promise.all(pending);
  expect(vi.getTimerCount()).toBe(0);
  await expect(b.request('data.read')).rejects.toThrow();
  expect(frames.length - before).toBe(64);
  for (const frame of frames.slice(before)) reply(frame.id);
  for (let i = 0; i < 30; i++) await Promise.resolve();
  const next = b.request('data.read');
  expect(frames.length - before).toBe(65);
  reply(frames.at(-1)!.id);
  expect(await next).toBe('expired');
  a.dispose();
  b.dispose();
  shutdown();
});

for (const adapter of ['ipc', 'main'] as const)
  it(`preserves a canonical physical ${adapter} denial after the recovery read deadline`, async () => {
    vi.useFakeTimers();
    const h = await harness();
    const session =
      adapter === 'ipc' ? await h.capture() : captureMainEventRecovery(h.client, () => {})!.session;
    const lastFrame = () => h.socket.frames.at(-1)!;
    const reply = (frame: unknown) => h.socket.batch([frame]);
    const shutdown = () => {};
    const pending = session.request('data.read').catch((error) => error);
    const frame = lastFrame();
    await vi.advanceTimersByTimeAsync(60_000);
    const timeout = (await pending) as RecoveryRequestTimeoutError;
    expect(timeout).toBeInstanceOf(RecoveryRequestTimeoutError);
    reply({
      id: frame.id,
      error: { code: -32003, message: 'Unavailable', data: { code: 'forbidden' } },
    });
    expect(await timeout.completion).toEqual({
      retired: false,
      errors: [
        expect.objectContaining({
          rpcCode: -32003,
          code: 'forbidden',
          data: { code: 'forbidden' },
        }),
      ],
    });
    await timeout.drained;
    session.dispose();
    shutdown();
  });

for (const adapter of ['ipc', 'main'] as const)
  it(`keeps ${adapter} wire ownership across same-socket identity renewal`, async () => {
    vi.useFakeTimers();
    const h = await harness();
    const capture = async () =>
      adapter === 'ipc' ? h.capture() : captureMainEventRecovery(h.client, () => {})?.session;
    const session = (await capture())!;
    const pending = session.request('data.read').catch((error) => error);
    const oldRequest = h.socket.frames.at(-1)!;
    const oldIdentity = h.client.getRepositoryConnection()!;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.socket.frames.filter((frame) => frame.method === 'data.read')).toHaveLength(1);
    await h.client.request('client.hello', {});
    const successor = h.client.getRepositoryConnection()!;
    expect(successor).not.toBe(oldIdentity);
    expect(successor.incarnation).toBe(oldIdentity.incarnation);
    if (adapter === 'ipc') await expect(capture()).rejects.toThrow();
    else expect(await capture()).toBeUndefined();
    h.socket.reply(oldRequest.id, 'expired');
    await pending;
    for (let i = 0; i < 30; i++) await Promise.resolve();
    const next = (await capture())!;
    const fresh = next.request('data.read');
    h.socket.reply(h.socket.frames.at(-1)!.id, 'fresh');
    expect(await fresh).toBe('fresh');
    session.dispose();
    next.dispose();
  });

it('shares physical recovery limits between IPC and direct main captures', async () => {
  vi.useFakeTimers();
  const h = await harness();
  const main = captureMainEventRecovery(h.client, () => {})!;
  const renderer = await h.capture();
  const pending = Array.from({ length: 64 }, () =>
    main.session.request('data.read').catch((error) => error),
  );
  const denied = renderer.request('data.read');
  const reads = h.socket.frames.filter((frame) => frame.method === 'data.read');
  if (reads.length > 64) h.socket.reply(reads.at(-1)!.id, 'wrongly-admitted');
  await expect(denied).rejects.toThrow();
  expect(h.socket.frames.filter((frame) => frame.method === 'data.read')).toHaveLength(64);
  await vi.advanceTimersByTimeAsync(60_000);
  await Promise.all(pending);
  expect(vi.getTimerCount()).toBe(0);
  main.session.dispose();
  expect(captureMainEventRecovery(h.client, () => {})).toBeUndefined();
  await expect(h.capture()).rejects.toThrow();
  for (const frame of h.socket.frames.filter((frame) => frame.method === 'data.read'))
    h.socket.reply(frame.id, 'expired');
  for (let i = 0; i < 30; i++) await Promise.resolve();
  const next = captureMainEventRecovery(h.client, () => {})!;
  const fresh = next.session.request('data.read');
  h.socket.reply(h.socket.frames.at(-1)!.id, 'fresh');
  expect(await fresh).toBe('fresh');
  renderer.dispose();
  next.session.dispose();
});

describe('bounded lease cleanup ipc', () => {
  it('queues cleanup within the physical cap and drains every admitted lease once', async () => {
    vi.useFakeTimers();
    const h = await harness();
    const getSession = async () => {
      const value = await h.capture();
      if (!value) throw new Error('unavailable');
      return value;
    };
    const frames = () => h.socket.frames;
    const reply = (id: number, result: unknown) => h.socket.reply(id, result);
    const stop = () => {};
    const session = await getSession();
    for (let i = 0; i < 70; i++) {
      const pending = session.request('events.subscribe', {
        eventTypes: ['file:*'],
        lossRecovery: 1,
      });
      reply(frames().at(-1)!.id, { subscriptionId: `lease-${i}`, lossRecovery: 1 });
      await pending;
    }
    session.dispose();
    for (let i = 0; i < 30; i++) await Promise.resolve();
    const sent = () => frames().filter((frame) => frame.method === 'events.unsubscribe');
    expect(sent()).toHaveLength(64);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sent()).toHaveLength(64);
    expect(vi.getTimerCount()).toBe(0);
    await expect(getSession()).rejects.toThrow();
    const firstBatch = [...sent()];
    for (const frame of firstBatch) reply(frame.id, {});
    for (let i = 0; i < 40; i++) await Promise.resolve();
    expect(sent()).toHaveLength(70);
    expect(
      new Set(sent().map((frame) => (frame.params as { subscriptionId: string }).subscriptionId))
        .size,
    ).toBe(70);
    for (const frame of sent().slice(64)) reply(frame.id, {});
    for (let i = 0; i < 40; i++) await Promise.resolve();
    const next = await getSession();
    next.dispose();
    stop();
  });
  for (const method of ['events.subscribe', 'note.subscribe'])
    it(`cleans abandoned ${method} once across late ack and disposal`, async () => {
      vi.useFakeTimers();
      const h = await harness();
      const getSession = async () => {
        const value = await h.capture();
        if (!value) throw new Error('unavailable');
        return value;
      };
      const frames = () => h.socket.frames;
      const reply = (id: number, result: unknown) => h.socket.reply(id, result);
      const stop = () => {};
      const session = await getSession();
      const pending = session
        .request(method, { workspaceId: 'w', eventTypes: ['file:*'], lossRecovery: 1 })
        .catch((error) => error);
      const frame = frames().at(-1)!;
      await vi.advanceTimersByTimeAsync(35_000);
      const timeout = await pending;
      expect(timeout).toBeInstanceOf(RecoveryRequestTimeoutError);
      reply(frame.id, { subscriptionId: 'orphan', lossRecovery: 1 });
      await timeout.completion;
      for (let i = 0; i < 30; i++) await Promise.resolve();
      const unsubscribe = method === 'events.subscribe' ? 'events.unsubscribe' : 'note.unsubscribe';
      const sent = () => frames().filter((frame) => frame.method === unsubscribe);
      expect(sent()).toHaveLength(1);
      expect(sent()[0].params).toMatchObject({ subscriptionId: 'orphan' });
      session.dispose();
      for (let i = 0; i < 30; i++) await Promise.resolve();
      expect(sent()).toHaveLength(1);
      await expect(getSession()).rejects.toThrow();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(sent()).toHaveLength(1);
      reply(sent()[0].id, {});
      for (let i = 0; i < 30; i++) await Promise.resolve();
      const next = await getSession();
      next.dispose();
      stop();
    });
});

describe('bounded lease cleanup main', () => {
  it('queues cleanup within the physical cap and drains every admitted lease once', async () => {
    vi.useFakeTimers();
    const h = await harness();
    const getSession = async () => {
      const value = captureMainEventRecovery(h.client, () => {})?.session;
      if (!value) throw new Error('unavailable');
      return value;
    };
    const frames = () => h.socket.frames;
    const reply = (id: number, result: unknown) => h.socket.reply(id, result);
    const stop = () => {};
    const session = await getSession();
    for (let i = 0; i < 70; i++) {
      const pending = session.request('events.subscribe', {
        eventTypes: ['file:*'],
        lossRecovery: 1,
      });
      reply(frames().at(-1)!.id, { subscriptionId: `lease-${i}`, lossRecovery: 1 });
      await pending;
    }
    session.dispose();
    for (let i = 0; i < 30; i++) await Promise.resolve();
    const sent = () => frames().filter((frame) => frame.method === 'events.unsubscribe');
    expect(sent()).toHaveLength(64);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sent()).toHaveLength(64);
    expect(vi.getTimerCount()).toBe(0);
    await expect(getSession()).rejects.toThrow();
    const firstBatch = [...sent()];
    for (const frame of firstBatch) reply(frame.id, {});
    for (let i = 0; i < 40; i++) await Promise.resolve();
    expect(sent()).toHaveLength(70);
    expect(
      new Set(sent().map((frame) => (frame.params as { subscriptionId: string }).subscriptionId))
        .size,
    ).toBe(70);
    for (const frame of sent().slice(64)) reply(frame.id, {});
    for (let i = 0; i < 40; i++) await Promise.resolve();
    const next = await getSession();
    next.dispose();
    stop();
  });
  for (const method of ['events.subscribe', 'note.subscribe'])
    it(`cleans abandoned ${method} once across late ack and disposal`, async () => {
      vi.useFakeTimers();
      const h = await harness();
      const getSession = async () => {
        const value = captureMainEventRecovery(h.client, () => {})?.session;
        if (!value) throw new Error('unavailable');
        return value;
      };
      const frames = () => h.socket.frames;
      const reply = (id: number, result: unknown) => h.socket.reply(id, result);
      const stop = () => {};
      const session = await getSession();
      const pending = session
        .request(method, { workspaceId: 'w', eventTypes: ['file:*'], lossRecovery: 1 })
        .catch((error) => error);
      const frame = frames().at(-1)!;
      await vi.advanceTimersByTimeAsync(35_000);
      const timeout = await pending;
      expect(timeout).toBeInstanceOf(RecoveryRequestTimeoutError);
      reply(frame.id, { subscriptionId: 'orphan', lossRecovery: 1 });
      await timeout.completion;
      for (let i = 0; i < 30; i++) await Promise.resolve();
      const unsubscribe = method === 'events.subscribe' ? 'events.unsubscribe' : 'note.unsubscribe';
      const sent = () => frames().filter((frame) => frame.method === unsubscribe);
      expect(sent()).toHaveLength(1);
      expect(sent()[0].params).toMatchObject({ subscriptionId: 'orphan' });
      session.dispose();
      for (let i = 0; i < 30; i++) await Promise.resolve();
      expect(sent()).toHaveLength(1);
      await expect(getSession()).rejects.toThrow();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(sent()).toHaveLength(1);
      reply(sent()[0].id, {});
      for (let i = 0; i < 30; i++) await Promise.resolve();
      const next = await getSession();
      next.dispose();
      stop();
    });
});

for (const adapter of ['ipc', 'main'] as const)
  it(`${adapter} readiness waits for confirmed identity and physical drain`, async () => {
    vi.useFakeTimers();
    const h = await harness();
    const capture = async () => {
      const session =
        adapter === 'ipc'
          ? await h.capture()
          : captureMainEventRecovery(h.client, () => {})?.session;
      if (!session) throw new Error('unavailable');
      return session;
    };
    const old = await capture();
    const ready = vi.fn();
    const off =
      adapter === 'ipc'
        ? onElectronEventRecoveryReady(() => h.bridge as unknown as Window['electronAPI'], ready)
        : onMainEventRecoveryReady(h.client, ready);
    cleanup.push(off);
    for (let i = 0; i < 30; i++) await Promise.resolve();
    ready.mockClear();
    const pending = old.request('data.read').catch((error) => error);
    const frame = h.socket.frames.at(-1)!;
    await vi.advanceTimersByTimeAsync(60_000);
    vi.spyOn(h.socket, 'write').mockImplementationOnce((line) => {
      h.socket.frames.push(JSON.parse(line));
      return true;
    });
    const hello = h.client.request('client.hello', {});
    await expect(capture()).rejects.toThrow();
    expect(ready).not.toHaveBeenCalled();
    h.socket.reply(h.socket.frames.at(-1)!.id, {
      clientId: 'renewed',
      server: { capabilities: { eventStreamRecovery: 1 } },
    });
    await hello;
    expect(ready).not.toHaveBeenCalled();
    h.socket.reply(frame.id, 'stale');
    await pending;
    for (let i = 0; i < 40; i++) await Promise.resolve();
    expect(ready).toHaveBeenCalledTimes(1);
    const next = await capture();
    const read = next.request('data.read');
    h.socket.reply(h.socket.frames.at(-1)!.id, 'fresh');
    expect(await read).toBe('fresh');
    expect(ready).toHaveBeenCalledTimes(1);
    off();
    next.dispose();
    old.dispose();
  });

for (const adapter of ['ipc', 'main'] as const)
  it(`${adapter} cleans an acknowledged lease when its owner barrier times out`, async () => {
    vi.useFakeTimers();
    const h = await harness();
    const session =
      adapter === 'ipc' ? await h.capture() : captureMainEventRecovery(h.client, () => {})!.session;
    const first = session.request('events.subscribe', { eventTypes: ['file:*'], lossRecovery: 1 });
    h.socket.reply(h.socket.frames.at(-1)!.id, { subscriptionId: 'owner', lossRecovery: 1 });
    await first;
    const held = Promise.withResolvers<void>();
    session.onNotification(() => held.promise);
    h.socket.batch([{ method: 'events.event', params: { subscriptionId: 'owner' } }]);
    const second = session
      .request('events.subscribe', { eventTypes: ['file:*'], lossRecovery: 1 })
      .catch((error) => error);
    h.socket.reply(h.socket.frames.at(-1)!.id, { subscriptionId: 'blocked-ack', lossRecovery: 1 });
    await vi.advanceTimersByTimeAsync(35_000);
    expect(await second).toBeInstanceOf(RecoveryRequestTimeoutError);
    const cleanups = () =>
      h.socket.frames.filter(
        (frame) =>
          frame.method === 'events.unsubscribe' &&
          (frame.params as { subscriptionId: string }).subscriptionId === 'blocked-ack',
      );
    expect(cleanups()).toHaveLength(1);
    h.socket.reply(cleanups()[0].id, {});
    held.resolve();
    await (
      await second
    ).completion;
    session.dispose();
    for (let i = 0; i < 30; i++) await Promise.resolve();
    expect(cleanups()).toHaveLength(1);
  });

it('binds readiness watches to their original renderer and disposes pending replays', async () => {
  const h = await harness(),
    other = h.createSender();
  const channels = IPC_CHANNELS.BACKEND.EVENT_RECOVERY;
  const watch = h.handlers.get(channels.WATCH_READY)!;
  expect(
    await watch({ ...h.event, senderFrame: other.event.senderFrame }, { id: 'foreign' }),
  ).toMatchObject({ ok: false });
  const navigationBefore = h.event.sender.listenerCount('did-start-navigation');
  const goneBefore = h.event.sender.listenerCount('render-process-gone');
  const ready = vi.fn();
  const off = onElectronEventRecoveryReady(
    () => h.bridge as unknown as Window['electronAPI'],
    ready,
  );
  off();
  for (let i = 0; i < 30; i++) await Promise.resolve();
  expect(ready).not.toHaveBeenCalled();
  expect(h.event.sender.listenerCount('did-start-navigation')).toBe(navigationBefore);
  expect(h.event.sender.listenerCount('render-process-gone')).toBe(goneBefore);
});

for (const adapter of ['ipc', 'main'] as const)
  it(`${adapter} recovery waits for actual ordinary timeout drainage`, async () => {
    vi.useFakeTimers();
    const h = await harness();
    const capture = async () => {
      const session =
        adapter === 'ipc'
          ? await h.capture()
          : captureMainEventRecovery(h.client, () => {})?.session;
      if (!session) throw new Error('unavailable');
      return session;
    };
    const session = await capture();
    const original = h.client
      .request('note.get', { workspaceId: 'w', noteId: 'n' }, { timeoutMs: 50 })
      .catch((e) => e);
    const frame = h.socket.frames.at(-1)!;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await original).toBeInstanceOf(Error);
    const fresh = session.request('note.get', { workspaceId: 'w', noteId: 'n' });
    void fresh.catch(() => {});
    await expect(capture()).rejects.toThrow();
    const count = () => h.socket.frames.filter((f) => f.method === 'note.get').length;
    expect(count()).toBe(1);
    h.socket.reply(frame.id, 'stale');
    for (let i = 0; i < 40; i++) await Promise.resolve();
    expect(count()).toBe(2);
    h.socket.reply(h.socket.frames.at(-1)!.id, 'fresh');
    expect(await fresh).toBe('fresh');
    session.dispose();
  });

for (const adapter of ['ipc', 'main'] as const)
  it(`${adapter} ordinary late denial retires old identity and never dispatches queued work on its successor`, async () => {
    vi.useFakeTimers();
    const h = await harness();
    const initial =
      adapter === 'ipc' ? await h.capture() : captureMainEventRecovery(h.client, () => {})!.session;
    const pending = h.client.request('note.get', {}, { timeoutMs: 50 }).catch((e) => e);
    const first = h.socket.frames.at(-1)!;
    await vi.advanceTimersByTimeAsync(51);
    const timeout = await pending;
    let drained = false;
    void timeout.completion.then(() => {
      drained = true;
    });
    expect(drained).toBe(false);
    const queued = h.client.request('note.list', {}, { timeoutMs: 100_000 }).catch((e) => e);
    await h.client.request('client.hello', {});
    const get = async () => {
      const session =
        adapter === 'ipc'
          ? await h.capture()
          : captureMainEventRecovery(h.client, () => {})?.session;
      if (!session) throw new Error('unavailable');
      return session;
    };
    await expect(get()).rejects.toThrow();
    const ready = vi.fn();
    const off = onMainEventRecoveryReady(h.client, ready);
    h.socket.batch([
      { id: first.id, error: { code: -32003, message: 'Forbidden', data: { code: 'forbidden' } } },
    ]);
    const completion = await timeout.completion;
    expect(completion.retired).toBe(true);
    expect(completion.errors[0]).toMatchObject({ rpcCode: -32003 });
    expect(await queued).toBeInstanceOf(Error);
    expect(h.socket.frames.filter((f) => f.method === 'note.list')).toHaveLength(0);
    for (let i = 0; i < 30; i++) await Promise.resolve();
    expect(ready).toHaveBeenCalledTimes(1);
    const next = await get();
    next.dispose();
    initial.dispose();
    off();
  });

it('direct main ordinary callers keep deadlines while physical correlation remains bounded', async () => {
  vi.useFakeTimers();
  const h = await harness();
  const pending = Array.from({ length: 256 }, () =>
    h.client.request('note.get', {}, { timeoutMs: 50 }).catch((e) => e),
  );
  const frames = h.socket.frames.filter((f) => f.method === 'note.get');
  expect(frames).toHaveLength(256);
  await expect(h.client.request('note.get', {}, { timeoutMs: 50 })).rejects.toThrow('limit');
  await vi.advanceTimersByTimeAsync(51);
  expect((await Promise.all(pending)).every((e) => e.message.includes('timed out'))).toBe(true);
  for (let i = 0; i < 70; i++) {
    const retry = h.client.request('note.get', {}, { timeoutMs: 50 }).catch((e) => e);
    await vi.advanceTimersByTimeAsync(51);
    expect((await retry).message).toContain('timed out');
  }
  expect(h.socket.frames.filter((f) => f.method === 'note.get')).toHaveLength(256);
  for (const frame of frames) h.socket.reply(frame.id, 'expired');
  const next = h.client.request('note.get');
  h.socket.reply(h.socket.frames.at(-1)!.id, 'fresh');
  expect(await next).toBe('fresh');
  expect(vi.getTimerCount()).toBe(0);
});

it('Electron ordinary serialized timeout cannot bypass main physical quarantine', async () => {
  vi.useFakeTimers();
  const h = await harness();
  const completions = registerOrdinaryRequestCompletions(
    { handle: (channel, fn) => h.handlers.set(channel, fn) },
    {
      readBackend: (id) => (id === 'A' ? h.client : undefined),
      errorPayload: (error) =>
        error instanceof JsonRpcError
          ? error.toErrorPayload()
          : { code: 'TRANSPORT_ERROR', message: (error as Error).message },
    },
  );
  cleanup.push(() => completions.dispose());
  h.handlers.set(IPC_CHANNELS.BACKEND.REQUEST, (event, payload) => {
    const { method, params, timeoutMs } = payload as {
      method: string;
      params?: unknown;
      timeoutMs?: number;
    };
    return completions.run(event, 'A', h.client, () =>
      h.client.request(method, params, { timeoutMs }),
    );
  });
  const previous = window.electronAPI;
  window.electronAPI = h.bridge as unknown as Window['electronAPI'];
  try {
    const { createElectronIpcBackendTransport } =
      await import('$lib/client/live/electron-ipc-transport');
    const transport = createElectronIpcBackendTransport();
    const session = await transport.captureEventRecovery!();
    const ordinary = transport.request('note.get', {}, { timeoutMs: 50 }).catch((e) => e);
    const frame = h.socket.frames.at(-1)!;
    await vi.advanceTimersByTimeAsync(51);
    const timeout = await ordinary;
    expect(timeout.message).toContain('timed out');
    expect(timeout.completion).toBeInstanceOf(Promise);
    const next = session.request('note.get');
    void next.catch(() => {});
    for (let i = 0; i < 30; i++) await Promise.resolve();
    expect(h.socket.frames.filter((f) => f.method === 'note.get')).toHaveLength(1);
    h.socket.reply(frame.id, 'stale');
    for (let i = 0; i < 40; i++) await Promise.resolve();
    expect(h.socket.frames.filter((f) => f.method === 'note.get')).toHaveLength(2);
    h.socket.reply(h.socket.frames.at(-1)!.id, 'fresh');
    expect(await next).toBe('fresh');
    session.dispose();
  } finally {
    window.electronAPI = previous;
  }
});

it('socket retirement settles ordinary main timeout receipts and cancels unsent retries', async () => {
  vi.useFakeTimers();
  const h = await harness();
  const ordinary = h.client.request('note.get', {}, { timeoutMs: 50 }).catch((e) => e);
  await vi.advanceTimersByTimeAsync(51);
  const timeout = await ordinary;
  const queued = h.client.request('note.list', {}, { timeoutMs: 100_000 }).catch((e) => e);
  h.client.dispose();
  expect((await timeout.completion).retired).toBe(true);
  expect(await queued).toBeInstanceOf(Error);
  expect(h.socket.frames.filter((f) => f.method === 'note.list')).toHaveLength(0);
  expect(vi.getTimerCount()).toBe(0);
});

async function ordinaryElectronHarness() {
  const h = await harness();
  const completions = registerOrdinaryRequestCompletions(
    { handle: (channel, fn) => h.handlers.set(channel, fn) },
    {
      readBackend: (id) => (id === 'A' ? h.client : undefined),
      errorPayload: (error) =>
        error instanceof JsonRpcError
          ? error.toErrorPayload()
          : { code: 'TRANSPORT_ERROR', message: (error as Error).message },
    },
  );
  cleanup.push(() => completions.dispose());
  h.handlers.set(IPC_CHANNELS.BACKEND.REQUEST, (event, payload) => {
    const { method, params, timeoutMs } = payload as {
      method: string;
      params?: unknown;
      timeoutMs?: number;
    };
    return completions.run(event, 'A', h.client, () =>
      h.client.request(method, params, { timeoutMs }),
    );
  });
  const previous = window.electronAPI;
  window.electronAPI = h.bridge as unknown as Window['electronAPI'];
  cleanup.push(() => {
    window.electronAPI = previous;
  });
  const { createElectronIpcBackendTransport } =
    await import('$lib/client/live/electron-ipc-transport');
  return { ...h, completions, transport: createElectronIpcBackendTransport() };
}

for (const kind of ['forbidden', 'not-found', 'transient', 'success', 'replacement'] as const)
  it(`ordinary Electron physical completion delivers ${kind} under original authority`, async () => {
    vi.useFakeTimers();
    const h = await ordinaryElectronHarness();
    const promise = h.transport
      .request('comment.list', { workspaceId: 'w', noteId: 'n' }, { timeoutMs: 50 })
      .catch((error) => error);
    const first = h.socket.frames.at(-1)!;
    await vi.advanceTimersByTimeAsync(51);
    const timeout = await promise;
    expect(timeout).toMatchObject({ code: 'TRANSPORT_ERROR' });
    expect(timeout.completion).toBeInstanceOf(Promise);
    let settled = false;
    void timeout.completion.then(() => {
      settled = true;
    });
    if (kind === 'replacement') await h.client.request('client.hello', {});
    await vi.advanceTimersByTimeAsync(60_000);
    expect(settled).toBe(false);
    expect(h.socket.frames.filter((frame) => frame.method === 'comment.list')).toHaveLength(1);
    if (kind === 'success') h.socket.reply(first.id, [{ private: 'timed-out data' }]);
    else
      h.socket.batch([
        {
          id: first.id,
          error: {
            code: kind === 'not-found' ? -32602 : kind === 'transient' ? -32603 : -32003,
            message: kind,
            data: {
              code:
                kind === 'not-found'
                  ? 'not-found'
                  : kind === 'transient'
                    ? 'internal'
                    : 'forbidden',
            },
          },
        },
      ]);
    const outcome = await timeout.completion;
    expect(outcome.retired).toBe(kind === 'replacement');
    if (kind === 'replacement' || kind === 'success') expect(outcome.errors).toEqual([]);
    else
      expect(outcome.errors[0]).toMatchObject({
        rpcCode: kind === 'not-found' ? -32602 : kind === 'transient' ? -32603 : -32003,
      });
    expect(h.event.sender.listenerCount('did-start-navigation')).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

it('ordinary completion receipt cannot be claimed by another sender or foreign frame and survives reply-before-claim', async () => {
  vi.useFakeTimers();
  const h = await ordinaryElectronHarness();
  const response = h.handlers.get(IPC_CHANNELS.BACKEND.REQUEST)!(h.event, {
    method: 'note.get',
    timeoutMs: 50,
  }) as Promise<{ completionId: string }>;
  const first = h.socket.frames.at(-1)!;
  await vi.advanceTimersByTimeAsync(51);
  const { completionId: id } = await response;
  const foreign = h.createSender();
  const claim = h.handlers.get(IPC_CHANNELS.BACKEND.REQUEST_COMPLETION)!;
  expect(await claim(foreign.event, { id })).toMatchObject({ ok: false });
  expect(await claim({ ...h.event, senderFrame: foreign.event.senderFrame }, { id })).toMatchObject(
    { ok: false },
  );
  h.socket.batch([
    {
      id: first.id,
      error: { code: -32003, message: 'private denial', data: { code: 'forbidden' } },
    },
  ]);
  const outcome = await claim(h.event, { id });
  expect(outcome).toMatchObject({
    ok: true,
    result: { retired: false, errors: [{ rpcCode: -32003 }] },
  });
  expect(await claim(h.event, { id })).toMatchObject({ ok: false });
  expect(foreign.delivered).toEqual([]);
});

for (const retirement of ['navigation', 'dispose', 'binding', 'socket'] as const)
  it(`ordinary Electron ${retirement} fences a held completion without leaking late denial`, async () => {
    vi.useFakeTimers();
    const h = await ordinaryElectronHarness();
    const request = h.transport.request('note.get', {}, { timeoutMs: 50 }).catch((error) => error);
    const first = h.socket.frames.at(-1)!;
    await vi.advanceTimersByTimeAsync(51);
    const timeout = await request;
    if (retirement === 'navigation')
      h.event.sender.emit('did-start-navigation', {}, 'next', false, true);
    if (retirement === 'dispose') h.completions.dispose();
    if (retirement === 'binding') {
      stampWindowWithBackend(h.window as unknown as BrowserWindow, 'B');
      stampWindowWithBackend(h.window as unknown as BrowserWindow, 'A');
    }
    if (retirement === 'socket') h.client.dispose();
    else
      h.socket.batch([
        {
          id: first.id,
          error: { code: -32003, message: 'old private denial', data: { code: 'forbidden' } },
        },
      ]);
    expect(await timeout.completion).toEqual({ retired: true, errors: [] });
    expect(h.event.sender.listenerCount('did-start-navigation')).toBe(1);
  });

it('ordinary completion registry bounds unclaimed receipts before dispatch and reclaims its slots', async () => {
  vi.useFakeTimers();
  const h = await ordinaryElectronHarness();
  const request = h.handlers.get(IPC_CHANNELS.BACKEND.REQUEST)!;
  const pending = Array.from({ length: 256 }, () =>
    request(h.event, { method: 'note.get', timeoutMs: 50 }),
  );
  expect(h.event.sender.listenerCount('did-start-navigation')).toBe(2);
  await vi.advanceTimersByTimeAsync(51);
  const responses = (await Promise.all(pending)) as Array<{ completionId: string }>;
  const frames = h.socket.frames.filter((frame) => frame.method === 'note.get');
  expect(frames).toHaveLength(256);
  for (const frame of frames) h.socket.reply(frame.id, 'unadmitted');
  expect(await request(h.event, { method: 'note.get', timeoutMs: 50 })).toMatchObject({
    ok: false,
  });
  expect(h.socket.frames.filter((frame) => frame.method === 'note.get')).toHaveLength(256);
  const claim = h.handlers.get(IPC_CHANNELS.BACKEND.REQUEST_COMPLETION)!;
  for (const response of responses)
    expect(await claim(h.event, { id: response.completionId })).toMatchObject({
      ok: true,
      result: { errors: [] },
    });
  expect(h.event.sender.listenerCount('did-start-navigation')).toBe(1);
  const next = request(h.event, { method: 'note.get', timeoutMs: 50 });
  h.socket.reply(h.socket.frames.at(-1)!.id, 'fresh');
  expect(await next).toEqual({ ok: true, result: 'fresh' });
});
