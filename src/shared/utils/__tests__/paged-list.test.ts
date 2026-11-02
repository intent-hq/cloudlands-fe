import { describe, expect, it, vi } from 'vitest';
import { MAX_LIST_PAGES, nextPageToken, requestAllPages } from '../paged-list';

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
