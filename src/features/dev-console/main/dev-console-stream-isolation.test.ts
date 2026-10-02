import { describe, expect, it } from 'vitest';
import type {
  RpcTrafficEvent,
  RpcTrafficMessage,
  RpcTrafficObserver,
  RpcTrafficSource,
} from '$features/backend/main/rpc-traffic';
import { DevConsoleCaptureService } from './dev-console-capture';

class Source implements RpcTrafficSource {
  observers = new Set<RpcTrafficObserver>();
  generation = 1;
  observeTraffic(observer: RpcTrafficObserver) {
    this.observers.add(observer);
    return () => {
      this.observers.delete(observer);
    };
  }
  emit(event: RpcTrafficMessage) {
    for (const observer of this.observers)
      observer({ ...event, connectionGeneration: this.generation } as RpcTrafficEvent);
  }
  request(key: string, direction: 'outbound' | 'inbound', method: string, payload: unknown) {
    this.emit({ type: 'request', key, requestId: key, direction, method, payload });
  }
  reply(key: string, payload: unknown, status: 'success' | 'error' = 'success') {
    this.emit({ type: 'response', key, payload, status });
  }
  notification(direction: 'outbound' | 'inbound', method: string, payload: unknown) {
    this.emit({ type: 'notification', direction, method, payload });
  }
}
function setup(maxRecords = 100, monotonicNow?: () => number) {
  const service = new DevConsoleCaptureService({ maxRecords, monotonicNow });
  const source = new Source();
  const detach = service.registerClient('one', 'main', source);
  const { sessionId } = service.openSession('one');
  return {
    service,
    source,
    detach,
    sessionId,
    rows: () => service.getSnapshot('one', sessionId)!.records,
  };
}
const push = { subscriptionId: 's', kind: 'snapshot', seq: 0, snapshot: [] };
const duplicateRejection = {
  code: -32602,
  message: 'host.execStream requestId is already active',
};

