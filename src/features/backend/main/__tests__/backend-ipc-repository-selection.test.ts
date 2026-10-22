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
        next: 0,
        destroy() {
          this.destroyed = true;
        },
        write(text: string) {
          const request = JSON.parse(text);
          this.writes.push(request);
          const root = {
            kind: request.params?.gitRootId ? 'registered' : 'primary',
            workspaceId: request.params?.workspaceId,
            ...(request.params?.gitRootId ? { gitRootId: request.params.gitRootId } : {}),
          };
          const selectionId = request.params?.selectionId ?? `${name}-${++this.next}`;
          const snapshot = {
            root,
            rootIncarnation: '1',
            selectionRevision: '1',
            selection: { kind: 'neverSaved' },
          };
          const result =
            request.method === 'client.hello'
              ? {
                  clientId: 'confirmed',
                  server: { capabilities: { repositoryContext: 1, repositorySelection: 1 } },
                }
              : request.method === 'workspace.repositorySelection.capture'
                ? {
                    selectionId,
                    scope: {
                      daemonId: name,
                      authorityScopeId: selectionId,
                      authorityGeneration: '1',
                    },
                    root,
                    snapshot,
                    retirementSequence: '0',
                    expiresAfterMs: 300000,
                  }
                : request.method === 'workspace.repositorySelection.release'
                  ? { released: true }
                  : [
                        'workspace.repositorySelection.save',
                        'workspace.repositorySelection.reset',
                        'workspace.repositorySelection.reconcile',
                      ].includes(request.method)
                    ? {
                        selectionId,
                        root,
                        attempt: {
                          status: 'settled',
                          receipt: {
                            result: { kind: 'applied', snapshot },
                            persistence: { kind: 'committed', selectionRevision: '2' },
                          },
                        },
                      }
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
const channels = IPC_CHANNELS.BACKEND.REPOSITORY_SELECTION;
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

describe('production selection IPC registration and private feed', () => {
  it('captures equal-ID hosts separately and enriches confirmation only in main', async () => {
    const { a, b } = await setup();
    for (const [owner, host] of [
      [a, 'host-A'],
      [b, 'local-B'],
    ] as const) {
      const capture = await call(channels.CAPTURE, owner.event, { root });
      expect(capture.ok).toBe(true);
      expect(capture.result.preview.scope.daemonId).toBe(host);
      expect(capture.result).not.toHaveProperty('selectionId');
      const id = capture.result.id;
      const outcome = await call(channels.CONFIRM, owner.event, {
        root,
        id,
        command: { kind: 'reset' },
      });
      expect(outcome).toMatchObject({
        ok: true,
        result: { attempt: { status: 'settled', receipt: { persistence: { kind: 'committed' } } } },
      });
      const socket = data.sockets.find((s) => s.name === host);
      expect(
        socket.writes.find((f: any) => f.method === 'workspace.repositorySelection.reset').params,
      ).toEqual({
        workspaceId: root.workspaceId,
        selectionId: capture.result.preview.scope.authorityScopeId,
      });
      await call(channels.RELEASE, owner.event, { root, id });
    }
  });
  it('blocks every selection method on the generic bridge including local-machine overrides', async () => {
    const { a } = await setup();
    for (const suffix of ['capture', 'save', 'reset', 'reconcile', 'release']) {
      expect(
        await call(IPC_CHANNELS.BACKEND.REQUEST, a.event, {
          method: 'workspace.repositorySelection.' + suffix,
          params: { workspaceId: 'equal-id' },
          localMachine: true,
        }),
      ).toMatchObject({ ok: false });
    }
    expect(
      await call(IPC_CHANNELS.BACKEND.REQUEST, a.event, {
        method: 'git.status',
        params: { workspaceId: 'equal-id' },
      }),
    ).toMatchObject({ ok: true, result: { backend: 'host-A' } });
  });
  it('rejects wrong sender, root and forged authority fields; drops private retirement broadcasts', async () => {
    const { a, b } = await setup();
    const captured = await call(channels.CAPTURE, a.event, { root });
    const id = captured.result.id;
    expect(await call(channels.RECONCILE, b.event, { id, root })).toMatchObject({ ok: false });
    expect(
      await call(channels.RECONCILE, a.event, { id, root: { ...root, workspaceId: 'other' } }),
    ).toMatchObject({ ok: false });
    expect(
      await call(channels.CONFIRM, a.event, {
        id,
        root,
        command: { kind: 'reset' },
        selectionId: 'forged',
      }),
    ).toMatchObject({ ok: false });
    a.sender.send.mockClear();
    a.sender.mainFrame.send.mockClear();
    const socket = data.sockets.find((s) => s.name === 'host-A');
    socket.emit(
      'data',
      Buffer.from(
        JSON.stringify({
          method: 'workspace.repositorySelection.retired',
          params: {
            selectionIds: [captured.result.preview.scope.authorityScopeId],
            sequence: '1',
            terminal: false,
            allRetired: false,
          },
        }) + '\n',
      ),
    );
    expect(a.sender.send).not.toHaveBeenCalledWith(
      IPC_CHANNELS.BACKEND.NOTIFICATION,
      expect.objectContaining({ method: 'workspace.repositorySelection.retired' }),
    );
    expect(a.sender.mainFrame.send).toHaveBeenCalledWith(channels.RETIRED, {
      id,
      kind: 'admission',
    });
    expect(
      await call(channels.CONFIRM, a.event, { id, root, command: { kind: 'reset' } }),
    ).toMatchObject({ ok: false });
    expect(await call(channels.RECONCILE, a.event, { id, root })).toMatchObject({ ok: true });
  });
  it('rejects an original handle after A to B to A window rebind', async () => {
    const { a } = await setup();
    const captured = await call(channels.CAPTURE, a.event, { root });
    stampWindowWithBackend(a.window as unknown as Window, 'local');
    stampWindowWithBackend(a.window as unknown as Window, 'host-A');
    expect(
      await call(channels.CONFIRM, a.event, {
        id: captured.result.id,
        root,
        command: { kind: 'reset' },
      }),
    ).toMatchObject({ ok: false });
  });
});
