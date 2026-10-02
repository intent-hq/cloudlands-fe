import { EventEmitter } from 'node:events';
import type { Duplex } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JsonRpcClient } from '$features/backend/main/json-rpc-client';
import { trafficBytes } from '../traffic-view';
import { DevConsoleCaptureService } from './dev-console-capture';

class Socket extends EventEmitter {
  writes: unknown[] = [];
  write(frame: string) {
    this.writes.push(JSON.parse(frame));
    return true;
  }
  destroy() {}
  receive(frame: unknown) {
    this.emit('data', JSON.stringify({ jsonrpc: '2.0', ...(frame as object) }) + '\n');
  }
}
const clients: JsonRpcClient[] = [];
afterEach(() => {
  for (const client of clients.splice(0)) client.dispose();
  vi.restoreAllMocks();
});
function setup(options: ConstructorParameters<typeof DevConsoleCaptureService>[0] = {}) {
  let clock = 0;
  const service = new DevConsoleCaptureService({ monotonicNow: () => clock, ...options });
  const socket = new Socket();
  const client = new JsonRpcClient({ socketFactory: () => socket as unknown as Duplex });
  clients.push(client);
  service.registerClient('local', 'main', client);
  client.start();
  socket.emit('connect');
  const { sessionId } = service.openSession('local');
  return {
    service,
    socket,
    client,
    sessionId,
    tick: (n: number) => {
      clock = n;
    },
    rows: () => service.getSnapshot('local', sessionId)!.records,
  };
}
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));
const viewer = { principalId: 'p', login: null, displayName: null, avatarUrl: null, cursor: null };
const push = (subscriptionId: string, seq: number, method = 'note.subscribe') => {
  const snapshot =
    method === 'chat.subscribe'
      ? { agentId: 'a', messages: [], truncated: false, totalMessages: 0, nextToken: null }
      : method === 'note.presence.subscribe'
        ? { viewers: [viewer] }
        : [];
  const delta =
    method === 'chat.subscribe'
      ? {
          updated: [
            {
              agentId: 'a',
              messageId: 'm',
              role: 'assistant',
              block: { type: 'text', id: 'm:0', text: '🙂' },
            },
          ],
        }
      : method === 'note.presence.subscribe'
        ? { kind: 'left', viewer }
        : { removedIds: ['n'] };
  return {
    subscriptionId,
    kind: seq ? 'delta' : 'snapshot',
    seq,
    ...(seq ? { delta } : { snapshot }),
  };
};
const bus = (subscriptionId: string, type: string, data: unknown) => ({
  subscriptionId,
  event: {
    type,
    id: 'event-1',
    workspaceId: 'w',
    timestamp: '2026-10-02T00:00:00Z',
    actor: { type: 'system' },
    data,
  },
});

