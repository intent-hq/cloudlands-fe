import { describe, expect, it, vi } from 'vitest';
import { MAX_LIST_PAGES, nextPageToken, requestAllPages, requestWholeNote } from '../paged-list';

describe('requestAllPages', () => {
  it('walks nextToken pages and repeats the first page params', async () => {
    const pages: Record<string, unknown> = {
      first: { notes: [{ id: 'a' }, { id: 'b' }], nextToken: 't1' },
      t1: { notes: [{ id: 'c' }], nextToken: 't2' },
      t2: { notes: [{ id: 'd' }], nextToken: null },
    };
    const request = vi.fn(
      async (params: Record<string, unknown>) =>
        pages[typeof params.nextToken === 'string' ? params.nextToken : 'first'],
    );
    const rows = await requestAllPages(
      request,
      { workspaceId: 'ws', projection: 'slim', limit: 500 },
      'notes',
    );
    expect(rows).toEqual([{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]);
    expect(request.mock.calls.map(([p]) => p)).toEqual([
      { workspaceId: 'ws', projection: 'slim', limit: 500 },
      { workspaceId: 'ws', projection: 'slim', limit: 500, nextToken: 't1' },
      { workspaceId: 'ws', projection: 'slim', limit: 500, nextToken: 't2' },
    ]);
  });

  it('reads an unpaged reply (older daemon) in one request', async () => {
    const request = vi.fn(async () => ({ threads: [{ threadId: 'x' }] }));
    expect(await requestAllPages(request, { limit: 500 }, 'threads')).toEqual([{ threadId: 'x' }]);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('stops on a repeated token and on the page cap', async () => {
    const repeating = vi.fn(async () => ({ notes: [1], nextToken: 'same' }));
    expect(await requestAllPages(repeating, {}, 'notes')).toEqual([1, 1]);
    let n = 0;
    const endless = vi.fn(async () => ({ notes: [n], nextToken: `t${n++}` }));
    expect((await requestAllPages(endless, {}, 'notes')).length).toBe(MAX_LIST_PAGES);
  });

  it('propagates a page failure', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ notes: [1], nextToken: 't' })
      .mockRejectedValueOnce(new Error('boom'));
    await expect(requestAllPages(request, {}, 'notes')).rejects.toThrow('boom');
  });
});

describe('nextPageToken', () => {
  it('accepts only non-empty strings', () => {
    expect(nextPageToken({ nextToken: 'a' })).toBe('a');
    expect(nextPageToken({ nextToken: null })).toBeUndefined();
    expect(nextPageToken({ nextToken: '' })).toBeUndefined();
    expect(nextPageToken({ nextToken: 3 })).toBeUndefined();
    expect(nextPageToken(null)).toBeUndefined();
  });
});

/** A daemon double that serves `content` in `chunk`-byte `note.get` pages. */
function contentPages(content: string, chunk: number, revs: number[] = []) {
  const bytes = new TextEncoder().encode(content);
  let reads = 0;
  return vi.fn(async (params: Record<string, unknown>) => {
    const rev = revs[Math.min(reads++, revs.length - 1)] ?? 1;
    const offset = typeof params.contentOffset === 'number' ? params.contentOffset : 0;
    let end = Math.min(offset + chunk, bytes.length);
    while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
    const piece = new TextDecoder().decode(bytes.slice(offset, end));
    if (offset === 0 && end === bytes.length) return { note: { id: 'n', rev, content } };
    return {
      note: {
        id: 'n',
        rev,
        content: piece,
        contentTruncated: true,
        contentBytes: bytes.length,
        contentOffset: offset,
        nextContentOffset: end < bytes.length ? end : null,
      },
    };
  });
}

describe('requestWholeNote', () => {
  const content = 'aé€😀"\\\n'.repeat(500);

  it('follows nextContentOffset and rebuilds multi-byte content byte for byte', async () => {
    const request = contentPages(content, 97);
    const result = (await requestWholeNote(request, { workspaceId: 'ws', noteId: 'n' })) as {
      note: Record<string, unknown>;
    };
    expect(result.note.content).toBe(content);
    expect(result.note).not.toHaveProperty('contentTruncated');
    expect(result.note).not.toHaveProperty('nextContentOffset');
    expect(request.mock.calls.length).toBeGreaterThan(2);
    expect(request.mock.calls[1][0]).toEqual({
      workspaceId: 'ws',
      noteId: 'n',
      contentOffset: expect.any(Number),
    });
  });

  it('reads a whole reply (older daemon or small note) in one request', async () => {
    const request = contentPages('small', 97);
    const result = (await requestWholeNote(request, { noteId: 'n' })) as {
      note: Record<string, unknown>;
    };
    expect(result.note.content).toBe('small');
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('restarts when the note changes between pages', async () => {
    const request = contentPages(content, 4_000, [1, 2, 3, 3, 3, 3]);
    const result = (await requestWholeNote(request, { noteId: 'n' })) as {
      note: Record<string, unknown>;
    };
    expect(result.note.content).toBe(content);
    expect(result.note.rev).toBe(3);
  });

  it('keeps the truncated first reply when the pages do not add up', async () => {
    const request = vi.fn(async (params: Record<string, unknown>) =>
      params.contentOffset === undefined
        ? {
            note: {
              rev: 1,
              content: 'ab',
              contentTruncated: true,
              contentBytes: 10,
              contentOffset: 0,
              nextContentOffset: 2,
            },
          }
        : {
            note: {
              rev: 1,
              content: 'c',
              contentTruncated: true,
              contentBytes: 10,
              contentOffset: 2,
              nextContentOffset: null,
            },
          },
    );
    const result = (await requestWholeNote(request, { noteId: 'n' })) as {
      note: Record<string, unknown>;
    };
    expect(result.note.content).toBe('ab');
    expect(result.note.contentTruncated).toBe(true);
  });
});
