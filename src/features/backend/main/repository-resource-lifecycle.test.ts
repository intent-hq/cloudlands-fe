import { EventEmitter } from 'node:events';
import type { Duplex } from 'node:stream';
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import fixture from '$shared/types/__fixtures__/repository-resource-read.json';
import {
  RepositoryResourceTargetSchema,
  RepositoryResourceResultSchema,
} from '$shared/types/repository-resource-read';
import { createRepositoryResourceTransport } from '$lib/client/live/repository-resource-transport';
import { stampWindowWithBackend } from '../../../main/window-backend';
import { JsonRpcClient } from './json-rpc-client';
import { createRepositoryResourceFeed } from './repository-resource-feed';
import { registerRepositoryResourceHandlers } from './repository-resource-lifecycle';

const windows = vi.hoisted(() => new Map<object, object>());
vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents: (sender: object) => windows.get(sender) ?? null },
}));
const channels = IPC_CHANNELS.BACKEND.REPOSITORY_RESOURCE;
const disposers: Array<() => void> = [];
afterEach(() => {
  disposers.splice(0).forEach((close) => close());
  windows.clear();
  vi.useRealTimers();
});
class Socket extends EventEmitter {
  destroyed = false;
  hold = false;
  capability: unknown = 1;
  frames: Array<{ id: number; method: string; params: Record<string, unknown> }> = [];
  write(line: string) {
    const frame = JSON.parse(line);
    this.frames.push(frame);
    const result =
      frame.method === 'client.hello'
        ? {
            clientId: 'desktop',
            server: { capabilities: { repositoryResourceRead: this.capability } },
          }
        : frame.method === 'sourceControl.read.capture'
          ? fixture.capture
          : frame.method === 'sourceControl.read.release'
            ? { released: true }
            : frame.params?.target?.kind === 'merge-request'
              ? fixture.mergeRequest
              : fixture.issue;
    if (!(this.hold && frame.method === 'sourceControl.read.detail'))
      queueMicrotask(() => this.result(frame.id, result));
    return true;
  }
  result(id: number, result: unknown) {
    this.emit('data', Buffer.from(JSON.stringify({ id, result }) + '\n'));
  }
  destroy() {
    this.destroyed = true;
  }
}
async function harness(capability: unknown = 1) {
  const socket = new Socket();
  socket.capability = capability;
  const client = new JsonRpcClient({
    socketFactory: () => socket as unknown as Duplex,
    helloParams: () => ({ clientId: 'desktop' }),
    heartbeatIntervalMs: 0,
  });
  const feed = createRepositoryResourceFeed(client);
  const pool = new Map([['host-A', client]]);
  const handlers = new Map<string, (event: IpcMainInvokeEvent, payload: unknown) => unknown>();
  const registry = registerRepositoryResourceHandlers(
    {
      handle: (channel, handler) => {
        handlers.set(channel, handler);
      },
    },
    {
      readBackend: (id) => pool.get(id),
      capture: (_client, connection, workspaceId) => feed.capture(connection, workspaceId),
    },
  );
  disposers.push(() => {
    registry.dispose();
    feed.dispose();
    client.dispose();
  });
  client.start();
  socket.emit('connect');
  await vi.waitFor(() => expect(client.getRepositoryConnection()).not.toBeNull());
  const listeners = new Map<string, (value: unknown) => void>();
  let nextListener = 0;
  function makeWindow() {
    const frame = {
      send: (channel: string, value: unknown) => {
        if (channel === channels.RETIRED) for (const fn of listeners.values()) fn(value);
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
    stampWindowWithBackend(window as unknown as BrowserWindow, 'host-A');
    return {
      window,
      sender,
      event: { sender, senderFrame: frame } as unknown as IpcMainInvokeEvent,
    };
  }
  const original = makeWindow();
  const bridge = {
    on: (_channel: string, handler: (value: unknown) => void) => {
      const id = String(++nextListener);
      listeners.set(id, handler);
      return id;
    },
    offById: (_channel: string, id: string) => listeners.delete(id),
    invoke: vi.fn((channel: string, payload: unknown) =>
      Promise.resolve(handlers.get(channel)!(original.event, payload)),
    ),
  };
  const capture = createRepositoryResourceTransport(
    () => bridge as unknown as Window['electronAPI'],
  );
  return { socket, client, pool, registry, original, bridge, capture, makeWindow, handlers };
}
describe('resource client → IPC → original socket composition', () => {
  it.each(['mergeRequest', 'issue'] as const)(
    'uses the actual %s capture/feed/detail chain without generic backend routing',
    async (key) => {
      const h = await harness();
      const session = await h.capture('workspace-A');
      await expect(
        session.detail(RepositoryResourceTargetSchema.parse(fixture[key].target)),
      ).resolves.toEqual(RepositoryResourceResultSchema.parse(fixture[key]));
      expect(h.socket.frames.map((frame) => frame.method)).toEqual([
        'client.hello',
        'sourceControl.read.capture',
        'sourceControl.read.detail',
      ]);
      expect(h.bridge.invoke.mock.calls.map(([channel]) => channel)).toEqual([
        channels.CAPTURE,
        channels.DETAIL,
      ]);
      await session.release();
      expect(h.socket.frames.at(-1)?.method).toBe('sourceControl.read.release');
    },
  );
  it('refuses unsupported capability before any resource frame', async () => {
    const h = await harness(null);
    await expect(h.capture('workspace-A')).rejects.toBeDefined();
    expect(h.socket.frames.map((frame) => frame.method)).toEqual(['client.hello']);
  });
  it('rejects a foreign sender, frame and workspace without consulting a provider', async () => {
    const h = await harness();
    const session = await h.capture('workspace-A');
    const captured = (await h.handlers.get(channels.CAPTURE)!(h.original.event, {
      workspaceId: 'workspace-A',
    })) as { result: { id: string } };
    const before = h.socket.frames.length;
    const payload = {
      id: captured.result.id,
      workspaceId: 'workspace-A',
      target: fixture.issue.target,
    };
    const other = h.makeWindow();
    for (const [event, request] of [
      [other.event, payload],
      [{ ...h.original.event, senderFrame: {} }, payload],
      [h.original.event, { ...payload, workspaceId: 'other' }],
    ] as const) {
      expect(
        await h.handlers.get(channels.DETAIL)!(event as IpcMainInvokeEvent, request),
      ).toMatchObject({ ok: false });
    }
    expect(h.socket.frames).toHaveLength(before);
    await session.release();
  });
  it('retires a settled hover immediately when the window changes backend, including A → B → A', async () => {
    const h = await harness();
    const session = await h.capture('workspace-A');
    await session.detail(RepositoryResourceTargetSchema.parse(fixture.issue.target));
    const retired = vi.fn();
    session.onRetired(retired);
    stampWindowWithBackend(h.original.window as unknown as BrowserWindow, 'host-B');
    expect(retired).toHaveBeenCalledTimes(1);
    stampWindowWithBackend(h.original.window as unknown as BrowserWindow, 'host-A');
    expect(retired).toHaveBeenCalledTimes(1);
    expect(
      h.socket.frames.filter((frame) => frame.method === 'sourceControl.read.release'),
    ).toHaveLength(1);
  });
  it('drops a held result after window A → B → A with equal public IDs', async () => {
    const h = await harness();
    const session = await h.capture('workspace-A');
    h.socket.hold = true;
    const read = session.detail(RepositoryResourceTargetSchema.parse(fixture.issue.target));
    const assertion = expect(read).rejects.toBeDefined();
    const frame = h.socket.frames.at(-1)!;
    stampWindowWithBackend(h.original.window as unknown as BrowserWindow, 'host-B');
    stampWindowWithBackend(h.original.window as unknown as BrowserWindow, 'host-A');
    h.socket.result(frame.id, fixture.issue);
    await assertion;
    expect(h.socket.frames.filter((f) => f.method === 'sourceControl.read.detail')).toHaveLength(1);
  });
  it('retires the mounted consumer immediately when the pool retires its original backend', async () => {
    const h = await harness();
    const session = await h.capture('workspace-A');
    const retired = vi.fn();
    session.onRetired(retired);
    h.registry.retireBackend('host-A');
    h.registry.retireBackend('host-A');
    expect(retired).toHaveBeenCalledTimes(1);
    await expect(
      session.detail(RepositoryResourceTargetSchema.parse(fixture.issue.target)),
    ).rejects.toBeDefined();
    expect(h.socket.frames.filter((f) => f.method === 'sourceControl.read.release')).toHaveLength(
      1,
    );
  });
  it('retires on document destruction and never transfers a held private result', async () => {
    const h = await harness();
    const session = await h.capture('workspace-A');
    h.socket.hold = true;
    const read = session.detail(RepositoryResourceTargetSchema.parse(fixture.issue.target));
    const asserted = expect(read).rejects.toBeDefined();
    const frame = h.socket.frames.at(-1)!;
    h.original.sender.emit('destroyed');
    h.socket.result(frame.id, fixture.issue);
    await asserted;
  });
});
