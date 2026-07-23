import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  appendPage,
  createPagedSource,
  createTrailingDebouncer,
  dedupeById,
  type PageResult,
} from '../issue-paging';

interface Item {
  id: string;
  title: string;
}

const item = (id: string): Item => ({ id, title: `Item ${id}` });

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('dedupeById', () => {
  it('drops duplicate ids preserving first occurrence order', () => {
    const out = dedupeById([item('a'), item('b'), item('a'), item('c')], (i) => i.id);
    expect(out.map((i) => i.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('appendPage', () => {
  it('appends only unseen ids', () => {
    const out = appendPage([item('a'), item('b')], [item('b'), item('c')], (i) => i.id);
    expect(out.map((i) => i.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('createPagedSource', () => {
  it('refresh replaces items and stores the nextToken', async () => {
    const fetchPage = vi.fn(
      async (): Promise<PageResult<Item>> => ({ items: [item('a')], nextToken: 't1' }),
    );
    const source = createPagedSource<Item>({ getId: (i) => i.id, fetchPage });

    await source.refresh('q');
    expect(fetchPage).toHaveBeenCalledWith('q', null);
    expect(source.state.items.map((i) => i.id)).toEqual(['a']);
    expect(source.state.nextToken).toBe('t1');
  });

  it('loadMore appends deduped items using the stored token and query', async () => {
    const fetchPage = vi
      .fn<(q: string, t: string | null) => Promise<PageResult<Item>>>()
      .mockResolvedValueOnce({ items: [item('a'), item('b')], nextToken: 't1' })
      .mockResolvedValueOnce({ items: [item('b'), item('c')], nextToken: null });
    const source = createPagedSource<Item>({ getId: (i) => i.id, fetchPage });

    await source.refresh('q');
    await source.loadMore();

    expect(fetchPage).toHaveBeenNthCalledWith(2, 'q', 't1');
    expect(source.state.items.map((i) => i.id)).toEqual(['a', 'b', 'c']);
    expect(source.state.nextToken).toBeNull();
  });

  it('loadMore is a no-op when exhausted or already in flight', async () => {
    const fetchPage = vi
      .fn<(q: string, t: string | null) => Promise<PageResult<Item>>>()
      .mockResolvedValue({ items: [item('a')], nextToken: null });
    const source = createPagedSource<Item>({ getId: (i) => i.id, fetchPage });

    await source.refresh('');
    await source.loadMore();
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it('discards out-of-order responses from a superseded refresh', async () => {
    const slow = deferred<PageResult<Item>>();
    const fetchPage = vi
      .fn<(q: string, t: string | null) => Promise<PageResult<Item>>>()
      .mockReturnValueOnce(slow.promise)
      .mockResolvedValueOnce({ items: [item('new')], nextToken: null });
    const source = createPagedSource<Item>({ getId: (i) => i.id, fetchPage });

    const first = source.refresh('old');
    await source.refresh('new');
    slow.resolve({ items: [item('stale')], nextToken: 'stale-token' });
    await first;

    expect(source.state.items.map((i) => i.id)).toEqual(['new']);
    expect(source.state.nextToken).toBeNull();
  });

  it('discards a loadMore response when a refresh/seed supersedes it', async () => {
    const slow = deferred<PageResult<Item>>();
    const fetchPage = vi
      .fn<(q: string, t: string | null) => Promise<PageResult<Item>>>()
      .mockResolvedValueOnce({ items: [item('a')], nextToken: 't1' })
      .mockReturnValueOnce(slow.promise);
    const source = createPagedSource<Item>({ getId: (i) => i.id, fetchPage });

    await source.refresh('q');
    const more = source.loadMore();
    source.seed([item('seeded')], null);
    slow.resolve({ items: [item('late')], nextToken: 't2' });
    await more;

    expect(source.state.items.map((i) => i.id)).toEqual(['seeded']);
    expect(source.state.nextToken).toBeNull();
    expect(source.state.isLoadingMore).toBe(false);
  });

  it('reports errors via onError and clears the fetching flag', async () => {
    const onError = vi.fn();
    const source = createPagedSource<Item>({
      getId: (i) => i.id,
      fetchPage: async () => {
        throw new Error('boom');
      },
      onError,
    });

    await source.refresh('q');
    expect(onError).toHaveBeenCalledOnce();
    expect(source.state.isFetching).toBe(false);
  });

  it('seed primes items and token and dedupes', () => {
    const source = createPagedSource<Item>({
      getId: (i) => i.id,
      fetchPage: async () => ({ items: [], nextToken: null }),
    });
    source.seed([item('a'), item('a'), item('b')], 'tok');
    expect(source.state.items.map((i) => i.id)).toEqual(['a', 'b']);
    expect(source.state.nextToken).toBe('tok');
  });

  it('emits state to onChange on every transition', async () => {
    const states: Array<{ isFetching: boolean; count: number }> = [];
    const source = createPagedSource<Item>({
      getId: (i) => i.id,
      fetchPage: async () => ({ items: [item('a')], nextToken: null }),
      onChange: (s) => states.push({ isFetching: s.isFetching, count: s.items.length }),
    });
    await source.refresh('');
    expect(states).toEqual([
      { isFetching: true, count: 0 },
      { isFetching: false, count: 1 },
    ]);
  });
});

describe('createTrailingDebouncer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs only the last scheduled fn after the delay', () => {
    const debouncer = createTrailingDebouncer(300);
    const first = vi.fn();
    const second = vi.fn();

    debouncer.schedule(first);
    vi.advanceTimersByTime(200);
    debouncer.schedule(second);
    vi.advanceTimersByTime(299);
    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
  });

  it('cancel drops the pending fn', () => {
    const debouncer = createTrailingDebouncer(300);
    const fn = vi.fn();
    debouncer.schedule(fn);
    debouncer.cancel();
    vi.advanceTimersByTime(1000);
    expect(fn).not.toHaveBeenCalled();
  });
});
