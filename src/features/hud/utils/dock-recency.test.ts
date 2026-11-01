import { describe, expect, it, vi } from 'vitest';
import type { UserMessageIndexItem, UserMessageIndexPageOptions } from '$lib/client';
import {
  DOCK_INDEX_MAX_PAGES,
  DOCK_INDEX_PAGE_LIMIT,
  latestDockHumanMessage,
  scanDockHumanMessages,
} from './dock-recency';

const NOW = Date.parse('2026-11-01T12:00:00.000Z');
const HOUR = 60 * 60 * 1000;

function at(offsetMs: number): string {
  return new Date(NOW - offsetMs).toISOString();
}

function human(id: string, offsetMs: number): UserMessageIndexItem {
  return { id, preview: 'hello', createdAt: at(offsetMs) };
}

function automated(id: string, offsetMs: number): UserMessageIndexItem {
  return {
    id,
    preview: '[WORKSPACE EVENTS] wake',
    createdAt: at(offsetMs),
    metadata: { type: 'event_notification' },
  };
}

/** A paging daemon over `rows` (oldest→newest): newest `limit` per page. */
function pagingDaemon(rows: UserMessageIndexItem[]) {
  const reads: UserMessageIndexPageOptions[] = [];
  const readPage = vi.fn(async (page: UserMessageIndexPageOptions) => {
    reads.push(page);
    const end = page.nextToken === undefined ? rows.length : Number(page.nextToken);
    const start = Math.max(0, end - (page.limit ?? 100));
    return {
      ok: true as const,
      items: rows.slice(start, end),
      total: end - start,
      nextToken: start > 0 ? String(start) : null,
    };
  });
  return { readPage, reads };
}

describe('latestDockHumanMessage', () => {
  it('ignores automated rows identified by projected metadata', () => {
    expect(latestDockHumanMessage([human('h', 2 * HOUR), automated('a', HOUR)])).toBe(
      NOW - 2 * HOUR,
    );
    expect(latestDockHumanMessage([automated('a', HOUR)])).toBeNull();
  });
});

describe('scanDockHumanMessages', () => {
  it('reads only the newest page when it holds a human row', async () => {
    const rows = [
      ...Array.from({ length: 500 }, (_, n) => automated(`old-${n}`, 10 * HOUR - n)),
      human('recent', HOUR),
      automated('tail', HOUR - 1),
    ];
    const { readPage, reads } = pagingDaemon(rows);
    const scan = await scanDockHumanMessages(readPage);
    expect(scan).toEqual({ latest: NOW - HOUR, newestId: 'tail' });
    expect(reads).toEqual([{ limit: DOCK_INDEX_PAGE_LIMIT, nextToken: undefined }]);
  });

  it('walks older pages until it finds a human row', async () => {
    const rows = [
      human('human', 5 * HOUR),
      ...Array.from({ length: 120 }, (_, n) => automated(`a-${n}`, 4 * HOUR - n * 1000)),
    ];
    const { readPage, reads } = pagingDaemon(rows);
    const scan = await scanDockHumanMessages(readPage);
    expect(scan).toEqual({ latest: NOW - 5 * HOUR, newestId: 'a-119' });
    expect(reads.map(({ nextToken }) => nextToken)).toEqual([undefined, '71', '21']);
  });

  it('never stops on a timestamp: an old row on the newest page cannot hide a human row', async () => {
    const rows = [
      human('human', 2 * HOUR),
      ...Array.from({ length: 49 }, (_, n) => automated(`a-${n}`, HOUR - n)),
      automated('backdated', 25 * HOUR),
    ];
    const { readPage, reads } = pagingDaemon(rows);
    const scan = await scanDockHumanMessages(readPage);
    expect(scan?.latest).toBe(NOW - 2 * HOUR);
    expect(reads).toHaveLength(2);
  });

  it('resumes at the previous scan newest row instead of re-reading covered history', async () => {
    const rows = [
      human('human', 6 * HOUR),
      ...Array.from({ length: 300 }, (_, n) => automated(`a-${n}`, 5 * HOUR - n * 1000)),
    ];
    const first = pagingDaemon(rows);
    const previous = await scanDockHumanMessages(first.readPage);
    expect(previous).toEqual({ latest: NOW - 6 * HOUR, newestId: 'a-299' });
    expect(first.reads.length).toBeGreaterThan(1);

    const grown = [...rows, automated('new-1', HOUR), automated('new-2', HOUR - 1)];
    const second = pagingDaemon(grown);
    const scan = await scanDockHumanMessages(second.readPage, previous ?? undefined);
    expect(scan).toEqual({ latest: NOW - 6 * HOUR, newestId: 'new-2' });
    expect(second.reads).toHaveLength(1);
  });

  it('finds a human row newer than the previous scan on resume', async () => {
    const rows = [human('old-human', 6 * HOUR), automated('a', 5 * HOUR)];
    const previous = { latest: NOW - 6 * HOUR, newestId: 'a' };
    const { readPage } = pagingDaemon([...rows, human('new-human', HOUR)]);
    expect(await scanDockHumanMessages(readPage, previous)).toEqual({
      latest: NOW - HOUR,
      newestId: 'new-human',
    });
  });

  it('keeps the previous result when nothing new arrived', async () => {
    const rows = [human('h', 3 * HOUR), automated('a', HOUR)];
    const { readPage, reads } = pagingDaemon(rows);
    const previous = { latest: NOW - 3 * HOUR, newestId: 'a' };
    expect(await scanDockHumanMessages(readPage, previous)).toEqual(previous);
    expect(reads).toHaveLength(1);
  });

  it('treats a daemon without paging as one complete page', async () => {
    const readPage = vi.fn(async () => ({
      ok: true as const,
      items: [human('h', 3 * HOUR), automated('a', HOUR)],
      total: 2,
    }));
    const scan = await scanDockHumanMessages(readPage);
    expect(scan).toEqual({ latest: NOW - 3 * HOUR, newestId: 'a' });
    expect(readPage).toHaveBeenCalledTimes(1);
  });

  it('returns null when a read fails so failures never prove recency', async () => {
    const readPage = vi.fn(async () => ({
      ok: false as const,
      unsupported: false,
      error: 'boom',
    }));
    expect(await scanDockHumanMessages(readPage)).toBeNull();
  });

  it('bounds the number of pages per scan', async () => {
    const rows = Array.from({ length: 5_000 }, (_, n) => automated(`a-${n}`, HOUR - n));
    const { readPage, reads } = pagingDaemon(rows);
    const scan = await scanDockHumanMessages(readPage);
    expect(scan).toEqual({ latest: null, newestId: 'a-4999' });
    expect(reads).toHaveLength(DOCK_INDEX_MAX_PAGES);
  });
});
