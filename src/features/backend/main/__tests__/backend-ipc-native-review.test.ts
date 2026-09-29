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
  const fixture = (await import('$shared/types/__fixtures__/native-review-v1.json')).default;
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
          const root = request.params?.review?.root ?? request.params?.root;
          const operationId =
            request.params?.review?.operationId ??
            request.params?.operationId ??
            (request.params?.review?.companion ||
            request.params?.review?.choice?.kind === 'afterCommit'
              ? `aaaaaaaa-0000-4000-8000-${String(++this.next).padStart(12, '0')}`
              : `${name}-${++this.next}`);
          const preparation = {
            ...fixture.prepare.reviewPreparation,
            operationId,
            root,
            scope: { daemonId: name, authorityScopeId: operationId, authorityGeneration: '1' },
            contextRevision: { epoch: operationId, sequence: '1' },
          };
          Reflect.deleteProperty(preparation.source, 'connection');
          Reflect.deleteProperty(preparation.target, 'connection');
          const state = {
            operationId,
            root,
            state: 'settled',
            reviewExecution: {
              ...fixture.execute.reviewExecution,
              requestId: operationId,
              preparation,
              ...(request.params?.action === 'commit'
                ? {
                    gitReceipts: [{ stage: 'commit', commitHash: 'actual-parent' }],
                    outcome: { status: 'not-attempted' },
                  }
                : {}),
            },
          };
          const result =
            request.method === 'client.hello'
              ? {
                  clientId: 'confirmed',
                  server: {
                    capabilities: {
                      repositoryContext: 1,
                      repositorySelection: 1,
                      nativeReview: 1,
                      nativeReviewCompanion: 1,
                    },
                  },
                }
              : request.method === 'accept-changes.prepare' && request.params?.review
                ? {
                    ...fixture.prepare,
                    reviewPreparation: preparation,
                    reviewOperation: {
                      operationId,
                      root,
                      retirementSequence: '0',
                      expiresAfterMs: 300000,
                    },
                  }
                : request.method === 'accept-changes.execute' && request.params?.review
                  ? { ...state, success: true, steps: [] }
                  : request.method === 'accept-changes.reconcile'
                    ? state
                    : request.method === 'accept-changes.release'
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
const channels = IPC_CHANNELS.BACKEND.NATIVE_REVIEW;
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

const input = {
  workspaceId: root.workspaceId,
  action: 'create-pr' as const,
  review: { root, choice: { kind: 'saved' as const } },
};
describe('production native handler and captured socket', () => {
  it('separates equal-ID host A/local B and enriches only with the original main reference', async () => {
    const { a, b } = await setup();
    for (const [owner, host] of [
      [a, 'host-A'],
      [b, 'local-B'],
    ] as const) {
      const prepared = await call(channels.PREPARE, owner.event, { input });
      expect(prepared.ok).toBe(true);
      expect(prepared.result.preview.reviewPreparation.scope.daemonId).toBe(host);
      expect(prepared.result.preview.reviewPreparation.source).not.toHaveProperty('connection');
      const id = prepared.result.id;
      const result = await call(channels.EXECUTE, owner.event, {
        root,
        id,
        command: { prTitle: 'T' },
      });
      expect(result).toMatchObject({
        ok: true,
        result: { execute: { state: 'settled' }, reconciliation: null },
      });
      expect(
        data.sockets
          .find((s) => s.name === host)
          .writes.find((f: any) => f.method === 'accept-changes.execute').params,
      ).toEqual({
        workspaceId: root.workspaceId,
        action: 'create-pr',
        prTitle: 'T',
        review: {
          root,
          operationId: prepared.result.preview.reviewPreparation.operationId,
        },
      });
      await call(channels.RELEASE, owner.event, { root, id });
    }
  });
  it('blocks native arms by presence including null but leaves ordinary GitHub calls unchanged', async () => {
    const { a } = await setup();
    for (const method of ['accept-changes.prepare', 'accept-changes.execute']) {
      for (const review of [null, {}, { operationId: 'forged' }]) {
        expect(
          await call(IPC_CHANNELS.BACKEND.REQUEST, a.event, {
            method,
            params: { review },
            localMachine: true,
          }),
        ).toMatchObject({ ok: false });
      }
      expect(
        await call(IPC_CHANNELS.BACKEND.REQUEST, a.event, {
          method,
          params: { workspaceId: root.workspaceId, action: 'create-pr' },
        }),
      ).toMatchObject({ ok: true, result: { backend: 'host-A' } });
    }
    for (const method of ['accept-changes.release', 'accept-changes.reconcile'])
      expect(
        await call(IPC_CHANNELS.BACKEND.REQUEST, a.event, {
          method,
          params: {},
          localMachine: true,
        }),
      ).toMatchObject({ ok: false });
  });
  it('isolates sender/root/command and intercepts private retirement before renderer broadcasting', async () => {
    const { a, b } = await setup();
    const prepared = await call(channels.PREPARE, a.event, { input }),
      id = prepared.result.id;
    expect(await call(channels.RECONCILE, b.event, { id, root })).toMatchObject({ ok: false });
    expect(
      await call(channels.RECONCILE, a.event, { id, root: { ...root, workspaceId: 'other' } }),
    ).toMatchObject({ ok: false });
    expect(
      await call(channels.EXECUTE, a.event, { id, root, command: { options: {} } }),
    ).toMatchObject({ ok: false });
    a.sender.send.mockClear();
    b.sender.mainFrame.send.mockClear();
    const socket = data.sockets.find((s) => s.name === 'host-A');
    socket.emit(
      'data',
      Buffer.from(
        JSON.stringify({
          method: 'accept-changes.retired',
          params: {
            operationIds: [prepared.result.preview.reviewPreparation.operationId],
            sequence: '1',
            terminal: false,
            allRetired: false,
          },
        }) + '\n',
      ),
    );
    expect(a.sender.send).not.toHaveBeenCalledWith(
      IPC_CHANNELS.BACKEND.NOTIFICATION,
      expect.objectContaining({ method: 'accept-changes.retired' }),
    );
    expect(a.sender.mainFrame.send).toHaveBeenCalledWith(channels.RETIRED, {
      id,
      kind: 'admission',
    });
    expect(b.sender.mainFrame.send).not.toHaveBeenCalledWith(channels.RETIRED, expect.anything());
    expect(await call(channels.RECONCILE, a.event, { id, root })).toMatchObject({ ok: true });
    stampWindowWithBackend(a.window as unknown as Window, 'local');
    stampWindowWithBackend(a.window as unknown as Window, 'host-A');
    expect(await call(channels.RECONCILE, a.event, { id, root })).toMatchObject({ ok: false });
  });
});

