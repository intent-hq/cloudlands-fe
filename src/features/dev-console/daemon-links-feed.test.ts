import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LinkCaptureStatus, LinkTrafficRow } from '$shared/types/daemon-links';
import {
  createDaemonLinksFeed,
  type DaemonLinksApi,
  type DaemonLinksState,
} from './daemon-links-feed';

const timing = { statusMs: 2000, liveMs: 1000, idleMs: 5000 };
function row(seq: number): LinkTrafficRow {
  return {
    id: `link-${seq}`,
    seq,
    at: '2026-11-03T08:00:00.000Z',
    timestamp: seq,
    direction: 'out',
    peer: { kind: 'machine', id: 'm', name: 'Mac' },
    frameType: 'launch',
    bytes: 10,
    summary: 'launch',
    hasPayload: true,
  };
}
/** A fake daemon buffer with the documented accounting. */
function daemon({ supported = true, maxRecords = 5, pageSize = Infinity } = {}) {
  let active = false;
  let startedAt = '';
  let records: LinkTrafficRow[] = [];
  let nextSeq = 1;
  let evicted = 0;
  let starts = 0;
  const status = (): LinkCaptureStatus => ({
    active,
    ...(active ? { startedAt } : {}),
    payloads: true,
    maxRecords,
    maxPayloadBytes: 65536,
    retained: records.length,
    evicted,
    dropped: 0,
    oversized: 0,
    nextSeq,
  });
  const api = {
    supported,
    status: vi.fn(async () => ({ supported: api.supported })),
    start: vi.fn(async () => {
      if (!active) {
        active = true;
        startedAt = `start-${++starts}`;
        records = [];
        nextSeq = 1;
        evicted = 0;
      }
      return status();
    }),
    stop: vi.fn(async () => {
      active = false;
      records = [];
      return status();
    }),
    // The daemon may return a short page (it caps a reply's JSON size).
    read: vi.fn(async (afterSeq: number) => ({
      capture: status(),
      records: records.filter((r) => r.seq > afterSeq).slice(0, pageSize),
    })),
    record: vi.fn(async () => null),
  } satisfies DaemonLinksApi & { supported: boolean };
  return {
    api,
    frames(count: number) {
      if (!active) return;
      for (let i = 0; i < count; i++) records.push(row(nextSeq++));
      while (records.length > maxRecords) {
        records.shift();
        evicted++;
      }
    },
    restart() {
      active = false;
      records = [];
      nextSeq = 1;
    },
  };
}

let states: DaemonLinksState[] = [];
const last = () => states[states.length - 1];
beforeEach(() => {
  vi.useFakeTimers();
  states = [];
});
afterEach(() => {
  vi.useRealTimers();
});

