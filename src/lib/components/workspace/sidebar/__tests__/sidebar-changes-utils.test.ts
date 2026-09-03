import {
  describe,
  it,
  expect,
} from 'vitest';
import {
  ChangeStage,
  type TrackedChange,
  type CommitInfo,
} from '$features/file-tracking/types';
import type { AgentChangeGroup, PRInfo } from '$lib/components/file-tracking/accept-changes/types';
import type { PullRequestInfo } from '$shared/types';
import { PullRequestStatus } from '$shared/types';
import type { PrMonitorRow, PrMonitorSnapshot } from '$features/pr-monitor/pr-monitor-service';
import {
  getBranchNameValidationError,
  constructPrUrl,
  toPRDisplayStatus,
  getGroupKey,
  getCommitsToPushCount,
  getCommitsToUndoCount,
  getLocalCommitsToUndoCount,
  getPushTooltip,
  getUndoTooltip,
  getUndoCommitTooltip,
  canAmendCommit,
  isFileActive,
  isFileSelected,
  isFileFocused,
  isAgentGroupCollapsed,
  toUIFileChange,
  aggregatePRFiles,
  computeTotalStats,
  mapWorkspacePRs,
  mergeMonitoredPRs,
  orderPRSectionsForSelection,
  sortPRsByRecency,
  sectionPRs,
  type GitRootPRSource,
  type SectionedPRs,
  getPRStatusTooltip,
  countOtherPrs,
  prRepoFromUrl,
  monitorDisplayStatus,
  monitorPillStatus,
  toPullRequestStatus,
} from '../sidebar-changes-utils';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeSnapshot(overrides: Partial<PrMonitorSnapshot> = {}): PrMonitorSnapshot {
  return {
    state: 'open',
    isDraft: false,
    hasConflicts: false,
    isBehind: false,
    checks: {
      total: 0,
      passed: 0,
      failed: 0,
      pending: 0,
      failingRequired: 0,
      pendingRequired: 0,
      requiredKnown: false,
    },
    approvals: { decision: '', have: 0, changesRequested: 0 },
    threads: { unresolved: 0 },
    rulesKnown: false,
    ...overrides,
  };
}

function makeCommit(overrides: Partial<CommitInfo> = {}): CommitInfo {
  return {
    hash: 'abc123',
    message: 'test commit',
    author: 'Test',
    timestamp: Date.now(),
    files: [],
    stage: 'local' as const,
    isPushed: false,
    ...overrides,
  };
}

function makeTrackedChange(overrides: Partial<TrackedChange> = {}): TrackedChange {
  return {
    id: 'change-1',
    file: '/repo/src/foo.ts',
    relativePath: 'src/foo.ts',
    stage: ChangeStage.Unstaged,
    stats: { additions: 10, deletions: 5 },
    status: 'modified',
    attribution: { timestamp: 1000 },
    ...overrides,
  } as TrackedChange;
}

function makeGroup(overrides: Partial<AgentChangeGroup> = {}): AgentChangeGroup {
  return {
    agentId: 'agent-1',
    agentName: 'Test Agent',
    files: [],
    stats: { fileCount: 0, additions: 0, deletions: 0 },
    ...overrides,
  };
}

// ─── getBranchNameValidationError ─────────────────────────────────────────────

describe('getBranchNameValidationError', () => {
  it('returns undefined for valid branch names', () => {
    expect(getBranchNameValidationError('feature/my-branch')).toBeUndefined();
    expect(getBranchNameValidationError('main')).toBeUndefined();
    expect(getBranchNameValidationError('fix-123')).toBeUndefined();
    expect(getBranchNameValidationError('a')).toBeUndefined();
  });

  it('rejects empty string', () => {
    expect(getBranchNameValidationError('')).toBe('Branch name cannot be empty');
  });

  it('rejects whitespace-only', () => {
    expect(getBranchNameValidationError('   ')).toBe('Branch name cannot be empty');
  });

  it('rejects spaces', () => {
    expect(getBranchNameValidationError('my branch')).toBe('Branch name contains invalid characters');
  });

  it('rejects tabs', () => {
    expect(getBranchNameValidationError('feat\ttab')).toBe('Branch name contains invalid characters');
  });

  it('rejects newlines', () => {
    expect(getBranchNameValidationError('feat\nnewline')).toBe(
      'Branch name contains invalid characters',
    );
  });

  it('rejects backslash', () => {
    expect(getBranchNameValidationError('feat\\bar')).toBe('Branch name contains invalid characters');
  });

  it('rejects tilde', () => {
    expect(getBranchNameValidationError('feat~1')).toBe('Branch name contains invalid characters');
  });

  it('rejects caret', () => {
    expect(getBranchNameValidationError('feat^1')).toBe('Branch name contains invalid characters');
  });

  it('rejects colon', () => {
    expect(getBranchNameValidationError('feat:1')).toBe('Branch name contains invalid characters');
  });

  it('rejects question mark', () => {
    expect(getBranchNameValidationError('feat?')).toBe('Branch name contains invalid characters');
  });

  it('rejects asterisk', () => {
    expect(getBranchNameValidationError('feat*')).toBe('Branch name contains invalid characters');
  });

  it('rejects open bracket', () => {
    expect(getBranchNameValidationError('feat[')).toBe('Branch name contains invalid characters');
  });

  it('rejects at-brace sequence @{', () => {
    expect(getBranchNameValidationError('feat@{')).toBe('Branch name cannot contain the sequence @{');
    expect(getBranchNameValidationError('@{upstream}')).toBe('Branch name cannot contain the sequence @{');
  });

  it('rejects @ as entire branch name', () => {
    expect(getBranchNameValidationError('@')).toBe('Branch name cannot be @');
  });

  it('allows bare @ in branch names', () => {
    expect(getBranchNameValidationError('feat@bar')).toBeUndefined();
    expect(getBranchNameValidationError('user@feature')).toBeUndefined();
  });

  it('allows bare { in branch names', () => {
    expect(getBranchNameValidationError('feat{bar')).toBeUndefined();
    expect(getBranchNameValidationError('{feature}')).toBeUndefined();
  });

  it('rejects starting with dot', () => {
    expect(getBranchNameValidationError('.hidden')).toBe("Branch name cannot start with '.'");
  });

  it('rejects ending with .lock', () => {
    expect(getBranchNameValidationError('branch.lock')).toBe(
      "Branch name cannot end with '.lock'",
    );
  });

  it('rejects consecutive dots', () => {
    expect(getBranchNameValidationError('a..b')).toBe("Branch name cannot contain '..'");
  });

  it('rejects starting with slash', () => {
    expect(getBranchNameValidationError('/branch')).toBe(
      'Branch name cannot start or end with /',
    );
  });

  it('rejects ending with slash', () => {
    expect(getBranchNameValidationError('branch/')).toBe(
      'Branch name cannot start or end with /',
    );
  });

  it('rejects consecutive slashes', () => {
    expect(getBranchNameValidationError('a//b')).toBe(
      'Branch name cannot contain consecutive slashes',
    );
  });

  it('rejects starting with dash', () => {
    expect(getBranchNameValidationError('-branch')).toBe("Branch name cannot start with '-'");
  });

  it('rejects ending with a period', () => {
    expect(getBranchNameValidationError('name.')).toBe('Branch name cannot end with a period');
  });

  it('rejects component starting with dot', () => {
    expect(getBranchNameValidationError('refs/.hidden/branch')).toBe(
      "Branch name component cannot start with '.'",
    );
  });

  it('rejects component ending with .lock', () => {
    expect(getBranchNameValidationError('feature/main.lock')).toBe(
      "Branch name cannot end with '.lock'",
    );
  });

  it('rejects names longer than 250 chars', () => {
    expect(getBranchNameValidationError('a'.repeat(251))).toBe(
      'Branch name is too long (max 250 characters)',
    );
  });

  it('accepts exactly 250 chars', () => {
    expect(getBranchNameValidationError('a'.repeat(250))).toBeUndefined();
  });
});

// ─── constructPrUrl ───────────────────────────────────────────────────────────

describe('constructPrUrl', () => {
  it('constructs URL from owner and repo', () => {
    expect(constructPrUrl(42, 'octocat', 'hello-world')).toBe(
      'https://github.com/octocat/hello-world/pull/42',
    );
  });

  it('returns fallback when owner is missing', () => {
    expect(constructPrUrl(42, undefined, 'repo', 'https://fallback.com')).toBe(
      'https://fallback.com',
    );
  });

  it('returns fallback when repo is missing', () => {
    expect(constructPrUrl(42, 'owner', undefined, 'https://fallback.com')).toBe(
      'https://fallback.com',
    );
  });

  it('returns empty string when no fallback and no repo info', () => {
    expect(constructPrUrl(42, undefined, undefined)).toBe('');
  });
});

// ─── toPRDisplayStatus ────────────────────────────────────────────────────────

describe('toPRDisplayStatus', () => {
  it('maps Open to open', () => expect(toPRDisplayStatus('Open')).toBe('open'));
  it('maps Merged to merged', () => expect(toPRDisplayStatus('Merged')).toBe('merged'));
  it('maps Draft to draft', () => expect(toPRDisplayStatus('Draft')).toBe('draft'));
  it('maps Closed to closed', () => expect(toPRDisplayStatus('Closed')).toBe('closed'));
  it('maps unknown to closed', () => expect(toPRDisplayStatus('anything')).toBe('closed'));
  it('maps empty to closed', () => expect(toPRDisplayStatus('')).toBe('closed'));
});

// ─── getGroupKey ──────────────────────────────────────────────────────────────

