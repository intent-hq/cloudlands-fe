import { describe, expect, it, vi } from 'vitest';
import {
  createDaemonLinks,
  parseCaptureStatus,
  toLinkRow,
  type DaemonLinksClient,
} from './daemon-links';
import { LINK_TRAFFIC_FORBIDDEN } from '$shared/types/daemon-links';

const capture = {
  active: true,
  startedAt: '2026-11-03T08:00:00.000Z',
  payloads: true,
  maxRecords: 2000,
  maxPayloadBytes: 65536,
  retained: 2,
  evicted: 1,
  dropped: 0,
  oversized: 1,
  nextSeq: 4,
};
const record = (seq: number, extra: Record<string, unknown> = {}) => ({
  seq,
  at: `2026-11-03T08:00:0${seq}.000Z`,
  direction: seq % 2 ? 'out' : 'in',
  peer: { kind: 'machine', id: 'node-1', name: 'Mac Studio' },
  frameType: 'launch',
  agentId: 'agent-1',
  bytes: 120,
  summary: 'start agent-1',
  payload: { env: { API_KEY: '***' } },
  ...extra,
});

function client(capabilities: Record<string, number> | null, request = vi.fn()) {
  return {
    request,
    getNodeCapabilities: () => capabilities,
  } as unknown as DaemonLinksClient & { request: ReturnType<typeof vi.fn> };
}

