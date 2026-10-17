import { describe, expect, it, vi } from 'vitest';
vi.mock('$store/renderer/store', () => ({
  store: { createSelector: (fn: any) => ({ select: fn }), state: {} },
}));
import { readSecondaryRootSnapshot } from './git-secondary-root-recovery';
import { serializeGitRead } from './git-recovery-read-lane';

const commit = {
  hash: 'sha',
  sha: 'sha',
  author: 'A',
  email: 'a@example.com',
  date: '2026-10-13',
  message: 'change',
};
const status = {
  branch: 'main',
  ahead: 0,
  behind: 0,
  files: [{ path: 'a.ts', status: 'modified', staged: false }],
};
const hunk = {
  oldStart: 1,
  oldLines: 0,
  newStart: 1,
  newLines: 1,
  lines: [{ type: 'Addition', content: 'new', newNumber: 1 }],
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { resolve, promise };
}
const settle = async () => {
  for (let i = 0; i < 50; i++) await Promise.resolve();
};
function transport() {
  const request = vi.fn(async (method: string, params?: any): Promise<any> => {
    if (method === 'git.status') return status;
    if (method === 'git.commits') return { items: [commit] };
    if (method === 'git.diffs') return params.staged ? [] : [{ path: 'a.ts', hunks: [hunk] }];
    if (method === 'git.commitDetails')
      return {
        ...commit,
        commitHash: commit.hash,
        files: ['a.ts'],
        fileDetails: [{ path: 'a.ts', additions: 1, deletions: 0 }],
      };
    throw new Error(method);
  });
  return { key: {}, request };
}
describe('secondary-root authoritative read', () => {
  it('reads status/history/diffs at the exact root and reuses immutable commit files', async () => {
    const t = transport();
    const first = await readSecondaryRootSnapshot('ws', 'root', undefined, 100, t);
    expect(first.status?.files[0]).toMatchObject({ path: 'a.ts', additions: 1, deletions: 0 });
    expect(first.commitFiles.sha).toEqual([{ path: 'a.ts', additions: 1, deletions: 0 }]);
    expect(
      t.request.mock.calls.every(([, p]) => p.workspaceId === 'ws' && p.gitRootId === 'root'),
    ).toBe(true);
    const second = await readSecondaryRootSnapshot('ws', 'root', undefined, 100, t, first);
    expect(second.commitFiles).toEqual(first.commitFiles);
    expect(t.request.mock.calls.filter(([m]) => m === 'git.commitDetails')).toHaveLength(1);
    expect(t.request.mock.calls.filter(([m]) => m === 'git.commits')).toHaveLength(2);
  });
  it('does not retry over a held sibling after the other read fails', async () => {
    const t = transport(),
      held = deferred<unknown>();
    const normal = t.request.getMockImplementation()!;
    t.request.mockImplementation((m, p) =>
      m === 'git.status'
        ? Promise.reject(new Error('offline'))
        : m === 'git.commits'
          ? held.promise
          : normal(m, p),
    );
    const failed = serializeGitRead(
      'root-failure',
      () => true,
      () => readSecondaryRootSnapshot('ws', 'root', undefined, 100, t),
    ).catch(() => undefined);
    const next = vi.fn(async () => undefined);
    const retry = serializeGitRead('root-failure', () => true, next);
    await settle();
    expect(next).not.toHaveBeenCalled();
    held.resolve({ items: [] });
    await Promise.all([failed, retry]);
    expect(next).toHaveBeenCalledTimes(1);
  });
  it('waits all enrichment reads on error and never issues reads for unchanged immutable history files', async () => {
    const t = transport(),
      held = deferred<unknown>();
    const normal = t.request.getMockImplementation()!;
    t.request.mockImplementation((m, p) =>
      m === 'git.commitDetails'
        ? Promise.reject(new Error('offline'))
        : m === 'git.diffs' && !p.staged
          ? held.promise
          : normal(m, p),
    );
    let done = false;
    const read = readSecondaryRootSnapshot('ws', 'root', undefined, 100, t).catch(() => {
      done = true;
    });
    await settle();
    expect(done).toBe(false);
    held.resolve([]);
    await read;
    expect(done).toBe(true);
  });
});
