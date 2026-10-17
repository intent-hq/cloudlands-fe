/** Real backend handler registration, pooled JsonRpcClient and lifetime adapter. */
import { EventEmitter } from 'node:events';
import { BrowserWindow, ipcMain } from 'electron';
import type { BrowserWindow as Window, IpcMainInvokeEvent } from 'electron';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import { stampWindowWithBackend } from '../../../../main/window-backend';

const data = vi.hoisted(() => ({ sockets: [] as Array<any>, windows: new Map<object, any>() }));
vi.mock('../../../../main/window', async () => import('../../../../main/window-backend'));
vi.mock('../client-identity', () => ({
  buildMainClientHelloParams: async () => ({ clientId: 'fixture-desktop' }),
  getOrCreateClientId: async () => 'fixture-desktop',
  persistClientId: async () => {},
  setLocalHostIdentity: () => false,
}));
vi.mock('../connections-store', async (original) => ({
  ...(await original<typeof import('../connections-store')>()),
  list: async () => [
    {
      id: 'host-A',
      host: 'host-a.test',
      hosts: ['host-a.test'],
      port: 443,
      fingerprint: 'synthetic',
    },
  ],
  getDecryptedToken: async () => 'synthetic-fixture-token',
  setDaemonVersion: async () => false,
  setUpdateSupported: async () => false,
  setTcAddress: async () => false,
  setHosts: async () => false,
  getDetectHosts: async () => false,
}));
vi.mock('../intentd-sidecar', () => ({
  onSidecarGaveUp: vi.fn(),
  onSidecarStartupFailed: vi.fn(),
  getLocalDaemonProtocolVersion: () => null,
  getSidecarStartupFailure: () => null,
  spawnSidecarOnDemand: vi.fn(),
  getSidecarRunLog: vi.fn(),
}));
vi.mock('../../../browser/main/browser-exec-reverse', () => ({
  registerBrowserExecReverseHandler: vi.fn(),
}));
vi.mock('../backend-connection', async (original) => {
  const actual = await original<typeof import('../backend-connection')>();
  const { EventEmitter } = await import('node:events');
  return {
    ...actual,
    createBackendSocket(config: { transport: string }) {
      const name = config.transport === 'uds' ? 'local-B' : 'host-A';
      const socket = Object.assign(new EventEmitter(), {
        name,
        destroyed: false,
        writes: [] as Array<any>,
        heldMethods: new Set<string>(),
        next: 0,
        destroy() {
          this.destroyed = true;
        },
        write(text: string) {
          const request = JSON.parse(text);
          this.writes.push(request);
          if (this.heldMethods.has(request.method)) return true;
          const result =
            request.method === 'client.hello'
              ? { clientId: 'confirmed', server: { capabilities: { repositoryContext: 1 } } }
              : request.method === 'workspace.repositoryContext.capture'
                ? {
                    lifetimeId: `${name}-${++this.next}`,
                    scope: {
                      daemonId: name,
                      authorityScopeId: 'original',
                      authorityGeneration: '1',
                    },
                    coverage: {
                      kind: 'workspaceInventory',
                      workspaceId: request.params.workspaceId,
                    },
                    retirementSequence: '0',
                    expiresAfterMs: 300000,
                  }
                : request.method === 'workspace.repositoryContext'
                  ? {
                      scope: {
                        daemonId: name,
                        authorityScopeId: 'original',
                        authorityGeneration: '1',
                      },
                      revision: { epoch: request.params.repositoryLifetimeId, sequence: '1' },
                      roots: [],
                    }
                  : request.method === 'workspace.repositoryContext.release'
                    ? { released: true }
                    : { backend: name };
          queueMicrotask(() =>
            socket.emit('data', Buffer.from(JSON.stringify({ id: request.id, result }) + '\n')),
          );
          return true;
        },
      });
      data.sockets.push(socket);
      queueMicrotask(() => socket.emit('connect'));
      return socket;
    },
  };
});
import {
  connectBackendClient,
  disconnectBackendClient,
  disposeAllBackendClients,
  getLocalBackendClient,
  registerBackendHandlers,
} from '../backend.ipc';
const channels = IPC_CHANNELS.BACKEND.REPOSITORY;
const root = { workspaceId: 'equal-id', kind: 'primary' as const };
function window(backend: string) {
  const sender = Object.assign(new EventEmitter(), {
    mainFrame: { send: vi.fn() },
    isDestroyed: () => false,
    send: vi.fn(),
  });
  const window = Object.assign(new EventEmitter(), {
    webContents: sender,
    isDestroyed: () => false,
  });
  data.windows.set(sender, window);
  stampWindowWithBackend(window as unknown as Window, backend);
  return {
    sender,
    window,
    event: { sender, senderFrame: sender.mainFrame } as unknown as IpcMainInvokeEvent,
  };
}
function call(channel: string, event: IpcMainInvokeEvent, payload: unknown) {
  const handler = vi.mocked(ipcMain.handle).mock.calls.find(([name]) => name === channel)?.[1];
  if (!handler) throw new Error(`Missing production handler ${channel}`);
  return handler(event, payload);
}
afterAll(() => disposeAllBackendClients());
afterEach(() => {
  disconnectBackendClient('host-A');
  disconnectBackendClient('local');
  data.sockets.length = 0;
  data.windows.clear();
  vi.unstubAllEnvs();
});
async function setup() {
  vi.stubEnv('INTENTD_SOCKET', '/disposable-fixture.sock');
  vi.mocked(BrowserWindow.fromWebContents).mockImplementation(
    (sender) => data.windows.get(sender) ?? null,
  );
  vi.mocked(BrowserWindow.getAllWindows).mockImplementation(() => [...data.windows.values()]);
  registerBackendHandlers();
  const local = getLocalBackendClient();
  const remote = await connectBackendClient('host-A');
  await vi.waitFor(() => {
    expect(local.getRepositoryConnection()).not.toBeNull();
    expect(remote.getRepositoryConnection()).not.toBeNull();
  });
  const a = window('host-A');
  const b = window('local');
  return { a, b, remote, local };
}

