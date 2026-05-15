import {
  describe,
  it,
  expect,
} from 'vitest';
import {
  computeBranchBaseCommittedFallbacks,
  computeBranchBaseCollapsedCommittedPaths,
  computeMergedDestinedPaths,
  getChangeCategory,
  applyNumstatStats,
} from '../ChatChangesPanel.svelte';
import type { LocalFileChange } from '../types';

function mkChange(overrides: Partial<LocalFileChange>): LocalFileChange {
  return {
    filePath: 'file.ts',
    action: 'modify',
    additions: 1,
    deletions: 1,
    toolName: 't',
    toolCallId: 'id',
    ...overrides,
  } as LocalFileChange;
}

describe('getChangeCategory', () => {
  it('prefers explicit category', () => {
    expect(getChangeCategory(mkChange({ category: 'committed', staged: true }))).toBe('committed');
  });

  it('falls back to staged boolean', () => {
    expect(getChangeCategory(mkChange({ staged: true }))).toBe('staged');
    expect(getChangeCategory(mkChange({ staged: false }))).toBe('unstaged');
  });
});

describe('computeMergedDestinedPaths', () => {
  it('returns empty for empty input', () => {
    expect(computeMergedDestinedPaths([], false)).toEqual(new Set());
  });

  it('flags files with mixed staged + unstaged parts', () => {
    const changes: LocalFileChange[] = [
      mkChange({ filePath: 'a.ts', category: 'staged' }),
      mkChange({ filePath: 'a.ts', category: 'unstaged' }),
    ];
    expect(computeMergedDestinedPaths(changes, false)).toEqual(new Set(['a.ts']));
  });

  it('flags files with staged + committed parts', () => {
    const changes: LocalFileChange[] = [
      mkChange({ filePath: 'a.ts', category: 'staged' }),
      mkChange({ filePath: 'a.ts', category: 'committed', commitHash: 'abc' }),
    ];
    expect(computeMergedDestinedPaths(changes, false)).toEqual(new Set(['a.ts']));
  });

  it('flags committed-only files with >1 commit in combined mode', () => {
    const changes: LocalFileChange[] = [
      mkChange({ filePath: 'a.ts', category: 'committed', commitHash: 'c1' }),
      mkChange({ filePath: 'a.ts', category: 'committed', commitHash: 'c2' }),
    ];
    expect(computeMergedDestinedPaths(changes, false)).toEqual(new Set(['a.ts']));
  });

  it('does NOT flag committed-only multi-commit files in by-commit mode', () => {
    const changes: LocalFileChange[] = [
      mkChange({ filePath: 'a.ts', category: 'committed', commitHash: 'c1' }),
      mkChange({ filePath: 'a.ts', category: 'committed', commitHash: 'c2' }),
    ];
    expect(computeMergedDestinedPaths(changes, true)).toEqual(new Set());
  });

  it('does NOT flag single-part files', () => {
    const changes: LocalFileChange[] = [
      mkChange({ filePath: 'a.ts', category: 'staged' }),
      mkChange({ filePath: 'b.ts', category: 'unstaged' }),
      mkChange({ filePath: 'c.ts', category: 'committed', commitHash: 'c1' }),
    ];
    expect(computeMergedDestinedPaths(changes, false)).toEqual(new Set());
  });

  it('detects a merged file past the 20-slot upfront cap (file #23 mixed stages)', () => {
    const changes: LocalFileChange[] = [];
    // 22 distinct single-stage files.
    for (let i = 0; i < 22; i++) {
      changes.push(mkChange({ filePath: `file-${String(i).padStart(2, '0')}.ts`, category: 'unstaged' }));
    }
    // File #23 (index 22) has mixed staged + unstaged parts.
    const target = 'file-23-merged.ts';
    changes.push(mkChange({ filePath: target, category: 'staged' }));
    changes.push(mkChange({ filePath: target, category: 'unstaged' }));
    // Plus another single-stage file after to push us to 25.
    changes.push(mkChange({ filePath: 'file-24.ts', category: 'staged' }));

    const mergedPaths = computeMergedDestinedPaths(changes, false);
    expect(mergedPaths.has(target)).toBe(true);
    expect(mergedPaths.size).toBe(1);
  });
});