describe('daemon links feed', () => {
  it('stays hidden and never reads an old daemon', async () => {
    const fake = daemon({ supported: false });
    const feed = createDaemonLinksFeed(fake.api, (s) => states.push(s), timing);
    feed.setVisible(true);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(feed.state.supported).toBe(false);
    expect(fake.api.status).toHaveBeenCalled();
    expect(fake.api.read).not.toHaveBeenCalled();
    feed.dispose();
  });

  it('reads the daemon only while the view is visible', async () => {
    const fake = daemon();
    const feed = createDaemonLinksFeed(fake.api, (s) => states.push(s), timing);
    await vi.advanceTimersByTimeAsync(0);
    expect(feed.state.supported).toBe(true);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(fake.api.read).not.toHaveBeenCalled();
    feed.setVisible(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.api.read).toHaveBeenCalledTimes(1);
    expect(feed.state.capture?.active).toBe(false);
    // Capture off: slow cadence.
    await vi.advanceTimersByTimeAsync(4_999);
    expect(fake.api.read).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fake.api.read).toHaveBeenCalledTimes(2);
    feed.setVisible(false);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(fake.api.read).toHaveBeenCalledTimes(2);
    feed.dispose();
  });

  it('streams live rows incrementally while capture is on', async () => {
    const fake = daemon({ maxRecords: 100 });
    const feed = createDaemonLinksFeed(fake.api, (s) => states.push(s), timing);
    feed.setVisible(true);
    await vi.advanceTimersByTimeAsync(0);
    await feed.start();
    expect(feed.state.capture?.active).toBe(true);
    fake.frames(3);
    await vi.advanceTimersByTimeAsync(1000);
    expect(feed.state.rows.map((r) => r.seq)).toEqual([1, 2, 3]);
    fake.frames(2);
    await vi.advanceTimersByTimeAsync(1000);
    expect(feed.state.rows.map((r) => r.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(fake.api.read).toHaveBeenLastCalledWith(3);
    feed.dispose();
  });

  it('mirrors daemon eviction and clears on stop', async () => {
    const fake = daemon({ maxRecords: 3 });
    const feed = createDaemonLinksFeed(fake.api, (s) => states.push(s), timing);
    feed.setVisible(true);
    await vi.advanceTimersByTimeAsync(0);
    await feed.start();
    fake.frames(5);
    await vi.advanceTimersByTimeAsync(1000);
    expect(feed.state.rows.map((r) => r.seq)).toEqual([3, 4, 5]);
    expect(feed.state.capture).toMatchObject({ retained: 3, evicted: 2 });
    fake.frames(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(feed.state.rows.map((r) => r.seq)).toEqual([4, 5, 6]);
    await feed.stop();
    expect(feed.state.capture?.active).toBe(false);
    expect(feed.state.rows).toEqual([]);
    feed.dispose();
  });

  it('resets when a new capture starts or the daemon restarts', async () => {
    const fake = daemon({ maxRecords: 50 });
    const feed = createDaemonLinksFeed(fake.api, (s) => states.push(s), timing);
    feed.setVisible(true);
    await vi.advanceTimersByTimeAsync(0);
    await feed.start();
    fake.frames(4);
    await vi.advanceTimersByTimeAsync(1000);
    expect(feed.state.rows).toHaveLength(4);
    // The daemon restarts and another console starts a fresh capture.
    fake.restart();
    await fake.api.start();
    fake.frames(2);
    await vi.advanceTimersByTimeAsync(1000);
    expect(feed.state.rows.map((r) => r.seq)).toEqual([1, 2]);
    feed.dispose();
  });

  it('hides again when the daemon stops advertising capture', async () => {
    const fake = daemon();
    const feed = createDaemonLinksFeed(fake.api, (s) => states.push(s), timing);
    feed.setVisible(true);
    await vi.advanceTimersByTimeAsync(0);
    await feed.start();
    fake.frames(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(feed.state.rows).toHaveLength(1);
    fake.api.supported = false;
    await vi.advanceTimersByTimeAsync(2000);
    expect(last()).toMatchObject({ supported: false, capture: null, rows: [] });
    const reads = fake.api.read.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fake.api.read).toHaveBeenCalledTimes(reads);
    feed.dispose();
  });

  it('surfaces command and read errors, then recovers', async () => {
    const fake = daemon();
    fake.api.start.mockRejectedValueOnce(new Error('owner only'));
    const feed = createDaemonLinksFeed(fake.api, (s) => states.push(s), timing);
    feed.setVisible(true);
    await vi.advanceTimersByTimeAsync(0);
    await feed.start();
    expect(feed.state).toMatchObject({ busy: false, error: 'Error: owner only' });
    fake.api.read.mockRejectedValueOnce(new Error('disconnected'));
    await vi.advanceTimersByTimeAsync(5000);
    expect(feed.state.error).toBe('Error: disconnected');
    await vi.advanceTimersByTimeAsync(5000);
    expect(feed.state.error).toBeNull();
    feed.dispose();
  });

  it('stops every timer on dispose', async () => {
    const fake = daemon();
    const feed = createDaemonLinksFeed(fake.api, (s) => states.push(s), timing);
    feed.setVisible(true);
    await vi.advanceTimersByTimeAsync(0);
    feed.dispose();
    const calls = fake.api.status.mock.calls.length + fake.api.read.mock.calls.length;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fake.api.status.mock.calls.length + fake.api.read.mock.calls.length).toBe(calls);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("re-reads at once on a records event, so another client's start or stop shows immediately", async () => {
    const fake = daemon({ maxRecords: 50 });
    let signal: (() => void) | undefined;
    const api = {
      ...fake.api,
      onChanged: vi.fn((listener: () => void) => {
        signal = listener;
        return () => {
          signal = undefined;
        };
      }),
    };
    const feed = createDaemonLinksFeed(api, (s) => states.push(s), timing);
    await vi.advanceTimersByTimeAsync(0);
    signal!();
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.api.read).not.toHaveBeenCalled();
    feed.setVisible(true);
    await vi.advanceTimersByTimeAsync(0);
    // Another owner client starts capture; its empty start event arrives.
    await fake.api.start();
    fake.frames(2);
    signal!();
    await vi.advanceTimersByTimeAsync(0);
    expect(feed.state.capture?.active).toBe(true);
    expect(feed.state.rows.map((r) => r.seq)).toEqual([1, 2]);
    // ...and stops it: the stop event clears the view without waiting for a poll.
    await fake.api.stop();
    signal!();
    await vi.advanceTimersByTimeAsync(0);
    expect(feed.state).toMatchObject({ capture: { active: false }, rows: [] });
    feed.dispose();
    expect(signal).toBeUndefined();
  });

  it('keeps paging through short snapshot replies until it reaches the newest record', async () => {
    const fake = daemon({ maxRecords: 50, pageSize: 2 });
    const feed = createDaemonLinksFeed(fake.api, (s) => states.push(s), timing);
    feed.setVisible(true);
    await vi.advanceTimersByTimeAsync(0);
    await feed.start();
    fake.frames(5);
    await vi.advanceTimersByTimeAsync(timing.liveMs);
    expect(feed.state.rows.map((r) => r.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(fake.api.read.mock.calls.slice(-3).map(([afterSeq]) => afterSeq)).toEqual([-1, 2, 4]);
    feed.dispose();
  });
});