describe('production repository IPC chain with controlled socket I/O', () => {
  it('routes equal workspace IDs through original hosts and enriches only inside main', async () => {
    const { a, b } = await setup();
    for (const [owner, backend] of [
      [a, 'host-A'],
      [b, 'local-B'],
    ] as const) {
      const capture = await call(channels.CAPTURE, owner.event, { root });
      expect(capture).toMatchObject({ ok: true, result: { id: expect.any(String) } });
      const request = {
        id: capture.result.id,
        root,
        method: 'workspace.repositoryContext',
        params: { workspaceId: 'equal-id' },
      };
      const result = await call(channels.REQUEST, owner.event, request);
      expect(result).toMatchObject({
        ok: true,
        result: { current: true, settlement: { value: { scope: { daemonId: backend } } } },
      });
      const socket = data.sockets.find((s) => s.name === backend);
      expect(
        socket.writes.find((r: any) => r.method === 'workspace.repositoryContext').params,
      ).toEqual({ workspaceId: 'equal-id', repositoryLifetimeId: `${backend}-1` });
      await expect(
        call(channels.REQUEST, owner === a ? b.event : a.event, request),
      ).resolves.toMatchObject({ ok: false });
      await call(channels.RELEASE, owner.event, { id: capture.result.id, root });
    }
  });
  it('blocks the three authority methods on generic IPC without blocking legacy ordinary calls', async () => {
    const { a } = await setup();
    for (const method of [
      'workspace.repositoryContext',
      'workspace.repositoryContext.capture',
      'workspace.repositoryContext.release',
    ])
      await expect(
        call(IPC_CHANNELS.BACKEND.REQUEST, a.event, { method, params: {}, localMachine: true }),
      ).resolves.toMatchObject({ ok: false });
    await expect(
      call(IPC_CHANNELS.BACKEND.REQUEST, a.event, {
        method: 'git.status',
        params: { workspaceId: 'equal-id' },
      }),
    ).resolves.toMatchObject({ ok: true, result: { backend: 'host-A' } });
  });
  it('keeps private retirement on the original frame and makes its handle unusable', async () => {
    const { a, b } = await setup();
    const capture = await call(channels.CAPTURE, a.event, { root });
    const socket = data.sockets.find((s) => s.name === 'host-A');
    a.sender.send.mockClear();
    b.sender.send.mockClear();
    socket.emit(
      'data',
      Buffer.from(
        JSON.stringify({
          method: 'workspace.repositoryContext.retired',
          params: { lifetimeIds: ['host-A-1'], sequence: '1', allRetired: false, terminal: false },
        }) + '\n',
      ),
    );
    expect(a.sender.mainFrame.send).toHaveBeenCalledExactlyOnceWith(channels.RETIRED, {
      id: capture.result.id,
    });
    expect(b.sender.mainFrame.send).not.toHaveBeenCalled();
    expect(a.sender.send).not.toHaveBeenCalled();
    expect(b.sender.send).not.toHaveBeenCalled();
    await expect(
      call(channels.REQUEST, a.event, {
        id: capture.result.id,
        root,
        method: 'workspace.repositoryContext',
        params: { workspaceId: 'equal-id' },
      }),
    ).resolves.toMatchObject({ ok: false });
  });
  it('rejects subframes, renderer lifetime injection and non-read method widening', async () => {
    const { a } = await setup();
    await expect(
      call(channels.CAPTURE, { ...a.event, senderFrame: {} } as IpcMainInvokeEvent, { root }),
    ).resolves.toMatchObject({ ok: false });
    const capture = await call(channels.CAPTURE, a.event, { root });
    for (const [method, params] of [
      ['workspace.repositoryContext', { workspaceId: 'equal-id', repositoryLifetimeId: 'forged' }],
      ['workspace.repositoryContext', { workspaceId: 'other' }],
      ['workspace.repositoryContext.release', { workspaceId: 'equal-id' }],
      ['git.push', { workspaceId: 'equal-id' }],
    ])
      await expect(
        call(channels.REQUEST, a.event, { id: capture.result.id, root, method, params }),
      ).resolves.toMatchObject({ ok: false });
  });
});