describe('streaming RPC capture', () => {
  it.each(['chat.subscribe', 'note.subscribe', 'task.subscribe', 'note.presence.subscribe'])(
    'captures %s acknowledgement and pushes with per-side timing and totals',
    async (method) => {
      const h = setup();
      const wallClock = vi.spyOn(Date, 'now').mockReturnValue(1000);
      const params =
        method === 'chat.subscribe'
          ? { agentId: 'a' }
          : method === 'note.presence.subscribe'
            ? { workspaceId: 'w', noteId: 'n' }
            : { workspaceId: 'w' };
      const request = h.client.request(method, params);
      expect(h.socket.writes[0]).toEqual({ jsonrpc: '2.0', id: 1, method, params });
      h.tick(5);
      wallClock.mockReturnValue(1005);
      h.socket.receive({ id: 1, result: { subscriptionId: 'sub' } });
      await request;
      h.tick(9);
      wallClock.mockReturnValue(1009);
      h.socket.receive({ method: 'subscription.push', params: push('sub', 0, method) });
      h.tick(20);
      wallClock.mockReturnValue(1020);
      h.socket.receive({ method: 'subscription.push', params: push('sub', 1, method) });
      const row = h.rows()[0];
      expect(row.frames?.map((f) => [f.side, f.intervalMs, JSON.parse(f.payload.text)])).toEqual([
        ['request', 0, params],
        ['response', 5, { subscriptionId: 'sub' }],
        ['response', 4, push('sub', 0, method)],
        ['response', 11, push('sub', 1, method)],
      ]);
      expect(row.frames?.map((f) => f.timestamp)).toEqual([1000, 1005, 1009, 1020]);
      expect(row.durationMs).toBe(20);
      expect(trafficBytes(row)).toBe(
        bytes(params) +
          bytes({ subscriptionId: 'sub' }) +
          bytes(push('sub', 0, method)) +
          bytes(push('sub', 1, method)),
      );
      const update = h.service.getUpdate('local', h.sessionId, 0)!;
      expect(JSON.stringify(update)).not.toContain('snapshot');
      expect(update.upserts[0]).not.toHaveProperty('frames');
    },
  );

  it('captures command stdin on the request side and event output on the response side', async () => {
    const h = setup();
    const start = h.client.request('host.execStream', { command: 'cat', requestId: 'exec' });
    h.tick(2);
    h.socket.receive({ id: 1, result: { requestId: 'exec' } });
    await start;
    h.tick(10);
    const write = h.client.request('host.execStream.write', { requestId: 'exec', stdin: 'hello' });
    h.tick(11);
    h.socket.receive({ id: 2, result: { ok: true } });
    await write;
    h.tick(14);
    h.socket.receive({
      method: 'events.event',
      params: bus('s', 'host:exec:stdout', { requestId: 'exec', chunk: 'aGVsbG8=' }),
    });
    h.tick(17);
    h.socket.receive({
      method: 'events.event',
      params: bus('s', 'host:exec:exit', { requestId: 'exec', ok: true, exitCode: 0 }),
    });
    const row = h.rows()[0];
    expect(row.frames?.map((f) => [f.side, f.rpcMethod, f.intervalMs])).toEqual([
      ['request', 'host.execStream', 0],
      ['response', 'host.execStream', 2],
      ['request', 'host.execStream.write', 10],
      ['response', 'host.execStream.write', 9],
      ['response', 'events.event', 3],
      ['response', 'events.event', 3],
    ]);
    expect(row.durationMs).toBe(17);
    expect(row.streamState).toBe('ended');
    expect(trafficBytes(row)).toBe(
      row.frames!.reduce((sum, f) => sum + f.payload.originalBytes!, 0),
    );
  });

  // Includes synthetic delivery for the broader documented search contract:
  // the current daemon returns search.inFiles/fileNames inline.
  it.each([
    'git.clone',
    'search.inFiles',
    'search.fileNames',
    'search.messages',
    'search.events',
    'search.codebase',
  ])('captures explicit requestId events before the %s reply', async (method) => {
    const h = setup();
    const params =
      method === 'git.clone'
        ? { requestId: 'work', url: 'https://example.com/repo.git', parentDir: '/tmp' }
        : {
            requestId: 'work',
            workspaceId: 'w',
            ...(method === 'search.fileNames' ? { pattern: '*.ts' } : { query: 'TODO' }),
          };
    const pending = h.client.request(method, params);
    expect(h.socket.writes[0]).toEqual({ jsonrpc: '2.0', id: 1, method, params });
    const family = method === 'git.clone' ? 'git:clone' : 'search';
    h.tick(3);
    h.socket.receive({
      method: 'events.event',
      params: bus(
        's',
        family + (family === 'search' ? ':result' : ':progress'),
        family === 'search'
          ? { requestId: 'work', matches: [] }
          : { requestId: 'work', phase: 'receiving', percent: 20, message: 'Receiving' },
      ),
    });
    h.tick(4);
    h.socket.receive({
      id: 1,
      result:
        method === 'git.clone'
          ? { requestId: 'work', targetPath: '/tmp/repo' }
          : {
              requestId: 'work',
              ...(method === 'search.fileNames' ? { files: [] } : { matches: [] }),
              truncated: false,
            },
    });
    await pending;
    expect(h.rows()[0].frames).toHaveLength(3);
    expect(h.rows()[0].durationMs).toBe(4);
  });
});

