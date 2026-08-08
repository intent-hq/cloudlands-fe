import { describe, expect, it } from 'vitest';
import { GitFileStatus, type FileStatus } from '$shared/types';
import { ChangeStage, type TrackedChange } from './types';
import { reconcileGitStatusChanges } from './git-status-reconciliation';

function tracked(path: string, stage: ChangeStage, id = `audit:${path}`): TrackedChange {
  return {
    id,
    file: `/repo/${path}`,
    relativePath: path,
    stage,
    status: 'modified',
    stats: { additions: 7, deletions: 3 },
    attribution: {
      timestamp: 1_750_000_000_000,
      agent: {
        agentId: 'agent-1',
        agentName: 'Agent One',
        sessionId: 'session-1',
        turnNumber: 4,
        timestamp: 1_750_000_000_000,
      },
    },
  };
}

describe('reconcileGitStatusChanges', () => {
  it('uses protocol-shaped git status as the file set and preserves matching audit metadata', () => {
    const files: FileStatus[] = [
      { path: 'src/staged.ts', status: GitFileStatus.Modified, staged: true },
      { path: 'src/unstaged.ts', status: GitFileStatus.Modified, staged: false },
      { path: 'src/new.ts', status: GitFileStatus.Untracked, staged: false },
      { path: 'src/deleted.ts', status: GitFileStatus.Deleted, staged: false },
    ];
    const matching = tracked('src/unstaged.ts', ChangeStage.Unstaged);
    const stale = tracked('src/stale.ts', ChangeStage.Unstaged);

    const result = reconcileGitStatusChanges(files, [matching, stale]);

    expect(
      result.map(({ relativePath, stage, status }) => ({ relativePath, stage, status })),
    ).toEqual([
      { relativePath: 'src/staged.ts', stage: ChangeStage.Staged, status: 'modified' },
      { relativePath: 'src/unstaged.ts', stage: ChangeStage.Unstaged, status: 'modified' },
      { relativePath: 'src/new.ts', stage: ChangeStage.Unstaged, status: 'added' },
      { relativePath: 'src/deleted.ts', stage: ChangeStage.Unstaged, status: 'deleted' },
    ]);
    expect(result[1]).toMatchObject({
      id: matching.id,
      file: matching.file,
      stats: matching.stats,
      attribution: matching.attribution,
    });
    expect(result.some((change) => change.relativePath === 'src/stale.ts')).toBe(false);
    expect(result[0]).toMatchObject({
      stats: { additions: 0, deletions: 0 },
      attribution: { manual: true, timestamp: 0 },
    });
  });

  it('keeps a path present in both index and worktree in both stages', () => {
    const files: FileStatus[] = [
      { path: 'src/dual.ts', status: GitFileStatus.Added, staged: true },
      { path: 'src/dual.ts', status: GitFileStatus.Modified, staged: false },
    ];
    const audit = tracked('src/dual.ts', ChangeStage.Staged);

    const result = reconcileGitStatusChanges(files, [audit]);

    expect(result.map((change) => change.stage)).toEqual([
      ChangeStage.Staged,
      ChangeStage.Unstaged,
    ]);
    expect(result.every((change) => change.attribution.agent?.agentId === 'agent-1')).toBe(true);
  });
});