describe('rejected duplicate host streams', () => {
  it.each([1, 3])('preserves the active stream after %i duplicate rejections', (duplicates) => {
    let now = 0;
    const h = setup(100, () => now);
    const start = { command: 'cat', requestId: 'id' };
    const ack = { requestId: 'id' };
    h.source.request('active', 'outbound', 'host.execStream', start);
    now = 1;
    h.source.reply('active', ack);
    for (let i = 0; i < duplicates; i++)
      h.source.request(`duplicate-${i}`, 'outbound', 'host.execStream', start);
    for (let i = duplicates - 1; i >= 0; i--) {
      h.source.reply(`duplicate-${i}`, duplicateRejection, 'error');
      if (i > 0) {
        h.source.notification('inbound', 'events.event', {
          event: { type: 'host:exec:stdout', data: { requestId: 'id', chunk: 'dW5rbm93bg==' } },
        });
        expect(h.rows()[0].frameCount).toBe(2);
      }
    }
    const outputs = ['host:exec:stdout', 'host:exec:stderr'].map((type) => ({
      event: { type, data: { requestId: 'id', chunk: 'aGk=' } },
    }));
    now = 4;
    for (const output of outputs) h.source.notification('inbound', 'events.event', output);
    const input = { requestId: 'id', stdin: 'hello' };
    now = 5;
    h.source.request('write', 'outbound', 'host.execStream.write', input);
    now = 6;
    const writeAck = { ok: true };
    h.source.reply('write', writeAck);
    now = 7;
    const exit = {
      event: { type: 'host:exec:exit', data: { requestId: 'id', ok: true, exitCode: 0 } },
    };
    h.source.notification('inbound', 'events.event', exit);
    const payloads = [start, ack, ...outputs, input, writeAck, exit];
    expect(h.rows()[0]).toMatchObject({
      status: 'success',
      streamState: 'ended',
      frameCount: 7,
      durationMs: 7,
      totalBytes: payloads.reduce(
        (bytes, payload) => bytes + Buffer.byteLength(JSON.stringify(payload)),
        0,
      ),
    });
    expect(h.rows()[0].frames?.map((frame) => JSON.parse(frame.payload.text))).toEqual(payloads);
    expect(
      h
        .rows()
        .filter((row) => String(row.requestId).startsWith('duplicate-'))
        .map((row) => [row.status, row.frameCount]),
    ).toEqual(Array.from({ length: duplicates }, () => ['error', 2]));
  });

  it.each(['timeout', 'send-error', 'error'] as const)(
    'keeps ambiguity when the duplicate ends with an uncertain %s outcome',
    (status) => {
      const h = setup();
      for (const key of ['active', 'uncertain', 'rejected'])
        h.source.request(key, 'outbound', 'host.execStream', { command: 'cat', requestId: 'id' });
      h.source.reply('active', { requestId: 'id' });
      h.source.emit({
        type: 'response',
        key: 'uncertain',
        status,
        payload: { code: -32603, message: 'unknown outcome' },
      });
      h.source.reply('rejected', duplicateRejection, 'error');
      h.source.notification('inbound', 'events.event', {
        event: { type: 'host:exec:stdout', data: { requestId: 'id', chunk: 'YQ==' } },
      });
      h.source.request('write', 'outbound', 'host.execStream.write', {
        requestId: 'id',
        eof: true,
      });
      expect(h.rows()[0].frameCount).toBe(2);
    },
  );

  it('captures output between successive rejected duplicates', () => {
    const h = setup();
    h.source.request('active', 'outbound', 'host.execStream', { command: 'cat', requestId: 'id' });
    h.source.reply('active', { requestId: 'id' });
    for (let i = 0; i < 5; i++) {
      h.source.request(`rejected-${i}`, 'outbound', 'host.execStream', {
        command: 'cat',
        requestId: 'id',
      });
      h.source.reply(`rejected-${i}`, duplicateRejection, 'error');
      h.source.notification('inbound', 'events.event', {
        event: { type: 'host:exec:stdout', data: { requestId: 'id', chunk: 'YQ==' } },
      });
      expect(h.rows()[0].frameCount).toBe(3 + i);
    }
  });

  it('does not erase accepted overlap history when another duplicate is rejected', () => {
    const h = setup(4);
    for (const key of ['old', 'active', 'rejected']) {
      h.source.request(key, 'outbound', 'host.execStream', { command: 'cat', requestId: 'id' });
      if (key !== 'rejected') h.source.reply(key, { requestId: 'id' });
      if (key !== 'rejected') h.source.notification('inbound', 'unrelated', {});
    }
    // The rejected request evicted the old accepted owner, leaving real ambiguity.
    h.source.reply('rejected', duplicateRejection, 'error');
    h.source.notification('inbound', 'events.event', {
      event: { type: 'host:exec:stdout', data: { requestId: 'id', chunk: 'YQ==' } },
    });
    // Snapshot before another row can evict the survivor.
    expect(h.rows().find((row) => row.requestId === 'active')).toMatchObject({ frameCount: 2 });
  });

  it('keeps uncertainty after an unacknowledged owner is evicted', () => {
    const h = setup(4);
    for (const key of ['unknown', 'active', 'rejected']) {
      h.source.request(key, 'outbound', 'host.execStream', { command: 'cat', requestId: 'id' });
      if (key === 'unknown') h.source.notification('inbound', 'unrelated', {});
    }
    h.source.reply('active', { requestId: 'id' });
    h.source.notification('inbound', 'unrelated', {});
    h.source.reply('rejected', duplicateRejection, 'error');
    h.source.reply('unknown', duplicateRejection, 'error'); // Evicted requests cannot regain ownership.
    h.source.notification('inbound', 'events.event', {
      event: { type: 'host:exec:stdout', data: { requestId: 'id', chunk: 'YQ==' } },
    });
    expect(h.rows().find((row) => row.requestId === 'active')).toMatchObject({ frameCount: 2 });
  });

  it('releases collision history when all owners leave bounded retention', () => {
    const h = setup(4);
    for (let cycle = 0; cycle < 8; cycle++) {
      for (const key of ['old', 'active']) {
        h.source.request(`${cycle}-${key}`, 'outbound', 'host.execStream', {
          command: 'cat',
          requestId: 'id',
        });
        h.source.reply(`${cycle}-${key}`, { requestId: 'id' });
      }
      for (let i = 0; i < 4; i++) h.source.notification('inbound', 'unrelated', {});
      expect(h.rows()).toHaveLength(4);
    }
    h.source.request('fresh', 'outbound', 'host.execStream', { command: 'cat', requestId: 'id' });
    h.source.reply('fresh', { requestId: 'id' });
    h.source.notification('inbound', 'events.event', {
      event: { type: 'host:exec:stdout', data: { requestId: 'id', chunk: 'YQ==' } },
    });
    expect(h.rows().find((row) => row.requestId === 'fresh')).toMatchObject({ frameCount: 3 });
    h.service.clearSession('one', h.sessionId);
    expect(h.service.getSnapshot('one', h.sessionId)).toMatchObject({
      records: [],
      retainedPayloadBytes: 0,
    });
  });
});