describe('daemon links (main)', () => {
  it('reports support only for an exact remoteLinkTraffic: 1 advertisement', () => {
    const clients: Record<string, DaemonLinksClient | undefined> = {
      on: client({ remoteLinkTraffic: 1 }),
      old: client({ remoteMachines: 1 }),
      off: client({ remoteLinkTraffic: 0 }),
      hello: client(null),
    };
    const links = createDaemonLinks((id) => clients[id]);
    expect(links.status('on')).toEqual({ supported: true });
    expect(links.status('old')).toEqual({ supported: false });
    expect(links.status('off')).toEqual({ supported: false });
    expect(links.status('hello')).toEqual({ supported: false });
    expect(links.status('missing')).toEqual({ supported: false });
  });

  it('never sends a capture method to a daemon that does not advertise it', async () => {
    const request = vi.fn();
    const links = createDaemonLinks(() => client({ remoteMachines: 1 }, request));
    await expect(links.start('old')).rejects.toThrow(/not supported/);
    await expect(links.read('old', -1)).rejects.toThrow(/not supported/);
    await expect(links.record('old', 1, capture.startedAt)).rejects.toThrow(/not supported/);
    expect(request).not.toHaveBeenCalled();
  });

  it('starts and stops capture on the window backend and parses the status', async () => {
    const request = vi.fn(async (method: string) => ({
      capture: method.endsWith('.stop') ? { ...capture, active: false, retained: 0 } : capture,
    }));
    const backends: string[] = [];
    const links = createDaemonLinks((id) => {
      backends.push(id);
      return client({ remoteLinkTraffic: 1 }, request);
    });
    expect(await links.start('backend-a')).toEqual(capture);
    expect(await links.stop('backend-a')).toMatchObject({ active: false, retained: 0 });
    expect(request.mock.calls.map(([method]) => method)).toEqual([
      'remoteLinkTraffic.start',
      'remoteLinkTraffic.stop',
    ]);
    expect(new Set(backends)).toEqual(new Set(['backend-a']));
  });

  it('reads incrementally and strips payloads from live rows', async () => {
    const request = vi.fn(async () => ({ capture, records: [record(2), record(3)] }));
    const links = createDaemonLinks(() => client({ remoteLinkTraffic: 1 }, request));
    const first = await links.read('b', -1);
    expect(request).toHaveBeenLastCalledWith('remoteLinkTraffic.snapshot', { limit: 2000 });
    await links.read('b', 3);
    expect(request).toHaveBeenLastCalledWith('remoteLinkTraffic.snapshot', {
      afterSeq: 3,
      limit: 2000,
    });
    expect(first.capture).toEqual(capture);
    expect(first.records).toHaveLength(2);
    expect(first.records[0]).toMatchObject({
      id: 'link-2',
      seq: 2,
      direction: 'in',
      peer: { kind: 'machine', id: 'node-1', name: 'Mac Studio' },
      frameType: 'launch',
      agentId: 'agent-1',
      bytes: 120,
      summary: 'start agent-1',
      hasPayload: true,
      timestamp: Date.parse('2026-11-03T08:00:02.000Z'),
    });
    expect(first.records[0]).not.toHaveProperty('payload');
  });

  it('drops malformed records and tolerates a malformed capture status', async () => {
    const request = vi.fn(async () => ({
      capture: { active: 'yes', maxRecords: -1, retained: 1.5 },
      records: [
        record(1),
        { seq: 'x' },
        record(2, { direction: 'sideways' }),
        record(3, { peer: { kind: 'node', id: 'n' } }),
        null,
      ],
    }));
    const links = createDaemonLinks(() => client({ remoteLinkTraffic: 1 }, request));
    const result = await links.read('b', -1);
    expect(result.records.map((r) => r.seq)).toEqual([1]);
    expect(result.capture).toEqual(parseCaptureStatus(undefined));
    expect(result.capture.active).toBe(false);
  });

  it('fetches one retained record with its masked payload, or null once evicted', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ capture, records: [record(3)] })
      .mockResolvedValueOnce({ capture, records: [record(5)] })
      .mockResolvedValueOnce({
        capture,
        records: [record(1, { payload: undefined, truncated: true })],
      });
    const links = createDaemonLinks(() => client({ remoteLinkTraffic: 1 }, request));
    expect(await links.record('b', 3, capture.startedAt)).toMatchObject({
      seq: 3,
      payload: { env: { API_KEY: '***' } },
    });
    expect(request).toHaveBeenLastCalledWith('remoteLinkTraffic.snapshot', {
      afterSeq: 2,
      limit: 1,
    });
    expect(await links.record('b', 4, capture.startedAt)).toBeNull();
    const oversized = await links.record('b', 1, capture.startedAt);
    expect(oversized).toMatchObject({ seq: 1, truncated: true });
    expect(oversized).not.toHaveProperty('payload');
    expect(request).toHaveBeenLastCalledWith('remoteLinkTraffic.snapshot', {
      afterSeq: 0,
      limit: 1,
    });
  });

  it('returns no record when the daemon now holds a different capture than the selected row', async () => {
    const restarted = { ...capture, startedAt: '2026-11-03T09:00:00.000Z' };
    const request = vi
      .fn()
      .mockResolvedValueOnce({ capture: restarted, records: [record(1)] })
      .mockResolvedValueOnce({ capture: parseCaptureStatus(undefined), records: [] });
    const links = createDaemonLinks(() => client({ remoteLinkTraffic: 1 }, request));
    // Same seq, newer capture: its payload must never stand in for the old row.
    expect(await links.record('b', 1, capture.startedAt)).toBeNull();
    expect(await links.record('b', 1, capture.startedAt)).toBeNull();
  });

  it('tags live rows with the capture they belong to', async () => {
    const request = vi.fn(async () => ({ capture, records: [record(2)] }));
    const links = createDaemonLinks(() => client({ remoteLinkTraffic: 1 }, request));
    const { records } = await links.read('b', -1);
    expect(records[0].captureStartedAt).toBe(capture.startedAt);
  });

  it('keeps a nameless peer and an unknown frame type as sent', async () => {
    const request = vi.fn(async () => ({
      capture,
      records: [record(1, { peer: { kind: 'backend', id: 'daemon-b' }, frameType: 'future' })],
    }));
    const links = createDaemonLinks(() => client({ remoteLinkTraffic: 1 }, request));
    const [row] = (await links.read('b', -1)).records;
    expect(row.peer).toEqual({ kind: 'backend', id: 'daemon-b' });
    expect(row.frameType).toBe('future');
    expect(toLinkRow({ ...row, at: 'not a date', summary: '' })).toMatchObject({
      id: 'link-1',
      timestamp: 0,
      hasPayload: false,
    });
  });

  it('maps the owner-only refusal to a marker and passes other errors through', async () => {
    const forbidden = Object.assign(new Error('Forbidden'), { rpcCode: -32003 });
    const request = vi
      .fn()
      .mockRejectedValueOnce(forbidden)
      .mockRejectedValueOnce(new Error('socket closed'));
    const links = createDaemonLinks(() => client({ remoteLinkTraffic: 1 }, request));
    await expect(links.start('b')).rejects.toThrow(LINK_TRAFFIC_FORBIDDEN);
    await expect(links.read('b', -1)).rejects.toThrow('socket closed');
  });

  it('subscribes to the records event, signals only its own events and resubscribes on reconnect', async () => {
    const { EventEmitter } = await import('node:events');
    let next = 0;
    const request = vi.fn(async (method: string) =>
      method === 'events.subscribe' ? { subscriptionId: `sub-${++next}` } : {},
    );
    const emitter = Object.assign(new EventEmitter(), {
      request,
      getNodeCapabilities: () => ({ remoteLinkTraffic: 1 }),
    });
    const links = createDaemonLinks(() => emitter as unknown as DaemonLinksClient);
    const onChange = vi.fn();
    const stop = links.watch('b', onChange);
    await vi.waitFor(() =>
      expect(request).toHaveBeenCalledWith('events.subscribe', {
        eventTypes: ['remoteLinkTraffic:records'],
      }),
    );
    const event = (subscriptionId: string, type = 'remoteLinkTraffic:records') =>
      emitter.emit('notification', {
        method: 'events.event',
        params: { subscriptionId, event: { type, data: { records: [], capture: {} } } },
      });
    event('sub-1');
    event('someone-else');
    event('sub-1', 'agent:idle');
    expect(onChange).toHaveBeenCalledTimes(1);
    emitter.emit('reconnected');
    await vi.waitFor(() =>
      expect(request).toHaveBeenCalledWith('events.unsubscribe', { subscriptionId: 'sub-1' }),
    );
    await vi.waitFor(() => expect(next).toBe(2));
    await Promise.resolve();
    event('sub-1');
    event('sub-2');
    expect(onChange).toHaveBeenCalledTimes(2);
    stop();
    expect(request).toHaveBeenLastCalledWith('events.unsubscribe', { subscriptionId: 'sub-2' });
    event('sub-2');
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(emitter.listenerCount('notification')).toBe(0);
    expect(emitter.listenerCount('reconnected')).toBe(0);
  });

  it('never subscribes on a daemon without the capability', () => {
    const request = vi.fn();
    const links = createDaemonLinks(() => client({ remoteMachines: 1 }, request));
    links.watch('b', vi.fn())();
    expect(request).not.toHaveBeenCalled();
  });
});
