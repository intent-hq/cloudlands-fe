import { describe, expect, it } from 'vitest';
import { ChangeStage, type TrackedChange } from '$features/file-tracking/types';
import { buildDiffMapDocument } from './build-document';
import { createReviewSlice, getStaleReviewSliceEntries, getViewedFreshness } from './review-slice';

function change(path: string, hash: string): TrackedChange {
  return {
    id: path,
    file: path,
    relativePath: path,
    stage: ChangeStage.Unstaged,
    stats: { additions: 1, deletions: 1 },
    attribution: { timestamp: 0 },
    content: { newContentSha: hash },
  };
}

const source = { kind: 'working-tree', workspaceId: 'ws-1', snapshotId: 'snapshot-1' } as const;

describe('review slices', () => {
  it('creates a portable three-file selection with source identity, hashes, and hunks', () => {
    const changes = [change('a.ts', 'hash-a'), change('b.ts', 'hash-b'), change('c.ts', 'hash-c')];
    const document = buildDiffMapDocument(changes, {
      source,
      patches: new Map([['b.ts', '@@ -4,2 +5,3 @@']]),
    });
    const hashes = Object.fromEntries(document.files.map((file) => [file.path, file.contentHash]));

    expect(
      createReviewSlice(document, new Set(changes.map(({ relativePath }) => relativePath))),
    ).toEqual({
      source: { kind: 'working-tree', workspaceId: 'ws-1' },
      snapshotId: 'snapshot-1',
      entries: [
        { path: 'a.ts', contentHash: hashes['a.ts'] },
        {
          path: 'b.ts',
          contentHash: hashes['b.ts'],
          hunks: [{ oldRange: { start: 4, end: 5 }, newRange: { start: 5, end: 7 } }],
        },
        { path: 'c.ts', contentHash: hashes['c.ts'] },
      ],
    });
  });

  it('reports only entries whose current content no longer matches', () => {
    const original = buildDiffMapDocument([change('a.ts', 'hash-a'), change('b.ts', 'hash-b')], {
      source,
    });
    const slice = createReviewSlice(original, new Set(['a.ts', 'b.ts']));
    const edited = buildDiffMapDocument([change('a.ts', 'hash-a'), change('b.ts', 'hash-new')], {
      source,
    });

    expect(getStaleReviewSliceEntries(slice, edited).map(({ path }) => path)).toEqual(['b.ts']);
  });

  it('distinguishes current, stale, and absent viewed hashes', () => {
    const viewed = { 'a.ts': 'hash-a', 'b.ts': 'hash-old' };

    expect(getViewedFreshness(viewed, 'a.ts', 'hash-a')).toBe('viewed');
    expect(getViewedFreshness(viewed, 'b.ts', 'hash-new')).toBe('changed-since-viewed');
    expect(getViewedFreshness(viewed, 'c.ts', 'hash-c')).toBe('unviewed');
  });
});
