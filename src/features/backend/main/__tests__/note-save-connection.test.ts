/** Actual captured JsonRpcClient; controlled socket ACKs are not live Services evidence. */
import { EventEmitter } from 'node:events';
import { BrowserWindow, ipcMain } from 'electron';
import type { BrowserWindow as Window, IpcMainInvokeEvent } from 'electron';
import { afterEach, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import type { JsonRpcClient } from '../json-rpc-client';

const data = vi.hoisted(() => ({ sockets: [] as any[], windows: new Map<object, any>() }));
vi.mock('../backend-connection', async (original) => {
  const actual = await original<typeof import('../backend-connection')>();
  const { EventEmitter } = await import('node:events');
  return {
    ...actual,
    createBackendSocket() {
      const socket = Object.assign(new EventEmitter(), {
        destroyed: false,
        writes: [] as any[],
        hook: undefined as (() => void) | undefined,
        destroy() {
          this.destroyed = true;
          this.emit('close');
        },
        write(text: string) {
          const request = JSON.parse(text);
          this.writes.push(request);
          if (request.method === 'client.hello')
            queueMicrotask(() =>
              this.reply(request, {
                clientId: 'controlled-fixed-principal',
                server: { capabilities: {} },
              }),
            );
          else this.hook?.();
          return true;
        },
        reply(request: any, result: unknown) {
          this.emit(
            'data',
            Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\n'),
          );
        },
      });
      data.sockets.push(socket);
      queueMicrotask(() => socket.emit('connect'));
      return socket;
    },
  };
});
const op = {
  scope: { backendId: 'bound-test', workspaceId: 'w', noteId: 'n', noteInstanceId: 'incarnation' },
  operationId: 'operation',
  baseRevision: 'before',
  headerDigest: 'a'.repeat(64),
  payloadDigest: 'b'.repeat(64),
  expiresAt: '2099-01-01T00:00:00.000Z',
  viewLength: 59,
};
const receipt = {
  kind: 'noteCommitReceipt',
  outcome: 'committed',
  scope: op.scope,
  operationId: op.operationId,
  headerDigest: op.headerDigest,
  payloadDigest: op.payloadDigest,
  beforeRevision: op.baseRevision,
  afterRevision: 'after',
  sourceLength: 3,
  invalidation: 'all',
  viewId: 'view',
  mappingRef: 'mapping',
  effectsRef: 'effects',
  inverseRef: 'inverse',
  receiptExpiresAt: op.expiresAt,
};
const channels = IPC_CHANNELS.BACKEND.NOTE_SAVE_CONNECTION;
const clients: JsonRpcClient[] = [];
afterEach(() => {
  for (const c of clients.splice(0)) c.dispose();
  data.sockets.length = 0;
  data.windows.clear();
});
async function fixture(beforeCapture?: (client: JsonRpcClient) => void) {
  vi.resetModules();
  const [{ JsonRpcClient }, { stampWindowWithBackend }, { registerNoteSaveConnectionHandlers }] =
    await Promise.all([
      import('../json-rpc-client'),
      import('../../../../main/window-backend'),
      import('../note-save-connection'),
    ]);
  const sender = Object.assign(new EventEmitter(), {
    mainFrame: { send: vi.fn() },
    isDestroyed: () => false,
  });
  const window = Object.assign(new EventEmitter(), {
    webContents: sender,
    isDestroyed: () => false,
  });
  data.windows.set(sender, window);
  vi.mocked(BrowserWindow.fromWebContents).mockImplementation((s) => data.windows.get(s) ?? null);
  stampWindowWithBackend(window as unknown as Window, op.scope.backendId);
  const event = { sender, senderFrame: sender.mainFrame } as unknown as IpcMainInvokeEvent;
  const client = new JsonRpcClient({
    config: { transport: 'uds', socketPath: '/controlled-note.sock' },
    heartbeatIntervalMs: 0,
    helloParams: () => ({ clientId: 'controlled' }),
    requestTimeoutMs: 1000,
  });
  client.on('error', () => {});
  clients.push(client);
  client.start();
  await vi.waitFor(() => expect(client.getRepositoryConnection()).not.toBeNull());
  let generation = 0,
    pooled = client;
  vi.mocked(ipcMain.handle).mockClear();
  const handlers = registerNoteSaveConnectionHandlers(ipcMain, {
    readBackend: () => pooled,
    credentialGeneration: () => generation,
  });
  const call = (channel: string, value: unknown, origin = event) => {
    const handler = vi.mocked(ipcMain.handle).mock.calls.find(([c]) => c === channel)![1];
    return handler(origin, value);
  };
  beforeCapture?.(client);
  const captured = await call(channels.CAPTURE, op);
  if (!beforeCapture) expect(captured.ok).toBe(true);
  const id = captured.result?.id as string,
    socket = data.sockets.at(-1);
  return {
    client,
    captured,
    sender,
    window,
    event,
    call,
    socket,
    id,
    handlers,
    anotherOrigin() {
      const sender = Object.assign(new EventEmitter(), {
        mainFrame: { send: vi.fn() },
        isDestroyed: () => false,
      });
      const window = Object.assign(new EventEmitter(), {
        webContents: sender,
        isDestroyed: () => false,
      });
      data.windows.set(sender, window);
      stampWindowWithBackend(window as unknown as Window, op.scope.backendId);
      return { sender, senderFrame: sender.mainFrame } as unknown as IpcMainInvokeEvent;
    },
    replace() {
      pooled = {} as JsonRpcClient;
    },
    credentials() {
      generation++;
    },
    request: (command: unknown) => call(channels.REQUEST, { id, command }),
    release: () => call(channels.RELEASE, { id }),
  };
}
it('uses the captured real socket, rejects concurrent/repeated commit, and consumes release ACK once', async () => {
  const f = await fixture();
  const pending = f.request({ kind: 'commit' });
  await expect(f.request({ kind: 'commit' })).resolves.toMatchObject({ ok: false });
  const request = f.socket.writes.at(-1);
  expect(request.method).toBe('note.operation.commit');
  expect(request.params).toEqual({
    ...op.scope,
    operationId: op.operationId,
    headerDigest: op.headerDigest,
    payloadDigest: op.payloadDigest,
  });
  f.socket.reply(request, receipt);
  await expect(pending).resolves.toMatchObject({
    ok: true,
    result: { current: true, settlement: { value: receipt } },
  });
  await expect(f.request({ kind: 'commit' })).resolves.toMatchObject({ ok: false });
  await expect(f.release()).resolves.toMatchObject({
    ok: true,
    result: { id: f.id, released: true, operationId: op.operationId },
  });
  await expect(f.release()).resolves.toMatchObject({ ok: false });
});
it.each(['credentials', 'replace', 'navigation'] as const)(
  'preserves late own ACK after %s loss without a new connection',
  async (mode) => {
    const f = await fixture(),
      pending = f.request({ kind: 'commit' });
    const request = f.socket.writes.at(-1);
    if (mode === 'navigation') f.sender.emit('did-start-navigation', {}, '', false, true);
    else f[mode]();
    f.socket.reply(request, receipt);
    await expect(pending).resolves.toMatchObject({
      ok: true,
      result: { current: false, settlement: { value: receipt } },
    });
    const count = f.socket.writes.length;
    await expect(f.request({ kind: 'source' })).resolves.toMatchObject({ ok: false });
    expect(f.socket.writes).toHaveLength(count);
    await expect(f.release()).resolves.toMatchObject({ ok: true });
  },
);
it('claims one global slot across senders and rejects foreign frame/release before wire', async () => {
  const f = await fixture(),
    count = f.socket.writes.length;
  const other = f.anotherOrigin();
  await expect(f.call(channels.CAPTURE, op, other)).resolves.toMatchObject({ ok: false });
  await expect(
    f.call(channels.REQUEST, { id: f.id, command: { kind: 'commit' } }, {
      ...f.event,
      senderFrame: {},
    } as IpcMainInvokeEvent),
  ).resolves.toMatchObject({ ok: false });
  await expect(f.call(channels.RELEASE, { id: 'foreign' })).resolves.toMatchObject({ ok: false });
  expect(f.socket.writes).toHaveLength(count);
  await expect(f.release()).resolves.toMatchObject({ ok: true });
  // This sender is independently valid, not rejected merely as a foreign frame.
  const next = await f.call(channels.CAPTURE, op, other);
  expect(next.ok).toBe(true);
  expect(next.result.id).not.toBe(f.id);
  await expect(f.call(channels.RELEASE, { id: next.result.id }, other)).resolves.toMatchObject({
    ok: true,
  });
});
it('uses one captured status after pending commit and keeps phase deadlines separate', async () => {
  const f = await fixture();
  const commit = f.request({ kind: 'commit' });
  f.socket.reply(f.socket.writes.at(-1), {
    kind: 'noteOperationStatus',
    outcome: 'pending',
    scope: op.scope,
    operationId: op.operationId,
    headerDigest: op.headerDigest,
    payloadDigest: op.payloadDigest,
  });
  await expect(commit).resolves.toMatchObject({ ok: true });
  const deadline = Date.parse(op.expiresAt);
  const now = vi.spyOn(Date, 'now').mockReturnValue(deadline + 1);
  try {
    const pending = f.request({ kind: 'status' });
    expect(f.socket.writes.at(-1)).toMatchObject({
      method: 'note.operationStatus',
      params: {
        ...op.scope,
        operationId: op.operationId,
        headerDigest: op.headerDigest,
        payloadDigest: op.payloadDigest,
      },
    });
    f.socket.reply(f.socket.writes.at(-1), {
      ...receipt,
      receiptExpiresAt: new Date(deadline + 60000).toISOString(),
    });
    await expect(pending).resolves.toMatchObject({ ok: true, result: { current: true } });
    const calls = f.socket.writes.length;
    await expect(f.request({ kind: 'status' })).resolves.toMatchObject({ ok: false });
    await expect(f.request({ kind: 'commit' })).resolves.toMatchObject({ ok: false });
    now.mockReturnValue(deadline + 60000);
    await expect(f.request({ kind: 'source' })).resolves.toMatchObject({ ok: false });
    now.mockReturnValue(deadline - 1);
    await expect(f.request({ kind: 'source' })).resolves.toMatchObject({ ok: false });
    expect(f.socket.writes).toHaveLength(calls);
    await expect(f.release()).resolves.toMatchObject({ ok: true });
  } finally {
    now.mockRestore();
  }
});
it('refuses expiry before first commit and never revives the retired capture', async () => {
  const f = await fixture(),
    calls = f.socket.writes.length;
  const now = vi.spyOn(Date, 'now').mockReturnValue(Date.parse(op.expiresAt));
  try {
    await expect(f.request({ kind: 'commit' })).resolves.toMatchObject({ ok: false });
    now.mockReturnValue(Date.parse(op.expiresAt) - 1);
    await expect(f.request({ kind: 'commit' })).resolves.toMatchObject({ ok: false });
    expect(f.socket.writes).toHaveLength(calls);
    await expect(f.release()).resolves.toMatchObject({ ok: true });
  } finally {
    now.mockRestore();
  }
});
it('keeps entered IO owned during reentrant retirement/release', async () => {
  const f = await fixture();
  let released = false,
    release: Promise<any> | undefined;
  f.socket.hook = () => {
    f.handlers.retireBackend(op.scope.backendId);
    release = f.release().then((v) => {
      released = true;
      return v;
    });
  };
  const pending = f.request({ kind: 'commit' });
  await Promise.resolve();
  expect(released).toBe(false);
  f.socket.reply(f.socket.writes.at(-1), receipt);
  await expect(pending).resolves.toMatchObject({ ok: true, result: { current: false } });
  await expect(release).resolves.toMatchObject({ ok: true });
});
it('bounds receipt/source addresses to the known outcome and keeps lexical identity separate', async () => {
  const f = await fixture(),
    pending = f.request({ kind: 'commit' });
  f.socket.reply(f.socket.writes.at(-1), receipt);
  await pending;
  await expect(
    f.request({ kind: 'receipt', output: 'inverseText', ref: 'inverse' }),
  ).resolves.toMatchObject({ ok: false });
  const read = f.request({
    kind: 'receipt',
    output: 'inverseText',
    ref: 'inverse',
    textId: 'empty',
  });
  expect(f.socket.writes.at(-1).params).toMatchObject({
    kind: 'inverseText',
    textId: 'empty',
    maxItems: 1,
    maxWireBytes: 8192,
    maxSourceBytes: 4096,
  });
  f.socket.reply(f.socket.writes.at(-1), {
    kind: 'noteOperationPage',
    outputKind: 'inverseText',
    scope: op.scope,
    operationId: op.operationId,
    headerDigest: op.headerDigest,
    payloadDigest: op.payloadDigest,
    viewId: 'view',
    sourceLength: 3,
    expiresAt: op.expiresAt,
    items: [{ textId: 'empty', offset: 0, text: '' }],
    nextCursor: null,
  });
  await expect(read).resolves.toMatchObject({ ok: true });
  const source = f.request({ kind: 'source' });
  expect(f.socket.writes.at(-1).params).toEqual({
    workspaceId: 'w',
    noteId: 'n',
    page: {
      kind: 'source',
      at: 0,
      sourceRevision: 'after',
      noteInstanceId: 'incarnation',
      maxSourceBytes: 4096,
      maxWireBytes: 8192,
      maxItems: 64,
    },
  });
  f.socket.reply(f.socket.writes.at(-1), {
    kind: 'noteSourcePage',
    scope: op.scope,
    sourceRevision: 'after',
    snapshotId: 'NEW',
    expiresAt: op.expiresAt,
    text: 'aXb',
    sourceLength: 3,
    range: { start: 0, end: 3 },
    contextRef: 'new-context',
    nextCursor: null,
  });
  await expect(source).resolves.toMatchObject({ ok: true });
  const context = f.request({ kind: 'context', contextRef: 'new-context' });
  expect(f.socket.writes.at(-1).params).toEqual({
    workspaceId: 'w',
    noteId: 'n',
    page: { kind: 'context', contextRef: 'new-context', maxWireBytes: 8192, maxItems: 64 },
  });
  f.socket.reply(f.socket.writes.at(-1), {
    kind: 'noteContextPage',
    scope: op.scope,
    sourceRevision: 'after',
    snapshotId: 'NEW',
    expiresAt: op.expiresAt,
    items: [],
    nextCursor: null,
  });
  await expect(context).resolves.toMatchObject({ ok: true });
  await expect(f.request({ kind: 'source' })).resolves.toMatchObject({ ok: false });
  await f.release();
});
it('retains the global unknown slot after malformed own response and sender recreation', async () => {
  const f = await fixture(),
    pending = f.request({ kind: 'commit' });
  f.socket.reply(f.socket.writes.at(-1), { ...receipt, operationId: 'foreign' });
  await expect(pending).resolves.toMatchObject({ ok: false });
  await expect(f.release()).resolves.toMatchObject({ ok: false });
  await expect(f.call(channels.CAPTURE, op, f.anotherOrigin())).resolves.toMatchObject({
    ok: false,
  });
  f.sender.emit('destroyed');
  await expect(f.call(channels.CAPTURE, op)).resolves.toMatchObject({ ok: false });
});

it('owns release before synchronous retirement-notification reentry', async () => {
  const f = await fixture();
  let nested: Promise<any> | undefined;
  f.sender.mainFrame.send.mockImplementation(() => {
    nested = f.release();
  });
  await expect(f.release()).resolves.toMatchObject({ ok: true });
  await expect(nested).resolves.toMatchObject({ ok: false });
});
it('keeps global debt when subscription registers then throws', async () => {
  const f = await fixture((client) => {
    const register = client.onRepositoryConnectionEvent.bind(client);
    vi.spyOn(client, 'onRepositoryConnectionEvent').mockImplementation((listener) => {
      register(listener);
      throw new Error('controlled registered then threw');
    });
  });
  expect(f.captured.ok).toBe(false);
  await Promise.resolve();
  await Promise.resolve();
  await expect(f.call(channels.CAPTURE, op)).resolves.toMatchObject({ ok: false });
  expect(f.client.onRepositoryConnectionEvent).toHaveBeenCalledOnce();
});
it('decodes release before any full input key scratch', async () => {
  const f = await fixture(),
    raw = Object.fromEntries(Array.from({ length: 2000 }, (_, i) => [`k${i}`, i]));
  const original = Object.keys;
  let enumerated = false;
  const spy = vi.spyOn(Object, 'keys').mockImplementation((value) => {
    if (value === raw) enumerated = true;
    return original(value);
  });
  try {
    await expect(f.call(channels.RELEASE, raw)).resolves.toMatchObject({ ok: false });
    expect(enumerated).toBe(false);
  } finally {
    spy.mockRestore();
    await f.release();
  }
});
it('uses the admitted command copy after callbackful connection checks', async () => {
  const f = await fixture(),
    raw = { id: f.id, command: { kind: 'commit' } };
  const get = vi.fn(() => ({ kind: 'source' })),
    original = f.client.getRepositoryConnection.bind(f.client);
  const spy = vi.spyOn(f.client, 'getRepositoryConnection').mockImplementation(() => {
    Object.defineProperty(raw, 'command', { configurable: true, enumerable: true, get });
    return original();
  });
  try {
    const pending = f.call(channels.REQUEST, raw);
    expect(f.socket.writes.at(-1).method).toBe('note.operation.commit');
    expect(get).not.toHaveBeenCalled();
    f.socket.reply(f.socket.writes.at(-1), receipt);
    await expect(pending).resolves.toMatchObject({ ok: true });
  } finally {
    spy.mockRestore();
    await f.release();
  }
});