for (const outcome of ['forbidden', 'transient', 'replacement'] as const)
  it(`production ordinary Electron route carries ${outcome} physical completion after caller timeout`, async () => {
    const { a, b, remote } = await setup();
    const socket = data.sockets.find((entry) => entry.name === 'host-A');
    socket.heldMethods.add('comment.list');
    const previous = globalThis.window.electronAPI;
    globalThis.window.electronAPI = {
      invoke: (channel: string, payload: unknown) => call(channel, a.event, payload),
    } as typeof previous;
    vi.useFakeTimers();
    try {
      const { createElectronIpcBackendTransport } =
        await import('$lib/client/live/electron-ipc-transport');
      const transport = createElectronIpcBackendTransport();
      const pending = transport
        .request('comment.list', { workspaceId: 'equal-id', noteId: 'n' }, { timeoutMs: 50 })
        .catch((error) => error);
      await vi.advanceTimersByTimeAsync(51);
      const timeout = await pending;
      expect(timeout.completion).toBeInstanceOf(Promise);
      const first = socket.writes.find(
        (frame: { method: string }) => frame.method === 'comment.list',
      );
      if (outcome === 'replacement') await remote.request('client.hello', {});
      let settled = false;
      void timeout.completion.then(() => {
        settled = true;
      });
      await vi.advanceTimersByTimeAsync(60_000);
      expect(settled).toBe(false);
      expect(
        socket.writes.filter((frame: { method: string }) => frame.method === 'comment.list'),
      ).toHaveLength(1);
      socket.emit(
        'data',
        Buffer.from(
          JSON.stringify({
            id: first.id,
            error: {
              code: outcome === 'transient' ? -32603 : -32003,
              message: 'original private outcome',
              data: { code: outcome === 'transient' ? 'internal' : 'forbidden' },
            },
          }) + '\n',
        ),
      );
      const completion = await timeout.completion;
      if (outcome === 'replacement') expect(completion).toEqual({ retired: true, errors: [] });
      else
        expect(completion).toMatchObject({
          retired: false,
          errors: [{ rpcCode: outcome === 'transient' ? -32603 : -32003 }],
        });
      expect(b.sender.mainFrame.send).not.toHaveBeenCalled();
    } finally {
      globalThis.window.electronAPI = previous;
      vi.useRealTimers();
    }
  });

it('production capability observation preserves full confirmed capabilities without renewing hello', async () => {
  const { a, remote } = await setup();
  const socket = data.sockets.find((entry) => entry.name === 'host-A');
  const count = () =>
    socket.writes.filter((frame: { method: string }) => frame.method === 'client.hello').length;
  const before = count();
  const connection = remote.getRepositoryConnection();
  const observed = await call(IPC_CHANNELS.BACKEND.NODE_CAPABILITIES, a.event, undefined);
  expect(observed).toMatchObject({
    ok: true,
    result: { clientId: 'confirmed', server: { capabilities: { repositoryContext: 1 } } },
  });
  expect(count()).toBe(before);
  expect(remote.getRepositoryConnection()).toBe(connection);
  socket.heldMethods.add('client.hello');
  const renewing = remote.request('client.hello', {});
  await vi.waitFor(() => expect(count()).toBe(before + 1));
  const frame = socket.writes
    .filter((entry: { method: string }) => entry.method === 'client.hello')
    .at(-1);
  expect(await call(IPC_CHANNELS.BACKEND.NODE_CAPABILITIES, a.event, undefined)).toMatchObject({
    ok: false,
    error: { code: 'UNAVAILABLE' },
  });
  socket.emit(
    'data',
    Buffer.from(
      JSON.stringify({
        id: frame.id,
        result: {
          clientId: 'renewed',
          server: { capabilities: { hostMembership: 1, liveState: true } },
        },
      }) + '\n',
    ),
  );
  await renewing;
  expect(await call(IPC_CHANNELS.BACKEND.NODE_CAPABILITIES, a.event, undefined)).toMatchObject({
    ok: true,
    result: {
      clientId: 'renewed',
      server: { capabilities: { hostMembership: 1, liveState: true } },
    },
  });
  expect(count()).toBe(before + 1);
});
