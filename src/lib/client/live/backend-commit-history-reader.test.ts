import { describe, expect, it, vi } from 'vitest';
import { createBackendCommitHistoryReader } from './backend-commit-history-reader';

const metadata = {
  hash: 'abc',
  message: 'A commit',
  author: 'Author',
  date: '2026-10-15T01:00:00Z',
  isPushed: false,
  agentId: 'agent-1',
  linkedNoteId: 'note-1',
};
const page = { commits: [metadata], boundarySha: 'base', nextToken: 'opaque-next' };

describe('strict canonical commit history reader', () => {
  it('sends exact independent current/older cursors and preserves optional metadata absence', async () => {
    const request = vi.fn().mockResolvedValue(page);
    const read = createBackendCommitHistoryReader({ request });
    const current = await read('ws', { includeOlder: false, limit: 20 });
    await read('ws', { includeOlder: true, limit: 20, pageToken: 'older-cursor' });
    expect(request.mock.calls).toEqual([
      ['file-tracking.loadCommits', { workspaceId: 'ws', includeOlder: false, limit: 20 }],
      [
        'file-tracking.loadCommits',
        { workspaceId: 'ws', includeOlder: true, limit: 20, nextToken: 'older-cursor' },
      ],
    ]);
    expect(current).toEqual({
      boundarySha: 'base',
      nextToken: 'opaque-next',
      commits: [{ ...metadata, timestamp: 1792026000000, stage: 'local' }],
    });
    expect(current.commits[0]).not.toHaveProperty('files');
    expect(current.commits[0]).not.toHaveProperty('filesChanged');
  });

  it('maps supplied file metadata and pushed provenance without inventing fields', async () => {
    const files = [{ path: 'src/file.ts', additions: 2, deletions: 1, status: 'modified' }];
    const read = createBackendCommitHistoryReader({
      request: vi.fn().mockResolvedValue({
        ...page,
        commits: [{ ...metadata, isPushed: true, files, filesChanged: 1 }],
      }),
    });
    expect((await read('ws', { includeOlder: false, limit: 20 })).commits[0]).toMatchObject({
      stage: 'pushed',
      isPushed: true,
      files,
      filesChanged: 1,
    });
  });

  it.each([
    {},
    { ...page, nextToken: undefined },
    { ...page, boundarySha: 3 },
    { ...page, commits: [{ ...metadata, isPushed: 'false' }] },
    { ...page, commits: [{ ...metadata, date: 'invalid' }] },
    { ...page, commits: [{ ...metadata, files: [{ path: '', additions: -1 }] }] },
  ])('rejects malformed responses instead of publishing empty history: %j', async (result) => {
    const read = createBackendCommitHistoryReader({ request: vi.fn().mockResolvedValue(result) });
    await expect(read('ws', { includeOlder: false, limit: 20 })).rejects.toThrow();
  });

  it('preserves failures and rejects a late reply after scope retirement', async () => {
    const failure = new Error('permission denied');
    const read = createBackendCommitHistoryReader({ request: vi.fn().mockRejectedValue(failure) });
    await expect(read('ws', { includeOlder: false, limit: 20 })).rejects.toBe(failure);
    let current = true;
    let resolve!: (value: unknown) => void;
    const request = vi.fn(
      () =>
        new Promise((yes) => {
          resolve = yes;
        }),
    );
    const scoped = createBackendCommitHistoryReader({
      request: request as never,
      isCurrent: () => current,
    });
    const pending = scoped('ws', { includeOlder: false, limit: 20 });
    current = false;
    resolve(page);
    await expect(pending).rejects.toMatchObject({ code: 'WORKSPACE_LOAD_ROUTE_UNAVAILABLE' });
    await expect(scoped('ws', { includeOlder: false, limit: 20 })).rejects.toThrow();
    expect(request).toHaveBeenCalledTimes(1);
  });
});
