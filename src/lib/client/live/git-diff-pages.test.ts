import { describe, expect, it, vi } from 'vitest';
import { gitDiffTruncatedReason, requestAllDiffPages } from './git-diff-pages';

const whole = (path: string) => ({ path, hunks: [{ lines: [path] }] });
const page = (path: string) => ({
  path,
  hunks: [],
  truncated: true,
  truncatedReason: 'pageBudget',
});
const tooLarge = (path: string) => ({
  path,
  hunks: [],
  truncated: true,
  truncatedReason: 'fileTooLarge',
});

describe('gitDiffTruncatedReason', () => {
  it('reads the reason only from truncated entries', () => {
    expect(gitDiffTruncatedReason(whole('a'))).toBeUndefined();
    expect(gitDiffTruncatedReason(page('a'))).toBe('pageBudget');
    expect(gitDiffTruncatedReason(tooLarge('a'))).toBe('fileTooLarge');
    expect(gitDiffTruncatedReason({ truncated: true })).toBe('fileTooLarge');
    expect(gitDiffTruncatedReason(null)).toBeUndefined();
  });
});

describe('requestAllDiffPages', () => {
  it('passes an older daemon result through with one request', async () => {
    const request = vi.fn().mockResolvedValueOnce([whole('a'), whole('b')]);
    const out = await requestAllDiffPages(
      request,
      'git.diffs',
      { workspaceId: 'w', maxBytes: 480_000 },
      'path',
    );
    expect(out).toEqual([whole('a'), whole('b')]);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('re-requests pageBudget paths and keeps the first response order', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce([whole('a'), page('b'), tooLarge('c'), page('d')])
      .mockResolvedValueOnce([whole('b'), page('d')])
      .mockResolvedValueOnce([whole('d')]);
    const out = await requestAllDiffPages(
      request,
      'git.diffs',
      { workspaceId: 'w', staged: true, path: 'x', paths: ['a', 'b', 'c', 'd'], maxBytes: 480_000 },
      'path',
    );
    expect(out).toEqual([whole('a'), whole('b'), tooLarge('c'), whole('d')]);
    expect(request).toHaveBeenNthCalledWith(2, 'git.diffs', {
      workspaceId: 'w',
      staged: true,
      paths: ['b', 'd'],
      maxBytes: 480_000,
    });
    expect(request).toHaveBeenNthCalledWith(3, 'git.diffs', {
      workspaceId: 'w',
      staged: true,
      paths: ['d'],
      maxBytes: 480_000,
    });
  });

  it('narrows a stalled follow-up to one path, then stops when even that stalls', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce([page('a'), page('b')])
      .mockResolvedValueOnce([page('a'), page('b')])
      .mockResolvedValueOnce([page('a')]);
    const out = await requestAllDiffPages(
      request,
      'git.diffs',
      { workspaceId: 'w', maxBytes: 480_000 },
      'path',
    );
    expect(request).toHaveBeenCalledTimes(3);
    expect(request).toHaveBeenNthCalledWith(3, 'git.diffs', {
      workspaceId: 'w',
      paths: ['a'],
      maxBytes: 480_000,
    });
    expect(out).toEqual([page('a'), page('b')]);
  });

  it('drops a pending path the follow-up no longer lists', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce([whole('a'), page('b')])
      .mockResolvedValueOnce([]);
    const out = await requestAllDiffPages(
      request,
      'git.diffs',
      { workspaceId: 'w', maxBytes: 480_000 },
      'path',
    );
    expect(request).toHaveBeenCalledTimes(2);
    expect(out).toEqual([whole('a'), page('b')]);
  });

  it('keeps asking while each follow-up serves more files, until every file is whole', async () => {
    const paths = Array.from({ length: 100 }, (_, i) => `f${i}`);
    let remaining = [...paths];
    const request = vi.fn(async () => {
      // Each read serves exactly one more file.
      const [served, ...rest] = remaining;
      remaining = rest;
      return [whole(served), ...rest.map(page)];
    });
    const out = await requestAllDiffPages(
      request,
      'git.diffs',
      { workspaceId: 'w', maxBytes: 480_000 },
      'path',
    );
    expect(out).toEqual(paths.map(whole));
    expect(out.some((entry) => gitDiffTruncatedReason(entry))).toBe(false);
    expect(request).toHaveBeenCalledTimes(100);
  });

  it('drains a paged file list by following nextToken and drops continuation entries', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce([whole('a'), whole('b'), { nextToken: 't1' }])
      .mockResolvedValueOnce([whole('c'), page('d'), { nextToken: 't2' }])
      .mockResolvedValueOnce([whole('e')])
      .mockResolvedValueOnce([whole('d')]);
    const out = await requestAllDiffPages(
      request,
      'git.diffs',
      { workspaceId: 'w', staged: true, maxBytes: 480_000 },
      'path',
    );
    expect(out).toEqual(['a', 'b', 'c', 'd', 'e'].map(whole));
    expect(request).toHaveBeenNthCalledWith(2, 'git.diffs', {
      workspaceId: 'w',
      staged: true,
      maxBytes: 480_000,
      nextToken: 't1',
    });
    expect(request).toHaveBeenNthCalledWith(3, 'git.diffs', {
      workspaceId: 'w',
      staged: true,
      maxBytes: 480_000,
      nextToken: 't2',
    });
    // The pageBudget follow-up names the remaining path, without a token.
    expect(request).toHaveBeenNthCalledWith(4, 'git.diffs', {
      workspaceId: 'w',
      staged: true,
      maxBytes: 480_000,
      paths: ['d'],
    });
  });

  it('drains a follow-up whose own file list is paged', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce([page('a'), page('b')])
      .mockResolvedValueOnce([whole('a'), { nextToken: 'next' }])
      .mockResolvedValueOnce([whole('b')]);
    const out = await requestAllDiffPages(
      request,
      'git.diffs',
      { workspaceId: 'w', maxBytes: 480_000 },
      'path',
    );
    expect(out).toEqual([whole('a'), whole('b')]);
    expect(request).toHaveBeenNthCalledWith(3, 'git.diffs', {
      workspaceId: 'w',
      maxBytes: 480_000,
      paths: ['a', 'b'],
      nextToken: 'next',
    });
  });

  it('stops following a nextToken the daemon repeats', async () => {
    const request = vi.fn().mockResolvedValue([whole('a'), { nextToken: 'same' }]);
    const out = await requestAllDiffPages(
      request,
      'git.diffs',
      { workspaceId: 'w', maxBytes: 480_000 },
      'path',
    );
    expect(request).toHaveBeenCalledTimes(2);
    expect(out).toEqual([whole('a'), whole('a')]);
  });

  it('matches git.branchDiff entries by file', async () => {
    const entry = (file: string, truncatedReason?: string) =>
      truncatedReason
        ? { file, chunks: [], oldContent: '', newContent: '', truncated: true, truncatedReason }
        : { file, chunks: [], oldContent: `old-${file}`, newContent: `new-${file}` };
    const request = vi
      .fn()
      .mockResolvedValueOnce([entry('a'), entry('b', 'pageBudget')])
      .mockResolvedValueOnce([entry('b')]);
    const out = await requestAllDiffPages(
      request,
      'git.branchDiff',
      { workspaceId: 'w', baseRef: 'main', maxBytes: 480_000 },
      'file',
    );
    expect(out).toEqual([entry('a'), entry('b')]);
    expect(request).toHaveBeenNthCalledWith(2, 'git.branchDiff', {
      workspaceId: 'w',
      baseRef: 'main',
      paths: ['b'],
      maxBytes: 480_000,
    });
  });
});