describe('stream lifecycle and retention', () => {
  it('releases subscriptions only after a successful unsubscribe and never attaches unknown IDs', async () => {
    const h = setup();
    const sub = h.client.request('events.subscribe', {
      eventTypes: ['terminal:*', 'script:*', 'agent:*'],
    });
    h.socket.receive({ id: 1, result: { subscriptionId: 'events' } });
    await sub;
    const terminal = bus('events', 'terminal:data', { terminalId: 't', chunk: 'YQ==' });
    h.socket.receive({ method: 'events.event', params: terminal });
    expect(h.rows()[0].frameCount).toBe(3);
    const failed = h.client.request('events.unsubscribe', { subscriptionId: 'events' });
    h.socket.receive({ id: 2, result: { success: false } });
    await failed;
    h.socket.receive({
      method: 'events.event',
      params: bus('events', 'script:output', { scriptId: 'script', output: 'line' }),
    });
    expect(h.rows()[0].frameCount).toBe(4);
    const removed = h.client.request('events.unsubscribe', { subscriptionId: 'events' });
    h.socket.receive({ id: 3, result: { success: true } });
    await removed;
    for (const subscriptionId of ['events', 'unknown', '', 42, null]) {
      h.socket.receive({ method: 'events.event', params: { ...terminal, subscriptionId } });
    }
    expect(h.rows()[0]).toMatchObject({ frameCount: 4, streamState: 'ended' });
  });

  it('keeps cumulative totals and side intervals when old frames are discarded', async () => {
    const h = setup({ maxFramesPerRecord: 4 });
    const pending = h.client.request('note.subscribe', { workspaceId: 'w' });
    h.tick(1);
    h.socket.receive({ id: 1, result: { subscriptionId: 'sub' } });
    await pending;
    let total = bytes({ workspaceId: 'w' }) + bytes({ subscriptionId: 'sub' });
    for (let seq = 0; seq < 100; seq++) {
      h.tick(seq + 2);
      const params = push('sub', seq);
      total += bytes(params);
      h.socket.receive({ method: 'subscription.push', params });
    }
    const row = h.rows()[0];
    expect(row).toMatchObject({ frameCount: 102, droppedFrames: 98, durationMs: 101 });
    expect(row.frames?.map((f) => f.sequence)).toEqual([0, 1, 100, 101]);
    expect(row.frames?.slice(2).map((f) => f.intervalMs)).toEqual([1, 1]);
    expect(trafficBytes(row)).toBe(total);
    const copy = h.service.getRecord('local', h.sessionId, row.id)!;
    copy.frames![2].payload.text = 'changed';
    expect(h.service.getRecord('local', h.sessionId, row.id)!.frames![2].payload.text).not.toBe(
      'changed',
    );
    const snapshot = h.service.getSnapshot('local', h.sessionId)!;
    expect(snapshot.retainedPayloadBytes).toBe(
      snapshot.records.reduce(
        (sum, r) =>
          sum +
          (r.frames
            ? r.frames.reduce((n, f) => n + f.payload.retainedBytes, 0)
            : r.payload.retainedBytes),
        0,
      ),
    );
  });

  it('retains previews prospectively and counts oversize full frames without losing the stream', async () => {
    const h = setup({ previewBytes: 30, maxPayloadBytes: 300 });
    const pending = h.client.request('chat.subscribe', { agentId: 'a' });
    h.socket.receive({ id: 1, result: { subscriptionId: 's' } });
    await pending;
    const params = {
      subscriptionId: 's',
      kind: 'delta',
      seq: 1,
      delta: {
        updated: [
          {
            agentId: 'a',
            messageId: 'm',
            role: 'assistant',
            block: { type: 'text', id: 'm:0', text: '🙂'.repeat(100) },
          },
        ],
      },
    };
    h.socket.receive({ method: 'subscription.push', params });
    expect(h.rows()[0].frames![2].payload).toMatchObject({
      state: 'truncated',
      originalBytes: bytes(params),
    });
    h.service.setFullCapture(
      'local',
      h.sessionId,
      { direction: 'outbound', kind: 'request', method: 'chat.subscribe' },
      true,
    );
    h.tick(4);
    h.socket.receive({ method: 'subscription.push', params });
    expect(h.rows()[0]).toMatchObject({
      frameCount: 4,
      droppedFrames: 1,
      streamState: 'open',
      durationMs: 4,
    });
    expect(trafficBytes(h.rows()[0])).toBe(
      bytes({ agentId: 'a' }) + bytes({ subscriptionId: 's' }) + bytes(params) * 2,
    );
  });

  it('uses explicit provisioning progress IDs before the workspace.create result', async () => {
    const h = setup();
    const pending = h.client.request('workspace.create', {
      title: 'Test',
      progressId: ' provision ',
    });
    h.tick(3);
    h.socket.receive({
      method: 'events.event',
      params: bus('s', 'git:clone:progress', {
        progressId: 'provision',
        requestId: 'server-minted',
        phase: 'cache',
        percent: 1,
        message: 'Preparing',
      }),
    });
    h.tick(5);
    h.socket.receive({
      method: 'events.event',
      params: bus('s', 'git:clone:done', {
        progressId: 'provision',
        requestId: 'server-minted',
        ok: true,
      }),
    });
    h.tick(7);
    h.socket.receive({ id: 1, result: { id: 'w', title: 'Test' } });
    await pending;
    expect(h.rows()[0]).toMatchObject({ frameCount: 4, streamState: 'ended', durationMs: 7 });
  });
});