describe('computeBranchBaseCollapsedCommittedPaths', () => {
  it('flags committed files touched by multiple commits in combined mode', () => {
    const changes: LocalFileChange[] = [
      mkChange({ filePath: 'a.ts', category: 'committed', commitHash: 'c1' }),
      mkChange({ filePath: 'a.ts', category: 'committed', commitHash: 'c2' }),
      mkChange({ filePath: 'b.ts', category: 'committed', commitHash: 'c3' }),
    ];

    expect(computeBranchBaseCollapsedCommittedPaths(changes, false)).toEqual(new Set(['a.ts']));
  });

  it('does not collapse committed files in by-commit mode', () => {
    const changes: LocalFileChange[] = [
      mkChange({ filePath: 'a.ts', category: 'committed', commitHash: 'c1' }),
      mkChange({ filePath: 'a.ts', category: 'committed', commitHash: 'c2' }),
    ];

    expect(computeBranchBaseCollapsedCommittedPaths(changes, true)).toEqual(new Set());
  });

  it('ignores repeated staged or unstaged parts', () => {
    const changes: LocalFileChange[] = [
      mkChange({ filePath: 'a.ts', category: 'staged' }),
      mkChange({ filePath: 'a.ts', category: 'unstaged' }),
      mkChange({ filePath: 'a.ts', category: 'committed', commitHash: 'c1' }),
    ];

    expect(computeBranchBaseCollapsedCommittedPaths(changes, false)).toEqual(new Set());
  });
});

describe('computeBranchBaseCommittedFallbacks', () => {
  it('retains all committed entries for a collapsed path when branch-base fetch fails', () => {
    const committedFirst = mkChange({
      filePath: 'a.ts',
      category: 'committed',
      commitHash: 'c1',
    });
    const committedSecond = mkChange({
      filePath: 'a.ts',
      category: 'committed',
      commitHash: 'c2',
    });
    const changes: LocalFileChange[] = [
      committedFirst,
      mkChange({ filePath: 'a.ts', category: 'staged' }),
      committedSecond,
      mkChange({ filePath: 'b.ts', category: 'committed', commitHash: 'c3' }),
    ];

    const fallbacks = computeBranchBaseCommittedFallbacks(changes, new Set(['a.ts']));

    expect(fallbacks.get('a.ts')).toEqual([committedFirst, committedSecond]);
    expect(fallbacks.has('b.ts')).toBe(false);
  });
});

describe('applyNumstatStats', () => {
  it('backfills stats for an over-cap raw local entry without changing content fields', () => {
    const changes: LocalFileChange[] = [];
    for (let i = 0; i < 21; i++) {
      changes.push(
        mkChange({
          filePath: `file-${String(i).padStart(2, '0')}.ts`,
          category: 'unstaged',
          additions: 0,
          deletions: 0,
        }),
      );
    }
    const overCap = changes[20];

    const result = applyNumstatStats(changes, [
      { filePath: overCap.filePath, additions: 12, deletions: 4 },
    ]);

    expect(result[20]).toMatchObject({ additions: 12, deletions: 4 });
    expect(result[20].oldContent).toBeUndefined();
    expect(result[20].newContent).toBeUndefined();
  });

  it('uses committed numstat entries for committed changes', () => {
    const changes = [
      mkChange({ filePath: 'src/a.ts', category: 'committed', additions: 0, deletions: 0 }),
    ];

    const result = applyNumstatStats(
      changes,
      [{ filePath: 'src/a.ts', additions: 1, deletions: 1 }],
      [{ filePath: 'src/a.ts', additions: 7, deletions: 3 }],
    );

    expect(result[0]).toMatchObject({ additions: 7, deletions: 3 });
  });

  it('does not double-count aggregate numstat when a file has multiple raw parts', () => {
    const changes = [
      mkChange({ filePath: 'src/a.ts', category: 'staged', additions: 0, deletions: 0 }),
      mkChange({ filePath: 'src/a.ts', category: 'unstaged', additions: 5, deletions: 5 }),
    ];

    const result = applyNumstatStats(changes, [{ filePath: 'src/a.ts', additions: 8, deletions: 2 }]);

    expect(result.map((change) => [change.additions, change.deletions])).toEqual([
      [8, 2],
      [0, 0],
    ]);
  });
});