describe('getGroupKey', () => {
  it('returns section:agentId for agent groups', () => {
    expect(getGroupKey(makeGroup({ agentId: 'agent-1' }), 'unstaged')).toBe('unstaged:agent-1');
    expect(getGroupKey(makeGroup({ agentId: 'agent-2' }), 'staged')).toBe('staged:agent-2');
  });
  it('returns section:manual for null agentId', () => {
    expect(getGroupKey(makeGroup({ agentId: null }), 'unstaged')).toBe('unstaged:manual');
  });
});

// ─── Commit counting functions ────────────────────────────────────────────────

describe('getCommitsToPushCount', () => {
  const commits = [
    makeCommit({ isPushed: false }),
    makeCommit({ isPushed: true }),
    makeCommit({ isPushed: false }),
    makeCommit({ isPushed: true }),
  ];

  it('counts unpushed from index to end', () => {
    expect(getCommitsToPushCount(commits, 0)).toBe(2);
    expect(getCommitsToPushCount(commits, 1)).toBe(1);
    expect(getCommitsToPushCount(commits, 2)).toBe(1);
    expect(getCommitsToPushCount(commits, 3)).toBe(0);
  });

  it('returns 0 for empty array', () => {
    expect(getCommitsToPushCount([], 0)).toBe(0);
  });
});

describe('getCommitsToUndoCount', () => {
  const commits = [
    makeCommit({ isPushed: true }),
    makeCommit({ isPushed: false }),
    makeCommit({ isPushed: true }),
  ];

  it('counts pushed from 0 to index', () => {
    expect(getCommitsToUndoCount(commits, 0)).toBe(1);
    expect(getCommitsToUndoCount(commits, 1)).toBe(1);
    expect(getCommitsToUndoCount(commits, 2)).toBe(2);
  });
});

describe('getLocalCommitsToUndoCount', () => {
  const commits = [
    makeCommit({ isPushed: false }),
    makeCommit({ isPushed: true }),
    makeCommit({ isPushed: false }),
  ];

  it('counts unpushed from 0 to index', () => {
    expect(getLocalCommitsToUndoCount(commits, 0)).toBe(1);
    expect(getLocalCommitsToUndoCount(commits, 1)).toBe(1);
    expect(getLocalCommitsToUndoCount(commits, 2)).toBe(2);
  });
});

// ─── Tooltip functions ────────────────────────────────────────────────────────

describe('getPushTooltip', () => {
  it('singular commit without PR', () => {
    const commits = [makeCommit({ isPushed: false })];
    expect(getPushTooltip(commits, 0, false, 'my-branch')).toBe(
      'Push commit to remote (origin/my-branch)',
    );
  });

  it('plural commits without PR', () => {
    const commits = [makeCommit({ isPushed: false }), makeCommit({ isPushed: false })];
    expect(getPushTooltip(commits, 0, false, 'feat')).toBe(
      'Push 2 commits to remote (origin/feat)',
    );
  });

  it('singular commit with PR', () => {
    const commits = [makeCommit({ isPushed: false })];
    expect(getPushTooltip(commits, 0, true, 'feat')).toBe('Add commit to PR (origin/feat)');
  });

  it('plural commits with PR', () => {
    const commits = [makeCommit({ isPushed: false }), makeCommit({ isPushed: false })];
    expect(getPushTooltip(commits, 0, true, undefined)).toBe('Add 2 commits to PR');
  });

  it('no branch name omits suffix', () => {
    const commits = [makeCommit({ isPushed: false })];
    expect(getPushTooltip(commits, 0, false, undefined)).toBe('Push commit to remote');
  });
});

describe('getUndoTooltip', () => {
  it('singular pushed commit', () => {
    const commits = [makeCommit({ isPushed: true })];
    expect(getUndoTooltip(commits, 0, 'main')).toBe('Undo push from remote (origin/main)');
  });

  it('plural pushed commits', () => {
    const commits = [makeCommit({ isPushed: true }), makeCommit({ isPushed: true })];
    expect(getUndoTooltip(commits, 1, 'dev')).toBe('Undo 2 commits from remote (origin/dev)');
  });

  it('no branch name', () => {
    const commits = [makeCommit({ isPushed: true })];
    expect(getUndoTooltip(commits, 0, undefined)).toBe('Undo push from remote');
  });
});

describe('getUndoCommitTooltip', () => {
  it('singular local commit', () => {
    const commits = [makeCommit({ isPushed: false })];
    expect(getUndoCommitTooltip(commits, 0)).toBe(
      'Undo commit (bring changes back to staging)',
    );
  });

  it('plural local commits', () => {
    const commits = [makeCommit({ isPushed: false }), makeCommit({ isPushed: false })];
    expect(getUndoCommitTooltip(commits, 1)).toBe(
      'Undo 2 commits (bring changes back to staging)',
    );
  });
});

// ─── canAmendCommit ───────────────────────────────────────────────────────────

describe('canAmendCommit', () => {
  it('returns true for index 0 with commits', () => {
    expect(canAmendCommit([makeCommit()], 0)).toBe(true);
  });

  it('returns false for index > 0', () => {
    expect(canAmendCommit([makeCommit(), makeCommit()], 1)).toBe(false);
  });

  it('returns false for empty array', () => {
    expect(canAmendCommit([], 0)).toBe(false);
  });
});

// ─── isFileActive ─────────────────────────────────────────────────────────────

describe('isFileActive', () => {
  it('returns true when path and staged match', () => {
    expect(isFileActive('src/foo.ts', true, 'src/foo.ts', true)).toBe(true);
    expect(isFileActive('src/foo.ts', false, 'src/foo.ts', false)).toBe(true);
  });

  it('returns false when path matches but staged differs', () => {
    expect(isFileActive('src/foo.ts', true, 'src/foo.ts', false)).toBe(false);
  });

  it('returns false when activeFilePath is null', () => {
    expect(isFileActive('src/foo.ts', true, null, true)).toBe(false);
  });

  it('returns false when activeFilePath is undefined', () => {
    expect(isFileActive('src/foo.ts', true, undefined, true)).toBe(false);
  });

  it('returns false when activeFileStaged is null', () => {
    expect(isFileActive('src/foo.ts', true, 'src/foo.ts', null)).toBe(false);
  });

  it('returns false when activeFileStaged is undefined', () => {
    expect(isFileActive('src/foo.ts', true, 'src/foo.ts', undefined)).toBe(false);
  });

  it('returns false when paths differ', () => {
    expect(isFileActive('src/bar.ts', true, 'src/foo.ts', true)).toBe(false);
  });
});

// ─── isFileSelected ───────────────────────────────────────────────────────────

describe('isFileSelected', () => {
  it('returns true when file is in selected set (staged)', () => {
    const selected = new Set(['staged:src/foo.ts']);
    expect(isFileSelected('src/foo.ts', true, selected)).toBe(true);
  });

  it('returns true when file is in selected set (unstaged)', () => {
    const selected = new Set(['unstaged:src/foo.ts']);
    expect(isFileSelected('src/foo.ts', false, selected)).toBe(true);
  });

  it('returns false when file is not in set', () => {
    const selected = new Set(['staged:src/bar.ts']);
    expect(isFileSelected('src/foo.ts', true, selected)).toBe(false);
  });

  it('returns false when staged status differs', () => {
    const selected = new Set(['staged:src/foo.ts']);
    expect(isFileSelected('src/foo.ts', false, selected)).toBe(false);
  });

  it('returns false for empty set', () => {
    expect(isFileSelected('src/foo.ts', true, new Set())).toBe(false);
  });
});

// ─── isFileFocused ────────────────────────────────────────────────────────────

describe('isFileFocused', () => {
  it('returns true when path and staged match', () => {
    expect(isFileFocused('src/foo.ts', true, { path: 'src/foo.ts', staged: true })).toBe(true);
  });

  it('returns false when path differs', () => {
    expect(isFileFocused('src/bar.ts', true, { path: 'src/foo.ts', staged: true })).toBe(false);
  });

  it('returns false when staged differs', () => {
    expect(isFileFocused('src/foo.ts', false, { path: 'src/foo.ts', staged: true })).toBe(false);
  });

  it('returns false when focusedFile is null', () => {
    expect(isFileFocused('src/foo.ts', true, null)).toBe(false);
  });
});

// ─── isAgentGroupCollapsed ────────────────────────────────────────────────────

describe('isAgentGroupCollapsed', () => {
  it('returns true when agentId is in collapsed set', () => {
    const collapsed = new Set(['agent-1']);
    expect(isAgentGroupCollapsed('agent-1', collapsed)).toBe(true);
  });

  it('returns false when agentId is not in collapsed set', () => {
    const collapsed = new Set(['agent-2']);
    expect(isAgentGroupCollapsed('agent-1', collapsed)).toBe(false);
  });

  it('uses "manual" key for null agentId', () => {
    const collapsed = new Set(['manual']);
    expect(isAgentGroupCollapsed(null, collapsed)).toBe(true);
  });

  it('returns false for null agentId when manual not collapsed', () => {
    expect(isAgentGroupCollapsed(null, new Set())).toBe(false);
  });
});

// ─── toUIFileChange ───────────────────────────────────────────────────────────

