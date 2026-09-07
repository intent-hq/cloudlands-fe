import { describe, expect, it } from 'vitest';
import { commitFileToTrackedChange } from './commit-file-to-tracked-change';

describe('commitFileToTrackedChange', () => {
  it.each([
    ['A', undefined, 'added'],
    ['D', undefined, 'deleted'],
    ['R100', 'src/old.ts', 'renamed'],
    ['modified', undefined, 'modified'],
  ] as const)('normalizes %s status', (status, renamedFrom, expected) => {
    const change = commitFileToTrackedChange(
      {
        path: 'src/current.ts',
        additions: 2,
        deletions: 1,
        status,
        ...(renamedFrom ? { renamedFrom } : {}),
      },
      { id: 'change-1', commitHash: 'abc', timestamp: 1 },
    );

    expect(change).toMatchObject({
      id: 'change-1',
      relativePath: 'src/current.ts',
      status: expected,
      commitHash: 'abc',
      stats: { additions: 2, deletions: 1 },
      ...(renamedFrom ? { renamedFrom } : {}),
    });
  });

  it('leaves unsupported status facts neutral', () => {
    const change = commitFileToTrackedChange(
      { path: 'src/current.ts', status: 'unknown' },
      { id: 'change-1', timestamp: 1 },
    );

    expect(change.status).toBeUndefined();
  });
});
