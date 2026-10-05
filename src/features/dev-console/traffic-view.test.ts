import { describe, expect, it, vi } from 'vitest';
import {
  orderTraffic,
  trafficBytes,
  selectedPayloadReader,
  payloadDocument,
  payloadSupportsRichView,
} from './traffic-view';
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
  it('bounds rich rendering by UTF-16 length, preserving the 20 * 1024 * 1024 boundary', () => {
    const boundary = 'x'.repeat(20 * 1024 * 1024);
    expect(payloadSupportsRichView(boundary)).toBe(true);
    expect(payloadSupportsRichView(boundary + 'x')).toBe(false);
  });
  it.each(['\n', '\r', '\r\n'])(
    'bounds rich rendering at 300,000 logical lines with %j separators',
    (newline) => {
      const boundary = newline.repeat(299999);
      expect(payloadSupportsRichView(boundary)).toBe(true);
      expect(payloadSupportsRichView(boundary + newline)).toBe(false);
    },
  );
  it('detects a supported capture whose pretty-printed JSON crosses the line limit', () => {
    const captured = JSON.stringify({
      items: Array.from({ length: 100000 }, () => ({ value: 1 })),
    });
    expect(captured.length).toBe(1200011);
    const formatted = payloadDocument(captured);
    expect(formatted.text.split('\n')).toHaveLength(300004);
    expect(payloadSupportsRichView(formatted.text)).toBe(false);
    expect(formatted.language).toBe('json');
  });
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

it('combines exactly the existing streams chronologically, with arrival-order ties and in-place completions', () => {
  const traffic: DevConsoleRow[] = [
    row('out', 'shared.call', 10),
    {
      ...row('event', 'shared.event', 10),
      direction: 'inbound',
      kind: 'notification',
      status: 'received',
    },
    { ...row('in', 'shared.reverse', 10), direction: 'inbound' },
    row('earlier', 'other.call', 9),
    { ...row('excluded', 'shared.notification', 8), kind: 'notification' },
  ];
  const ids = (descending = false, filter = '') =>
    orderTraffic(traffic, 'all', filter, 'timestamp', descending).map((record) => record.id);
  expect(ids()).toEqual(['earlier', 'out', 'event', 'in']);
  expect(ids(true)).toEqual(['out', 'event', 'in', 'earlier']);
  expect(ids(false, ' SHARED. ')).toEqual(['out', 'event', 'in']);
  traffic[0] = {
    ...traffic[0],
    status: 'success',
    completedAt: 20,
    durationMs: 10,
    response: { state: 'complete', originalBytes: 42, retainedBytes: 42 },
  };
  expect(ids()).toEqual(['earlier', 'out', 'event', 'in']);
  expect(orderTraffic(traffic, 'all', '', 'bytes', true)[0]).toBe(traffic[0]);
  expect(traffic.map((record) => record.id)).toEqual(['out', 'event', 'in', 'earlier', 'excluded']);
});

it('sorts by cumulative stream bytes without recounting the retained acknowledgement', () => {
  const streaming = {
    ...row('stream', 'note.subscribe'),
    totalBytes: 1000,
    response: { state: 'complete' as const, originalBytes: 20, retainedBytes: 20 },
  };
  const ordinary = {
    ...row('ordinary', 'workspace.list'),
    response: { state: 'complete' as const, originalBytes: 40, retainedBytes: 40 },
  };
  expect(trafficBytes(streaming)).toBe(1000);
  expect(trafficBytes(ordinary)).toBe(40);
  expect(orderTraffic([ordinary, streaming], 'all', '', 'bytes', true).map((r) => r.id)).toEqual([
    'stream',
    'ordinary',
  ]);
});

it('publishes completed stream reads during continuous updates while coalescing the next read', async () => {
  const pending: Array<(record: DevConsoleRecord) => void> = [];
  const read = vi.fn(() => new Promise<DevConsoleRecord>((resolve) => pending.push(resolve)));
  const change = vi.fn();
  const reader = selectedPayloadReader(read, change, vi.fn());
  const selected = row('stream', 'host.execStream');
  const result = (frameCount: number): DevConsoleRecord => ({
    ...selected,
    frameCount,
    payload: { text: '{}', state: 'complete', originalBytes: 2, retainedBytes: 2 },
  });
  reader.select('one', { ...selected, frameCount: 2 });
  reader.select('one', { ...selected, frameCount: 3 });
  reader.select('one', { ...selected, frameCount: 4 });
  expect(read).toHaveBeenCalledTimes(1);
  pending[0](result(2));
  await Promise.resolve();
  expect(change).toHaveBeenLastCalledWith(result(2));
  expect(read).toHaveBeenCalledTimes(2);
  reader.select('one', { ...selected, frameCount: 5 });
  reader.select('one', { ...selected, frameCount: 6 });
  pending[1](result(4));
  await Promise.resolve();
  expect(change).toHaveBeenLastCalledWith(result(4));
  expect(read).toHaveBeenCalledTimes(3);
  reader.dispose();
  pending[2](result(6));
  await Promise.resolve();
  expect(change).toHaveBeenLastCalledWith(null);
});