it('keeps a marked companion on its original production pooled host and separates both request histories', async () => {
  const { a, b } = await setup();
  const marked = {
    ...input,
    action: 'commit',
    review: { ...input.review, targetBranch: 'trunk', companion: { kind: 'create-pr' } },
  };
  const parent = await call(channels.PREPARE, a.event, { input: marked });
  expect(parent.ok).toBe(true);
  const original = await call(channels.EXECUTE, a.event, {
    id: parent.result.id,
    root,
    command: { commitMessage: 'Original' },
  });
  expect(original.result.execute.reviewExecution.gitReceipts).toEqual([
    { stage: 'commit', commitHash: 'actual-parent' },
  ]);
  expect(
    await call(channels.PREPARE, b.event, { companionOf: parent.result.id, root }),
  ).toMatchObject({ ok: false });
  const child = await call(channels.PREPARE, a.event, { companionOf: parent.result.id, root });
  expect(child.ok).toBe(true);
  expect(child.result.preview.reviewPreparation.scope.daemonId).toBe('host-A');
  expect(child.result.preview.reviewPreparation.source).not.toHaveProperty('connection');
  expect(child.result.id).not.toBe(parent.result.id);
  const response = await call(channels.EXECUTE, a.event, {
    id: child.result.id,
    root,
    command: { prTitle: 'Separate create' },
  });
  expect(response.result.execute.operationId).not.toBe(original.result.execute.operationId);
  expect(response.result.execute.reviewExecution.gitReceipts).toEqual([]);
  const remote = data.sockets.find((s) => s.name === 'host-A'),
    local = data.sockets.find((s) => s.name === 'local-B');
  expect(remote.writes.filter((f: any) => f.method === 'accept-changes.prepare')).toHaveLength(2);
  expect(
    remote.writes.find((f: any) => f.params?.review?.choice?.kind === 'afterCommit').params,
  ).toEqual({
    workspaceId: root.workspaceId,
    action: 'create-pr',
    review: {
      root,
      choice: {
        kind: 'afterCommit',
        operationId: original.result.execute.operationId,
        captureId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      },
    },
  });
  expect(local.writes.filter((f: any) => f.method.startsWith('accept-changes.'))).toHaveLength(0);
  await call(channels.RELEASE, a.event, { id: child.result.id, root });
  expect(
    await call(channels.PREPARE, a.event, { companionOf: parent.result.id, root }),
  ).toMatchObject({ ok: false });
  await call(channels.RELEASE, a.event, { id: parent.result.id, root });
});