describe('stream correlation isolation', () => {
  it.each(['outbound', 'inbound'] as const)(
    'correlates both sides of %s RPCs independently of transport direction',
    (direction) => {
      const h = setup();
      const opposite = direction === 'outbound' ? 'inbound' : 'outbound';
      h.source.request('exec', direction, 'host.execStream', { command: 'cat', requestId: 'same' });
      h.source.reply('exec', { requestId: 'same' });
      h.source.request('other', opposite, 'host.execStream', { command: 'cat', requestId: 'same' });
      h.source.reply('other', { requestId: 'same' });
      h.source.request('write', direction, 'host.execStream.write', {
        requestId: 'same',
        stdin: 'hi',
      });
      h.source.reply('write', { ok: true });
      h.source.notification(direction, 'host.execStream.write', { requestId: 'same', eof: true });
      h.source.notification(opposite, 'events.event', {
        event: { type: 'host:exec:stdout', data: { requestId: 'same', chunk: 'aGk=' } },
      });
      expect(h.rows()[0].frames?.map((f) => f.side)).toEqual([
        'request',
        'response',
        'request',
        'response',
        'request',
        'response',
      ]);
      expect(h.rows()[1].frameCount).toBe(2);
    },
  );

  it('scopes reused subscriptions to clients, generations and backends', () => {
    const h = setup();
    const second = new Source();
    const remote = new Source();
    h.service.registerClient('one', 'other', second);
    h.service.registerClient('remote', 'main', remote);
    const remoteSession = h.service.openSession('remote');
    for (const source of [h.source, second, remote]) {
      source.request('sub', 'outbound', 'note.subscribe', { workspaceId: 'w' });
      source.reply('sub', { subscriptionId: 's' });
    }
    h.source.notification('inbound', 'subscription.push', push);
    expect(
      h
        .rows()
        .map((r) => r.frameCount)
        .slice(0, 2),
    ).toEqual([3, 2]);
    expect(h.service.getSnapshot('remote', remoteSession.sessionId)!.records[0].frameCount).toBe(2);
    h.source.emit({ type: 'disconnected' });
    h.source.generation++;
    h.source.request('sub', 'outbound', 'note.subscribe', { workspaceId: 'w' });
    h.source.reply('sub', { subscriptionId: 's' });
    h.source.notification('inbound', 'subscription.push', push);
    expect(
      h
        .rows()
        .filter((r) => r.kind === 'request')
        .map((r) => [r.status, r.frameCount]),
    ).toEqual([
      ['disconnected', 3],
      ['success', 2],
      ['success', 3],
    ]);
  });

  it.each(['clear', 'close', 'evict', 'detach', 'error', 'disconnect'] as const)(
    'releases stream ownership on %s',
    (cleanup) => {
      const h = setup(cleanup === 'evict' ? 1 : 100);
      h.source.request('exec', 'outbound', 'host.execStream', { command: 'cat', requestId: 'id' });
      if (cleanup === 'error') h.source.reply('exec', { code: -32602, message: 'bad' }, 'error');
      else h.source.reply('exec', { requestId: 'id' });
      if (cleanup === 'clear') h.service.clearSession('one', h.sessionId);
      if (cleanup === 'close') {
        h.service.closeSession('one', h.sessionId);
        h.sessionId = h.service.openSession('one').sessionId;
      }
      if (cleanup === 'evict') h.source.notification('inbound', 'unrelated', {});
      if (cleanup === 'detach') h.detach();
      if (cleanup === 'disconnect') h.source.emit({ type: 'disconnected' });
      h.source.notification('inbound', 'events.event', {
        event: { type: 'host:exec:stdout', data: { requestId: 'id', chunk: 'YQ==' } },
      });
      const rows = h.service.getSnapshot('one', h.sessionId)!.records;
      expect(
        rows.filter((r) => r.rpcMethod === 'host.execStream').every((r) => r.frameCount === 2),
      ).toBe(true);
      if (cleanup === 'close') expect(h.source.observers.size).toBe(1);
      if (cleanup === 'detach') expect(h.source.observers.size).toBe(0);
    },
  );

  it('does not guess relationships from unrelated or malformed handles, or ambiguous live IDs', () => {
    const h = setup();
    h.source.request('one', 'outbound', 'host.execStream', { command: 'cat', requestId: 'id' });
    h.source.reply('one', { requestId: 'id' });
    for (const requestId of ['', 1, {}, null, 'other'])
      h.source.notification('inbound', 'events.event', {
        event: { type: 'host:exec:stdout', data: { requestId, chunk: 'YQ==' } },
      });
    h.source.notification('inbound', 'events.event', {
      event: { type: 'agent:updated', data: { requestId: 'id' } },
    });
    h.source.request('two', 'outbound', 'host.execStream', { command: 'cat', requestId: 'id' });
    h.source.reply('two', { requestId: 'id' });
    h.source.notification('inbound', 'events.event', {
      event: { type: 'host:exec:stdout', data: { requestId: 'id', chunk: 'YQ==' } },
    });
    expect(
      h
        .rows()
        .filter((r) => r.kind === 'request')
        .map((r) => r.frameCount),
    ).toEqual([2, 2]);
  });
});