describe('toUIFileChange', () => {
  it('converts basic tracked change', () => {
    const change = makeTrackedChange();
    const result = toUIFileChange(change, false);
    expect(result.path).toBe('src/foo.ts');
    expect(result.additions).toBe(10);
    expect(result.deletions).toBe(5);
    expect(result.staged).toBe(false);
    expect(result.status).toBe('modified');
    expect(result.attribution).toBeUndefined();
  });

  it('sets staged to true', () => {
    const result = toUIFileChange(makeTrackedChange(), true);
    expect(result.staged).toBe(true);
  });

  it('maps agent attribution', () => {
    const change = makeTrackedChange({
      attribution: {
        agent: {
          agentId: 'agent-1',
          agentName: 'My Agent',
          sessionId: 'sess-1',
          turnNumber: 3,
          timestamp: 5000,
        },
        timestamp: 5000,
      },
    });
    const result = toUIFileChange(change, false);
    expect(result.attribution).toEqual({
      agentId: 'agent-1',
      agentName: 'My Agent',
      sessionId: 'sess-1',
      turnNumber: 3,
      timestamp: 5000,
    });
  });

  it('handles added status', () => {
    const change = makeTrackedChange({ status: 'added' });
    expect(toUIFileChange(change, false).status).toBe('added');
  });

  it('handles deleted status', () => {
    const change = makeTrackedChange({ status: 'deleted' });
    expect(toUIFileChange(change, false).status).toBe('deleted');
  });

  it('handles renamed status', () => {
    const change = makeTrackedChange({ status: 'renamed' });
    expect(toUIFileChange(change, false).status).toBe('renamed');
  });

  it('handles undefined status', () => {
    const change = makeTrackedChange({ status: undefined });
    expect(toUIFileChange(change, false).status).toBeUndefined();
  });
});



// ─── aggregatePRFiles ──────────────────────────────────────────────────────────

describe('aggregatePRFiles', () => {
  it('returns empty array for empty commits', () => {
    expect(aggregatePRFiles([])).toEqual([]);
  });

  it('aggregates files from a single commit', () => {
    const commits = [
      makeCommit({ files: [{ path: 'a.ts', additions: 5, deletions: 2 }], timestamp: 100 }),
    ];
    const result = aggregatePRFiles(commits);
    expect(result).toEqual([{ path: 'a.ts', additions: 5, deletions: 2, staged: false }]);
  });

  it('accumulates additions/deletions across commits for the same file', () => {
    const commits = [
      makeCommit({ hash: 'a', files: [{ path: 'a.ts', additions: 5, deletions: 2 }], timestamp: 100 }),
      makeCommit({ hash: 'b', files: [{ path: 'a.ts', additions: 3, deletions: 1 }], timestamp: 200 }),
    ];
    const result = aggregatePRFiles(commits);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ path: 'a.ts', additions: 8, deletions: 3, staged: false });
  });

  it('handles multiple different files across commits', () => {
    const commits = [
      makeCommit({ hash: 'a', files: [{ path: 'a.ts', additions: 1, deletions: 0 }], timestamp: 100 }),
      makeCommit({ hash: 'b', files: [{ path: 'b.ts', additions: 2, deletions: 1 }], timestamp: 200 }),
    ];
    const result = aggregatePRFiles(commits);
    expect(result).toHaveLength(2);
    expect(result.find((f) => f.path === 'a.ts')).toEqual({ path: 'a.ts', additions: 1, deletions: 0, staged: false });
    expect(result.find((f) => f.path === 'b.ts')).toEqual({ path: 'b.ts', additions: 2, deletions: 1, staged: false });
  });

  it('handles commits with undefined files', () => {
    const commits = [makeCommit({ files: undefined, timestamp: 100 })];
    expect(aggregatePRFiles(commits)).toEqual([]);
  });
});

// ─── computeTotalStats ─────────────────────────────────────────────────────────

describe('computeTotalStats', () => {
  it('returns zeros for empty inputs', () => {
    expect(computeTotalStats([], [], [])).toEqual({
      totalFilesChanged: 0,
      totalAdditions: 0,
      totalDeletions: 0,
    });
  });

  it('counts unstaged changes', () => {
    const unstaged = [
      makeTrackedChange({ relativePath: 'a.ts', stats: { additions: 5, deletions: 2 } }),
    ];
    const result = computeTotalStats(unstaged, [], []);
    expect(result).toEqual({ totalFilesChanged: 1, totalAdditions: 5, totalDeletions: 2 });
  });

  it('deduplicates paths across unstaged, staged, and commits', () => {
    const unstaged = [makeTrackedChange({ relativePath: 'a.ts', stats: { additions: 1, deletions: 0 } })];
    const staged = [makeTrackedChange({ relativePath: 'a.ts', stats: { additions: 2, deletions: 1 } })];
    const commits = [
      makeCommit({ files: [{ path: 'a.ts', additions: 3, deletions: 0 }] }),
    ];
    const result = computeTotalStats(unstaged, staged, commits);
    expect(result.totalFilesChanged).toBe(1); // same file across all
    expect(result.totalAdditions).toBe(6); // 1+2+3
    expect(result.totalDeletions).toBe(1);
  });

  it('counts unique files across sources', () => {
    const unstaged = [makeTrackedChange({ relativePath: 'a.ts', stats: { additions: 1, deletions: 0 } })];
    const staged = [makeTrackedChange({ relativePath: 'b.ts', stats: { additions: 1, deletions: 0 } })];
    const commits = [makeCommit({ files: [{ path: 'c.ts', additions: 1, deletions: 0 }] })];
    const result = computeTotalStats(unstaged, staged, commits);
    expect(result.totalFilesChanged).toBe(3);
  });
});

// ─── mapWorkspacePRs ───────────────────────────────────────────────────────────

describe('mapWorkspacePRs', () => {
  const buildUrl = (n: number, fallback?: string) => fallback || `https://github.com/pr/${n}`;
  const getTitle = (pr: PullRequestInfo) => pr.title;

  function makePR(overrides: Partial<PullRequestInfo> = {}): PullRequestInfo {
    return {
      id: 'pr-1',
      number: 1,
      url: 'https://github.com/pr/1',
      title: 'Test PR',
      status: 'open',
      createdAt: '2024-01-01',
      updatedAt: '2024-01-02',
      ...overrides,
    };
  }

  it('returns empty array when no PRs and no active PR', () => {
    expect(mapWorkspacePRs(undefined, null, buildUrl, getTitle)).toEqual([]);
    expect(mapWorkspacePRs([], null, buildUrl, getTitle)).toEqual([]);
  });

  it('maps workspace PRs when available', () => {
    const prs = [makePR({ number: 42, title: 'My PR', status: 'open' })];
    const result = mapWorkspacePRs(prs, null, buildUrl, getTitle);
    expect(result).toHaveLength(1);
    expect(result[0].number).toBe(42);
    expect(result[0].title).toBe('My PR');
  });

  it('falls back to active PR when workspace PRs are empty', () => {
    const activePR = makePR({ number: 99, title: 'Active' });
    const result = mapWorkspacePRs([], activePR, buildUrl, getTitle);
    expect(result).toHaveLength(1);
    expect(result[0].number).toBe(99);
  });

  it('prefers workspace PRs over active PR', () => {
    const prs = [makePR({ number: 1 })];
    const activePR = makePR({ number: 99 });
    const result = mapWorkspacePRs(prs, activePR, buildUrl, getTitle);
    expect(result).toHaveLength(1);
    expect(result[0].number).toBe(1);
  });

  // The daemon-merged pool (intent-hq/intentd#1330) can carry cross-repo
  // entries whose URL is the authoritative repo identity.

  it('keeps a present entry URL as-is instead of rebuilding it', () => {
    const prs = [makePR({ number: 7, url: 'https://github.com/other/repo/pull/7' })];
    const result = mapWorkspacePRs(prs, null, buildUrl, getTitle, 'acme/widgets');
    expect(result[0].url).toBe('https://github.com/other/repo/pull/7');
    expect(result[0].htmlUrl).toBe('https://github.com/other/repo/pull/7');
  });

  it('constructs a URL only for entries lacking one', () => {
    const prs = [makePR({ number: 7, url: '' })];
    const result = mapWorkspacePRs(prs, null, buildUrl, getTitle, 'acme/widgets');
    expect(result[0].url).toBe('https://github.com/pr/7');
  });

  it('annotates entries whose URL points at another repo with crossRepo context', () => {
    const prs = [
      makePR({ number: 1, url: 'https://github.com/acme/widgets/pull/1' }),
      makePR({ id: 'pr-2', number: 2, url: 'https://github.com/acme/intentd/pull/2' }),
      makePR({ id: 'pr-3', number: 3, url: 'https://github.com/other/repo/pull/3' }),
    ];
    const result = mapWorkspacePRs(prs, null, buildUrl, getTitle, 'acme/widgets');
    expect(result[0].crossRepo).toBeUndefined();
    expect(result[0].crossRepoDisplay).toBeUndefined();
    expect(result[1].crossRepo).toBe('acme/intentd');
    expect(result[1].crossRepoDisplay).toBe('intentd');
    expect(result[2].crossRepo).toBe('other/repo');
    expect(result[2].crossRepoDisplay).toBe('other/repo');
  });

  it('compares repos case-insensitively for crossRepo annotation', () => {
    const prs = [makePR({ number: 1, url: 'https://github.com/Acme/Widgets/pull/1' })];
    const result = mapWorkspacePRs(prs, null, buildUrl, getTitle, 'acme/widgets');
    expect(result[0].crossRepo).toBeUndefined();
  });

  it('leaves crossRepo unset when the workspace repo is unknown', () => {
    const prs = [makePR({ number: 1, url: 'https://github.com/other/repo/pull/1' })];
    const result = mapWorkspacePRs(prs, null, buildUrl, getTitle);
    expect(result[0].crossRepo).toBeUndefined();
  });
});

// ─── prRepoFromUrl ─────────────────────────────────────────────────────────────

