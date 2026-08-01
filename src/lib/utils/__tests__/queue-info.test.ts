import { describe, it, expect } from 'vitest';
import { getQueueInfo, stripDequeueWaitNote } from '../queue-info';

// PROTOCOL.md §5.5 dequeue-wait annotation, exactly as intentd appends it.
const WAIT_NOTE =
  '[SYSTEM NOTE] This message was queued at 2026-01-01T11:58:00Z and waited 2m 0s before delivery.';

// The #576 stale-redrive note — distinct prefix, must never be stripped.
const STALE_NOTE =
  '[SYSTEM NOTE] This message was queued before you completed; your completion report ' +
  'was already delivered to your parent at 2026-01-01T12:00:00Z. Only call reportToParent ' +
  'again if this message materially changes the outcome — do not re-send the same report.';

describe('getQueueInfo', () => {
  it('extracts a valid queueInfo per the wire shape', () => {
    const info = getQueueInfo({
      queueInfo: { queuedAt: '2026-01-01T11:58:00Z', waitedMs: 120000 },
    });
    expect(info).toEqual({ queuedAt: '2026-01-01T11:58:00Z', waitedMs: 120000 });
  });

  it('clamps a negative waitedMs (clock skew) to 0', () => {
    const info = getQueueInfo({
      queueInfo: { queuedAt: '2026-01-01T11:58:00Z', waitedMs: -5 },
    });
    expect(info).toEqual({ queuedAt: '2026-01-01T11:58:00Z', waitedMs: 0 });
  });

  it('returns null for absent metadata', () => {
    expect(getQueueInfo(undefined)).toBeNull();
    expect(getQueueInfo(null)).toBeNull();
    expect(getQueueInfo({})).toBeNull();
  });

  it('returns null for malformed queueInfo', () => {
    expect(getQueueInfo({ queueInfo: 'soon' })).toBeNull();
    expect(getQueueInfo({ queueInfo: {} })).toBeNull();
    expect(getQueueInfo({ queueInfo: { queuedAt: '2026-01-01T11:58:00Z' } })).toBeNull();
    expect(getQueueInfo({ queueInfo: { waitedMs: 1000 } })).toBeNull();
    expect(
      getQueueInfo({ queueInfo: { queuedAt: '2026-01-01T11:58:00Z', waitedMs: '1000' } }),
    ).toBeNull();
    expect(getQueueInfo({ queueInfo: { queuedAt: 42, waitedMs: 1000 } })).toBeNull();
    expect(getQueueInfo({ queueInfo: { queuedAt: 'not-a-date', waitedMs: 1000 } })).toBeNull();
    expect(
      getQueueInfo({ queueInfo: { queuedAt: '2026-01-01T11:58:00Z', waitedMs: NaN } }),
    ).toBeNull();
  });
});

describe('stripDequeueWaitNote', () => {
  it('strips the trailing dequeue-wait note and its separator', () => {
    expect(stripDequeueWaitNote(`hello world\n\n${WAIT_NOTE}`)).toBe('hello world');
  });

  it('strips hour/second duration variants', () => {
    const note = (waited: string) =>
      `[SYSTEM NOTE] This message was queued at 2026-01-01T11:58:00Z and waited ${waited} before delivery.`;
    expect(stripDequeueWaitNote(`hi\n\n${note('5s')}`)).toBe('hi');
    expect(stripDequeueWaitNote(`hi\n\n${note('2h 3m')}`)).toBe('hi');
  });

  it('returns text without the note unchanged', () => {
    expect(stripDequeueWaitNote('plain message')).toBe('plain message');
    expect(stripDequeueWaitNote('line one\n\nline two')).toBe('line one\n\nline two');
  });

  it('does not touch the stale-redrive note', () => {
    const text = `hello\n\n${STALE_NOTE}`;
    expect(stripDequeueWaitNote(text)).toBe(text);
  });

  it('strips only the wait note when both notes are present, in either order', () => {
    expect(stripDequeueWaitNote(`hello\n\n${STALE_NOTE}\n\n${WAIT_NOTE}`)).toBe(
      `hello\n\n${STALE_NOTE}`,
    );
    expect(stripDequeueWaitNote(`hello\n\n${WAIT_NOTE}\n\n${STALE_NOTE}`)).toBe(
      `hello\n\n${STALE_NOTE}`,
    );
  });
});