it('ends old subscriptions when a successful replacement shares the same connection group', () => {
  const h = setup();
  h.source.request('old', 'outbound', 'note.subscribe', {
    workspaceId: 'w',
    replaceGroup: 'active',
  });
  h.source.reply('old', { subscriptionId: 'old' });
  h.source.request('failed', 'outbound', 'chat.subscribe', {
    agentId: 'missing',
    replaceGroup: 'active',
  });
  h.source.reply('failed', { code: -32602, message: 'missing agent' }, 'error');
  h.source.notification('inbound', 'subscription.push', { ...push, subscriptionId: 'old' });
  expect(h.rows()[0]).toMatchObject({ streamState: 'open', frameCount: 3 });
  h.source.request('new', 'outbound', 'events.subscribe', {
    eventTypes: ['agent:*'],
    replaceGroup: 'active',
  });
  h.source.reply('new', { subscriptionId: 'new' });
  h.source.notification('inbound', 'subscription.push', { ...push, subscriptionId: 'old' });
  expect(h.rows()[0]).toMatchObject({ streamState: 'ended', frameCount: 3 });
});

it('ends terminal streams even when their acknowledgement arrives afterward', () => {
  const h = setup();
  h.source.request('exec', 'outbound', 'host.execStream', { command: 'true', requestId: 'id' });
  h.source.notification('inbound', 'events.event', {
    event: { type: 'host:exec:exit', data: { requestId: 'id', ok: true, exitCode: 0 } },
  });
  h.source.reply('exec', { requestId: 'id' });
  h.source.notification('inbound', 'events.event', {
    event: { type: 'host:exec:stdout', data: { requestId: 'id', chunk: 'YQ==' } },
  });
  expect(h.rows()[0]).toMatchObject({ streamState: 'ended', frameCount: 4 });
});

it.each(['clear', 'generation'] as const)(
  'does not replay early frames across %s boundaries',
  (boundary) => {
    const h = setup();
    h.source.request('old', 'outbound', 'host.execStream', { command: 'cat' });
    h.source.notification('inbound', 'events.event', {
      event: { type: 'host:exec:stdout', data: { requestId: 'server-id', chunk: 'YQ==' } },
    });
    if (boundary === 'clear') h.service.clearSession('one', h.sessionId);
    else h.source.generation++;
    h.source.request('new', 'outbound', 'host.execStream', { command: 'cat' });
    h.source.reply('new', { requestId: 'server-id' });
    expect(h.rows().find((r) => r.requestId === 'new')).toMatchObject({
      frameCount: 2,
      droppedFrames: 0,
    });
  },
);