describe('prRepoFromUrl', () => {
  it('parses owner/name from a canonical GitHub PR URL', () => {
    expect(prRepoFromUrl('https://github.com/acme/widgets/pull/42')).toBe('acme/widgets');
  });

  it('returns undefined for non-PR or non-GitHub URLs', () => {
    expect(prRepoFromUrl('https://github.com/acme/widgets')).toBeUndefined();
    expect(prRepoFromUrl('https://example.com/acme/widgets/pull/42')).toBeUndefined();
    expect(prRepoFromUrl('')).toBeUndefined();
    expect(prRepoFromUrl(undefined)).toBeUndefined();
  });
});

// ─── mergeMonitoredPRs (PROTOCOL §6.9) ─────────────────────────────────────────

describe('mergeMonitoredPRs', () => {
  const workspaceRepo = 'acme/widgets';

  function makeMonitor(overrides: Partial<PrMonitorRow> = {}): PrMonitorRow {
    const prNumber = overrides.prNumber ?? 42;
    const repo = overrides.repo ?? 'acme/widgets';
    return {
      monitorId: 'mon-1',
      workspaceId: 'ws-1',
      agentId: 'agent-1',
      repo,
      prNumber,
      state: 'active',
      pendingChanges: [],
      hasPendingChanges: false,
      createdAt: '2026-08-07T10:00:00Z',
      updatedAt: '2026-08-07T10:05:00Z',
      title: 'Monitored PR',
      url: `https://github.com/${repo}/pull/${prNumber}`,
      ...overrides,
    };
  }

  function makeBasePR(overrides: Partial<PRInfo> = {}): PRInfo {
    const number = overrides.number ?? 42;
    const url = overrides.url ?? `https://github.com/acme/widgets/pull/${number}`;
    return {
      number,
      title: 'Branch PR',
      url,
      htmlUrl: url,
      status: 'open',
      ...overrides,
    };
  }

  it('returns base list untouched when there are no monitors', () => {
    const base = [makeBasePR()];
    expect(mergeMonitoredPRs(base, [], workspaceRepo)).toBe(base);
  });

  it('annotates a same-repo duplicate with the owning agent instead of appending', () => {
    const result = mergeMonitoredPRs([makeBasePR()], [makeMonitor()], workspaceRepo);
    expect(result).toHaveLength(1);
    expect(result[0].monitorAgentId).toBe('agent-1');
    expect(result[0].title).toBe('Branch PR');
  });

  it('appends an unmatched same-repo monitor with agent attribution', () => {
    const result = mergeMonitoredPRs(
      [makeBasePR({ number: 7 })],
      [makeMonitor()],
      workspaceRepo,
    );
    expect(result).toHaveLength(2);
    expect(result[1]).toMatchObject({
      number: 42,
      title: 'Monitored PR',
      status: 'open',
      monitorAgentId: 'agent-1',
      crossRepo: undefined,
      monitorOnly: true,
    });
    expect(result[0].monitorOnly).toBeUndefined();
  });

  it('appends a cross-repo monitor with repo context even when numbers collide', () => {
    const result = mergeMonitoredPRs(
      [makeBasePR({ number: 42 })],
      [makeMonitor({ repo: 'other/repo', url: 'https://github.com/other/repo/pull/42' })],
      workspaceRepo,
    );
    expect(result).toHaveLength(2);
    expect(result[1].crossRepo).toBe('other/repo');
    expect(result[1].monitorOnly).toBe(true);
  });

  it('drops the owner segment in crossRepoDisplay when the org matches the workspace repo', () => {
    const result = mergeMonitoredPRs(
      [],
      [makeMonitor({ repo: 'acme/other', url: 'https://github.com/acme/other/pull/42' })],
      workspaceRepo,
    );
    expect(result[0].crossRepo).toBe('acme/other');
    expect(result[0].crossRepoDisplay).toBe('other');
  });

  it('shortens crossRepoDisplay case-insensitively on the owner segment', () => {
    const result = mergeMonitoredPRs(
      [],
      [makeMonitor({ repo: 'Acme/other', url: 'https://github.com/Acme/other/pull/42' })],
      workspaceRepo,
    );
    expect(result[0].crossRepo).toBe('Acme/other');
    expect(result[0].crossRepoDisplay).toBe('other');
  });

  it('keeps the full owner/name in crossRepoDisplay when the org differs', () => {
    const result = mergeMonitoredPRs(
      [],
      [makeMonitor({ repo: 'other/repo', url: 'https://github.com/other/repo/pull/42' })],
      workspaceRepo,
    );
    expect(result[0].crossRepo).toBe('other/repo');
    expect(result[0].crossRepoDisplay).toBe('other/repo');
  });

  it('leaves crossRepoDisplay unset for same-repo monitor rows', () => {
    const result = mergeMonitoredPRs([makeBasePR({ number: 7 })], [makeMonitor()], workspaceRepo);
    expect(result[1].crossRepo).toBeUndefined();
    expect(result[1].crossRepoDisplay).toBeUndefined();
  });

  it('attaches the monitor last snapshot to both appended and annotated rows', () => {
    const snapshot = makeSnapshot();
    const appended = mergeMonitoredPRs([], [makeMonitor({ lastSnapshot: snapshot })], workspaceRepo);
    expect(appended[0].monitorSnapshot).toBe(snapshot);

    const annotated = mergeMonitoredPRs(
      [makeBasePR()],
      [makeMonitor({ lastSnapshot: snapshot })],
      workspaceRepo,
    );
    expect(annotated[0].monitorSnapshot).toBe(snapshot);
  });

  it('does not let a snapshotless duplicate monitor clobber an earlier snapshot', () => {
    const snapshot = makeSnapshot();
    const result = mergeMonitoredPRs(
      [makeBasePR()],
      [
        makeMonitor({ monitorId: 'mon-1', agentId: 'agent-1', lastSnapshot: snapshot }),
        makeMonitor({ monitorId: 'mon-2', agentId: 'agent-2', lastSnapshot: undefined }),
      ],
      workspaceRepo,
    );
    expect(result[0].monitorSnapshot).toBe(snapshot);
    expect(result[0].monitorAgentId).toBe('agent-2');
  });

  it('renders completed monitors without a snapshot verdict as closed (completion covers merged AND closed)', () => {
    const result = mergeMonitoredPRs(
      [],
      [makeMonitor({ state: 'completed' })],
      workspaceRepo,
    );
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe('closed');
  });

  it('prefers the last-snapshot state for completed monitors (closed stays closed)', () => {
    const snapshot = {
      state: 'closed',
      isDraft: false,
      hasConflicts: false,
      isBehind: false,
      checks: {
        total: 0,
        passed: 0,
        failed: 0,
        pending: 0,
        failingRequired: 0,
        pendingRequired: 0,
        requiredKnown: false,
      },
      approvals: { decision: '', have: 0, changesRequested: 0 },
      threads: { unresolved: 0 },
      rulesKnown: false,
    };
    const result = mergeMonitoredPRs(
      [],
      [makeMonitor({ state: 'completed', lastSnapshot: snapshot })],
      workspaceRepo,
    );
    expect(result[0].status).toBe('closed');
  });

  it('falls back to repo#number title and a constructed URL before the first poll', () => {
    const result = mergeMonitoredPRs(
      [],
      [makeMonitor({ title: undefined, url: undefined })],
      workspaceRepo,
    );
    expect(result[0].title).toBe('acme/widgets#42');
    expect(result[0].url).toBe('https://github.com/acme/widgets/pull/42');
  });

  it('copies the monitor createdAt/updatedAt onto appended rows for recency sorting', () => {
    const result = mergeMonitoredPRs(
      [],
      [makeMonitor({ createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-02T00:00:00Z' })],
      workspaceRepo,
    );
    expect(result[0].createdAt).toBe('2026-08-01T00:00:00Z');
    expect(result[0].updatedAt).toBe('2026-08-02T00:00:00Z');
  });

  it('orders multiple monitored PRs by recency using the copied monitor timestamps', () => {
    const pool = mergeMonitoredPRs(
      [],
      [
        makeMonitor({ monitorId: 'mon-1', prNumber: 50, updatedAt: '2026-08-06T00:00:00Z' }),
        makeMonitor({ monitorId: 'mon-2', prNumber: 43, updatedAt: '2026-08-08T00:00:00Z' }),
        makeMonitor({ monitorId: 'mon-3', prNumber: 47, updatedAt: '2026-08-05T00:00:00Z' }),
      ],
      workspaceRepo,
    );
    expect(sortPRsByRecency(pool).map((pr) => pr.number)).toEqual([43, 50, 47]);
  });

  it('treats all monitors as same-repo when the workspace repo is unknown', () => {
    const result = mergeMonitoredPRs(
      [makeBasePR({ number: 42 })],
      [makeMonitor({ repo: 'other/repo' })],
      undefined,
    );
    expect(result).toHaveLength(1);
    expect(result[0].monitorAgentId).toBe('agent-1');
  });

  // ─── Regression: intent-hq/monorepo#1699 (each_key_duplicate crash) ────────

  it('dedupes two monitors (different agentIds) on the same cross-repo PR into one row', () => {
    const result = mergeMonitoredPRs(
      [],
      [
        makeMonitor({ monitorId: 'mon-1', agentId: 'agent-1', repo: 'other/repo' }),
        makeMonitor({ monitorId: 'mon-2', agentId: 'agent-2', repo: 'other/repo' }),
      ],
      workspaceRepo,
    );
    expect(result).toHaveLength(1);
    expect(result[0].crossRepo).toBe('other/repo');
    expect(result[0].number).toBe(42);
    // Keys collide under prKey (crossRepo#number), so there must be exactly one row.
    const keys = result.map((pr) => (pr.crossRepo ? `${pr.crossRepo}#${pr.number}` : String(pr.number)));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('dedupes two monitors on the same same-repo PR absent from basePRs into one row', () => {
    const result = mergeMonitoredPRs(
      [],
      [
        makeMonitor({ monitorId: 'mon-1', agentId: 'agent-1' }),
        makeMonitor({ monitorId: 'mon-2', agentId: 'agent-2' }),
      ],
      workspaceRepo,
    );
    expect(result).toHaveLength(1);
    expect(result[0].crossRepo).toBeUndefined();
    expect(result[0].number).toBe(42);
  });

  it('keeps a same-repo monitor and a cross-repo row with the same PR number as two distinct, correctly attributed rows', () => {
    const result = mergeMonitoredPRs(
      [],
      [
        makeMonitor({
          monitorId: 'mon-1',
          agentId: 'agent-1',
          repo: 'other/repo',
          url: 'https://github.com/other/repo/pull/42',
        }),
        makeMonitor({ monitorId: 'mon-2', agentId: 'agent-2' }),
      ],
      workspaceRepo,
    );
    expect(result).toHaveLength(2);
    const crossRepoRow = result.find((pr) => pr.crossRepo === 'other/repo');
    const bareRow = result.find((pr) => pr.crossRepo === undefined);
    expect(crossRepoRow?.monitorAgentId).toBe('agent-1');
    expect(bareRow?.monitorAgentId).toBe('agent-2');
    const keys = result.map((pr) => (pr.crossRepo ? `${pr.crossRepo}#${pr.number}` : String(pr.number)));
    expect(new Set(keys).size).toBe(keys.length);
  });

  // ─── URL dedup against the daemon-merged pool (intent-hq/intentd#1330) ─────

  it('annotates a base row matching the monitor by URL even when the base row carries crossRepo context', () => {
    const base = [
      makeBasePR({
        number: 42,
        url: 'https://github.com/other/repo/pull/42',
        htmlUrl: 'https://github.com/other/repo/pull/42',
        crossRepo: 'other/repo',
        crossRepoDisplay: 'other/repo',
      }),
    ];
    const result = mergeMonitoredPRs(
      base,
      [makeMonitor({ repo: 'other/repo', url: 'https://github.com/other/repo/pull/42' })],
      workspaceRepo,
    );
    expect(result).toHaveLength(1);
    expect(result[0].monitorAgentId).toBe('agent-1');
    expect(result[0].monitorOnly).toBeUndefined();
  });

  it('dedupes by URL case-insensitively', () => {
    const result = mergeMonitoredPRs(
      [makeBasePR({ url: 'https://github.com/Acme/Widgets/pull/42' })],
      [makeMonitor({ url: 'https://github.com/acme/widgets/pull/42' })],
      workspaceRepo,
    );
    expect(result).toHaveLength(1);
    expect(result[0].monitorAgentId).toBe('agent-1');
  });

  it('annotates a daemon-merged monitor-origin row by URL instead of appending (no double count after open)', () => {
    // Before opening, the daemon-merged pullRequests already carry the
    // monitored PR; when the live monitor rows arrive the pool size must
    // not change.
    const base = [
      makeBasePR({ number: 1, url: 'https://github.com/acme/widgets/pull/1' }),
      makeBasePR({
        number: 42,
        url: 'https://github.com/acme/widgets/pull/42',
        htmlUrl: 'https://github.com/acme/widgets/pull/42',
      }),
    ];
    const result = mergeMonitoredPRs(base, [makeMonitor()], workspaceRepo);
    expect(result).toHaveLength(2);
    expect(result[1].monitorAgentId).toBe('agent-1');
  });
});

// ─── sectionPRs (Changes tab sub-sections, monorepo#2053) ─────────────────────

describe('sectionPRs', () => {
  const workspaceRepo = 'acme/widgets';
  const getTitle = (pr: PullRequestInfo) => pr.title;

  function makeMonitor(overrides: Partial<PrMonitorRow> = {}): PrMonitorRow {
    const prNumber = overrides.prNumber ?? 42;
    const repo = overrides.repo ?? 'acme/widgets';
    return {
      monitorId: 'mon-1',
      workspaceId: 'ws-1',
      agentId: 'agent-1',
      repo,
      prNumber,
      state: 'active',
      pendingChanges: [],
      hasPendingChanges: false,
      createdAt: '2026-08-07T10:00:00Z',
      updatedAt: '2026-08-07T10:05:00Z',
      title: 'Monitored PR',
      url: `https://github.com/${repo}/pull/${prNumber}`,
      ...overrides,
    };
  }

  function makeBasePR(overrides: Partial<PRInfo> = {}): PRInfo {
    const number = overrides.number ?? 42;
    const url = overrides.url ?? `https://github.com/acme/widgets/pull/${number}`;
    return {
      number,
      title: 'Branch PR',
      url,
      htmlUrl: url,
      status: 'open',
      ...overrides,
    };
  }

  function makeRootPR(overrides: Partial<PullRequestInfo> = {}): PullRequestInfo {
    return {
      id: 'pr-1',
      number: 7,
      url: 'https://github.com/acme/intentd/pull/7',
      title: 'Root PR',
      status: PullRequestStatus.Open,
      createdAt: '2026-08-01T00:00:00Z',
      updatedAt: '2026-08-02T00:00:00Z',
      ...overrides,
    };
  }

  function makeRoot(overrides: Partial<GitRootPRSource> = {}): GitRootPRSource {
    return {
      repoOwner: 'acme',
      repoName: 'intentd',
      pullRequests: [makeRootPR()],
      ...overrides,
    };
  }

  it('matches mergeMonitoredPRs exactly in own when there are no roots or foreign monitors', () => {
    const base = [makeBasePR()];
    const monitors = [makeMonitor()];
    const result = sectionPRs(base, monitors, workspaceRepo, [], getTitle);
    expect(result.own).toEqual(mergeMonitoredPRs(base, monitors, workspaceRepo));
    expect(result.otherRoots).toEqual([]);
    expect(result.otherTracked).toEqual([]);
  });

  it('returns the base list untouched in own when everything else is empty', () => {
    const base = [makeBasePR()];
    const result = sectionPRs(base, [], workspaceRepo, [], getTitle);
    expect(result.own).toBe(base);
    expect(result.otherRoots).toEqual([]);
    expect(result.otherTracked).toEqual([]);
  });

  it('maps secondary-root pullRequests into otherRoots with repo context', () => {
    const result = sectionPRs([makeBasePR()], [], workspaceRepo, [makeRoot()], getTitle);
    expect(result.otherRoots).toHaveLength(1);
    expect(result.otherRoots[0]).toMatchObject({
      number: 7,
      title: 'Root PR',
      url: 'https://github.com/acme/intentd/pull/7',
      status: 'open',
      crossRepo: 'acme/intentd',
      crossRepoDisplay: 'intentd',
    });
  });

  it('keeps the full owner/name in crossRepoDisplay when the root org differs', () => {
    const root = makeRoot({
      repoOwner: 'other',
      repoName: 'repo',
      pullRequests: [makeRootPR({ url: 'https://github.com/other/repo/pull/7' })],
    });
    const result = sectionPRs([], [], workspaceRepo, [root], getTitle);
    expect(result.otherRoots[0].crossRepo).toBe('other/repo');
    expect(result.otherRoots[0].crossRepoDisplay).toBe('other/repo');
  });

  it('constructs a GitHub URL when the root PR carries none', () => {
    const root = makeRoot({ pullRequests: [makeRootPR({ url: '' })] });
    const result = sectionPRs([], [], workspaceRepo, [root], getTitle);
    expect(result.otherRoots[0].url).toBe('https://github.com/acme/intentd/pull/7');
  });

  it('attributes a monitor on a root repo to otherRoots, annotating the matching row', () => {
    const monitor = makeMonitor({
      repo: 'acme/intentd',
      prNumber: 7,
      url: 'https://github.com/acme/intentd/pull/7',
    });
    const result = sectionPRs([], [monitor], workspaceRepo, [makeRoot()], getTitle);
    expect(result.own).toEqual([]);
    expect(result.otherTracked).toEqual([]);
    expect(result.otherRoots).toHaveLength(1);
    expect(result.otherRoots[0].monitorAgentId).toBe('agent-1');
    expect(result.otherRoots[0].monitorOnly).toBeUndefined();
  });

  it('appends an unmatched root-repo monitor to otherRoots as a monitor-only row', () => {
    const monitor = makeMonitor({
      repo: 'acme/intentd',
      prNumber: 99,
      url: 'https://github.com/acme/intentd/pull/99',
    });
    const result = sectionPRs([], [monitor], workspaceRepo, [makeRoot()], getTitle);
    expect(result.otherRoots).toHaveLength(2);
    expect(result.otherRoots[1]).toMatchObject({
      number: 99,
      monitorOnly: true,
      crossRepo: 'acme/intentd',
    });
  });

  it('routes monitors matching no root into otherTracked', () => {
    const monitor = makeMonitor({
      repo: 'stranger/repo',
      prNumber: 5,
      url: 'https://github.com/stranger/repo/pull/5',
    });
    const result = sectionPRs([], [monitor], workspaceRepo, [makeRoot()], getTitle);
    expect(result.otherRoots).toHaveLength(1);
    expect(result.otherTracked).toHaveLength(1);
    expect(result.otherTracked[0]).toMatchObject({
      number: 5,
      monitorOnly: true,
      crossRepo: 'stranger/repo',
    });
  });

  it('keeps workspace-repo monitors in own even when a root points at the same repo', () => {
    const root = makeRoot({
      repoOwner: 'acme',
      repoName: 'widgets',
      pullRequests: [],
    });
    const result = sectionPRs([makeBasePR()], [makeMonitor()], workspaceRepo, [root], getTitle);
    expect(result.own).toHaveLength(1);
    expect(result.own[0].monitorAgentId).toBe('agent-1');
    expect(result.otherRoots).toEqual([]);
  });

  it('treats every monitor as own when the workspace repo is unknown, mirroring mergeMonitoredPRs', () => {
    const monitor = makeMonitor({ repo: 'other/repo' });
    const result = sectionPRs([], [monitor], undefined, [makeRoot()], getTitle);
    expect(result.own).toHaveLength(1);
    expect(result.otherTracked).toEqual([]);
  });

  it('skips roots without a detected owner/name', () => {
    const root = makeRoot({ repoOwner: undefined, repoName: undefined });
    const result = sectionPRs([], [], workspaceRepo, [root], getTitle);
    expect(result.otherRoots).toEqual([]);
  });

  it('drops a root PR duplicating an own row identity (same-repo subtree checkout)', () => {
    const root = makeRoot({
      repoOwner: 'acme',
      repoName: 'widgets',
      pullRequests: [makeRootPR({ number: 42 })],
    });
    const result = sectionPRs([makeBasePR({ number: 42 })], [], workspaceRepo, [root], getTitle);
    expect(result.own).toHaveLength(1);
    expect(result.otherRoots).toEqual([]);
  });

  it('leaves crossRepo unset for a root PR on the workspace repo itself', () => {
    const root = makeRoot({
      repoOwner: 'acme',
      repoName: 'widgets',
      pullRequests: [makeRootPR({ number: 8, url: 'https://github.com/acme/widgets/pull/8' })],
    });
    const result = sectionPRs([makeBasePR({ number: 42 })], [], workspaceRepo, [root], getTitle);
    expect(result.otherRoots).toHaveLength(1);
    expect(result.otherRoots[0].crossRepo).toBeUndefined();
    expect(result.otherRoots[0].crossRepoDisplay).toBeUndefined();
  });

  it('dedupes the same PR appearing under two roots on the same repo', () => {
    const result = sectionPRs(
      [],
      [],
      workspaceRepo,
      [makeRoot(), makeRoot()],
      getTitle,
    );
    expect(result.otherRoots).toHaveLength(1);
  });

  it('attributes monitors case-insensitively (GitHub repo identities)', () => {
    // A monitor registered as Acme/IntentD against a root detected as
    // acme/intentd must not misclassify into otherTracked; likewise a
    // differently-cased workspace-repo monitor stays in own.
    const rootMonitor = makeMonitor({
      monitorId: 'mon-root',
      repo: 'Acme/IntentD',
      prNumber: 99,
      url: 'https://github.com/acme/intentd/pull/99',
    });
    const ownMonitor = makeMonitor({ monitorId: 'mon-own', repo: 'ACME/Widgets' });
    const result = sectionPRs([], [ownMonitor, rootMonitor], workspaceRepo, [makeRoot()], getTitle);
    expect(result.otherTracked).toEqual([]);
    expect(result.own).toHaveLength(1);
    expect(result.own[0].monitorAgentId).toBe('agent-1');
    expect(result.otherRoots.map((pr) => pr.number)).toEqual([7, 99]);
  });

  it('drops the crossRepo context for a root PR on a differently-cased workspace repo', () => {
    const root = makeRoot({
      repoOwner: 'Acme',
      repoName: 'Widgets',
      pullRequests: [makeRootPR({ number: 8, url: 'https://github.com/Acme/Widgets/pull/8' })],
    });
    const result = sectionPRs([], [], workspaceRepo, [root], getTitle);
    expect(result.otherRoots).toHaveLength(1);
    expect(result.otherRoots[0].crossRepo).toBeUndefined();
    expect(result.otherRoots[0].crossRepoDisplay).toBeUndefined();
  });

  it('keeps repo-qualified row keys unique across all three sections', () => {
    const rootMonitor = makeMonitor({
      monitorId: 'mon-root',
      repo: 'acme/intentd',
      prNumber: 7,
    });
    const trackedMonitor = makeMonitor({
      monitorId: 'mon-tracked',
      repo: 'stranger/repo',
      prNumber: 42,
    });
    const result = sectionPRs(
      [makeBasePR({ number: 42 })],
      [makeMonitor(), rootMonitor, trackedMonitor],
      workspaceRepo,
      [makeRoot()],
      getTitle,
    );
    const all = [...result.own, ...result.otherRoots, ...result.otherTracked];
    const keys = all.map((pr) => (pr.crossRepo ? `${pr.crossRepo}#${pr.number}` : String(pr.number)));
    expect(new Set(keys).size).toBe(keys.length);
  });

  // ─── Cross-repo base rows from the daemon-merged pool (intentd#1330) ───────

  it('partitions a cross-repo base row into otherRoots when a root matches its repo', () => {
    const base = [
      makeBasePR(),
      makeBasePR({
        number: 7,
        url: 'https://github.com/acme/intentd/pull/7',
        htmlUrl: 'https://github.com/acme/intentd/pull/7',
        crossRepo: 'acme/intentd',
        crossRepoDisplay: 'intentd',
      }),
    ];
    const result = sectionPRs(base, [], workspaceRepo, [makeRoot({ pullRequests: [] })], getTitle);
    expect(result.own.map((pr) => pr.number)).toEqual([42]);
    expect(result.otherRoots.map((pr) => pr.number)).toEqual([7]);
    expect(result.otherTracked).toEqual([]);
  });

  it('partitions a cross-repo base row matching no root into otherTracked', () => {
    const base = [
      makeBasePR({
        number: 5,
        url: 'https://github.com/stranger/repo/pull/5',
        crossRepo: 'stranger/repo',
        crossRepoDisplay: 'stranger/repo',
      }),
    ];
    const result = sectionPRs(base, [], workspaceRepo, [makeRoot()], getTitle);
    expect(result.own).toEqual([]);
    expect(result.otherTracked.map((pr) => pr.number)).toEqual([5]);
  });

  it('does not duplicate a cross-repo base row against the same PR from the root pool (no flicker after open)', () => {
    // Before opening, the daemon-merged pullRequests carry the root PR;
    // after opening, gitRoot.list delivers the same PR — one row, not two.
    const base = [
      makeBasePR({
        number: 7,
        url: 'https://github.com/acme/intentd/pull/7',
        crossRepo: 'acme/intentd',
        crossRepoDisplay: 'intentd',
      }),
    ];
    const result = sectionPRs(base, [], workspaceRepo, [makeRoot()], getTitle);
    expect(result.otherRoots).toHaveLength(1);
    expect(result.otherRoots[0].number).toBe(7);
  });

  it('annotates a cross-repo base row in otherTracked with its matching monitor (no double count)', () => {
    const base = [
      makeBasePR({
        number: 5,
        url: 'https://github.com/stranger/repo/pull/5',
        crossRepo: 'stranger/repo',
        crossRepoDisplay: 'stranger/repo',
      }),
    ];
    const monitor = makeMonitor({
      repo: 'stranger/repo',
      prNumber: 5,
      url: 'https://github.com/stranger/repo/pull/5',
    });
    const result = sectionPRs(base, [monitor], workspaceRepo, [], getTitle);
    expect(result.otherTracked).toHaveLength(1);
    expect(result.otherTracked[0].monitorAgentId).toBe('agent-1');
    expect(result.otherTracked[0].monitorOnly).toBeUndefined();
  });
});

// ─── orderPRSectionsForSelection (dropdown-follow ordering, monorepo#2053) ─────

describe('orderPRSectionsForSelection', () => {
  const workspaceRepo = 'acme/widgets';

  function makePR(overrides: Partial<PRInfo> = {}): PRInfo {
    return {
      number: 42,
      title: 'Branch PR',
      url: 'https://github.com/acme/widgets/pull/42',
      htmlUrl: 'https://github.com/acme/widgets/pull/42',
      status: 'open',
      ...overrides,
    };
  }

  function makeSectioned(overrides: Partial<SectionedPRs> = {}): SectionedPRs {
    return {
      own: [makePR()],
      otherRoots: [
        makePR({ number: 7, crossRepo: 'acme/intentd', crossRepoDisplay: 'intentd' }),
        makePR({ number: 9, crossRepo: 'acme/ios', crossRepoDisplay: 'ios' }),
      ],
      otherTracked: [makePR({ number: 5, crossRepo: 'stranger/repo', monitorOnly: true })],
      ...overrides,
    };
  }

  it('keeps the selection-unaware sectioning (as recency-sorted copies) when primary is selected', () => {
    const sectioned = makeSectioned();
    const result = orderPRSectionsForSelection(sectioned, workspaceRepo, null);
    expect(result.selected.map((pr) => pr.number)).toEqual([42]);
    // No updatedAt on these rows: PR number desc is the tiebreak.
    expect(result.others.map((pr) => pr.number)).toEqual([9, 7]);
    expect(result.otherTracked.map((pr) => pr.number)).toEqual([5]);
    // Sorted copies, not the input arrays.
    expect(result.selected).not.toBe(sectioned.own);
    expect(result.others).not.toBe(sectioned.otherRoots);
    expect(result.otherTracked).not.toBe(sectioned.otherTracked);
  });

  it('moves the selected root PRs on top and own PRs under others', () => {
    const sectioned = makeSectioned();
    const result = orderPRSectionsForSelection(sectioned, workspaceRepo, {
      repoOwner: 'acme',
      repoName: 'intentd',
    });
    expect(result.selected).toHaveLength(1);
    expect(result.selected[0]).toMatchObject({ number: 7, crossRepo: 'acme/intentd' });
    // Own PRs first, then the non-selected roots' rows
    expect(result.others.map((pr) => pr.number)).toEqual([42, 9]);
    expect(result.otherTracked).toEqual(sectioned.otherTracked);
  });

  it('attributes rows without crossRepo context to a selected root on the workspace repo', () => {
    // A subtree-checkout root on the workspace repo produces bare rows
    // (sectionPRs drops the repo context for sameRepo roots).
    const sectioned = makeSectioned({
      otherRoots: [makePR({ number: 8 })],
    });
    const result = orderPRSectionsForSelection(sectioned, workspaceRepo, {
      repoOwner: 'acme',
      repoName: 'widgets',
    });
    expect(result.selected.map((pr) => pr.number)).toEqual([8]);
    expect(result.others.map((pr) => pr.number)).toEqual([42]);
  });

  it('owns no rows when the selected root has no detected owner/name', () => {
    const sectioned = makeSectioned();
    const result = orderPRSectionsForSelection(sectioned, workspaceRepo, {});
    expect(result.selected).toEqual([]);
    expect(result.others.map((pr) => pr.number)).toEqual([42, 9, 7]);
    expect(result.otherTracked).toEqual(sectioned.otherTracked);
  });

  it('leaves otherTracked membership untouched by any selection', () => {
    const sectioned = makeSectioned();
    const secondary = orderPRSectionsForSelection(sectioned, workspaceRepo, {
      repoOwner: 'acme',
      repoName: 'intentd',
    });
    expect(secondary.otherTracked).toEqual(sectioned.otherTracked);
  });

  it('never moves own or tracked rows into selected', () => {
    const sectioned = makeSectioned();
    // Selecting a root that shadows the workspace repo: own rows stay
    // functional-side (they were never in otherRoots).
    const result = orderPRSectionsForSelection(sectioned, workspaceRepo, {
      repoOwner: 'stranger',
      repoName: 'repo',
    });
    expect(result.selected).toEqual([]);
    expect(result.others.map((pr) => pr.number)).toEqual([42, 9, 7]);
    expect(result.otherTracked).toEqual(sectioned.otherTracked);
  });

  it('sorts all three sections by updatedAt desc when primary is selected', () => {
    const sectioned = makeSectioned({
      own: [
        makePR({ number: 1, updatedAt: '2026-01-01T00:00:00Z' }),
        makePR({ number: 2, updatedAt: '2026-03-01T00:00:00Z' }),
      ],
      otherRoots: [
        makePR({ number: 7, crossRepo: 'acme/intentd', updatedAt: '2026-02-01T00:00:00Z' }),
        makePR({ number: 9, crossRepo: 'acme/ios', updatedAt: '2026-04-01T00:00:00Z' }),
      ],
      otherTracked: [
        makePR({ number: 5, crossRepo: 'stranger/repo', updatedAt: '2026-01-01T00:00:00Z' }),
        makePR({ number: 6, crossRepo: 'stranger/repo', updatedAt: '2026-05-01T00:00:00Z' }),
      ],
    });
    const result = orderPRSectionsForSelection(sectioned, workspaceRepo, null);
    expect(result.selected.map((pr) => pr.number)).toEqual([2, 1]);
    expect(result.others.map((pr) => pr.number)).toEqual([9, 7]);
    expect(result.otherTracked.map((pr) => pr.number)).toEqual([6, 5]);
  });

  it('sorts all three sections by updatedAt desc when a secondary root is selected', () => {
    const sectioned = makeSectioned({
      own: [makePR({ number: 1, updatedAt: '2026-01-01T00:00:00Z' })],
      otherRoots: [
        makePR({ number: 7, crossRepo: 'acme/intentd', updatedAt: '2026-02-01T00:00:00Z' }),
        makePR({ number: 8, crossRepo: 'acme/intentd', updatedAt: '2026-04-01T00:00:00Z' }),
        makePR({ number: 9, crossRepo: 'acme/ios', updatedAt: '2026-03-01T00:00:00Z' }),
      ],
      otherTracked: [
        makePR({ number: 5, crossRepo: 'stranger/repo', updatedAt: '2026-01-01T00:00:00Z' }),
        makePR({ number: 6, crossRepo: 'stranger/repo', updatedAt: '2026-05-01T00:00:00Z' }),
      ],
    });
    const result = orderPRSectionsForSelection(sectioned, workspaceRepo, {
      repoOwner: 'acme',
      repoName: 'intentd',
    });
    expect(result.selected.map((pr) => pr.number)).toEqual([8, 7]);
    // Recency wins over the own-first concatenation order.
    expect(result.others.map((pr) => pr.number)).toEqual([9, 1]);
    expect(result.otherTracked.map((pr) => pr.number)).toEqual([6, 5]);
  });

  it('does not mutate the input arrays', () => {
    const sectioned = makeSectioned({
      own: [
        makePR({ number: 1, updatedAt: '2026-01-01T00:00:00Z' }),
        makePR({ number: 2, updatedAt: '2026-03-01T00:00:00Z' }),
      ],
    });
    orderPRSectionsForSelection(sectioned, workspaceRepo, null);
    expect(sectioned.own.map((pr) => pr.number)).toEqual([1, 2]);
    expect(sectioned.otherRoots.map((pr) => pr.number)).toEqual([7, 9]);
  });
});

// ─── sortPRsByRecency (display-only Changes tab recency sort) ──────────────────

describe('sortPRsByRecency', () => {
  function makePR(overrides: Partial<PRInfo> = {}): PRInfo {
    return {
      number: 1,
      title: 'PR',
      url: 'https://github.com/acme/widgets/pull/1',
      htmlUrl: 'https://github.com/acme/widgets/pull/1',
      status: 'open',
      updatedAt: '2026-01-01T00:00:00Z',
      ...overrides,
    };
  }

  it('sorts by updatedAt descending', () => {
    const prs = [
      makePR({ number: 1, updatedAt: '2026-01-01T00:00:00Z' }),
      makePR({ number: 2, updatedAt: '2026-03-01T00:00:00Z' }),
      makePR({ number: 3, updatedAt: '2026-02-01T00:00:00Z' }),
    ];
    expect(sortPRsByRecency(prs).map((pr) => pr.number)).toEqual([2, 3, 1]);
  });

  it('sorts rows missing updatedAt last', () => {
    const prs = [
      makePR({ number: 1, updatedAt: undefined }),
      makePR({ number: 2, updatedAt: '2026-01-01T00:00:00Z' }),
    ];
    expect(sortPRsByRecency(prs).map((pr) => pr.number)).toEqual([2, 1]);
  });

  it('tiebreaks equal or missing updatedAt by descending PR number', () => {
    const equal = [
      makePR({ number: 4, updatedAt: '2026-01-01T00:00:00Z' }),
      makePR({ number: 9, updatedAt: '2026-01-01T00:00:00Z' }),
    ];
    expect(sortPRsByRecency(equal).map((pr) => pr.number)).toEqual([9, 4]);

    const missing = [
      makePR({ number: 3, updatedAt: undefined }),
      makePR({ number: 5, updatedAt: undefined }),
    ];
    expect(sortPRsByRecency(missing).map((pr) => pr.number)).toEqual([5, 3]);
  });

  it('returns a new array without mutating the input', () => {
    const prs = [
      makePR({ number: 1, updatedAt: '2026-01-01T00:00:00Z' }),
      makePR({ number: 2, updatedAt: '2026-03-01T00:00:00Z' }),
    ];
    const sorted = sortPRsByRecency(prs);
    expect(sorted).not.toBe(prs);
    expect(prs.map((pr) => pr.number)).toEqual([1, 2]);
  });
});

// ─── getPRStatusTooltip (hover status, PROTOCOL §6.9) ──────────────────────────

describe('getPRStatusTooltip', () => {
  function makePR(overrides: Partial<PRInfo> = {}): PRInfo {
    return {
      number: 42,
      title: 'PR',
      url: 'https://github.com/acme/widgets/pull/42',
      htmlUrl: 'https://github.com/acme/widgets/pull/42',
      status: 'open',
      ...overrides,
    };
  }

  it('returns just the state line when there is no monitor snapshot', () => {
    expect(getPRStatusTooltip(makePR({ status: 'open' }))).toBe('Open');
    expect(getPRStatusTooltip(makePR({ status: 'draft' }))).toBe('Draft');
    expect(getPRStatusTooltip(makePR({ status: 'merged' }))).toBe('Merged');
    expect(getPRStatusTooltip(makePR({ status: 'closed' }))).toBe('Closed');
  });

  it('adds a checks line only when the snapshot has checks', () => {
    const withChecks = getPRStatusTooltip(
      makePR({
        monitorSnapshot: makeSnapshot({
          checks: {
            total: 3,
            passed: 2,
            failed: 1,
            pending: 0,
            failingRequired: 0,
            pendingRequired: 0,
            requiredKnown: false,
          },
        }),
      }),
    );
    expect(withChecks).toContain('Checks: 2 passed, 1 failed, 0 pending');

    const noChecks = getPRStatusTooltip(makePR({ monitorSnapshot: makeSnapshot() }));
    expect(noChecks).not.toContain('Checks:');
  });

  it('renders approvals with a needed count when the snapshot specifies one', () => {
    const tooltip = getPRStatusTooltip(
      makePR({
        monitorSnapshot: makeSnapshot({
          approvals: { decision: 'REVIEW_REQUIRED', have: 1, needed: 2, changesRequested: 0 },
        }),
      }),
    );
    expect(tooltip).toContain('Approvals: 1 of 2');
  });

  it('renders approvals without a needed count when none is specified', () => {
    const tooltip = getPRStatusTooltip(
      makePR({
        monitorSnapshot: makeSnapshot({
          approvals: { decision: 'APPROVED', have: 2, changesRequested: 0 },
        }),
      }),
    );
    expect(tooltip).toContain('Approvals: 2');
    expect(tooltip).not.toContain('of');
  });

  it('includes changes-requested, unresolved threads, and the merge-blocked reason', () => {
    const tooltip = getPRStatusTooltip(
      makePR({
        monitorSnapshot: makeSnapshot({
          approvals: { decision: 'CHANGES_REQUESTED', have: 0, changesRequested: 2 },
          threads: { unresolved: 3 },
          mergeBlockedReason: 'Merge conflict must be resolved',
        }),
      }),
    );
    expect(tooltip).toContain('Changes requested: 2');
    expect(tooltip).toContain('Unresolved threads: 3');
    expect(tooltip).toContain('Merge conflict must be resolved');
  });

  it('capitalizes a lowercase merge-blocked reason', () => {
    const tooltip = getPRStatusTooltip(
      makePR({
        monitorSnapshot: makeSnapshot({ mergeBlockedReason: 'branch behind base' }),
      }),
    );
    expect(tooltip).toContain('Branch behind base');
    expect(tooltip).not.toContain('branch behind base');
  });

  it('omits snapshot detail lines on merged and closed rows', () => {
    const snapshot = makeSnapshot({
      approvals: { decision: 'REVIEW_REQUIRED', have: 0, needed: 2, changesRequested: 0 },
      mergeBlockedReason: 'blocked by required checks or reviews',
    });
    expect(getPRStatusTooltip(makePR({ status: 'merged', monitorSnapshot: snapshot }))).toBe(
      'Merged',
    );
    expect(getPRStatusTooltip(makePR({ status: 'closed', monitorSnapshot: snapshot }))).toBe(
      'Closed',
    );
  });
});

// ─── countOtherPrs ("+N" indicator over the deduped pool) ──────────────────────

describe('countOtherPrs', () => {
  function makePoolPR(overrides: Partial<PRInfo> = {}): PRInfo {
    return {
      number: 42,
      title: 'Pool PR',
      url: 'https://github.com/acme/widgets/pull/42',
      htmlUrl: 'https://github.com/acme/widgets/pull/42',
      status: 'open',
      ...overrides,
    };
  }

  function makeMonitor(overrides: Partial<PrMonitorRow> = {}): PrMonitorRow {
    return {
      monitorId: 'mon-1',
      workspaceId: 'ws-1',
      agentId: 'agent-1',
      repo: 'acme/widgets',
      prNumber: 42,
      state: 'active',
      pendingChanges: [],
      hasPendingChanges: false,
      createdAt: '2026-08-07T10:00:00Z',
      updatedAt: '2026-08-07T10:05:00Z',
      ...overrides,
    };
  }

  it('excludes the primary PR from the count by URL', () => {
    const pool = [
      makePoolPR(),
      makePoolPR({ number: 7, url: 'https://github.com/acme/widgets/pull/7' }),
    ];
    expect(countOtherPrs(pool, pool[0])).toBe(1);
  });

  it('matches the primary URL case-insensitively', () => {
    const pool = [makePoolPR({ url: 'https://github.com/Acme/Widgets/pull/42' })];
    const primary = makePoolPR({ url: 'https://github.com/acme/widgets/pull/42' });
    expect(countOtherPrs(pool, primary)).toBe(0);
  });

  it('counts the whole pool when there is no primary PR', () => {
    const pool = [
      makePoolPR(),
      makePoolPR({ number: 7, url: 'https://github.com/acme/widgets/pull/7' }),
    ];
    expect(countOtherPrs(pool, undefined)).toBe(2);
  });

  it('returns 0 for an empty pool', () => {
    expect(countOtherPrs([], makePoolPR())).toBe(0);
  });

  it('counts a same-number cross-repo row as "other"', () => {
    const pool = [
      makePoolPR(),
      makePoolPR({
        url: 'https://github.com/other/repo/pull/42',
        crossRepo: 'other/repo',
      }),
    ];
    expect(countOtherPrs(pool, pool[0])).toBe(1);
  });

  it('falls back to repo-qualified number when URLs are absent', () => {
    const pool = [
      makePoolPR({ url: '' }),
      makePoolPR({ number: 7, url: '' }),
    ];
    const primary = makePoolPR({ url: '' });
    expect(countOtherPrs(pool, primary)).toBe(1);
  });

  it('matches the fallback crossRepo identity case-insensitively', () => {
    const pool = [makePoolPR({ url: '', crossRepo: 'Other/Repo' })];
    const primary = makePoolPR({ url: '', crossRepo: 'other/repo' });
    expect(countOtherPrs(pool, primary)).toBe(0);
  });

  it('does not double count a PR present in both the daemon-merged list and as a monitor', () => {
    // Before opening: only the daemon-merged pullRequests. After opening:
    // the same PR also arrives as a live monitor row. The pool is built by
    // mergeMonitoredPRs, so the "+N" count must not change across opening.
    const base = [
      makePoolPR({ number: 1, url: 'https://github.com/acme/widgets/pull/1' }),
      makePoolPR({ number: 42, url: 'https://github.com/acme/widgets/pull/42' }),
    ];
    const before = mergeMonitoredPRs(base, [], 'acme/widgets');
    const after = mergeMonitoredPRs(
      base,
      [makeMonitor({ url: 'https://github.com/acme/widgets/pull/42' })],
      'acme/widgets',
    );
    const primaryBefore = before.find((pr) => pr.number === 42);
    const primaryAfter = after.find((pr) => pr.number === 42);
    expect(countOtherPrs(after, primaryAfter)).toBe(countOtherPrs(before, primaryBefore));
    expect(countOtherPrs(after, primaryAfter)).toBe(1);
  });
});

// ─── toPullRequestStatus (display status → enum projection) ────────────────────

describe('toPullRequestStatus', () => {
  it('maps each display status to the matching enum value', () => {
    expect(toPullRequestStatus('open')).toBe(PullRequestStatus.Open);
    expect(toPullRequestStatus('merged')).toBe(PullRequestStatus.Merged);
    expect(toPullRequestStatus('closed')).toBe(PullRequestStatus.Closed);
    expect(toPullRequestStatus('draft')).toBe(PullRequestStatus.Draft);
  });
});

// ─── monitorDisplayStatus / monitorPillStatus (pill status fallback) ───────────

describe('monitorDisplayStatus', () => {
  function makeMonitor(overrides: Partial<PrMonitorRow> = {}): PrMonitorRow {
    return {
      monitorId: 'mon-1',
      workspaceId: 'ws-1',
      agentId: 'agent-1',
      repo: 'acme/widgets',
      prNumber: 42,
      state: 'active',
      pendingChanges: [],
      hasPendingChanges: false,
      createdAt: '2026-08-07T10:00:00Z',
      updatedAt: '2026-08-07T10:05:00Z',
      ...overrides,
    };
  }

  it('reads the last-snapshot state case-insensitively', () => {
    expect(monitorDisplayStatus(makeMonitor({ lastSnapshot: makeSnapshot({ state: 'MERGED' }) })))
      .toBe('merged');
    expect(monitorDisplayStatus(makeMonitor({ lastSnapshot: makeSnapshot({ state: 'Closed' }) })))
      .toBe('closed');
  });

  it('reports draft from the snapshot flag', () => {
    expect(
      monitorDisplayStatus(makeMonitor({ lastSnapshot: makeSnapshot({ isDraft: true }) })),
    ).toBe('draft');
  });

  it('defaults active monitors to open and completed ones to closed without a verdict', () => {
    expect(monitorDisplayStatus(makeMonitor())).toBe('open');
    expect(monitorDisplayStatus(makeMonitor({ state: 'completed' }))).toBe('closed');
  });
});

describe('monitorPillStatus', () => {
  function makeMonitor(overrides: Partial<PrMonitorRow> = {}): PrMonitorRow {
    return {
      monitorId: 'mon-1',
      workspaceId: 'ws-1',
      agentId: 'agent-1',
      repo: 'acme/widgets',
      prNumber: 42,
      state: 'active',
      pendingChanges: [],
      hasPendingChanges: false,
      createdAt: '2026-08-07T10:00:00Z',
      updatedAt: '2026-08-07T10:05:00Z',
      ...overrides,
    };
  }

  it('maps a merged completed monitor to PullRequestStatus.Merged', () => {
    const monitor = makeMonitor({
      state: 'completed',
      lastSnapshot: makeSnapshot({ state: 'merged' }),
    });
    expect(monitorPillStatus(monitor)).toBe(PullRequestStatus.Merged);
  });

  it('maps closed, draft, and open display states to the matching enum values', () => {
    expect(
      monitorPillStatus(makeMonitor({ lastSnapshot: makeSnapshot({ state: 'closed' }) })),
    ).toBe(PullRequestStatus.Closed);
    expect(
      monitorPillStatus(makeMonitor({ lastSnapshot: makeSnapshot({ isDraft: true }) })),
    ).toBe(PullRequestStatus.Draft);
    expect(monitorPillStatus(makeMonitor())).toBe(PullRequestStatus.Open);
  });
});