it('correlates retained early output once a server-minted stream ID becomes known', async () => {
  const h = setup();
  const pending = h.client.request('host.execStream', { command: 'printf', args: ['hello'] });
  h.tick(2);
  const output = bus('s', 'host:exec:stdout', { requestId: 'server-id', chunk: 'aGVsbG8=' });
  h.socket.receive({ method: 'events.event', params: output });
  h.tick(3);
  const done = bus('s', 'host:exec:exit', { requestId: 'server-id', ok: true, exitCode: 0 });
  h.socket.receive({ method: 'events.event', params: done });
  h.tick(5);
  h.socket.receive({ id: 1, result: { requestId: 'server-id' } });
  await pending;
  expect(h.rows()[0].frames?.map((f) => [f.rpcMethod, f.intervalMs])).toEqual([
    ['host.execStream', 0],
    ['events.event', 2],
    ['events.event', 1],
    ['host.execStream', 2],
  ]);
  expect(h.rows()[0]).toMatchObject({ frameCount: 4, streamState: 'ended', durationMs: 5 });
});

it('counts each payload once per RPC even when subscription, operation and standalone rows share it', async () => {
  const h = setup();
  const subscribeParams = { eventTypes: ['host:exec:*'] };
  const subscribe = h.client.request('events.subscribe', subscribeParams);
  const subscribeAck = { subscriptionId: 'events' };
  h.socket.receive({ id: 1, result: subscribeAck });
  await subscribe;
  const startParams = { command: 'cat', requestId: 'exec' };
  const start = h.client.request('host.execStream', startParams);
  const startAck = { requestId: 'exec' };
  h.socket.receive({ id: 2, result: startAck });
  await start;
  const writeParams = { requestId: 'exec', stdin: '🙂' };
  const write = h.client.request('host.execStream.write', writeParams);
  const writeAck = { ok: true };
  h.socket.receive({ id: 3, result: writeAck });
  await write;
  const output = bus('events', 'host:exec:stdout', { requestId: 'exec', chunk: '8J+Zgg==' });
  h.socket.receive({ method: 'events.event', params: output });
  const [subscription, operation, stdin, notification] = h.rows();
  expect(trafficBytes(subscription)).toBe(
    bytes(subscribeParams) + bytes(subscribeAck) + bytes(output),
  );
  expect(trafficBytes(operation)).toBe(
    bytes(startParams) + bytes(startAck) + bytes(writeParams) + bytes(writeAck) + bytes(output),
  );
  expect(trafficBytes(stdin)).toBe(bytes(writeParams) + bytes(writeAck));
  expect(trafficBytes(notification)).toBe(bytes(output));
  expect([subscription.frameCount, operation.frameCount, stdin.frameCount]).toEqual([3, 5, 2]);
});

it('bounds early-frame replay while retaining cumulative bytes and original observation intervals', async () => {
  const h = setup({ maxFramesPerRecord: 3 });
  const params = { command: 'printf', args: ['hello'] };
  const pending = h.client.request('host.execStream', params);
  let outputBytes = 0;
  for (let n = 1; n <= 20; n++) {
    h.tick(n);
    const output = bus('s', 'host:exec:stdout', { requestId: 'server-id', chunk: 'aGVsbG8=' });
    outputBytes += bytes(output);
    h.socket.receive({ method: 'events.event', params: output });
  }
  h.tick(25);
  const ack = { requestId: 'server-id' };
  h.socket.receive({ id: 1, result: ack });
  await pending;
  const row = h.rows()[0];
  expect(row.frames?.map((f) => [f.sequence, f.intervalMs])).toEqual([
    [0, 0],
    [20, 1],
    [21, 5],
  ]);
  expect(row).toMatchObject({ frameCount: 22, droppedFrames: 19, durationMs: 25 });
  expect(trafficBytes(row)).toBe(bytes(params) + outputBytes + bytes(ack));
});

it('enforces the global byte limit on stream growth without discarding pinned payloads from surviving rows', async () => {
  const h = setup({ maxPayloadBytes: 180, previewBytes: 50 });
  const params = { workspaceId: 'w' };
  const pending = h.client.request('note.subscribe', params);
  h.socket.receive({ id: 1, result: { subscriptionId: 'sub' } });
  await pending;
  h.socket.receive({ method: 'subscription.push', params: push('sub', 1) });
  expect(
    h
      .rows()[0]
      .frames?.slice(0, 2)
      .map((f) => JSON.parse(f.payload.text)),
  ).toEqual([params, { subscriptionId: 'sub' }]);
  h.socket.receive({ method: 'subscription.push', params: push('sub', 2) });
  const snapshot = h.service.getSnapshot('local', h.sessionId)!;
  expect(snapshot.retainedPayloadBytes).toBeLessThanOrEqual(180);
  expect(snapshot.evictedRecords).toBe(1);
  expect(snapshot.records.every((r) => r.kind === 'notification')).toBe(true);
  // Eviction also retires the old stream association: later frames stay standalone.
  h.socket.receive({ method: 'subscription.push', params: push('sub', 3) });
  expect(h.rows().every((r) => r.kind === 'notification')).toBe(true);
});