it.each(['clear', 'disconnect', 'evict', 'generation'] as const)(
  'drops ended host associations on %s',
  (boundary) => {
    const h = setup(boundary === 'evict' ? 3 : 100);
    h.source.request('exec', 'outbound', 'host.execStream', { command: 'cat', requestId: 'id' });
    h.source.reply('exec', { requestId: 'id' });
    h.source.request('write', 'outbound', 'host.execStream.write', { requestId: 'id', eof: true });
    h.source.notification('inbound', 'events.event', {
      event: { type: 'host:exec:exit', data: { requestId: 'id', ok: true, exitCode: 0 } },
    });
    if (boundary === 'clear') h.service.clearSession('one', h.sessionId);
    if (boundary === 'disconnect') h.source.emit({ type: 'disconnected' });
    if (boundary === 'generation') h.source.generation++;
    if (boundary === 'evict') h.source.notification('inbound', 'unrelated', {});
    h.source.reply('write', { ok: true });
    h.source.notification('inbound', 'events.event', {
      event: { type: 'host:exec:stdout', data: { requestId: 'id', chunk: 'YQ==' } },
    });
    expect(
      h
        .rows()
        .filter((r) => r.requestId === 'exec')
        .every((r) => r.frameCount === 4),
    ).toBe(true);
  },
);

it('does not guess ownership of trailing output when a completed host ID is reused', () => {
  const h = setup();
  h.source.request('old', 'outbound', 'host.execStream', { command: 'true', requestId: 'id' });
  h.source.reply('old', { requestId: 'id' });
  h.source.notification('inbound', 'events.event', {
    event: { type: 'host:exec:exit', data: { requestId: 'id', ok: true, exitCode: 0 } },
  });
  h.source.request('late-write', 'outbound', 'host.execStream.write', {
    requestId: 'id',
    eof: true,
  });
  h.source.reply('late-write', { ok: true });
  expect(h.rows()[0].frameCount).toBe(3);
  h.source.request('new', 'outbound', 'host.execStream', { command: 'true', requestId: 'id' });
  h.source.reply('new', { requestId: 'id' });
  h.source.notification('inbound', 'events.event', {
    event: { type: 'host:exec:stdout', data: { requestId: 'id', chunk: 'YQ==' } },
  });
  expect(h.rows()[0].frameCount).toBe(3);
  expect(h.rows().find((r) => r.requestId === 'new')?.frameCount).toBe(2);
});

it.each([false, true])(
  'preserves host ID ambiguity after the older owner is evicted (early replay: %s)',
  (earlyReply) => {
    const h = setup(3);
    h.source.request('old', 'outbound', 'host.execStream', {
      command: 'true',
      requestId: 'reused',
    });
    h.source.reply('old', { requestId: 'reused' });
    h.source.notification('inbound', 'events.event', {
      event: { type: 'host:exec:exit', data: { requestId: 'reused', ok: true, exitCode: 0 } },
    });
    h.source.request('new', 'outbound', 'host.execStream', {
      command: 'true',
      requestId: 'reused',
    });
    if (!earlyReply) h.source.reply('new', { requestId: 'reused' });
    // This frame evicts the old execution; it must not clear the survivor's ambiguity.
    h.source.notification(
      'inbound',
      earlyReply ? 'events.event' : 'unrelated',
      earlyReply
        ? {
            event: { type: 'host:exec:stdout', data: { requestId: 'reused', chunk: 'YQ==' } },
          }
        : {},
    );
    if (earlyReply) h.source.reply('new', { requestId: 'reused' });
    h.source.notification('inbound', 'events.event', {
      event: { type: 'host:exec:stdout', data: { requestId: 'reused', chunk: 'Yg==' } },
    });
    expect(h.rows().find((r) => r.requestId === 'new')).toMatchObject({ frameCount: 2 });
  },
);
