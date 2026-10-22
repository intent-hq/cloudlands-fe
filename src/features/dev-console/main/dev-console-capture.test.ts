import { EventEmitter } from 'node:events';
import type { Duplex } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JsonRpcClient, ReverseRpcHandlerError } from '$features/backend/main/json-rpc-client';
import { DevConsoleCaptureService } from './dev-console-capture';

class Socket extends EventEmitter {
  writes: string[] = [];
  write(frame: string): boolean {
    this.writes.push(frame);
    return true;
  }
  destroy(): void {}
  receive(frame: unknown): void {
    this.emit('data', JSON.stringify(frame) + '\n');
  }
}

const clients: JsonRpcClient[] = [];
afterEach(() => {
  for (const client of clients.splice(0)) client.dispose();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
function connect(service: DevConsoleCaptureService, backendId = 'local', connectionId = 'main') {
  const socket = new Socket();
  const client = new JsonRpcClient({
    socketFactory: () => socket as unknown as Duplex,
    requestTimeoutMs: 100,
    reconnectDelayMs: 1000,
  });
  clients.push(client);
  const unregister = service.registerClient(backendId, connectionId, client);
  client.start();
  socket.emit('connect');
  return { client, socket, unregister };
}
const event = (socket: Socket, params: unknown, method = 'agent:updated') =>
  socket.receive({ jsonrpc: '2.0', method, params });
const requestSelection = {
  direction: 'outbound' as const,
  kind: 'request' as const,
  method: 'work',
};

describe('DevConsoleCaptureService', () => {
  it('does no diagnostic serialization or payload copying before open and after close', async () => {
    const service = new DevConsoleCaptureService();
    const { client, socket } = connect(service);
    const toJSON = vi.fn(() => ({ secret: 'original' }));
    const stringify = vi.spyOn(JSON, 'stringify');
    const parse = vi.spyOn(JSON, 'parse');
    for (let id = 1; id <= 2; id++) {
      if (id === 2) {
        const session = service.openSession('local');
        service.closeSession('local', session.sessionId);
      }
      stringify.mockClear();
      parse.mockClear();
      const pending = client.request('work', { toJSON });
      expect(stringify).toHaveBeenCalledTimes(1);
      expect(parse).not.toHaveBeenCalled();
      socket.emit('data', `{"id":${id},"result":{"ok":true}}\n`);
      await expect(pending).resolves.toEqual({ ok: true });
      expect(stringify).toHaveBeenCalledTimes(1);
      expect(parse).toHaveBeenCalledTimes(1);
    }
    expect(toJSON).toHaveBeenCalledTimes(2);
    expect(service.openSession('local').records).toEqual([]);
  });

  it('captures wire values, correlates replies and errors, and uses monotonic durations', async () => {
    let elapsed = 10;
    const service = new DevConsoleCaptureService({ monotonicNow: () => elapsed });
    const { client, socket } = connect(service);
    const session = service.openSession('local');
    const toJSON = vi.fn(() => ({ value: 7 }));
    const first = client.request('work', { toJSON });
    const second = client.request('fail', { value: 8 });
    expect(JSON.parse(socket.writes[0])).toEqual({
      jsonrpc: '2.0',
      id: 1,
      method: 'work',
      params: { value: 7 },
    });
    elapsed = 25;
    socket.receive({ id: 2, error: { code: -32602, message: 'bad', data: { field: 'value' } } });
    socket.receive({ id: 1, result: { ok: true } });
    await expect(second).rejects.toThrow('bad');
    await expect(first).resolves.toEqual({ ok: true });
    const records = service.getSnapshot('local', session.sessionId)!.records;
    expect(
      records.map(({ method, status, durationMs }) => ({ method, status, durationMs })),
    ).toEqual([
      { method: 'work', status: 'success', durationMs: 15 },
      { method: 'fail', status: 'error', durationMs: 15 },
    ]);
    expect(records[0]).toMatchObject({
      backendId: 'local',
      connectionId: 'main',
      requestId: 1,
      direction: 'outbound',
      kind: 'request',
      payload: { text: '{"value":7}', state: 'complete', originalBytes: 11 },
    });
    expect(records[1].response?.text).toBe(
      '{"code":-32602,"message":"bad","data":{"field":"value"}}',
    );
    expect(toJSON).toHaveBeenCalledTimes(1);
  });

  it('truncates at UTF-8 boundaries and enables full capture prospectively by exact selector', () => {
    const service = new DevConsoleCaptureService();
    const { socket } = connect(service);
    const session = service.openSession('local');
    const text = '🙂'.repeat(1000);
    event(socket, text);
    const selection = {
      direction: 'inbound' as const,
      kind: 'notification' as const,
      method: 'agent:updated',
    };
    service.setFullCapture('local', session.sessionId, selection, true);
    event(socket, text);
    event(socket, text, 'agent:updated:other');
    const records = service.getSnapshot('local', session.sessionId)!.records;
    expect(records[0].payload).toMatchObject({
      state: 'truncated',
      originalBytes: 4002,
      retainedBytes: 2045,
    });
    expect(records[0].payload.text).toBe('"' + '🙂'.repeat(511));
    expect(records[1].payload).toMatchObject({ state: 'complete', retainedBytes: 4002 });
    expect(records[1].payload.text).toBe(JSON.stringify(text));
    expect(records[2].payload.state).toBe('truncated');
  });

  it('applies full capture at each payload arrival, without recovering historical requests', async () => {
    const service = new DevConsoleCaptureService();
    const { socket, client } = connect(service);
    const session = service.openSession('local');
    const pending = client.request('work', 'x'.repeat(4000));
    service.setFullCapture('local', session.sessionId, requestSelection, true);
    socket.receive({ id: 1, result: 'y'.repeat(4000) });
    await pending;
    const record = service.getSnapshot('local', session.sessionId)!.records[0];
    expect(record.payload.state).toBe('truncated');
    expect(record.response).toMatchObject({
      state: 'complete',
      originalBytes: 4002,
      retainedBytes: 4002,
    });
  });

  it('bounds records and aggregate bytes, preserving complete full payloads or reporting drops', () => {
    const service = new DevConsoleCaptureService({ maxRecords: 2, maxPayloadBytes: 20 });
    const { socket } = connect(service);
    const session = service.openSession('local');
    const selector = {
      direction: 'inbound' as const,
      kind: 'notification' as const,
      method: 'event',
    };
    service.setFullCapture('local', session.sessionId, selector, true);
    event(socket, '12345678', 'event');
    event(socket, 'abcdefgh', 'event');
    event(socket, 'ijklmnop', 'event');
    let snapshot = service.getSnapshot('local', session.sessionId)!;
    expect(snapshot.records.map((row) => row.payload.text)).toEqual(['"abcdefgh"', '"ijklmnop"']);
    expect(snapshot).toMatchObject({ retainedPayloadBytes: 20, evictedRecords: 1 });
    event(socket, 'z'.repeat(40), 'event');
    snapshot = service.getSnapshot('local', session.sessionId)!;
    expect(snapshot).toMatchObject({
      droppedRecords: 1,
      oversizePayloads: 1,
      retainedPayloadBytes: 20,
    });
    expect(snapshot.records).toHaveLength(2);
  });

  it('bounds pending correlation and drops a record whose full response cannot fit', async () => {
    const service = new DevConsoleCaptureService({ maxRecords: 2, maxPayloadBytes: 20 });
    const { socket, client } = connect(service);
    const session = service.openSession('local');
    service.setFullCapture('local', session.sessionId, requestSelection, true);
    const pending = client.request('work', '12345678');
    socket.receive({ id: 1, result: 'x'.repeat(20) });
    await pending;
    expect(service.getSnapshot('local', session.sessionId)).toMatchObject({
      records: [],
      droppedRecords: 1,
      oversizePayloads: 1,
      retainedPayloadBytes: 0,
    });
    const later = client.request('work');
    event(socket, 1);
    event(socket, 2);
    socket.receive({ id: 2, result: 'too late' });
    await later;
    expect(service.getSnapshot('local', session.sessionId)!.records.map((row) => row.kind)).toEqual(
      ['notification', 'notification'],
    );
  });

  it('captures timeout, write failure, disconnect, and disposal without changing request behavior', async () => {
    vi.useFakeTimers();
    const service = new DevConsoleCaptureService();
    const { socket, client } = connect(service);
    const session = service.openSession('local');
    const timeout = expect(client.request('timeout')).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(100);
    await timeout;
    vi.spyOn(socket, 'write').mockImplementationOnce(() => {
      throw new Error('write failed');
    });
    await expect(client.request('write')).rejects.toThrow('write failed');
    const disconnected = expect(client.request('disconnect')).rejects.toThrow('Connection closed');
    socket.emit('close');
    await disconnected;
    expect(
      service.getSnapshot('local', session.sessionId)!.records.map((row) => row.status),
    ).toEqual(['timeout', 'send-error', 'disconnected']);
  });

  it('records reverse requests, replies, errors and events without echoing replies as requests', async () => {
    const service = new DevConsoleCaptureService();
    const { socket, client } = connect(service);
    const session = service.openSession('local');
    client.registerMethod('reverse', () => ({ ok: true }));
    client.registerMethod('bad', () => {
      throw new ReverseRpcHandlerError(-32602, 'bad input', { field: 'id' });
    });
    socket.receive({ id: 'rev-1', method: 'reverse', params: { id: 1 } });
    socket.receive({ id: 'rev-2', method: 'bad', params: {} });
    socket.receive({ id: 'rev-3', method: 'missing' });
    event(socket, { workspaceId: 'w' });
    await vi.waitFor(() => expect(socket.writes).toHaveLength(3));
    expect(socket.writes.map((frame) => JSON.parse(frame))).toEqual(
      expect.arrayContaining([
        { jsonrpc: '2.0', id: 'rev-1', result: { ok: true } },
        {
          jsonrpc: '2.0',
          id: 'rev-2',
          error: { code: -32602, message: 'bad input', data: { field: 'id' } },
        },
        {
          jsonrpc: '2.0',
          id: 'rev-3',
          error: { code: -32601, message: 'Method not found: missing' },
        },
      ]),
    );
    expect(
      service
        .getSnapshot('local', session.sessionId)!
        .records.map((row) => [row.direction, row.kind, row.status]),
    ).toEqual([
      ['inbound', 'request', 'success'],
      ['inbound', 'request', 'error'],
      ['inbound', 'request', 'error'],
      ['inbound', 'notification', 'received'],
    ]);
  });

  it('isolates backends and stale completions, subscriptions, choices, and disposers across reopen', async () => {
    const service = new DevConsoleCaptureService();
    const local = connect(service);
    const remote = connect(service, 'remote');
    const first = service.openSession('local');
    expect(service.openSession('local').sessionId).toBe(first.sessionId);
    const changed = vi.fn();
    service.subscribe('local', first.sessionId, changed);
    service.setFullCapture('local', first.sessionId, requestSelection, true);
    const pending = local.client.request('work', { n: 1 });
    let finish!: (value: unknown) => void;
    local.client.registerMethod(
      'slow',
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    local.socket.receive({ id: 'rev-1', method: 'slow' });
    await Promise.resolve();
    service.closeSession('local', first.sessionId);
    changed.mockClear();
    const reopened = service.openSession('local');
    const remoteSession = service.openSession('remote');
    service.closeSession('local', first.sessionId);
    finish({ done: true });
    local.socket.receive({ id: 1, result: 'late' });
    await pending;
    await Promise.resolve();
    event(remote.socket, 'remote');
    expect(service.getSnapshot('local', reopened.sessionId)).toMatchObject({
      records: [],
      fullCapture: [],
    });
    expect(service.getSnapshot('local', first.sessionId)).toBeNull();
    expect(service.getSnapshot('remote', remoteSession.sessionId)!.records).toHaveLength(1);
    expect(changed).not.toHaveBeenCalled();
  });

  it('attaches clients added during a session and detaches replaced clients safely', () => {
    const service = new DevConsoleCaptureService();
    const session = service.openSession('local');
    const old = connect(service);
    const current = connect(service);
    old.unregister();
    event(old.socket, 'old');
    event(current.socket, 'new');
    expect(
      service.getSnapshot('local', session.sessionId)!.records.map((row) => row.payload.text),
    ).toEqual(['"new"']);
    current.unregister();
    event(current.socket, 'detached');
    expect(service.getSnapshot('local', session.sessionId)!.records).toHaveLength(1);
  });

  it('selects events.event by event type while retaining the original wire method and envelope', () => {
    const service = new DevConsoleCaptureService();
    const { socket } = connect(service);
    const session = service.openSession('local');
    service.setFullCapture(
      'local',
      session.sessionId,
      {
        direction: 'inbound',
        kind: 'notification',
        method: 'agent:updated',
      },
      true,
    );
    const params = {
      subscriptionId: 'sub-1',
      event: {
        type: 'agent:updated',
        workspaceId: 'ws-1',
        id: 'evt-1',
        timestamp: '2026-10-01T00:00:00Z',
        actor: { type: 'agent', id: 'agent-1', name: 'Test' },
        data: { text: 'x'.repeat(4000) },
      },
    };
    event(socket, params, 'events.event');
    event(socket, { ...params, event: { ...params.event, type: 'agent:idle' } }, 'events.event');
    const rows = service.getSnapshot('local', session.sessionId)!.records;
    expect(rows[0]).toMatchObject({
      method: 'agent:updated',
      rpcMethod: 'events.event',
      payload: { state: 'complete' },
    });
    expect(JSON.parse(rows[0].payload.text)).toEqual(params);
    expect(rows[1]).toMatchObject({ method: 'agent:idle', payload: { state: 'truncated' } });
  });

  it('enforces the record bound under sustained traffic even when the byte budget has room', () => {
    const service = new DevConsoleCaptureService({ maxRecords: 10 });
    const { socket } = connect(service);
    const session = service.openSession('local');
    for (let n = 0; n < 1000; n++) event(socket, n);
    const snapshot = service.getSnapshot('local', session.sessionId)!;
    expect(snapshot.records.map((row) => Number(row.payload.text))).toEqual([
      990, 991, 992, 993, 994, 995, 996, 997, 998, 999,
    ]);
    expect(snapshot).toMatchObject({ evictedRecords: 990, retainedPayloadBytes: 30 });
  });

  it('evicts oldest rows when completing a retained request exceeds the aggregate budget', async () => {
    const service = new DevConsoleCaptureService({ maxPayloadBytes: 30 });
    const { socket, client } = connect(service);
    const session = service.openSession('local');
    event(socket, 'oldest-oldest');
    const pending = client.request('work', 'params');
    socket.receive({ id: 1, result: 'a-result' });
    await pending;
    expect(service.getSnapshot('local', session.sessionId)).toMatchObject({
      evictedRecords: 1,
      retainedPayloadBytes: 18,
      records: [{ method: 'work', status: 'success', response: { text: '\"a-result\"' } }],
    });
  });

  it('keeps same-id reverse requests from different sessions and connections separate', async () => {
    const service = new DevConsoleCaptureService();
    const { socket, client } = connect(service);
    const first = service.openSession('local');
    let finishOld!: (value: unknown) => void;
    client.registerMethod(
      'slow',
      () =>
        new Promise((resolve) => {
          finishOld = resolve;
        }),
    );
    socket.receive({ id: 'rev-1', method: 'slow' });
    await Promise.resolve();
    service.closeSession('local', first.sessionId);
    const reopened = service.openSession('local');
    client.registerMethod('slow', () => 'new result');
    socket.receive({ id: 'rev-1', method: 'slow' });
    finishOld('old result');
    await vi.waitFor(() => expect(socket.writes).toHaveLength(2));
    expect(service.getSnapshot('local', reopened.sessionId)!.records).toMatchObject([
      { response: { text: '\"new result\"' }, status: 'success' },
    ]);
    const other = connect(service, 'local', 'other');
    const one = client.request('one');
    const two = other.client.request('two');
    socket.receive({ id: 1, result: 1 });
    other.socket.receive({ id: 1, result: 2 });
    await Promise.all([one, two]);
    expect(
      service
        .getSnapshot('local', reopened.sessionId)!
        .records.slice(1)
        .map((row) => [row.connectionId, row.requestId, row.response?.text]),
    ).toEqual([
      ['main', 1, '1'],
      ['other', 1, '2'],
    ]);
  });

  it('marks pending reverse and outbound requests disconnected on disposal', async () => {
    const service = new DevConsoleCaptureService();
    const { socket, client } = connect(service);
    const session = service.openSession('local');
    let finish!: (value: unknown) => void;
    client.registerMethod(
      'slow',
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    socket.receive({ id: 'rev-1', method: 'slow' });
    const pending = expect(client.request('work')).rejects.toThrow('disposed');
    await Promise.resolve();
    client.dispose();
    finish('late');
    await pending;
    await Promise.resolve();
    expect(
      service.getSnapshot('local', session.sessionId)!.records.map((row) => row.status),
    ).toEqual(['disconnected', 'disconnected']);
  });

  it('returns detached snapshots, resets choices and invalidates stale writes', () => {
    const service = new DevConsoleCaptureService({ maxRecords: 1 });
    const { socket } = connect(service);
    const session = service.openSession('local');
    event(socket, { private: 'original' });
    const snapshot = service.getSnapshot('local', session.sessionId)!;
    snapshot.records[0].payload.text = 'tampered';
    snapshot.limits.maxRecords = 999;
    expect(service.getSnapshot('local', session.sessionId)!.records[0].payload.text).toBe(
      '{"private":"original"}',
    );
    expect(service.setFullCapture('local', session.sessionId, requestSelection, true)).toBe(true);
    expect(
      service.setFullCapture(
        'local',
        session.sessionId,
        { ...requestSelection, method: 'other' },
        true,
      ),
    ).toBe(false);
    expect(service.setFullCapture('local', session.sessionId, requestSelection, false)).toBe(true);
    service.closeSession('local', session.sessionId);
    expect(service.setFullCapture('local', session.sessionId, requestSelection, true)).toBe(false);
    expect(service.openSession('local')).toMatchObject({
      records: [],
      fullCapture: [],
      limits: { maxRecords: 1 },
    });
  });

  it('clears history and pending correlations without changing prospective choices or reusing row IDs', async () => {
    const service = new DevConsoleCaptureService();
    const { client, socket } = connect(service);
    const session = service.openSession('local');
    service.setFullCapture('local', session.sessionId, requestSelection, true);
    const pending = client.request('work');
    const oldId = service.getSnapshot('local', session.sessionId)!.records[0].id;
    expect(service.clearSession('local', session.sessionId)).toBe(true);
    socket.receive({ id: 1, result: 'late' });
    await pending;
    expect(service.getSnapshot('local', session.sessionId)).toMatchObject({
      records: [],
      fullCapture: [requestSelection],
      retainedPayloadBytes: 0,
    });
    event(socket, 'new');
    expect(service.getSnapshot('local', session.sessionId)!.records[0].id).not.toBe(oldId);
    service.closeSession('local', session.sessionId);
    expect(service.clearSession('local', session.sessionId)).toBe(false);
  });

  it('isolates observer failures and subscriber failures from live RPC behavior', async () => {
    const service = new DevConsoleCaptureService();
    const { socket, client } = connect(service);
    const session = service.openSession('local');
    client.observeTraffic(() => {
      throw new Error('observer failed');
    });
    service.subscribe('local', session.sessionId, () => {
      throw new Error('window destroyed');
    });
    client.observeTraffic(async () => {
      throw new Error('async observer failed');
    });
    service.subscribe('local', session.sessionId, async () => {
      throw new Error('async subscriber failed');
    });
    const result = client.request('work', {});
    socket.receive({ id: 1, result: 'ok' });
    await expect(result).resolves.toBe('ok');
    expect(service.getSnapshot('local', session.sessionId)!.records[0].status).toBe('success');
  });
});