it.each([false, true])(
  'keeps trailing host output after exit (server-minted ID: %s)',
  async (serverId) => {
    const h = setup();
    const params = { command: 'printf', ...(serverId ? {} : { requestId: 'exec' }) };
    const pending = h.client.request('host.execStream', params);
    const ack = { requestId: 'exec' };
    if (!serverId) {
      h.tick(2);
      h.socket.receive({ id: 1, result: ack });
      await pending;
    }
    const exit = bus('s', 'host:exec:exit', { requestId: 'exec', ok: true, exitCode: 0 });
    const stdout = bus('s', 'host:exec:stdout', { requestId: 'exec', chunk: 'YQ==' });
    const stderr = bus('s', 'host:exec:stderr', { requestId: 'exec', chunk: 'Yg==' });
    for (const [time, payload] of [
      [10, exit],
      [11, stdout],
      [12, stderr],
    ] as const) {
      h.tick(time);
      h.socket.receive({ method: 'events.event', params: payload });
    }
    if (serverId) {
      h.tick(13);
      h.socket.receive({ id: 1, result: ack });
      await pending;
    }
    expect(h.rows()[0]).toMatchObject({
      frameCount: 5,
      streamState: 'ended',
      durationMs: serverId ? 13 : 12,
    });
    expect(trafficBytes(h.rows()[0])).toBe(
      [params, ack, exit, stdout, stderr].reduce((n, p) => n + bytes(p), 0),
    );
  },
);

it.each(['host.execStream.write', 'host.execStream.cancel'])(
  'keeps an already linked %s reply after exit',
  async (method) => {
    const h = setup();
    const params = { command: 'cat', requestId: 'exec' };
    const start = h.client.request('host.execStream', params);
    const ack = { requestId: 'exec' };
    h.socket.receive({ id: 1, result: ack });
    await start;
    h.tick(5);
    const continuation = { requestId: 'exec', ...(method.endsWith('write') ? { eof: true } : {}) };
    const pending = h.client.request(method, continuation);
    h.tick(7);
    const exit = bus('s', 'host:exec:exit', { requestId: 'exec', ok: true, exitCode: 0 });
    h.socket.receive({ method: 'events.event', params: exit });
    h.tick(9);
    h.socket.receive({ id: 2, result: { ok: true } });
    await pending;
    expect(h.rows()[0]).toMatchObject({ frameCount: 5, streamState: 'ended', durationMs: 9 });
    expect(trafficBytes(h.rows()[0])).toBe(
      [params, ack, continuation, exit, { ok: true }].reduce((n, p) => n + bytes(p), 0),
    );
  },
);

it('releases a completed inline message search before reusing its ID for streaming', async () => {
  const h = setup();
  const match = {
    agentId: 'a',
    messageId: 'm',
    workspaceId: 'w',
    agentName: 'Example',
    role: 'user',
    timestamp: '2026-10-02T00:00:00Z',
    preview: 'hello',
  };
  const first = h.client.request('search.messages', {
    workspaceId: 'w',
    query: 'hello',
    requestId: 'query',
  });
  h.socket.receive({ id: 1, result: { requestId: 'query', matches: [match] } });
  await first;
  expect(h.rows()[0]).toMatchObject({ streamState: 'ended', frameCount: 2 });
  const params = { workspaceId: 'w', query: 'hell', requestId: 'query' };
  const second = h.client.request('search.messages', params);
  const ack = { requestId: 'query', matches: [] };
  h.socket.receive({ id: 2, result: ack });
  await second;
  const matches = Array.from({ length: 26 }, (_, n) => ({ ...match, messageId: `m${n}` }));
  const batch = bus('s', 'search:result', { requestId: 'query', matches });
  h.socket.receive({ method: 'events.event', params: batch });
  expect(h.rows()[1]).toMatchObject({ streamState: 'open', frameCount: 3 });
  const done = bus('s', 'search:done', { requestId: 'query', total: 26, truncated: false });
  h.socket.receive({ method: 'events.event', params: done });
  expect(h.rows()[1]).toMatchObject({ streamState: 'ended', frameCount: 4 });
  expect(trafficBytes(h.rows()[1])).toBe(
    [params, ack, batch, done].reduce((n, p) => n + bytes(p), 0),
  );
  expect(h.rows()[0].frameCount).toBe(2);
});
