import { EventEmitter } from 'node:events';
import type { Duplex } from 'node:stream';
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import { createElectronIpcBackendTransport } from '$lib/client/live/electron-ipc-transport';
import { stampWindowWithBackend } from '../../../main/window-backend';
import { JsonRpcClient } from './json-rpc-client';
import { registerRepositoryRouteHandlers } from './repository-route-lifecycle';

const windows = vi.hoisted(() => new Map<object, object>());
vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents: (sender: object) => windows.get(sender) ?? null },
}));
const root = { workspaceId: 'duplicate-id', kind: 'primary' as const };
const channels = IPC_CHANNELS.BACKEND.REPOSITORY;
class Socket extends EventEmitter {
  writes: Array<{ id: number; method: string; params: unknown }> = [];
  destroyed = false;
  write(line: string) {
    this.writes.push(JSON.parse(line));
    return true;
  }
  destroy() {
    this.destroyed = true;
  }
  reply(value: unknown) {
    this.emit(
      'data',
      Buffer.from(JSON.stringify({ id: this.writes.at(-1)!.id, result: value }) + '\n'),
    );
  }
}
const disposers: Array<() => void> = [];
afterEach(() => {
  disposers.splice(0).forEach((dispose) => dispose());
  vi.useRealTimers();
  vi.unstubAllGlobals();
  windows.clear();
});
async function harness() {
  const pool = new Map<string, JsonRpcClient>();
  const sockets = new Map<string, Socket[]>();
  for (const id of ['host-A', 'local']) {
    const all: Socket[] = [];
    sockets.set(id, all);
    const client = new JsonRpcClient({
      socketFactory: () => {
        const socket = new Socket();
        all.push(socket);
        return socket as unknown as Duplex;
      },
      helloParams: () => ({ clientId: 'desktop' }),
      reconnectDelayMs: 10,
    });
    pool.set(id, client);
    disposers.push(() => client.dispose());
    client.start();
    all[0].emit('connect');
    await vi.waitFor(() => expect(all[0].writes).toHaveLength(1));
    all[0].reply({ clientId: 'confirmed' });
    await vi.waitFor(() => expect(client.getRepositoryConnection()).not.toBeNull());
  }
  function window(backend: string) {
    const sender = Object.assign(new EventEmitter(), { mainFrame: {}, isDestroyed: () => false });
    const window = Object.assign(new EventEmitter(), {
      webContents: sender,
      isDestroyed: () => false,
    });
    windows.set(sender, window);
    stampWindowWithBackend(window as unknown as BrowserWindow, backend);
    return {
      window,
      event: { sender, senderFrame: sender.mainFrame } as unknown as IpcMainInvokeEvent,
    };
  }
  const a = window('host-A');
  const b = window('local');
  const otherA = window('host-A');
  let lifetime = {};
  const resolveLifetime = vi.fn(() => {
    const stamp = lifetime;
    return Promise.resolve({
      stamp,
      isCurrent: () => lifetime === stamp,
      allowsRequest: (method: string, params: Readonly<Record<string, unknown>>) =>
        method === 'git.status' && params.workspaceId === root.workspaceId && !('target' in params),
    });
  });
  const handlers = new Map<string, (event: IpcMainInvokeEvent, payload: unknown) => unknown>();
  const registry = registerRepositoryRouteHandlers(
    {
      handle: (channel, handler) => {
        handlers.set(channel, handler);
      },
    },
    {
      readBackend: (id) => pool.get(id),
      resolveLifetime,
      errorPayload: (error) => ({
        code: 'TRANSPORT_ERROR',
        message: error instanceof Error ? error.message : 'Unknown transport error',
      }),
    },
  );
  disposers.push(() => registry.dispose());
  const call = async (channel: string, payload: unknown, event = a.event): Promise<any> =>
    handlers.get(channel)!(event, payload);
  async function capture(event = a.event) {
    return (await call(channels.CAPTURE, { root }, event)).result.id as string;
  }
  function request(id: string, event = a.event, extra: Record<string, unknown> = {}) {
    return call(
      channels.REQUEST,
      { id, root, method: 'git.status', params: { workspaceId: root.workspaceId }, ...extra },
      event,
    );
  }
  return {
    a,
    b,
    otherA,
    pool,
    sockets,
    call,
    capture,
    request,
    registry,
    resolveLifetime,
    retireLifetime: () => {
      lifetime = {};
    },
  };
}

