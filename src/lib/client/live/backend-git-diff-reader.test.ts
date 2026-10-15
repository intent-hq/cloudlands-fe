import { describe, expect, it, vi } from 'vitest';
import { createBackendGitDiffReader } from './backend-git-diff-reader';

// PROTOCOL §5.6 git.diffs: bare path/hunks array, already parsed by the daemon.
const hunk = {
  oldStart: 1,
  oldLines: 2,
  newStart: 1,
  newLines: 2,
  lines: [
    { type: 'Context', content: 'shared', oldNumber: 1, newNumber: 1 },
    { type: 'Deletion', content: 'old', oldNumber: 2 },
    { type: 'Addition', content: 'new', newNumber: 2 },
  ],
};

describe('createBackendGitDiffReader', () => {
  it('sends exact scoped options and maps daemon hunks without rebuilding file content', async () => {
    const request = vi.fn().mockResolvedValue([{ path: 'src/new.ts', hunks: [hunk] }]);
    const read = createBackendGitDiffReader(request);
    const result = await read('workspace', {
      path: 'src/new.ts',
      paths: ['src/old.ts'],
      staged: true,
      commitHash: 'commit',
      gitRootId: 'root',
    });
    expect(request).toHaveBeenCalledExactlyOnceWith('git.diffs', {
      workspaceId: 'workspace',
      path: 'src/new.ts',
      paths: ['src/old.ts'],
      staged: true,
      commitHash: 'commit',
      gitRootId: 'root',
    });
    expect(result).toEqual([
      {
        file: 'src/new.ts',
        chunks: [
          {
            oldStart: 1,
            oldLines: 2,
            newStart: 1,
            newLines: 2,
            lines: [
              { type: 'Context', content: 'shared', oldNumber: 1, newNumber: 1 },
              { type: 'Deletion', content: 'old', oldNumber: 2 },
              { type: 'Addition', content: 'new', newNumber: 2 },
            ],
          },
        ],
      },
    ]);
  });

  it('keeps staged and unstaged requests distinct and omits empty narrowing options', async () => {
    const request = vi.fn().mockResolvedValue([]);
    const read = createBackendGitDiffReader(request);
    await expect(read('workspace', { path: 'a.ts', staged: false, paths: [] })).resolves.toEqual(
      [],
    );
    await read('workspace', { path: 'a.ts', staged: true });
    expect(request.mock.calls).toEqual([
      ['git.diffs', { workspaceId: 'workspace', path: 'a.ts' }],
      ['git.diffs', { workspaceId: 'workspace', path: 'a.ts', staged: true }],
    ]);
  });

  it('retains supplied content and flags without inferring a reason from empty hunks', async () => {
    const request = vi.fn().mockResolvedValue([
      { path: 'image.png', hunks: [], isBinary: true, isTooLarge: false },
      { path: 'large.txt', hunks: [], isTooLarge: true },
      { path: 'source.ts', hunks: [], oldContent: '', newContent: 'source' },
      { path: 'unknown.dat', hunks: [] },
    ]);
    await expect(createBackendGitDiffReader(request)('workspace')).resolves.toEqual([
      { file: 'image.png', chunks: [], isBinary: true, isTooLarge: false },
      { file: 'large.txt', chunks: [], isTooLarge: true },
      { file: 'source.ts', chunks: [], oldContent: '', newContent: 'source' },
      { file: 'unknown.dat', chunks: [] },
    ]);
  });

  it('preserves transport errors for explicit retry', async () => {
    const failure = new Error('transport unavailable');
    const request = vi.fn().mockRejectedValue(failure);
    await expect(createBackendGitDiffReader(request)('workspace')).rejects.toBe(failure);
  });

  it.each(
    [
      null,
      {},
      { files: [] },
      [null],
      [{ path: '', hunks: [] }],
      [{ path: 'a.ts' }],
      [{ path: 'a.ts', hunks: [null] }],
      [{ path: 'a.ts', hunks: [{ ...hunk, oldStart: '1' }] }],
      [{ path: 'a.ts', hunks: [{ ...hunk, newLines: -1 }] }],
      [{ path: 'a.ts', hunks: [{ ...hunk, lines: [{ type: 'Surprise', content: '' }] }] }],
      [{ path: 'a.ts', hunks: [{ ...hunk, lines: [{ type: 'Context' }] }] }],
      [
        {
          path: 'a.ts',
          hunks: [{ ...hunk, lines: [{ type: 'Context', content: '', oldNumber: '1' }] }],
        },
      ],
      [{ path: 'a.ts', hunks: [], isBinary: 'yes' }],
      [{ path: 'a.ts', hunks: [], oldContent: {} }],
      [
        { path: 'valid.ts', hunks: [] },
        { path: 'invalid.ts', hunks: 'bad' },
      ],
    ].map((response) => [response]),
  )(
    'rejects malformed payload %# instead of reporting an empty or partial diff',
    async (response) => {
      const request = vi.fn().mockResolvedValue(response);
      await expect(createBackendGitDiffReader(request)('workspace')).rejects.toBeInstanceOf(
        TypeError,
      );
    },
  );
});
