import { describe, expect, it, vi } from 'vitest';
import { orderTraffic, selectedPayloadReader, payloadDocument } from './traffic-view';
import type { DevConsoleRecord, DevConsoleRow } from '$shared/types/dev-console';
const row = (id: string, method: string, timestamp = 0): DevConsoleRow => ({
  id,
  method,
  timestamp,
  direction: 'outbound',
  kind: 'request',
  rpcMethod: method,
  backendId: 'one',
  connectionId: 'main',
  connectionGeneration: 1,
  status: 'pending',
  payload: { state: 'absent', originalBytes: 0, retainedBytes: 0 },
});
describe('payload documents', () => {
  it.each(['null', 'true', 'false', '42', '"hello"'])('handles scalar JSON %s', (text) => {
    expect(payloadDocument(text)).toEqual({ text, language: 'json' });
  });
  it('indents nested objects and arrays with two spaces', () => {
    expect(payloadDocument('{"items":[{"value":1}]}')).toEqual({
      text: '{\n  "items": [\n    {\n      "value": 1\n    }\n  ]\n}',
      language: 'json',
    });
  });
  it.each(['', 'undefined', '[unserializable]', '{"truncated":', 'plain text', ' \n '])(
    'preserves non-JSON text %j',
    (text) => {
      expect(payloadDocument(text)).toEqual({ text, language: 'plaintext' });
    },
  );
});
describe('Dev Console traffic view', () => {
  it('keeps arrival-order ties stable while filtering names and sorting response updates', () => {
    const rows = [
      row('a', 'workspace.list', 10),
      row('b', 'agent.list', 10),
      row('c', 'agent.list', 9),
    ];
    expect(orderTraffic(rows, 'outbound', '', 'timestamp', false).map((r) => r.id)).toEqual([
      'c',
      'a',
      'b',
    ]);
    expect(orderTraffic(rows, 'outbound', 'AGENT.', 'method', true).map((r) => r.id)).toEqual([
      'b',
      'c',
    ]);
    expect(orderTraffic(rows, 'inbound', '', 'timestamp', false)).toEqual([]);
    rows[1] = { ...rows[1], durationMs: 20, status: 'success' };
    expect(orderTraffic(rows, 'outbound', '', 'durationMs', true).map((r) => r.id)).toEqual([
      'b',
      'a',
      'c',
    ]);
  });
  it('rejects late selection replies and releases payload on deselection/disposal', async () => {
    const pending: Array<(r: DevConsoleRecord | null) => void> = [];
    const read = vi.fn(
      () => new Promise<DevConsoleRecord | null>((resolve) => pending.push(resolve)),
    );
    const change = vi.fn();
    const reader = selectedPayloadReader(read, change, vi.fn());
    reader.select('session', row('a', 'first'));
    reader.select('session', row('b', 'second'));
    pending[0]({
      ...row('a', 'first'),
      payload: { text: 'secret', state: 'complete', retainedBytes: 6, originalBytes: 6 },
    });
    await Promise.resolve();
    expect(change).not.toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }));
    reader.select('session', null);
    pending[1]({
      ...row('b', 'second'),
      payload: { text: 'late', state: 'complete', retainedBytes: 4, originalBytes: 4 },
    });
    await Promise.resolve();
    expect(change.mock.calls.every(([value]) => value === null)).toBe(true);
    reader.dispose();
    expect(change).toHaveBeenLastCalledWith(null);
  });
  it('refreshes only changed selected rows and coalesces response updates during a read', async () => {
    const pending: Array<(r: DevConsoleRecord | null) => void> = [];
    const read = vi.fn(
      () => new Promise<DevConsoleRecord | null>((resolve) => pending.push(resolve)),
    );
    const change = vi.fn();
    const reader = selectedPayloadReader(read, change, vi.fn());
    const first = row('a', 'first');
    reader.select('one', first);
    reader.select('one', first);
    reader.select('one', { ...first, status: 'success' });
    reader.select('one', { ...first, status: 'error' });
    expect(read).toHaveBeenCalledTimes(1);
    pending[0](null);
    await Promise.resolve();
    expect(read).toHaveBeenCalledTimes(2);
    reader.select('two', first);
    expect(change).toHaveBeenLastCalledWith(null);
    reader.dispose();
  });
});

it('partitions outbound calls, reverse calls and events while retaining replies on calls', () => {
  const traffic: DevConsoleRow[] = [
    {
      ...row('call', 'shared.method'),
      status: 'success',
      response: { state: 'complete', originalBytes: 30, retainedBytes: 30 },
    },
    { ...row('reverse', 'shared.method'), direction: 'inbound', status: 'pending' },
    {
      ...row('event', 'shared.event'),
      direction: 'inbound',
      kind: 'notification',
      status: 'received',
    },
    {
      ...row('other-event', 'other.event'),
      direction: 'inbound',
      kind: 'notification',
      status: 'received',
    },
  ];
  expect(orderTraffic(traffic, 'outbound', 'shared', 'timestamp', false).map((r) => r.id)).toEqual([
    'call',
  ]);
  expect(orderTraffic(traffic, 'inbound', 'shared', 'timestamp', false).map((r) => r.id)).toEqual([
    'reverse',
  ]);
  expect(orderTraffic(traffic, 'events', 'shared', 'timestamp', false).map((r) => r.id)).toEqual([
    'event',
  ]);
  expect(orderTraffic(traffic, 'events', '', 'timestamp', false)).toHaveLength(2);
});