describe('bound repository IPC with real window, socket and route sources', () => {
  it('routes duplicate workspace IDs to the original host, never local or another window', async () => {
    const h = await harness();
    const id = await h.capture();
    const pending = h.request(id);
    expect(h.sockets.get('host-A')![0].writes.at(-1)).toMatchObject({
      method: 'git.status',
      params: { workspaceId: root.workspaceId },
    });
    expect(h.sockets.get('local')![0].writes).toHaveLength(1);
    for (const event of [h.b.event, h.otherA.event])
      expect(await h.request(id, event)).toMatchObject({ ok: false });
    h.sockets.get('host-A')![0].reply({ branch: 'original' });
    expect(await pending).toMatchObject({
      ok: true,
      result: { current: true, settlement: { status: 'fulfilled', value: { branch: 'original' } } },
    });
  });
  it('fails closed when the actual lifetime producer is missing, even after a successful hello', async () => {
    const h = await harness();
    h.resolveLifetime.mockResolvedValue(null as never);
    expect(await h.call(channels.CAPTURE, { root })).toMatchObject({
      ok: false,
      error: { code: 'REPOSITORY_ROUTE_UNAVAILABLE' },
    });
    expect(h.sockets.get('host-A')![0].writes).toHaveLength(1);
  });
  it('rejects forged IDs, subframes, arbitrary backends, local overrides and wrong roots without dispatch', async () => {
    const h = await harness();
    const id = await h.capture();
    expect(await h.request('forged')).toMatchObject({ ok: false });
    expect(await h.request(id, { ...h.a.event, senderFrame: {} as never })).toMatchObject({
      ok: false,
    });
    expect(await h.call(channels.CAPTURE, { root, backendId: 'local' })).toMatchObject({
      ok: false,
    });
    expect(await h.request(id, h.a.event, { localMachine: true })).toMatchObject({ ok: false });
    expect(
      await h.request(id, h.a.event, { root: { ...root, workspaceId: 'different' } }),
    ).toMatchObject({ ok: false });
    expect(
      await h.request(id, h.a.event, {
        root: { workspaceId: root.workspaceId, kind: 'registered', gitRootId: 'other' },
      }),
    ).toMatchObject({ ok: false });
    expect(h.sockets.get('host-A')![0].writes).toHaveLength(1);
  });
  it('rejects method, target or root-param widening against the trusted captured lifetime', async () => {
    const h = await harness();
    const id = await h.capture();
    for (const extra of [
      { method: 'secrets.get' },
      { params: { workspaceId: root.workspaceId, target: 'other' } },
      { params: { workspaceId: 'other' } },
      { params: { workspaceId: root.workspaceId, gitRootId: 'other' } },
    ]) {
      expect(await h.request(id, h.a.event, extra)).toMatchObject({ ok: false });
    }
    expect(h.sockets.get('host-A')![0].writes).toHaveLength(1);
  });
  it('rechecks window and socket lifetimes after an asynchronous authority lookup', async () => {
    const h = await harness();
    let finish!: (value: any) => void;
    h.resolveLifetime.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const capture = h.call(channels.CAPTURE, { root });
    stampWindowWithBackend(h.a.window as unknown as BrowserWindow, 'local');
    stampWindowWithBackend(h.a.window as unknown as BrowserWindow, 'host-A');
    finish({ stamp: {}, isCurrent: () => true, allowsRequest: () => true });
    expect(await capture).toMatchObject({ ok: false });
  });
  it.each(['navigation', 'account', 'pool', 'disconnect', 'release'])(
    'stops deferred queued work after %s retirement',
    async (cause) => {
      const h = await harness();
      const id = await h.capture();
      if (cause === 'navigation')
        h.a.event.sender.emit('did-start-navigation', {}, 'app://new', false, true);
      if (cause === 'account') h.retireLifetime();
      if (cause === 'pool') h.pool.set('host-A', h.pool.get('local')!);
      if (cause === 'disconnect') h.sockets.get('host-A')![0].emit('close');
      if (cause === 'release') await h.call(channels.RELEASE, { id, root });
      expect(await h.request(id)).toMatchObject({ ok: false });
      expect(h.sockets.get('host-A')![0].writes).toHaveLength(1);
      expect(h.sockets.get('local')![0].writes).toHaveLength(1);
    },
  );
  it('retains known completion on original scope after transport retirement, suppresses current application and next stage', async () => {
    const h = await harness();
    const id = await h.capture();
    const pending = h.request(id);
    h.sockets.get('host-A')![0].reply({
      success: true,
      steps: [{ step: 'commit', success: true }],
      result: { commitHash: 'real' },
    });
    h.registry.retireBackend('host-A');
    expect(await pending).toMatchObject({
      ok: true,
      result: {
        current: false,
        settlement: { status: 'fulfilled', value: { result: { commitHash: 'real' } } },
      },
    });
    expect(await h.request(id)).toMatchObject({ ok: false });
    expect(h.sockets.get('host-A')![0].writes).toHaveLength(2);
  });
  it('retains a rejected original request as uncertain facts, not an empty successful effect receipt', async () => {
    const h = await harness();
    const id = await h.capture();
    const pending = h.request(id);
    h.sockets.get('host-A')![0].emit('close');
    expect(await pending).toMatchObject({
      ok: true,
      result: {
        current: false,
        settlement: { status: 'rejected', error: { code: 'TRANSPORT_ERROR' } },
      },
    });
  });
  it.each(['window', 'account', 'cancel'])(
    'does not disclose a settled payload after %s retirement',
    async (cause) => {
      const h = await harness();
      const id = await h.capture();
      const pending = h.request(id);
      h.sockets.get('host-A')![0].reply({ privateResult: 'original account only' });
      if (cause === 'window')
        stampWindowWithBackend(h.a.window as unknown as BrowserWindow, 'local');
      if (cause === 'account') h.retireLifetime();
      if (cause === 'cancel') await h.call(channels.RELEASE, { id, root });
      const response = await pending;
      expect(response).toMatchObject({ ok: false });
      expect(JSON.stringify(response)).not.toContain('privateResult');
    },
  );
  it('rejects simultaneous dispatch and releases all handles on shutdown', async () => {
    const h = await harness();
    const id = await h.capture();
    const pending = h.request(id);
    expect(await h.request(id)).toMatchObject({ ok: false });
    h.registry.dispose();
    h.sockets.get('host-A')![0].reply({ completed: true });
    expect(await pending).toMatchObject({ ok: false });
    expect(await h.request(id)).toMatchObject({ ok: false });
  });
  it('bounds per-sender captures, expires them and permits no stale ID replay', async () => {
    const h = await harness();
    vi.useFakeTimers();
    const ids: string[] = [];
    for (let i = 0; i < 32; i++) ids.push(await h.capture());
    expect(await h.call(channels.CAPTURE, { root })).toMatchObject({ ok: false });
    await vi.advanceTimersByTimeAsync(300_001);
    expect(await h.request(ids[0])).toMatchObject({ ok: false });
    expect(await h.capture()).toBeTypeOf('string');
  });
  it('carries a captured renderer request through registered IPC to the exact socket', async () => {
    const h = await harness();
    const invoke = vi.fn((channel: string, payload: unknown) =>
      h.call(channel, payload, h.a.event),
    );
    vi.stubGlobal('window', {
      electronAPI: { invoke, on: vi.fn(() => 'subscription'), offById: vi.fn() },
    });
    const transport = createElectronIpcBackendTransport();
    const route = await transport.captureRepositoryRoute!(root);
    const pending = route.request('git.status', { workspaceId: root.workspaceId });
    expect(h.sockets.get('host-A')![0].writes.at(-1)).toMatchObject({
      method: 'git.status',
      params: { workspaceId: root.workspaceId },
    });
    expect(h.sockets.get('local')![0].writes).toHaveLength(1);
    h.sockets.get('host-A')![0].reply({ branch: 'host-A-branch' });
    expect(await pending).toMatchObject({
      current: true,
      settlement: { status: 'fulfilled', value: { branch: 'host-A-branch' } },
    });
    await route.release();
    expect(invoke.mock.calls.map(([channel]) => channel)).toEqual([
      channels.CAPTURE,
      channels.REQUEST,
      channels.RELEASE,
    ]);
    await expect(route.request('git.status', { workspaceId: root.workspaceId })).rejects.toThrow();
  });
  it('rejects the old capture after the same pooled client reconnects and confirms a new hello', async () => {
    const h = await harness();
    const id = await h.capture();
    const client = h.pool.get('host-A')!;
    const before = client.getRepositoryConnection();
    h.sockets.get('host-A')![0].emit('close');
    await vi.waitFor(() => expect(h.sockets.get('host-A')).toHaveLength(2));
    const next = h.sockets.get('host-A')![1];
    next.emit('connect');
    await vi.waitFor(() => expect(next.writes).toHaveLength(1));
    next.reply({ clientId: 'confirmed' });
    await vi.waitFor(() => expect(client.getRepositoryConnection()).not.toBeNull());
    expect(client.getRepositoryConnection()?.incarnation).not.toBe(before?.incarnation);
    expect(await h.request(id)).toMatchObject({ ok: false });
    expect(next.writes).toHaveLength(1);
  });
  it('retires a queued capture through host A to B to A without any intervening read', async () => {
    const h = await harness();
    const id = await h.capture();
    stampWindowWithBackend(h.a.window as unknown as BrowserWindow, 'local');
    stampWindowWithBackend(h.a.window as unknown as BrowserWindow, 'host-A');
    expect(await h.request(id)).toMatchObject({ ok: false });
    expect(h.sockets.get('host-A')![0].writes).toHaveLength(1);
  });
});
