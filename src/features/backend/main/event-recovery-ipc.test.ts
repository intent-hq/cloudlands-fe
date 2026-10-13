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
  const listeners = new Map<string, (value: unknown) => void>();
  let counter = 0;
  const frame = {
    send: (channel: string, value: unknown) => {
      if (channel === IPC_CHANNELS.BACKEND.EVENT_RECOVERY.FRAME)
        for (const fn of [...listeners.values()]) fn(value);
    },
  };
  const sender = Object.assign(new EventEmitter(), { mainFrame: frame, isDestroyed: () => false });
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
  return { socket, client, capture, window, bridge, handlers, event };
}

describe('Electron recovery IPC through real JSON-RPC decode', () => {
  it('observes notification processing before fence even when all frames share one socket chunk', async () => {
    const h = await harness(),
      session = await h.capture();
    cleanup.push(() => session.dispose());
    expect(session.supported).toBe(true);
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
